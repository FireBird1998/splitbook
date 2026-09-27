/**
 * Integration tests for expense and settlement services against a real,
 * isolated MongoDB database (`splitbook-test-expense-settlement`).
 * Covers participant/currency/tag validation, edit history, soft delete,
 * and settlement authorization boundaries.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Activity from '@/lib/models/Activity';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';

const db = integrationTestDb('expense-settlement');
const { alice, bob, carol, dave } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
});
afterAll(db.teardown);

/** INR trip with alice (admin), bob and carol as members. dave stays a stranger. */
async function createTrip(): Promise<string> {
  const group = await groupService.create(
    {
      name: 'Money Trip',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
    alice,
  );
  const groupId = group._id.toString();
  await groupService.addMember(groupId, bob);
  await groupService.addMember(groupId, carol);
  return groupId;
}

const expenseInput = {
  description: 'Dinner',
  amount: 300,
  currency: 'INR',
  category: 'food',
  date: new Date('2026-07-20T12:00:00.000Z'),
  splitMethod: 'equal' as const,
  tag: 'Food',
};

describe('ExpenseService integration', () => {
  it('creates an expense with computed equal splits and logs activity', async () => {
    const groupId = await createTrip();

    const expense = await expenseService.create(
      groupId,
      {
        ...expenseInput,
        paidBy: [{ user: alice, amount: 300 }],
        splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
      },
      alice,
    );

    expect(expense.splitBetween.map((s) => s.amount)).toEqual([100, 100, 100]);

    const activity = await Activity.findOne({ group: groupId, type: 'expense_added' });
    expect(activity?.actor.toString()).toBe(alice);
    expect(activity?.metadata?.description).toBe('Dinner');
  });

  it('rejects payers who are not group members', async () => {
    const groupId = await createTrip();

    await expect(
      expenseService.create(
        groupId,
        {
          ...expenseInput,
          paidBy: [{ user: dave, amount: 300 }],
          splitBetween: [{ user: alice }, { user: bob }],
        },
        alice,
      ),
    ).rejects.toThrow('INVALID_MEMBERS');

    expect(await Expense.countDocuments({ group: groupId })).toBe(0);
  });

  it('rejects split participants who are not group members', async () => {
    const groupId = await createTrip();

    await expect(
      expenseService.create(
        groupId,
        {
          ...expenseInput,
          paidBy: [{ user: alice, amount: 300 }],
          splitBetween: [{ user: alice }, { user: dave }],
        },
        alice,
      ),
    ).rejects.toThrow('INVALID_MEMBERS');
  });

  it('enforces the single group currency', async () => {
    const groupId = await createTrip();

    await expect(
      expenseService.create(
        groupId,
        {
          ...expenseInput,
          currency: 'USD',
          paidBy: [{ user: alice, amount: 300 }],
          splitBetween: [{ user: alice }, { user: bob }],
        },
        alice,
      ),
    ).rejects.toThrow('CURRENCY_MISMATCH');
  });

  it('rejects tags that are not active group tags', async () => {
    const groupId = await createTrip();

    await expect(
      expenseService.create(
        groupId,
        {
          ...expenseInput,
          tag: 'Not A Tag',
          paidBy: [{ user: alice, amount: 300 }],
          splitBetween: [{ user: alice }],
        },
        alice,
      ),
    ).rejects.toThrow('INVALID_TAG');
  });

  it('rejects archived tags on create, but lets an existing expense keep its archived tag', async () => {
    const groupId = await createTrip();

    const expense = await expenseService.create(
      groupId,
      {
        ...expenseInput,
        paidBy: [{ user: alice, amount: 300 }],
        splitBetween: [{ user: alice }, { user: bob }],
      },
      alice,
    );

    // Archive the tag afterwards
    const group = await groupService.getById(groupId);
    const foodTag = group!.tags.find((t: { name: string }) => t.name === 'Food')!;
    await groupService.updateTag(groupId, foodTag._id.toString(), { isArchived: true }, alice);

    // New expenses can no longer use it
    await expect(
      expenseService.create(
        groupId,
        {
          ...expenseInput,
          description: 'Another dinner',
          paidBy: [{ user: alice, amount: 300 }],
          splitBetween: [{ user: alice }],
        },
        alice,
      ),
    ).rejects.toThrow('INVALID_TAG');

    // The existing expense can be edited without changing its archived tag
    const updated = await expenseService.update(
      { actorId: bob, groupId, expenseId: expense._id.toString() },
      { description: 'Dinner (renamed)' },
    );
    expect(updated?.description).toBe('Dinner (renamed)');
    expect(updated?.tag).toBe('Food');
  });

  it('tracks edit history with who changed what', async () => {
    const groupId = await createTrip();
    const expense = await expenseService.create(
      groupId,
      {
        ...expenseInput,
        paidBy: [{ user: alice, amount: 300 }],
        splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
      },
      alice,
    );

    await expenseService.update(
      { actorId: bob, groupId, expenseId: expense._id.toString() },
      { amount: 330, paidBy: [{ user: alice, amount: 330 }] },
    );

    const stored = await Expense.findById(expense._id);
    expect(stored!.amount).toBe(330);
    expect(stored!.editHistory).toHaveLength(1);
    expect(stored!.editHistory[0].editedBy.toString()).toBe(bob);
    expect(stored!.editHistory[0].changes.amount).toMatchObject({ old: 300, new: 330 });
  });

  it('soft deletes and restores expenses without losing them', async () => {
    const groupId = await createTrip();
    const expense = await expenseService.create(
      groupId,
      {
        ...expenseInput,
        paidBy: [{ user: alice, amount: 300 }],
        splitBetween: [{ user: alice }, { user: bob }],
      },
      alice,
    );

    await expenseService.delete({ actorId: alice, groupId, expenseId: expense._id.toString() });

    let stored = await Expense.findById(expense._id);
    expect(stored!.isDeleted).toBe(true);
    expect(stored!.deletedBy?.toString()).toBe(alice);

    const list = await expenseService.getGroupExpenses(groupId, {}, alice);
    expect(list.expenses).toHaveLength(0);

    await expenseService.update(
      { actorId: alice, groupId, expenseId: expense._id.toString() },
      { isDeleted: false },
    );
    stored = await Expense.findById(expense._id);
    expect(stored!.isDeleted).toBe(false);
    expect(stored!.deletedBy).toBeNull();
  });

  it('detects duplicates on description, amount, and day — excluding self', async () => {
    const groupId = await createTrip();
    const expense = await expenseService.create(
      groupId,
      {
        ...expenseInput,
        paidBy: [{ user: alice, amount: 300 }],
        splitBetween: [{ user: alice }],
      },
      alice,
    );

    // The service compares server-local calendar days; 12:00Z and 13:00Z fall
    // on the same local date in every timezone (max ±14h offset).
    const duplicate = await expenseService.checkDuplicate(
      groupId,
      'dinner', // case-insensitive
      300,
      new Date('2026-07-20T13:00:00.000Z'),
    );
    expect(duplicate.isDuplicate).toBe(true);

    const self = await expenseService.checkDuplicate(
      groupId,
      'Dinner',
      300,
      new Date('2026-07-20T13:00:00.000Z'),
      expense._id.toString(),
    );
    expect(self.isDuplicate).toBe(false);

    const otherDay = await expenseService.checkDuplicate(
      groupId,
      'Dinner',
      300,
      new Date('2026-07-21T12:00:00.000Z'),
    );
    expect(otherDay.isDuplicate).toBe(false);
  });
});

describe('SettlementService integration', () => {
  it('lets the payer record a settlement and logs it', async () => {
    const groupId = await createTrip();

    const settlement = await settlementService.create(
      groupId,
      { paidTo: alice, amount: 100, currency: 'INR', note: 'UPI' },
      bob,
    );

    const stored = await Settlement.findById(settlement._id).lean();
    expect(stored!.paidBy.toString()).toBe(bob);
    expect(stored!.paidTo.toString()).toBe(alice);
    expect(stored!.createdBy.toString()).toBe(bob);

    const activity = await Activity.findOne({ group: groupId, type: 'settlement_recorded' });
    expect(activity?.actor.toString()).toBe(bob);
    expect(activity?.metadata?.amount).toBe(100);
  });

  it('lets the recipient record a settlement on behalf of the payer', async () => {
    const groupId = await createTrip();

    const settlement = await settlementService.create(
      groupId,
      { paidBy: bob, paidTo: alice, amount: 50, currency: 'INR' },
      alice, // recorded by the recipient
    );

    const stored = await Settlement.findById(settlement._id).lean();
    expect(stored!.paidBy.toString()).toBe(bob);
    expect(stored!.createdBy.toString()).toBe(alice);
  });

  it('forbids a third group member from recording someone else’s settlement', async () => {
    const groupId = await createTrip();

    await expect(
      settlementService.create(
        groupId,
        { paidBy: bob, paidTo: alice, amount: 50, currency: 'INR' },
        carol,
      ),
    ).rejects.toThrow('FORBIDDEN_SETTLEMENT');

    expect(await Settlement.countDocuments({ group: groupId })).toBe(0);
  });

  it('rejects settlements involving non-members or the same party twice', async () => {
    const groupId = await createTrip();

    await expect(
      settlementService.create(groupId, { paidTo: dave, amount: 50, currency: 'INR' }, alice),
    ).rejects.toThrow('INVALID_MEMBERS');

    await expect(
      settlementService.create(groupId, { paidTo: alice, amount: 50, currency: 'INR' }, alice),
    ).rejects.toThrow('SAME_PARTY');
  });

  it('enforces the single group currency for settlements', async () => {
    const groupId = await createTrip();

    await expect(
      settlementService.create(groupId, { paidTo: alice, amount: 50, currency: 'USD' }, bob),
    ).rejects.toThrow('CURRENCY_MISMATCH');
  });

  it('returns settlement history newest first', async () => {
    const groupId = await createTrip();

    await settlementService.create(groupId, { paidTo: alice, amount: 40, currency: 'INR' }, bob);
    await settlementService.create(groupId, { paidTo: alice, amount: 60, currency: 'INR' }, carol);

    const settlements = await settlementService.getGroupSettlements(groupId);
    expect(settlements).toHaveLength(2);
    expect(settlements[0].createdAt >= settlements[1].createdAt).toBe(true);
  });
});
