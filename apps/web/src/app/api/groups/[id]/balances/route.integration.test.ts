/**
 * Integration tests for the Group Balances route against a real, isolated MongoDB database
 * (`splitbook-test-balances-route`). Only the session is a stand-in; membership, recurring
 * materialization and the Balances computation run against stored Expenses.
 *
 * The Group page starts the Group read, the Expense count read and the Balances read in the
 * same render. The first two materialize due recurring Expenses, so Balances must as well, or
 * the page shows last month's figures beside this month's Expense (#240).
 *
 * An archived Group creates no recurring Expenses, so none of the three reads adds one to an
 * archived Household, and each still answers as before (#254).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Expense from '@/lib/models/Expense';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from '@/lib/services/group.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import {
  expenseDateForPeriod,
  previousPeriod,
  toPeriod,
} from '@splitbook/shared/recurring-due-periods';
import { GET as readGroup } from '../route';
import { GET as readExpenses } from '../expenses/route';
import { GET as readBalances } from './route';

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

const db = integrationTestDb('balances-route');
const { alice, bob, carol, dave } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = null;
});
afterAll(db.teardown);

const CURRENT_PERIOD = toPeriod(new Date());
const PREVIOUS_PERIOD = previousPeriod(CURRENT_PERIOD);

interface Balances {
  currency: string;
  balances: { user: { _id: string }; balance: number }[];
  debts: { from: { _id: string }; to: { _id: string }; amount: number }[];
}

type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

async function read(handler: Handler, groupId: string, path: string) {
  const request = new Request(`http://localhost/api/groups/${groupId}${path}`);
  const response = await handler(request, { params: Promise.resolve({ id: groupId }) });
  return { status: response.status, body: await response.json() };
}

function balanceOf(balances: Balances, userId: string): number | undefined {
  return balances.balances.find((entry) => entry.user._id === userId)?.balance;
}

function debtOf(balances: Balances, from: string, to: string): number | undefined {
  return balances.debts.find((debt) => debt.from._id === from && debt.to._id === to)?.amount;
}

/**
 * A Household of three whose ₹30,000 Rent, paid by Alice and split equally, was last
 * materialized for the previous month. This month's Rent is due and no read has seen it yet.
 */
async function householdWithRentDue(name = 'Lakeview Flat') {
  const group = await groupService.create(
    { name, category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  await groupService.addMember(groupId, carol);

  const template = await recurringExpenseService.create(
    groupId,
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

  // Rewind the stored rows one month: the Rent created above becomes last month's, and the
  // template's marker says the current month has not been materialized.
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
  expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);

  return { groupId, templateId };
}

function rentFor(templateId: string, period: string) {
  return Expense.countDocuments({ recurringExpense: templateId, period, isDeleted: false });
}

/** The three reads the Group page starts in the same render, as Bob. */
async function openGroupPage(groupId: string) {
  session.userId = bob;
  const [group, expenseCount, balances] = await Promise.all([
    read(readGroup, groupId, ''),
    read(readExpenses, groupId, '/expenses?page=1&limit=1'),
    read(readBalances, groupId, '/balances'),
  ]);
  expect([group.status, expenseCount.status, balances.status]).toEqual([200, 200, 200]);
  return {
    expenseTotal: expenseCount.body.data.pagination.total as number,
    balances: balances.body.data as Balances,
  };
}

describe('GET /api/groups/[id]/balances with a recurring Expense due', () => {
  it('includes this month’s Rent when the Group page starts its reads together', async () => {
    for (let round = 0; round < 20; round += 1) {
      const { groupId, templateId } = await householdWithRentDue(`Lakeview Flat ${round}`);

      const page = await openGroupPage(groupId);

      expect(page.expenseTotal, `Group ${round}: Expense count`).toBe(2);
      expect(balanceOf(page.balances, bob), `Group ${round}: Bob's balance`).toBe(-20000);
      expect(balanceOf(page.balances, carol), `Group ${round}: Carol's balance`).toBe(-20000);
      expect(balanceOf(page.balances, alice), `Group ${round}: Alice's balance`).toBe(40000);
      expect(debtOf(page.balances, bob, alice), `Group ${round}: Bob's debt`).toBe(20000);
      expect(await rentFor(templateId, CURRENT_PERIOD), `Group ${round}: this month`).toBe(1);
    }
  }, 120_000);

  it('includes this month’s Rent on a Balances read with no other read', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    session.userId = bob;

    const { status, body } = await read(readBalances, groupId, '/balances');

    expect(status).toBe(200);
    expect(balanceOf(body.data, bob)).toBe(-20000);
    expect(debtOf(body.data, bob, alice)).toBe(20000);
    expect(debtOf(body.data, carol, alice)).toBe(20000);
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(1);
    expect(await rentFor(templateId, PREVIOUS_PERIOD)).toBe(1);

    // A second read finds the row already materialized and adds nothing.
    const again = await read(readBalances, groupId, '/balances');
    expect(balanceOf(again.body.data, bob)).toBe(-20000);
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(1);
  });

  it('refuses a non-member or a signed-out reader without materializing anything', async () => {
    const { groupId, templateId } = await householdWithRentDue();

    session.userId = dave;
    expect(await read(readBalances, groupId, '/balances')).toEqual({
      status: 403,
      body: { error: 'Forbidden', status: 403 },
    });
    session.userId = null;
    expect(await read(readBalances, groupId, '/balances')).toEqual({
      status: 401,
      body: { error: 'Unauthorized', status: 401 },
    });

    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);
  });
});

describe('Group page reads of an archived Household with a recurring Expense due', () => {
  /** The same Household, archived by Alice before anyone read this month's Rent. */
  async function archivedHouseholdWithRentDue() {
    const household = await householdWithRentDue();
    await groupService.archive(household.groupId, alice);
    session.userId = bob;
    return household;
  }

  it('reads the Group as before without adding this month’s Rent', async () => {
    const { groupId, templateId } = await archivedHouseholdWithRentDue();

    const { status, body } = await read(readGroup, groupId, '');

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ _id: groupId, name: 'Lakeview Flat', isArchived: true });
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);
  });

  it('lists the Expenses as before without adding this month’s Rent', async () => {
    const { groupId, templateId } = await archivedHouseholdWithRentDue();

    const { status, body } = await read(readExpenses, groupId, '/expenses');

    expect(status).toBe(200);
    expect(body.data.expenses.map((expense: { period: string }) => expense.period)).toEqual([
      PREVIOUS_PERIOD,
    ]);
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);
  });

  it('computes Balances from the stored Expenses without adding this month’s Rent', async () => {
    const { groupId, templateId } = await archivedHouseholdWithRentDue();

    const { status, body } = await read(readBalances, groupId, '/balances');

    expect(status).toBe(200);
    expect(balanceOf(body.data, bob)).toBe(-10000);
    expect(debtOf(body.data, bob, alice)).toBe(10000);
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);
  });
});
