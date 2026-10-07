/**
 * Integration tests for Home's balances read (`GET /api/user/balances`, #306) against a real,
 * isolated MongoDB database (`splitbook-test-user-balances-suggested`). Only the session is a
 * stand-in.
 *
 * - `suggestedPayments` lists every payment the member makes or receives, across their Groups
 *   and currencies, in exact minor units, naming the other person without their email.
 * - The fields Android reads are unchanged.
 * - The read first adds the recurring Expenses that have fallen due, as a Group's own reads do,
 *   only while recurring Expenses are switched on (#289).
 */

import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import ProductSwitch from '@/lib/models/ProductSwitch';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import {
  expenseDateForPeriod,
  previousPeriod,
  toPeriod,
} from '@splitbook/shared/recurring-due-periods';
import type { GroupCategory, UserBalancesResponse } from '@splitbook/shared/types';
import { GET as readHome } from './route';
import { GET as readGroupBalances } from '@/app/api/groups/[id]/balances/route';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.userId
          ? { user: { id: session.userId, name: 'Tester', email: 'tester@splitbook-test.local' } }
          : null,
      ),
    },
  },
}));

const db = integrationTestDb('user-balances-suggested');
const { alice, bob, carol, dave } = TEST_USER_IDS;

beforeAll(async () => {
  await db.connect();
  await Expense.createIndexes();
});
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(db.teardown);

/** Recurring Expenses are off unless the variable is exactly `true`; unset is the default. */
function switchRecurringExpenses(on: boolean) {
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', on ? 'true' : undefined);
}

/** Home's read, as `userId` sees it. */
async function home(userId: string): Promise<UserBalancesResponse> {
  session.userId = userId;
  const response = await readHome();
  expect(response.status).toBe(200);
  return (await response.json()).data;
}

/** A Group with `alice` (admin) and `members`. */
async function createGroup(
  name: string,
  category: GroupCategory,
  currency: string,
  members: string[],
): Promise<string> {
  const group = await groupService.create(
    { name, category, defaultCurrency: currency, alternateCurrencies: [] },
    alice,
  );
  const groupId = String(group._id);
  for (const member of members) await groupService.addMember(groupId, member);
  return groupId;
}

/** `payer` pays `amount`, shared equally by `between`. */
async function addExpense(
  groupId: string,
  payer: string,
  amount: number,
  between: string[],
  currency = 'INR',
) {
  await expenseService.create(
    groupId,
    {
      description: 'Shared cost',
      amount,
      currency,
      category: 'food',
      date: new Date('2026-09-20T12:00:00.000Z'),
      splitMethod: 'equal',
      tag: 'General',
      paidBy: [{ user: payer, amount }],
      splitBetween: between.map((user) => ({ user })),
    },
    payer,
  );
}

/**
 * Alice's Groups:
 * - Lakeview Flat (INR): she is owed ₹200 by Carol, who has since been removed from the
 *   Group with her balance open, and ₹100 by Bob.
 * - Lisbon Offsite (EUR): she pays Bob €30; Dave pays Bob too, which isn't hers.
 * - Goa Trip (INR): she pays three people, ₹450, ₹300 and ₹50.
 * - Sunday Football (INR): Carol pays Bob; Alice is in no payment.
 * - Old Trip, a legacy Group in INR and USD: she pays Bob ₹50, and Bob pays her $10.
 */
async function seedAlicesGroups() {
  const lakeview = await createGroup('Lakeview Flat', 'home', 'INR', [bob, carol]);
  await addExpense(lakeview, alice, 300, [alice, bob, carol]);
  await addExpense(lakeview, alice, 100, [carol]);
  await Group.updateOne({ _id: lakeview }, { $pull: { members: { user: carol } } });

  const lisbon = await createGroup('Lisbon Offsite', 'work', 'EUR', [bob, dave]);
  await addExpense(lisbon, bob, 90, [alice, bob, dave], 'EUR');

  const goa = await createGroup('Goa Trip', 'trip', 'INR', [bob, carol, dave]);
  await addExpense(goa, carol, 500, [alice]);
  await addExpense(goa, dave, 300, [alice]);
  await addExpense(goa, bob, 100, [bob, carol]);

  const football = await createGroup('Sunday Football', 'other', 'INR', [bob, carol]);
  await addExpense(football, bob, 100, [bob, carol]);

  const oldTrip = await createGroup('Old Trip', 'trip', 'INR', [bob]);
  await addExpense(oldTrip, bob, 100, [alice, bob]);
  // Written before one currency per Group was enforced: no service accepts it today.
  const at = new Date('2026-01-10T12:00:00.000Z');
  await Expense.collection.insertOne({
    group: new mongoose.Types.ObjectId(oldTrip),
    description: 'Airport taxi',
    amount: 20,
    amountMinor: 2000,
    currency: 'USD',
    moneyVersion: 1,
    category: 'transport',
    date: at,
    paidBy: [{ user: new mongoose.Types.ObjectId(alice), amount: 20, amountMinor: 2000 }],
    splitMethod: 'equal',
    splitBetween: [
      { user: new mongoose.Types.ObjectId(alice), amount: 10, amountMinor: 1000 },
      { user: new mongoose.Types.ObjectId(bob), amount: 10, amountMinor: 1000 },
    ],
    createdBy: new mongoose.Types.ObjectId(alice),
    isDeleted: false,
    revision: 0,
    createdAt: at,
    updatedAt: at,
  });

  return { lakeview, lisbon, goa, football, oldTrip };
}

describe('every suggested payment involving the member', () => {
  it('lists each one across Groups and currencies, pays first, in exact minor units', async () => {
    const { lakeview, lisbon, goa, oldTrip } = await seedAlicesGroups();

    const { suggestedPayments } = await home(alice);

    const row = (
      groupId: string,
      groupName: string,
      currency: string,
      direction: 'pay' | 'receive',
      counterpartyId: string,
      counterpartyName: string,
      amountMinor: number,
    ) => ({
      groupId,
      groupName,
      currency,
      direction,
      counterpartyId,
      counterpartyName,
      amountMinor,
    });
    expect(suggestedPayments).toStrictEqual([
      row(lisbon, 'Lisbon Offsite', 'EUR', 'pay', bob, 'Bob Tester', 3000),
      row(goa, 'Goa Trip', 'INR', 'pay', carol, 'Carol Tester', 45_000),
      row(goa, 'Goa Trip', 'INR', 'pay', dave, 'Dave Tester', 30_000),
      row(goa, 'Goa Trip', 'INR', 'pay', bob, 'Bob Tester', 5000),
      row(oldTrip, 'Old Trip', 'INR', 'pay', bob, 'Bob Tester', 5000),
      // Carol left Lakeview Flat with her balance open: named from her account.
      row(lakeview, 'Lakeview Flat', 'INR', 'receive', carol, 'Carol Tester', 20_000),
      row(lakeview, 'Lakeview Flat', 'INR', 'receive', bob, 'Bob Tester', 10_000),
      row(oldTrip, 'Old Trip', 'USD', 'receive', bob, 'Bob Tester', 1000),
    ]);
    // People are never shown by email.
    expect(JSON.stringify(suggestedPayments)).not.toContain('@');
  });

  it('matches what each Group’s Balances suggests, payment for payment', async () => {
    const groups = await seedAlicesGroups();
    const { suggestedPayments } = await home(alice);

    for (const groupId of Object.values(groups)) {
      session.userId = alice;
      const response = await readGroupBalances(new Request('http://localhost'), {
        params: Promise.resolve({ id: groupId }),
      });
      const { data } = (await response.json()) as {
        data: {
          byCurrency: Array<{
            currency: string;
            debts: Array<{ from: { _id: string }; to: { _id: string }; amount: number }>;
          }>;
        };
      };
      const fromBalances = data.byCurrency.flatMap(({ currency, debts }) =>
        debts
          .filter(({ from, to }) => from._id === alice || to._id === alice)
          .map(({ from, to, amount }) => ({
            currency,
            counterpartyId: from._id === alice ? to._id : from._id,
            amount,
          })),
      );
      const fromHome = suggestedPayments
        .filter((payment) => payment.groupId === groupId)
        .map(({ currency, counterpartyId, amountMinor }) => ({
          currency,
          counterpartyId,
          amount: amountMinor / 100,
        }));
      const sorted = (rows: unknown[]) => rows.map((value) => JSON.stringify(value)).sort();
      expect(sorted(fromHome)).toEqual(sorted(fromBalances));
    }
  });

  it('is what the other side sees, the other way round', async () => {
    const { goa } = await seedAlicesGroups();
    const { suggestedPayments } = await home(dave);
    expect(suggestedPayments).toContainEqual({
      groupId: goa,
      groupName: 'Goa Trip',
      currency: 'INR',
      direction: 'receive',
      counterpartyId: alice,
      counterpartyName: 'Alice Tester',
      amountMinor: 30_000,
    });
    // Dave pays Bob in Lisbon Offsite; he isn't in Alice's payment to Bob there.
    expect(suggestedPayments.filter((payment) => payment.currency === 'EUR')).toEqual([
      expect.objectContaining({ direction: 'pay', counterpartyId: bob, amountMinor: 3000 }),
    ]);
  });

  it('is empty for a member with no debts: settled up, or in no Group at all', async () => {
    const settled = await createGroup('Settled Flat', 'home', 'INR', [dave]);
    await addExpense(settled, dave, 100, [alice, dave]);
    await settlementService.create(settled, { paidTo: dave, amount: 50, currency: 'INR' }, alice);

    const forDave = await home(dave);
    expect(forDave).toMatchObject({ buckets: [], suggestedPayments: [] });
    expect(forDave.groups).toEqual([expect.objectContaining({ groupId: settled, balances: [] })]);

    const loner = new mongoose.Types.ObjectId().toString();
    expect(await home(loner)).toStrictEqual({
      buckets: [],
      groups: [],
      hasMixedCurrencies: false,
      suggestedPayments: [],
    });
  });

  it('leaves out an archived Group, as before', async () => {
    const archived = await createGroup('Archived Trip', 'trip', 'INR', [bob]);
    await addExpense(archived, bob, 100, [alice, bob]);
    await Group.updateOne({ _id: archived }, { $set: { isArchived: true } });
    expect((await home(alice)).suggestedPayments).toEqual([]);
  });
});

describe('the fields Android reads', () => {
  it('are unchanged: the same values, keys and key order as before #306', async () => {
    const { lakeview, lisbon, goa, football, oldTrip } = await seedAlicesGroups();
    session.userId = alice;
    const response = await readHome();
    const body = await response.json();
    const updatedAt = Object.fromEntries(
      (await Group.find().select('updatedAt').lean()).map((group) => [
        String(group._id),
        new Date(group.updatedAt).toISOString(),
      ]),
    );
    const group = (
      groupId: string,
      name: string,
      category: string,
      hasMixedCurrencies: boolean,
      balances: unknown[],
    ) => ({ groupId, name, category, updatedAt: updatedAt[groupId], hasMixedCurrencies, balances });

    const { suggestedPayments, ...existing } = body.data;
    expect(Object.keys(body.data)).toEqual([
      'buckets',
      'groups',
      'hasMixedCurrencies',
      'suggestedPayments',
    ]);
    expect(suggestedPayments).toHaveLength(8);
    // Compared as JSON, so a key renamed, added or moved inside them fails too.
    expect(JSON.stringify(existing)).toBe(
      JSON.stringify({
        buckets: [
          { currency: 'EUR', youOwe: 30, youAreOwed: 0, net: -30 },
          { currency: 'INR', youOwe: 850, youAreOwed: 300, net: -550 },
          { currency: 'USD', youOwe: 0, youAreOwed: 10, net: 10 },
        ],
        groups: [
          group(lakeview, 'Lakeview Flat', 'home', false, [
            {
              currency: 'INR',
              balance: 300,
              // Still only the largest payment, and a former member is still Unknown here.
              settlement: { counterpartyId: carol, counterpartyName: 'Unknown', amount: 200 },
            },
          ]),
          group(lisbon, 'Lisbon Offsite', 'work', false, [
            {
              currency: 'EUR',
              balance: -30,
              settlement: { counterpartyId: bob, counterpartyName: 'Bob Tester', amount: 30 },
            },
          ]),
          group(goa, 'Goa Trip', 'trip', false, [
            {
              currency: 'INR',
              balance: -800,
              settlement: { counterpartyId: carol, counterpartyName: 'Carol Tester', amount: 450 },
            },
          ]),
          group(football, 'Sunday Football', 'other', false, []),
          group(oldTrip, 'Old Trip', 'trip', true, [
            {
              currency: 'INR',
              balance: -50,
              settlement: { counterpartyId: bob, counterpartyName: 'Bob Tester', amount: 50 },
            },
            {
              currency: 'USD',
              balance: 10,
              settlement: { counterpartyId: bob, counterpartyName: 'Bob Tester', amount: 10 },
            },
          ]),
        ],
        hasMixedCurrencies: true,
      }),
    );
  });
});

describe('recurring Expenses that have fallen due', () => {
  const NOW = new Date();
  const CURRENT_PERIOD = toPeriod(NOW);
  const PREVIOUS_PERIOD = previousPeriod(CURRENT_PERIOD);

  /**
   * A Household whose ₹30,000 Rent (Alice pays, three share it) was added through last month
   * only: this month's Rent, due on the 1st, is not there because nobody has read the Group
   * since. Beside it, a Trip without templates.
   */
  async function householdWithRentDue() {
    switchRecurringExpenses(true);
    const householdId = await createGroup('Lakeview Flat', 'home', 'INR', [bob, carol]);
    const template = await recurringExpenseService.create(
      householdId,
      {
        description: 'Rent',
        amount: 30000,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: alice, amount: 30000 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
        dayOfMonth: 1,
        startsOn: expenseDateForPeriod(CURRENT_PERIOD, 1),
      },
      alice,
    );
    const templateId = String(template!._id);
    const lastMonth = expenseDateForPeriod(PREVIOUS_PERIOD, 1);
    const rewound = await Expense.updateOne(
      { recurringExpense: templateId, period: CURRENT_PERIOD },
      { $set: { period: PREVIOUS_PERIOD, date: lastMonth } },
    );
    expect(rewound.modifiedCount).toBe(1);
    await RecurringExpense.updateOne(
      { _id: templateId },
      { $set: { startsOn: lastMonth, lastGeneratedFor: PREVIOUS_PERIOD } },
    );
    const tripId = await createGroup('Goa Trip', 'trip', 'INR', [bob]);
    await addExpense(tripId, alice, 100, [alice, bob]);
    return { householdId, tripId, templateId };
  }

  async function periodsOf(templateId: string): Promise<string[]> {
    const rows = await Expense.find({ recurringExpense: templateId, isDeleted: false })
      .sort({ period: 1 })
      .lean();
    return rows.map((row) => row.period!);
  }

  it('adds them first while the switch is on, so Home matches the Group, in one run per Group with a month due', async () => {
    const { householdId, templateId } = await householdWithRentDue();
    const runs = vi.spyOn(recurringExpenseService, 'generateDueExpenses');

    const forBob = await home(bob);

    // Two months of Rent: ₹10,000 each, and ₹50 from the Trip.
    expect(forBob.buckets).toEqual([
      { currency: 'INR', youOwe: 20050, youAreOwed: 0, net: -20050 },
    ]);
    expect(forBob.suggestedPayments).toEqual([
      expect.objectContaining({
        groupId: householdId,
        direction: 'pay',
        counterpartyId: alice,
        amountMinor: 2_000_000,
      }),
      expect.objectContaining({ groupName: 'Goa Trip', amountMinor: 5000 }),
    ]);
    expect(await periodsOf(templateId)).toEqual([PREVIOUS_PERIOD, CURRENT_PERIOD]);
    // Only the Household has a template; the Trip is never run.
    expect(runs.mock.calls.map(([groupId]) => groupId)).toEqual([householdId]);

    // The Group's own Balances read finds nothing left to add, and agrees.
    session.userId = bob;
    const groupRead = await readGroupBalances(new Request('http://localhost'), {
      params: Promise.resolve({ id: householdId }),
    });
    const { data } = await groupRead.json();
    expect(
      data.balances.find((row: { user: { _id: string } }) => row.user._id === bob).balance,
    ).toBe(-20000);
    expect(await periodsOf(templateId)).toEqual([PREVIOUS_PERIOD, CURRENT_PERIOD]);

    // Read again: nothing is added twice.
    expect((await home(bob)).buckets[0].youOwe).toBe(20050);
    expect(await periodsOf(templateId)).toEqual([PREVIOUS_PERIOD, CURRENT_PERIOD]);
  });

  it('adds nothing while the switch is off, changes no template, and records that it is off', async () => {
    const { templateId } = await householdWithRentDue();
    const before = await RecurringExpense.findById(templateId).lean();
    switchRecurringExpenses(false);
    const runs = vi.spyOn(recurringExpenseService, 'generateDueExpenses');

    const forBob = await home(bob);

    // Last month's Rent only.
    expect(forBob.buckets).toEqual([
      { currency: 'INR', youOwe: 10050, youAreOwed: 0, net: -10050 },
    ]);
    expect(forBob.suggestedPayments.map(({ amountMinor }) => amountMinor)).toEqual([
      1_000_000, 5000,
    ]);
    expect(await periodsOf(templateId)).toEqual([PREVIOUS_PERIOD]);
    expect(await RecurringExpense.findById(templateId).lean()).toEqual(before);
    expect(runs).not.toHaveBeenCalled();
    expect(await ProductSwitch.findById('recurringExpenses').lean()).toMatchObject({
      enabled: false,
    });
  });

  it('runs no Group whose templates have nothing due, however many Households the member has', async () => {
    switchRecurringExpenses(true);
    const households: string[] = [];
    for (const name of ['Lakeview Flat', 'Harbour Flat', 'Garden Flat']) {
      const householdId = await createGroup(name, 'home', 'INR', [bob]);
      // Created this month: its Rent is added at once, so the next read has nothing to add.
      await recurringExpenseService.create(
        householdId,
        {
          description: 'Rent',
          amount: 20000,
          currency: 'INR',
          category: 'housing',
          tag: 'Rent',
          paidBy: [{ user: alice, amount: 20000 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alice }, { user: bob }],
          dayOfMonth: 1,
          startsOn: expenseDateForPeriod(CURRENT_PERIOD, 1),
        },
        alice,
      );
      households.push(householdId);
    }
    const runs = vi.spyOn(recurringExpenseService, 'generateDueExpenses');

    const forBob = await home(bob);

    expect(runs).not.toHaveBeenCalled();
    expect(forBob.buckets).toEqual([
      { currency: 'INR', youOwe: 30000, youAreOwed: 0, net: -30000 },
    ]);
    expect(forBob.suggestedPayments.map(({ groupId }) => groupId).sort()).toEqual(
      [...households].sort(),
    );
  });

  it('still answers when generation fails, with the Expenses already there', async () => {
    const { templateId } = await householdWithRentDue();
    vi.spyOn(RecurringExpense, 'find').mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const forBob = await home(bob);

    expect(forBob.buckets[0].youOwe).toBe(10050);
    expect(await periodsOf(templateId)).toEqual([PREVIOUS_PERIOD]);
  });
});
