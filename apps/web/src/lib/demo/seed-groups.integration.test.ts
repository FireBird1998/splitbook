/**
 * Integration tests for the demo Groups the seed adds beside the Goa trip (#302), against a
 * real, isolated MongoDB database (`splitbook-test-seed-groups`). They seed through
 * `seedDemoData` and `resetDemoData`, the functions `pnpm web demo:seed` and `demo:reset` run.
 */

import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import User from '@/lib/models/User';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Activity from '@/lib/models/Activity';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Invitation from '@/lib/models/Invitation';
import ProductSwitch from '@/lib/models/ProductSwitch';
import { resetDemoData, seedDemoData } from '@/lib/demo/seed';
import { buildDemoGroupsPlan, type DemoGroupPlan } from '@/lib/demo/groups-plan';
import {
  DEMO_GROUP_ID,
  DEMO_HOUSEHOLD_ID,
  DEMO_PERSONAS,
  DEMO_PERSONA_IDS,
  DEMO_SEEDED_GROUP_IDS,
  DEMO_WEEK_TRIP_ID,
  DEMO_WORK_GROUP_ID,
} from '@/lib/demo-personas';
import { balanceService } from '@/lib/services/balance.service';
import { expenseService } from '@/lib/services/expense.service';
import { invitationService } from '@/lib/services/invitation.service';
import { defaultTagsForCategory } from '@splitbook/shared/default-tags';
import { toPeriod } from '@splitbook/shared/recurring-due-periods';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

const db = integrationTestDb('seed-groups');
const { alex, sam, priya } = DEMO_PERSONA_IDS;
const priyaEmail = DEMO_PERSONAS.find((persona) => persona.id === priya)!.email;

/** Recurring Expenses are off unless the variable is exactly `true` (#289). */
function switchRecurringExpenses(on: boolean) {
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', on ? 'true' : undefined);
}

function planFor(groupId: string): DemoGroupPlan {
  return buildDemoGroupsPlan(new Date()).find((plan) => plan.groupId === groupId)!;
}

async function balancesOf(groupId: string) {
  const result = await balanceService.getGroupBalances(groupId);
  const lean = result!.balances as Array<{ user: { _id: string }; balance: number }>;
  return {
    byUser: Object.fromEntries(lean.map((row) => [row.user._id, row.balance])),
    debts: result!.debts as Array<{ from: { _id: string }; to: { _id: string }; amount: number }>,
    hasMixedCurrencies: result!.hasMixedCurrencies,
  };
}

/**
 * What the seed stored in its Groups, without generated ids or write times, so two runs on
 * the same day compare equal. Recurring links are left out: they differ by design.
 */
async function seededLedger() {
  const groups = await Group.find({ _id: { $in: [...DEMO_SEEDED_GROUP_IDS] } })
    .sort({ _id: 1 })
    .lean();
  const ledger = [];
  for (const group of groups) {
    const tagName = new Map(group.tags.map((tag) => [String(tag._id), tag.name]));
    const expenses = await Expense.find({ group: group._id }).lean();
    const settlements = await Settlement.find({ group: group._id }).lean();
    const sorted = <T>(rows: T[]) =>
      rows.map((row) => JSON.stringify(row)).sort() as unknown as T[];
    ledger.push({
      id: String(group._id),
      name: group.name,
      description: group.description,
      category: group.category,
      currency: group.defaultCurrency,
      currencyLocked: group.currencyLocked,
      startDate: group.startDate?.toISOString() ?? null,
      endDate: group.endDate?.toISOString() ?? null,
      members: group.members.map((member) => [
        String(member.user),
        member.role,
        member.joinedAt.toISOString(),
      ]),
      tags: group.tags.map((tag) => [tag.name, tag.isArchived]),
      expenses: sorted(
        expenses.map((expense) => ({
          description: expense.description,
          amountMinor: expense.amountMinor,
          currency: expense.currency,
          category: expense.category,
          tag: tagName.get(String(expense.tagId)),
          date: expense.date.toISOString(),
          splitMethod: expense.splitMethod,
          paidBy: expense.paidBy.map((row) => [String(row.user), row.amountMinor]),
          splitBetween: expense.splitBetween.map((row) => [String(row.user), row.amountMinor]),
          notes: expense.notes || '',
          createdBy: String(expense.createdBy),
          isDeleted: expense.isDeleted,
          edits: expense.editHistory.map((edit) => [String(edit.editedBy), edit.changes]),
        })),
      ),
      settlements: sorted(
        settlements.map((settlement) => ({
          paidBy: String(settlement.paidBy),
          paidTo: String(settlement.paidTo),
          amountMinor: settlement.amountMinor,
          currency: settlement.currency,
          note: settlement.note,
        })),
      ),
    });
  }
  return ledger;
}

beforeAll(db.connect);
beforeEach(db.reset);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(db.teardown);

describe('demo Groups beside the Goa trip (#302)', () => {
  it('creates a Household, a week-long Trip and a Work Group with recurring Expenses on', async () => {
    switchRecurringExpenses(true);
    const result = await seedDemoData();

    expect(result.recurringExpenses).toBe('on');
    expect(result.demoGroups.map((group) => group.groupId).sort()).toEqual(
      [DEMO_HOUSEHOLD_ID, DEMO_WEEK_TRIP_ID, DEMO_WORK_GROUP_ID].sort(),
    );
    for (const group of result.demoGroups) {
      const plan = planFor(group.groupId);
      expect(group).toMatchObject({
        groupCreated: true,
        membersEnsured: plan.memberIds.length - 1,
        tagsEnsured: 0,
        expensesEdited: plan.edits.length,
        expensesDeleted: plan.deletions.length,
        recurringTemplatesCreated: plan.recurring.length,
        settlementsCreated: plan.settlements.length,
        invitationsCreated: plan.invitations.length,
        skippedTransactions: false,
      });

      const stored = await Group.findById(group.groupId).lean();
      expect(stored).toMatchObject({
        name: plan.name,
        category: plan.category,
        defaultCurrency: 'INR',
        currencyLocked: true,
        isArchived: false,
      });
      expect(stored!.members.map((member) => [String(member.user), member.role])).toEqual(
        plan.memberIds.map((id) => [id, id === plan.adminId ? 'admin' : 'member']),
      );
      expect(stored!.tags.map((tag) => tag.name)).toEqual([
        ...defaultTagsForCategory(plan.category),
      ]);
    }
  });

  it('keeps one currency in every Group: Expenses, payments and templates', async () => {
    switchRecurringExpenses(true);
    await seedDemoData();

    for (const groupId of DEMO_SEEDED_GROUP_IDS) {
      const group = await Group.findById(groupId).lean();
      const currencies = new Set([
        ...(await Expense.distinct('currency', { group: groupId })),
        ...(await Settlement.distinct('currency', { group: groupId })),
        ...(await RecurringExpense.distinct('currency', { group: groupId })),
      ]);
      expect([...currencies], group!.name).toEqual([group!.defaultCurrency]);
      expect((await balancesOf(groupId)).hasMixedCurrencies).toBe(false);
    }
  });

  it('gives the Household six-plus months of history, edits, a deletion and recurring Months', async () => {
    switchRecurringExpenses(true);
    await seedDemoData();
    const plan = planFor(DEMO_HOUSEHOLD_ID);

    const expenses = await Expense.find({ group: DEMO_HOUSEHOLD_ID }).lean();
    const recurringMonths = plan.recurring.reduce((sum, t) => sum + t.periods.length, 0);
    expect(expenses).toHaveLength(plan.expenses.length + recurringMonths);

    const live = expenses.filter((expense) => !expense.isDeleted);
    const months = new Set(live.map((expense) => toPeriod(expense.date)));
    for (let monthsAgo = 0; monthsAgo <= 6; monthsAgo += 1) {
      const now = new Date();
      const period = toPeriod(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 15)),
      );
      expect(months.has(period), period).toBe(true);
    }
    expect(new Set(live.map((expense) => String(expense.tagId))).size).toBeGreaterThanOrEqual(5);
    expect(new Set(live.map((expense) => expense.category)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(live.flatMap((e) => e.paidBy.map((row) => String(row.user))))).toEqual(
      new Set([alex, sam, priya]),
    );

    const edited = expenses.filter((expense) => expense.editHistory.length > 0);
    expect(edited).toHaveLength(plan.edits.length);
    expect(edited.some((expense) => 'amount' in expense.editHistory[0].changes)).toBe(true);
    const deleted = expenses.filter((expense) => expense.isDeleted);
    expect(deleted).toHaveLength(plan.deletions.length);
    expect(String(deleted[0].deletedBy)).toBe(sam);

    // The templates exist, were created by the Household's admin, and added every Month.
    const templates = await RecurringExpense.find({ group: DEMO_HOUSEHOLD_ID }).lean();
    expect(templates).toHaveLength(plan.recurring.length);
    for (const template of templates) {
      const planned = plan.recurring.find((t) => t.description === template.description)!;
      expect(String(template.createdBy)).toBe(plan.adminId);
      expect(template.lastGeneratedFor).toBe(toPeriod(new Date()));
      const generated = await Expense.find({ recurringExpense: template._id }).lean();
      expect(generated.map((expense) => expense.period).sort()).toEqual(planned.periods);
    }

    const activity = await Activity.find({ group: DEMO_HOUSEHOLD_ID }).lean();
    const count = (type: string) => activity.filter((event) => event.type === type).length;
    expect(count('group_created')).toBe(1);
    expect(count('member_joined')).toBe(2);
    expect(count('expense_added')).toBe(expenses.length);
    expect(count('expense_updated')).toBe(plan.edits.length);
    expect(count('expense_deleted')).toBe(plan.deletions.length);
    expect(count('settlement_recorded')).toBe(plan.settlements.length);
    expect(
      activity.filter((event) => event.type === 'expense_added' && event.metadata.recurring),
    ).toHaveLength(recurringMonths);
  });

  it('leaves the Trip with payments to settle and the Work Group settled, with an invitation', async () => {
    await seedDemoData();

    const trip = await balancesOf(DEMO_WEEK_TRIP_ID);
    expect(trip.byUser).toEqual({ [sam]: 2812, [alex]: -8661, [priya]: 5849 });
    expect(trip.debts.length).toBeGreaterThan(0);
    const tripGroup = await Group.findById(DEMO_WEEK_TRIP_ID).lean();
    const days = (tripGroup!.endDate!.getTime() - tripGroup!.startDate!.getTime()) / 86_400_000;
    expect(days + 1).toBe(6);

    const work = await balancesOf(DEMO_WORK_GROUP_ID);
    expect(work.byUser).toEqual({ [alex]: 0, [sam]: 0 });
    expect(work.debts).toEqual([]);

    const invitations = await invitationService.getPendingByEmail(priyaEmail);
    expect(invitations).toHaveLength(1);
    expect(String((invitations[0].group as unknown as { _id: unknown })._id)).toBe(
      DEMO_WORK_GROUP_ID,
    );
    expect(String((invitations[0].invitedBy as unknown as { _id: unknown })._id)).toBe(alex);
  });

  it('enters the same bills by hand when recurring Expenses are off, so balances match', async () => {
    switchRecurringExpenses(false);
    const off = await seedDemoData();
    expect(off.recurringExpenses).toBe('off');
    expect(await RecurringExpense.countDocuments({})).toBe(0);
    expect(await Expense.countDocuments({ recurringExpense: { $ne: null } })).toBe(0);
    const ledgerOff = await seededLedger();
    const householdOff = await balancesOf(DEMO_HOUSEHOLD_ID);

    switchRecurringExpenses(true);
    const on = await resetDemoData();
    expect(on.recurringExpenses).toBe('on');
    expect(await RecurringExpense.countDocuments({ group: DEMO_HOUSEHOLD_ID })).toBe(2);

    expect(await seededLedger()).toEqual(ledgerOff);
    expect(householdOff.byUser).toEqual({ [priya]: 5972.46, [alex]: -2726.77, [sam]: -3245.69 });
    expect((await balancesOf(DEMO_HOUSEHOLD_ID)).byUser).toEqual(householdOff.byUser);
  });

  it('is deterministic: a reset on the same day stores the same data again', async () => {
    switchRecurringExpenses(true);
    await seedDemoData();
    const first = await seededLedger();
    await resetDemoData();
    expect(await seededLedger()).toEqual(first);
  });

  it('is idempotent: seeding again adds nothing to the demo Groups', async () => {
    switchRecurringExpenses(true);
    await seedDemoData();
    const before = await seededLedger();
    const counts = async () => ({
      expenses: await Expense.countDocuments({}),
      settlements: await Settlement.countDocuments({}),
      templates: await RecurringExpense.countDocuments({}),
      invitations: await Invitation.countDocuments({}),
      activity: await Activity.countDocuments({}),
    });
    const countsBefore = await counts();

    const again = await seedDemoData();
    for (const group of again.demoGroups) {
      expect(group).toMatchObject({
        groupCreated: false,
        membersEnsured: 0,
        tagsEnsured: 0,
        expensesCreated: 0,
        recurringTemplatesCreated: 0,
        settlementsCreated: 0,
        invitationsCreated: 0,
        skippedTransactions: true,
      });
    }
    expect(await counts()).toEqual(countsBefore);
    expect(await seededLedger()).toEqual(before);
  });

  it('reset removes everything the seed created and nothing else', async () => {
    switchRecurringExpenses(true);
    await ProductSwitch.create({ _id: 'recurringExpenses', enabled: false, since: new Date(0) });
    await seedDemoData();
    const seeded = await seededLedger();

    // Records the seed did not make: another Group with its own Expense and invitation, a
    // fourth user, and what a demo session adds to the seeded Groups.
    const outsider = await User.create({ name: 'Rowan Test', email: 'rowan.test@example.com' });
    const unrelated = await Group.create({
      name: 'Unrelated test Group',
      category: 'other',
      defaultCurrency: 'INR',
      createdBy: alex,
      members: [{ user: alex, role: 'admin', joinedAt: new Date() }],
      tags: [{ name: 'General', isArchived: false, createdAt: new Date() }],
    });
    await expenseService.create(
      String(unrelated._id),
      {
        description: 'Unrelated expense',
        amount: 100,
        currency: 'INR',
        category: 'other',
        date: new Date(),
        paidBy: [{ user: alex, amount: 100 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }],
        tag: 'General',
      },
      alex,
    );
    await invitationService.create(String(unrelated._id), 'rowan.test@example.com', alex);
    const household = await Group.findById(DEMO_HOUSEHOLD_ID).lean();
    await expenseService.create(
      DEMO_HOUSEHOLD_ID,
      {
        description: 'Added during a demo',
        amount: 300,
        currency: 'INR',
        category: 'food',
        date: new Date(),
        paidBy: [{ user: sam, amount: 300 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }, { user: priya }],
        tagId: String(household!.tags.find((tag) => tag.name === 'General')!._id),
      },
      sam,
    );
    await invitationService.create(DEMO_GROUP_ID, 'rowan.test@example.com', alex);
    const unrelatedRecords = async () => ({
      group: await Group.countDocuments({ _id: unrelated._id }),
      expenses: await Expense.countDocuments({ group: unrelated._id }),
      activity: await Activity.countDocuments({ group: unrelated._id }),
      invitations: await Invitation.countDocuments({ group: unrelated._id }),
    });
    const before = await unrelatedRecords();
    expect(before).toEqual({ group: 1, expenses: 1, activity: 1, invitations: 1 });

    await resetDemoData();

    expect(await unrelatedRecords()).toEqual(before);
    expect(await User.exists({ _id: outsider._id })).not.toBeNull();
    expect(await User.countDocuments({})).toBe(DEMO_PERSONAS.length + 1);
    // The switch's record is the server's, not the seed's.
    expect(await ProductSwitch.countDocuments({})).toBe(1);
    // The seeded Groups are back exactly as seeded: the demo session's additions are gone.
    expect(await seededLedger()).toEqual(seeded);
    expect(await Invitation.countDocuments({ group: DEMO_GROUP_ID })).toBe(0);
    expect(await Invitation.countDocuments({ group: DEMO_WORK_GROUP_ID })).toBe(1);
    expect(
      await Group.countDocuments({
        _id: { $in: [...DEMO_SEEDED_GROUP_IDS].map((id) => new mongoose.Types.ObjectId(id)) },
      }),
    ).toBe(DEMO_SEEDED_GROUP_IDS.length);
  });

  it('leaves the mobile fixture Groups’ ids free', async () => {
    await seedDemoData();
    expect(await Group.exists({ _id: 'a00000000000000000000020' })).toBeNull();
    expect(await Group.exists({ _id: 'a00000000000000000000030' })).toBeNull();
  });
});
