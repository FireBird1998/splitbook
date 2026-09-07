/**
 * Integration tests for recurring expense templates (v4 Phase 3) against a
 * real, isolated MongoDB database (`splitbook-test-recurring`).
 *
 * Covers the spec's core guarantees: idempotent generation under concurrency
 * (unique (recurringExpense, period) index), lazy-on-read catch-up, pause /
 * resume semantics, visible-pause on invalid group state, template deletion
 * leaving generated expenses intact, and generated expenses flowing through
 * the monthly per-member breakdown like any manual expense.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Activity from '@/lib/models/Activity';
import Expense from '@/lib/models/Expense';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { previousPeriod, toPeriod } from '@splitbook/shared/recurring-due-periods';
import type { CreateRecurringExpenseInput } from '@splitbook/shared/validators/recurring-expense';

const db = integrationTestDb('recurring');
const { alice, bob, carol } = TEST_USER_IDS;

const NOW = new Date();
const CURRENT_PERIOD = toPeriod(NOW);
const CURRENT_YEAR = NOW.getUTCFullYear();
const CURRENT_MONTH = NOW.getUTCMonth(); // 0-based
const DAYS_IN_CURRENT_MONTH = new Date(Date.UTC(CURRENT_YEAR, CURRENT_MONTH + 1, 0)).getUTCDate();

function dateInCurrentPeriod(day: number): Date {
  return new Date(Date.UTC(CURRENT_YEAR, CURRENT_MONTH, day));
}

function periodOffset(delta: number): Date {
  return new Date(Date.UTC(CURRENT_YEAR, CURRENT_MONTH + delta, 5));
}

/** 1st of the month `delta` months from now — a startsOn that makes every
 *  month in the offset window eligible for a day-1 template. */
function firstOfMonthOffset(delta: number): Date {
  return new Date(Date.UTC(CURRENT_YEAR, CURRENT_MONTH + delta, 1));
}

beforeAll(async () => {
  await db.connect();
  // The concurrency test relies on the unique (recurringExpense, period)
  // index — make sure Mongoose has built it before any inserts race.
  await Expense.createIndexes();
});
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol');
});
afterAll(db.teardown);

async function createHousehold(): Promise<string> {
  const group = await groupService.create(
    { name: 'Recurring Flat', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  const groupId = group._id.toString();
  await groupService.addMember(groupId, bob);
  await groupService.addMember(groupId, carol);
  return groupId;
}

function rentTemplate(overrides: Partial<CreateRecurringExpenseInput> = {}) {
  return {
    description: 'Rent',
    amount: 30000,
    currency: 'INR',
    category: 'housing',
    tag: 'Rent',
    paidBy: [{ user: alice, amount: 30000 }],
    splitMethod: 'equal' as const,
    splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
    dayOfMonth: 1,
    startsOn: dateInCurrentPeriod(1),
    ...overrides,
  };
}

async function expensesFor(templateId: string) {
  return Expense.find({ recurringExpense: templateId, isDeleted: false }).lean();
}

describe('recurring expense generation', () => {
  it('materializes the due period on create and marks the expense as recurring', async () => {
    const groupId = await createHousehold();
    const template = await recurringExpenseService.create(groupId, rentTemplate(), alice);
    expect(template).not.toBeNull();

    const expenses = await expensesFor(template!._id.toString());
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      description: 'Rent',
      amount: 30000,
      currency: 'INR',
      tag: 'Rent',
      period: CURRENT_PERIOD,
      isDeleted: false,
    });
    expect(expenses[0].date.toISOString()).toBe(dateInCurrentPeriod(1).toISOString());
    expect(expenses[0].recurringExpense?.toString()).toBe(template!._id.toString());
    // Equal split resolved like a manual expense.
    expect(expenses[0].splitBetween.map((s) => s.amount)).toEqual([10000, 10000, 10000]);
    expect(expenses[0].createdBy.toString()).toBe(alice);

    const stored = await RecurringExpense.findById(template!._id).lean();
    expect(stored?.lastGeneratedFor).toBe(CURRENT_PERIOD);
  });

  it('logs an expense_added activity per generated expense with recurring metadata', async () => {
    const groupId = await createHousehold();
    const template = await recurringExpenseService.create(groupId, rentTemplate(), alice);

    const activities = await Activity.find({
      group: groupId,
      type: 'expense_added',
      'metadata.recurring': true,
    }).lean();

    expect(activities).toHaveLength(1);
    expect(activities[0].actor.toString()).toBe(alice);
    expect(activities[0].metadata).toMatchObject({
      description: 'Rent',
      amount: 30000,
      currency: 'INR',
      recurring: true,
      recurringExpenseId: template!._id.toString(),
      period: CURRENT_PERIOD,
    });
  });

  it('produces exactly one expense under concurrent generation', async () => {
    const groupId = await createHousehold();
    // startsOn next month: create() materializes nothing, so the race below
    // is about creating the expense itself.
    const template = await recurringExpenseService.create(
      groupId,
      rentTemplate({ startsOn: firstOfMonthOffset(1) }),
      alice,
    );
    const templateId = template!._id.toString();
    expect(await expensesFor(templateId)).toHaveLength(0);

    const raced = await Promise.all(
      Array.from({ length: 5 }, () =>
        recurringExpenseService.generateDueExpenses(groupId, periodOffset(1)),
      ),
    );

    const expenses = await expensesFor(templateId);
    expect(expenses).toHaveLength(1);
    expect(raced.reduce((sum, r) => sum + r.generated, 0)).toBe(1);
    expect(expenses[0].period).toBe(toPeriod(periodOffset(1)));
  });

  it('is idempotent on sequential re-reads', async () => {
    const groupId = await createHousehold();
    const template = await recurringExpenseService.create(groupId, rentTemplate(), alice);

    const second = await recurringExpenseService.generateDueExpenses(groupId, NOW);
    expect(second.generated).toBe(0);
    expect(await expensesFor(template!._id.toString())).toHaveLength(1);
  });

  it('catches up missed months when the marker falls behind', async () => {
    const groupId = await createHousehold();
    // startsOn two months back: the template's first read materializes the
    // whole missed window up through the current month.
    const template = await recurringExpenseService.create(
      groupId,
      rentTemplate({ startsOn: firstOfMonthOffset(-2) }),
      alice,
    );
    const templateId = template!._id.toString();

    const twoBack = previousPeriod(previousPeriod(CURRENT_PERIOD));
    const previous = previousPeriod(CURRENT_PERIOD);
    const expenses = await expensesFor(templateId);
    expect(expenses).toHaveLength(3);
    expect(expenses.map((e) => e.period).sort()).toEqual(
      [twoBack, previous, CURRENT_PERIOD].sort(),
    );
    expect(expenses.map((e) => e.date.toISOString()).sort()).toEqual(
      [firstOfMonthOffset(-2), firstOfMonthOffset(-1), firstOfMonthOffset(0)]
        .map((d) => d.toISOString())
        .sort(),
    );

    const stored = await RecurringExpense.findById(templateId).lean();
    expect(stored?.lastGeneratedFor).toBe(CURRENT_PERIOD);
  });

  it('pauses generation and resumes from the current month, skipping the on-hold window', async () => {
    const groupId = await createHousehold();
    const template = await recurringExpenseService.create(groupId, rentTemplate(), alice);
    const templateId = template!._id.toString();

    await recurringExpenseService.update(groupId, templateId, { isPaused: true }, alice);

    // Two simulated months pass on hold: nothing generates.
    const onHold = await recurringExpenseService.generateDueExpenses(groupId, periodOffset(2));
    expect(onHold.generated).toBe(0);
    expect(await expensesFor(templateId)).toHaveLength(1);

    // Rewind the marker as if the template had fallen behind before the hold,
    // then resume: the on-hold window is skipped, generation resumes fresh.
    await RecurringExpense.updateOne(
      { _id: templateId },
      { $set: { lastGeneratedFor: previousPeriod(previousPeriod(CURRENT_PERIOD)) } },
    );
    await recurringExpenseService.update(groupId, templateId, { isPaused: false }, alice);

    // The on-hold month between the stale marker and the current period is
    // never materialized; the marker lands on the current period.
    const stored = await RecurringExpense.findById(templateId).lean();
    expect(stored?.lastGeneratedFor).toBe(CURRENT_PERIOD);
    const periodsAfterResume = (await expensesFor(templateId)).map((e) => e.period);
    expect(periodsAfterResume).not.toContain(previousPeriod(CURRENT_PERIOD));

    const resumed = await recurringExpenseService.generateDueExpenses(groupId, NOW);
    expect(resumed.generated).toBe(0); // current period already materialized
    const afterResume = await recurringExpenseService.generateDueExpenses(groupId, periodOffset(1));
    expect(afterResume.generated).toBe(1); // next month only — no backfill
    expect(await expensesFor(templateId)).toHaveLength(2);
  });

  it('skips generation visibly when the template tag is archived, and catches up when restored', async () => {
    const groupId = await createHousehold();
    const template = await recurringExpenseService.create(groupId, rentTemplate(), alice);
    const templateId = template!._id.toString();

    const group = await groupService.getById(groupId);
    const rentTag = (group?.tags || []).find((t) => t.name === 'Rent')!;
    await groupService.updateTag(groupId, rentTag._id.toString(), { isArchived: true }, alice);

    // Next month arrives: the template's tag is archived, so nothing is
    // generated and the marker does not advance (problem surfaces in settings).
    const whileArchived = await recurringExpenseService.generateDueExpenses(
      groupId,
      periodOffset(1),
    );
    expect(whileArchived.generated).toBe(0);
    expect(await expensesFor(templateId)).toHaveLength(1);
    let stored = await RecurringExpense.findById(templateId).lean();
    expect(stored?.lastGeneratedFor).toBe(CURRENT_PERIOD);

    // Unarchive: the missed month materializes on the next read.
    await groupService.updateTag(groupId, rentTag._id.toString(), { isArchived: false }, alice);
    const afterRestore = await recurringExpenseService.generateDueExpenses(
      groupId,
      periodOffset(1),
    );
    expect(afterRestore.generated).toBe(1);
    expect(await expensesFor(templateId)).toHaveLength(2);
    stored = await RecurringExpense.findById(templateId).lean();
    expect(stored?.lastGeneratedFor).toBe(toPeriod(periodOffset(1)));
  });

  it('never generates for a day-of-month that precedes startsOn in its first month', async () => {
    const groupId = await createHousehold();
    // startsOn the 10th with day 1: this month's 1st is before the template
    // existed, so nothing is due until next month.
    const template = await recurringExpenseService.create(
      groupId,
      rentTemplate({ dayOfMonth: 1, startsOn: dateInCurrentPeriod(10) }),
      alice,
    );
    expect(await expensesFor(template!._id.toString())).toHaveLength(0);

    const nextMonth = await recurringExpenseService.generateDueExpenses(groupId, periodOffset(1));
    expect(nextMonth.generated).toBe(1);
    const expenses = await expensesFor(template!._id.toString());
    expect(expenses[0].period).toBe(toPeriod(periodOffset(1)));
  });
});

describe('recurring template management', () => {
  it('rejects creation by non-admins and in non-Household themes', async () => {
    const groupId = await createHousehold();
    await expect(recurringExpenseService.create(groupId, rentTemplate(), bob)).rejects.toThrow(
      'FORBIDDEN',
    );

    const trip = await groupService.create(
      { name: 'Goa Again', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
      alice,
    );
    await expect(
      recurringExpenseService.create(trip._id.toString(), rentTemplate({ tag: 'General' }), alice),
    ).rejects.toThrow('NOT_HOUSEHOLD');
  });

  it('rejects invalid windows and unknown tags', async () => {
    const groupId = await createHousehold();
    await expect(
      recurringExpenseService.create(
        groupId,
        rentTemplate({
          startsOn: dateInCurrentPeriod(10),
          endsOn: dateInCurrentPeriod(5),
        }),
        alice,
      ),
    ).rejects.toThrow('INVALID_WINDOW');

    await expect(
      recurringExpenseService.create(groupId, rentTemplate({ tag: 'NoSuchTag' }), alice),
    ).rejects.toThrow('INVALID_TAG');

    await expect(
      recurringExpenseService.create(groupId, rentTemplate({ currency: 'USD' }), alice),
    ).rejects.toThrow('CURRENCY_MISMATCH');
  });

  it('deletes a template without touching the expenses it generated', async () => {
    const groupId = await createHousehold();
    const template = await recurringExpenseService.create(groupId, rentTemplate(), alice);
    const templateId = template!._id.toString();
    expect(await expensesFor(templateId)).toHaveLength(1);

    const removed = await recurringExpenseService.remove(groupId, templateId, alice);
    expect(removed).not.toBeNull();
    expect(await RecurringExpense.findById(templateId)).toBeNull();

    // Generated expense survives, still ordinary (soft-deletable, recurring-marked).
    const survivors = await Expense.find({ recurringExpense: templateId }).lean();
    expect(survivors).toHaveLength(1);
    expect(survivors[0].isDeleted).toBe(false);
    expect(survivors[0].period).toBe(CURRENT_PERIOD);

    // No templates remain, so generation is a no-op.
    const result = await recurringExpenseService.generateDueExpenses(groupId, periodOffset(1));
    expect(result.generated).toBe(0);
  });

  it('scopes templates to their group', async () => {
    const groupId = await createHousehold();
    const otherGroupId = await createHousehold();
    const template = await recurringExpenseService.create(groupId, rentTemplate(), alice);

    const wrongGroup = await recurringExpenseService.update(
      otherGroupId,
      template!._id.toString(),
      { isPaused: true },
      alice,
    );
    expect(wrongGroup).toBeNull();
  });
});

describe('generated expenses in monthly views', () => {
  it('appears in the month window and the byMember breakdown like a manual expense', async () => {
    const groupId = await createHousehold();
    await recurringExpenseService.create(groupId, rentTemplate(), alice);

    const dateFrom = `${CURRENT_PERIOD}-01`;
    const dateTo = `${CURRENT_PERIOD}-${String(DAYS_IN_CURRENT_MONTH).padStart(2, '0')}`;
    const result = await expenseService.getGroupExpenses(
      groupId,
      { dateFrom, dateTo, includeMemberBreakdown: true },
      alice,
    );

    expect(result.summary.totalAmount).toBe(30000);
    expect(result.summary.count).toBe(1);

    const byMember = result.summary.byMember!;
    const rowFor = (userId: string) => byMember.find((row) => row.user._id === userId)!;
    expect(rowFor(alice)).toMatchObject({ paid: 30000, share: 10000, net: -20000 });
    expect(rowFor(bob)).toMatchObject({ paid: 0, share: 10000, net: 10000 });
    expect(rowFor(carol)).toMatchObject({ paid: 0, share: 10000, net: 10000 });

    const nets = byMember.reduce((sum, row) => sum + row.net, 0);
    expect(Math.abs(nets)).toBeLessThanOrEqual(0.01);
  });
});
