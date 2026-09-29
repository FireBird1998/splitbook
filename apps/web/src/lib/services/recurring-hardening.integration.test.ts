import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Activity from '@/lib/models/Activity';
import Expense from '@/lib/models/Expense';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import {
  createRecurringExpenseSchema,
  updateRecurringExpenseSchema,
} from '@splitbook/shared/validators/recurring-expense';
import { toPeriod } from '@splitbook/shared/recurring-due-periods';
import { balanceService } from './balance.service';
import { expenseService } from './expense.service';
import { decideExpenseMoneyEdit } from '@splitbook/shared/expense-money-edit';
import { groupService } from './group.service';
import { recurringExpenseService } from './recurring-expense.service';

const db = integrationTestDb('recurring-hardening');
const { alice, bob, carol } = TEST_USER_IDS;
const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
const nextPeriod = toPeriod(nextMonth);

beforeAll(async () => {
  await db.connect();
  await Expense.createIndexes();
});
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol');
});
afterEach(() => vi.restoreAllMocks());
afterAll(db.teardown);

async function household(currency = 'INR') {
  const group = await groupService.create(
    {
      name: 'Exact recurring ledger',
      category: 'home',
      defaultCurrency: currency,
      alternateCurrencies: [],
    },
    alice,
  );
  const id = String(group._id);
  await groupService.addMember(id, bob);
  await groupService.addMember(id, carol);
  return id;
}

function input(currency = 'INR', amount = 100) {
  return {
    description: 'Utilities',
    amount,
    currency,
    category: 'utilities',
    tag: 'Rent',
    paidBy: [{ user: alice, amount }],
    splitMethod: 'equal' as const,
    splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
    dayOfMonth: 1,
    startsOn: nextMonth,
  };
}

describe('recurring financial integrity and revisions', () => {
  it('rejects invalid money at the public schema and service seams', async () => {
    const groupId = await household();
    const unbalanced = { ...input(), paidBy: [{ user: alice, amount: 1 }] };
    expect(createRecurringExpenseSchema.safeParse(unbalanced).success).toBe(false);
    expect(createRecurringExpenseSchema.safeParse({ ...input(), description: '   ' }).success).toBe(
      false,
    );
    expect(createRecurringExpenseSchema.safeParse(input('JPY', 1.5)).success).toBe(false);
    expect(createRecurringExpenseSchema.safeParse(input('INR', 0.1 + 0.2)).success).toBe(false);
    await expect(recurringExpenseService.create(groupId, unbalanced, alice)).rejects.toThrow(
      'Payer amounts',
    );
    expect(await RecurringExpense.countDocuments()).toBe(0);
    expect(await Expense.countDocuments()).toBe(0);
    expect(updateRecurringExpenseSchema.parse({ isPaused: true })).toEqual({ isPaused: true });
  });

  it('stores exact money and preserves every unit during zero-decimal generation', async () => {
    const groupId = await household('JPY');
    const template = await recurringExpenseService.create(groupId, input('JPY', 1), alice);
    expect(template).toMatchObject({ amountMinor: 1, moneyVersion: 1, revision: 0 });
    expect(template!.splitBetween.map((row) => row.amountMinor)).toEqual([1, 0, 0]);

    await recurringExpenseService.generateDueExpenses(groupId, nextMonth);
    const expense = await Expense.findOne({ recurringExpense: template!._id }).lean();
    expect(expense).toMatchObject({ amount: 1, amountMinor: 1, moneyVersion: 1 });
    expect(expense!.splitBetween.map((row) => row.amountMinor)).toEqual([1, 0, 0]);
  });

  it('applies a financial template edit only to future generation with preview and Balance parity', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input('INR', 0.03), alice);
    await recurringExpenseService.generateDueExpenses(groupId, nextMonth);
    const initial = await expenseService.getGroupExpenses(groupId, {}, alice);
    expect(initial.expenses).toHaveLength(1);
    const original = initial.expenses[0];
    const change = { amount: 0.05, paidBy: [{ user: alice, amount: 0.05 }] };
    const preview = decideExpenseMoneyEdit(template!.toObject(), change).money;
    const updated = await recurringExpenseService.update(
      groupId,
      String(template!._id),
      change,
      alice,
      0,
    );
    expect(preview.splitBetween.map((row) => row.amountMinor)).toEqual([2, 2, 1]);
    expect(updated!.splitBetween.map((row) => row.amountMinor)).toEqual([2, 2, 1]);

    const followingMonth = new Date(
      Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1),
    );
    expect(await recurringExpenseService.generateDueExpenses(groupId, followingMonth)).toEqual({
      generated: 1,
    });
    expect(await recurringExpenseService.generateDueExpenses(groupId, followingMonth)).toEqual({
      generated: 0,
    });
    const result = await expenseService.getGroupExpenses(groupId, {}, alice);
    expect(result.expenses).toHaveLength(2);
    const future = result.expenses.find((row) => row.period === toPeriod(followingMonth))!;
    expect(future).toMatchObject({ amountMinor: 5, moneyVersion: 1 });
    expect(future.paidBy.map((row) => row.amountMinor)).toEqual([5]);
    expect(future.splitBetween.map((row) => row.amountMinor)).toEqual([2, 2, 1]);
    expect(result.expenses.find((row) => String(row._id) === String(original._id))).toEqual(
      original,
    );
    const balances = await balanceService.getGroupBalances(groupId);
    expect(balances!.balances.map((row) => ({ user: row.user._id, balance: row.balance }))).toEqual(
      expect.arrayContaining([
        { user: alice, balance: 0.05 },
        { user: bob, balance: -0.03 },
        { user: carol, balance: -0.02 },
      ]),
    );
    expect(await Activity.countDocuments({ group: groupId, type: 'expense_added' })).toBe(2);
  });

  it('rejects an amount-only partial update without changing the template or revision', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input(), alice);
    await expect(
      recurringExpenseService.update(groupId, String(template!._id), { amount: 101 }, alice, 0),
    ).rejects.toThrow('Payer amounts');
    expect(await RecurringExpense.findById(template!._id).lean()).toMatchObject({
      amount: 100,
      revision: 0,
    });
  });

  it('preserves a valid stored allocation on a full metadata-only form save and later generation', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input(), alice);
    // A valid legacy allocation put the remainder on Carol. A description edit
    // must not silently transfer that penny to Alice under the newer algorithm.
    await RecurringExpense.updateOne(
      { _id: template!._id },
      {
        $set: {
          'splitBetween.0.amount': 33.33,
          'splitBetween.0.amountMinor': 3333,
          'splitBetween.1.amount': 33.33,
          'splitBetween.1.amountMinor': 3333,
          'splitBetween.2.amount': 33.34,
          'splitBetween.2.amountMinor': 3334,
        },
      },
    );
    const updated = await recurringExpenseService.update(
      groupId,
      String(template!._id),
      { ...input(), description: 'Renamed utilities' },
      alice,
      0,
    );
    expect(updated!.splitBetween.map((row) => row.amountMinor)).toEqual([3333, 3333, 3334]);
    await recurringExpenseService.generateDueExpenses(groupId, nextMonth);
    const expense = await Expense.findOne({ recurringExpense: template!._id }).lean();
    expect(expense!.splitBetween.map((row) => row.amountMinor)).toEqual([3333, 3333, 3334]);
  });

  it('preserves historical allocations when a metadata-only form orders participants differently', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input(), alice);
    const historical = template!.splitBetween
      .map((row) => ({
        user: row.user,
        amount: String(row.user) === carol ? 33.34 : 33.33,
        amountMinor: String(row.user) === carol ? 3334 : 3333,
      }))
      .reverse();
    await RecurringExpense.collection.updateOne(
      { _id: template!._id },
      { $set: { splitBetween: historical } },
    );

    // The editor sends Group member order, which differs from the stored rows.
    const updated = await recurringExpenseService.update(
      groupId,
      String(template!._id),
      { ...input(), description: 'Metadata edit with reordered rows' },
      alice,
      0,
    );
    const expected = { [alice]: 3333, [bob]: 3333, [carol]: 3334 };
    const allocation = (rows: Array<{ user: unknown; amountMinor?: number }>) =>
      Object.fromEntries(rows.map((row) => [String(row.user), row.amountMinor]));
    expect(allocation(updated!.splitBetween)).toEqual(expected);
    await recurringExpenseService.generateDueExpenses(groupId, nextMonth);
    const expense = await Expense.findOne({ recurringExpense: template!._id }).lean();
    expect(allocation(expense!.splitBetween)).toEqual(expected);
  });

  it('reads legacy binary tails during generation and metadata edits without moving minor units', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(
      groupId,
      {
        ...input('INR', 0.3),
        splitBetween: [{ user: alice }, { user: bob }],
      },
      alice,
    );
    await RecurringExpense.collection.updateOne(
      { _id: template!._id },
      {
        $set: {
          amount: 0.1 + 0.2,
          'paidBy.0.amount': 0.1 + 0.2,
          'splitBetween.0.amount': 0.1 + 0.05,
          'splitBetween.1.amount': 0.1 + 0.05,
        },
        $unset: {
          moneyVersion: '',
          amountMinor: '',
          'paidBy.0.amountMinor': '',
          'splitBetween.0.amountMinor': '',
          'splitBetween.1.amountMinor': '',
        },
      },
    );

    expect(await recurringExpenseService.generateDueExpenses(groupId, nextMonth)).toEqual({
      generated: 1,
    });
    const expense = await Expense.findOne({ recurringExpense: template!._id }).lean();
    expect(expense).toMatchObject({ amount: 0.3, amountMinor: 30, moneyVersion: 1 });
    expect(expense!.paidBy.map((row) => row.amountMinor)).toEqual([30]);
    expect(expense!.splitBetween.map((row) => row.amountMinor)).toEqual([15, 15]);
    expect((await RecurringExpense.findById(template!._id))!.amount).toBe(0.1 + 0.2);

    const updated = await recurringExpenseService.update(
      groupId,
      String(template!._id),
      {
        ...input('INR', 0.3),
        description: 'Legacy template correction',
        splitBetween: [{ user: alice }, { user: bob }],
      },
      alice,
      0,
    );
    expect(updated).toMatchObject({
      description: 'Legacy template correction',
      amount: 0.3,
      amountMinor: 30,
      moneyVersion: 1,
      revision: 1,
    });
    expect(updated!.paidBy.map((row) => row.amountMinor)).toEqual([30]);
    expect(updated!.splitBetween.map((row) => row.amountMinor)).toEqual([15, 15]);
  });

  it.each(['amountMinor', 'paidBy.0.amountMinor', 'splitBetween.0.amountMinor'])(
    'refuses generation and metadata edits when canonical %s disagrees with the major amount',
    async (field) => {
      const groupId = await household();
      const template = await recurringExpenseService.create(groupId, input(), alice);
      await RecurringExpense.collection.updateOne({ _id: template!._id }, { $set: { [field]: 1 } });
      const before = await RecurringExpense.findById(template!._id).lean();
      expect(await recurringExpenseService.generateDueExpenses(groupId, nextMonth)).toEqual({
        generated: 0,
      });
      await expect(
        recurringExpenseService.update(
          groupId,
          String(template!._id),
          { description: 'Must not silently repair money' },
          alice,
          0,
        ),
      ).rejects.toThrow('Stored amounts disagree');
      expect(await Expense.countDocuments({ recurringExpense: template!._id })).toBe(0);
      expect(await RecurringExpense.findById(template!._id).lean()).toEqual(before);
    },
  );

  it('allows only one concurrent editor and rejects stale deletion', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input(), alice);
    const results = await Promise.allSettled([
      recurringExpenseService.update(
        groupId,
        String(template!._id),
        { description: 'First editor' },
        alice,
        0,
      ),
      recurringExpenseService.update(
        groupId,
        String(template!._id),
        { description: 'Second editor' },
        alice,
        0,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await RecurringExpense.findById(template!._id).lean()).toMatchObject({ revision: 1 });
    await expect(
      recurringExpenseService.remove(groupId, String(template!._id), alice, 0),
    ).rejects.toThrow('STALE_REVISION');
    expect(await RecurringExpense.countDocuments()).toBe(1);
  });

  it('checks authorization before missing revisions and refuses unversioned HTTP commands', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input(), alice);
    await expect(
      recurringExpenseService.update(groupId, String(template!._id), { isPaused: true }, bob, NaN),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      recurringExpenseService.update(
        groupId,
        String(template!._id),
        { isPaused: true },
        alice,
        NaN,
      ),
    ).rejects.toThrow('REVISION_REQUIRED');
    await expect(
      recurringExpenseService.remove(groupId, String(template!._id), alice, NaN),
    ).rejects.toThrow('REVISION_REQUIRED');
  });

  it('initializes a legacy revision safely before competing edits', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input(), alice);
    await RecurringExpense.collection.updateOne(
      { _id: template!._id },
      { $unset: { revision: '' } },
    );
    const results = await Promise.allSettled([
      recurringExpenseService.update(
        groupId,
        String(template!._id),
        { description: 'First' },
        alice,
        0,
      ),
      recurringExpenseService.update(
        groupId,
        String(template!._id),
        { description: 'Second' },
        alice,
        0,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await RecurringExpense.findById(template!._id))!.revision).toBe(1);
  });

  it('enforces canonical representation and allocations on a direct model save', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input(), alice);
    template!.paidBy[0].amountMinor = 1;
    await expect(template!.save()).rejects.toThrow('Stored amounts disagree');
    expect((await RecurringExpense.findById(template!._id))!.paidBy[0].amountMinor).toBe(10000);
  });
});

describe('recurring Activity failure recovery', () => {
  it('retries a committed period after Activity and marker failures without duplicating money', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input(), alice);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Activity, 'updateOne').mockImplementationOnce(() => {
      throw new Error('Activity unavailable');
    });
    vi.spyOn(RecurringExpense, 'updateOne').mockImplementationOnce(() => {
      throw new Error('marker interrupted');
    });

    await expect(recurringExpenseService.generateDueExpenses(groupId, nextMonth)).resolves.toEqual({
      generated: 1,
    });
    const committed = await Expense.findOne({ recurringExpense: template!._id }).select(
      '+pendingActivity',
    );
    expect(committed!.pendingActivity).toHaveLength(1);
    const occurredAt = committed!.pendingActivity[0].occurredAt;
    expect(await Activity.countDocuments({ type: 'expense_added' })).toBe(0);
    expect((await RecurringExpense.findById(template!._id))!.lastGeneratedFor).toBeNull();

    await expect(recurringExpenseService.generateDueExpenses(groupId, nextMonth)).resolves.toEqual({
      generated: 0,
    });
    expect(await Expense.countDocuments({ recurringExpense: template!._id })).toBe(1);
    const activity = await Activity.findOne({ type: 'expense_added' }).lean();
    expect(activity?.createdAt).toEqual(occurredAt);
    expect(activity?.metadata.period).toBe(nextPeriod);
    expect(
      (await Expense.findById(committed!._id).select('+pendingActivity'))!.pendingActivity,
    ).toHaveLength(0);
    expect((await RecurringExpense.findById(template!._id))!.lastGeneratedFor).toBe(nextPeriod);
  });

  it('does not advance a period for an unrelated duplicate-key failure', async () => {
    const groupId = await household();
    const template = await recurringExpenseService.create(groupId, input(), alice);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Expense, 'create').mockImplementationOnce(() => {
      throw Object.assign(new Error('unrelated index collision'), { code: 11000 });
    });

    expect(await recurringExpenseService.generateDueExpenses(groupId, nextMonth)).toEqual({
      generated: 0,
    });
    expect(await Expense.countDocuments({ recurringExpense: template!._id })).toBe(0);
    expect((await RecurringExpense.findById(template!._id))!.lastGeneratedFor).toBeNull();
  });
});
