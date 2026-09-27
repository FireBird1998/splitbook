import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Expense from '@/lib/models/Expense';
import { Types } from 'mongoose';
import { groupService } from './group.service';
import { expenseService } from './expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';

const db = integrationTestDb('ledger-integrity');
const { alice, bob, carol } = TEST_USER_IDS;
beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol');
});
afterAll(db.teardown);

async function fixture() {
  const group = await groupService.create(
    { name: 'Integrity', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  await groupService.addMember(groupId, carol);
  const command = {
    description: 'Old allocation',
    amount: 100,
    currency: 'INR',
    category: 'food',
    tag: 'Food',
    date: new Date('2026-09-01'),
    paidBy: [{ user: alice, amount: 100 }],
    splitMethod: 'equal' as const,
    splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
  };
  const expense = await expenseService.create(groupId, command, alice);
  const access = { actorId: alice, groupId, expenseId: String(expense._id) };
  return { groupId, command, expense, access };
}

describe('ledger integrity at the persistence boundary', () => {
  it('preserves historical allocations on a full-form metadata edit', async () => {
    const { expense, access, command } = await fixture();
    await Expense.collection.updateOne(
      { _id: expense._id },
      {
        $unset: {
          amountMinor: '',
          moneyVersion: '',
          revision: '',
          'paidBy.0.amountMinor': '',
          'splitBetween.0.amountMinor': '',
          'splitBetween.1.amountMinor': '',
          'splitBetween.2.amountMinor': '',
        },
        $set: {
          'splitBetween.0.amount': 33.33,
          'splitBetween.1.amount': 33.33,
          'splitBetween.2.amount': 33.34,
        },
      },
    );
    const result = await expenseService.update(
      access,
      { ...command, description: 'Metadata only' },
      0,
    );
    expect(result!.splitBetween.map((row) => row.amountMinor)).toEqual([3333, 3333, 3334]);
    expect(result!.revision).toBe(1);
    expect(result!.splitMethod).toBe('equal');
  });

  it('allows exactly one concurrent mutation of a legacy record without a revision', async () => {
    const { expense, access } = await fixture();
    await Expense.collection.updateOne({ _id: expense._id }, { $unset: { revision: '' } });
    const outcomes = await Promise.allSettled([
      expenseService.update(access, { description: 'First editor' }, 0),
      expenseService.update(access, { description: 'Second editor' }, 0),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await Expense.findById(expense._id))!.revision).toBe(1);
  });

  it('rejects drift instead of silently repairing canonical money during metadata edits', async () => {
    const { expense, access } = await fixture();
    await Expense.collection.updateOne({ _id: expense._id }, { $set: { amountMinor: 1 } });
    await expect(expenseService.update(access, { description: 'Should fail' }, 0)).rejects.toThrow(
      'Stored amounts disagree',
    );
    expect((await Expense.findById(expense._id))!.description).toBe('Old allocation');
  });

  it('omits histories from lists, keeps them in details, and uses the compound list index', async () => {
    const { expense, access, groupId } = await fixture();
    await expenseService.update(access, { description: 'Edited' }, 0);
    const list = await expenseService.getGroupExpenses(groupId, {}, alice);
    expect(list.expenses[0]).not.toHaveProperty('editHistory');
    expect(list.expenses[0]).not.toHaveProperty('creationRequest');
    expect(list.expenses[0]).not.toHaveProperty('pendingActivity');
    const detail = await expenseService.getById(access);
    expect(detail!.editHistory).toHaveLength(1);
    await Expense.createIndexes();
    const plan = await Expense.find({ group: expense.group, isDeleted: false })
      .sort({ date: -1, createdAt: -1 })
      .hint({ group: 1, isDeleted: 1, date: -1, createdAt: -1 })
      .explain('executionStats');
    expect(JSON.stringify(plan)).toContain('IXSCAN');
    expect(JSON.stringify(plan)).not.toContain('"stage":"SORT"');
  });
  it('serializes a currency change against the first financial write', async () => {
    const group = await groupService.create(
      { name: 'Currency race', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
      alice,
    );
    const groupId = String(group._id);
    const outcomes = await Promise.allSettled([
      groupService.update(groupId, { defaultCurrency: 'USD' }, alice),
      expenseService.create(
        groupId,
        {
          description: 'First money',
          amount: 1,
          currency: 'INR',
          category: 'other',
          tag: 'Food',
          date: new Date(),
          paidBy: [{ user: alice, amount: 1 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alice }],
        },
        alice,
      ),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const current = await groupService.getById(groupId);
    const records = await Expense.find({ group: groupId });
    for (const record of records) expect(record.currency).toBe(current!.defaultCurrency);
    if (records.length) expect(current!.currencyLocked).toBe(true);
    else expect(current!.defaultCurrency).toBe('USD');
  });
  it('permits compatible legacy floating tails during metadata edits without accepting new excess precision', async () => {
    const { expense, access } = await fixture();
    await Expense.collection.updateOne(
      { _id: expense._id },
      {
        $unset: { moneyVersion: '', amountMinor: '' },
        $set: {
          amount: 0.1 + 0.2,
          paidBy: [{ user: new Types.ObjectId(alice), amount: 0.1 + 0.2 }],
          splitBetween: [{ user: new Types.ObjectId(alice), amount: 0.1 + 0.2 }],
        },
      },
    );
    const updated = await expenseService.update(access, { description: 'Legacy metadata' }, 0);
    expect(updated!.amountMinor).toBe(30);
    expect(updated!.paidBy[0].amountMinor).toBe(30);
    expect(updated!.splitBetween[0].amountMinor).toBe(30);
    await expect(expenseService.update(access, { amount: 0.30000000000000004 }, 1)).rejects.toThrow(
      'decimal places',
    );
  });
});
