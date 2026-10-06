import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from './group.service';
import { expenseService } from './expense.service';
import { recurringExpenseService } from './recurring-expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';

// Recurring Expenses are off unless switched on (#289); this file covers them switched on.
vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');

const db = integrationTestDb('tag-identity');
const { alice } = TEST_USER_IDS;
beforeAll(async () => {
  await db.connect();
  await Expense.createIndexes();
});
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice');
});
afterAll(db.teardown);

async function household() {
  const group = await groupService.create(
    { name: 'Tag household', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  return {
    groupId: String(group._id),
    tagId: String(group.tags.find((tag) => tag.name === 'Rent')!._id),
  };
}

const expenseInput = {
  description: 'Rent payment',
  amount: 12,
  currency: 'INR',
  category: 'housing',
  date: new Date('2026-01-01'),
  paidBy: [{ user: alice, amount: 12 }],
  splitMethod: 'equal' as const,
  splitBetween: [{ user: alice }],
};
const templateInput = { ...expenseInput, dayOfMonth: 1, startsOn: new Date('2099-01-01') };

describe('stable Tag identity', () => {
  it('renames manual and recurring references without losing filtering or generation', async () => {
    const { groupId, tagId } = await household();
    const expense = await expenseService.create(groupId, { ...expenseInput, tagId }, alice);
    const template = await recurringExpenseService.create(
      groupId,
      { ...templateInput, tagId },
      alice,
    );
    await groupService.updateTag(groupId, tagId, { name: 'Monthly housing' }, alice);
    const access = { actorId: alice, groupId, expenseId: String(expense._id) };
    expect(await expenseService.getById(access)).toMatchObject({ tagId, tag: 'Monthly housing' });
    expect((await expenseService.getGroupExpenses(groupId, { tagId })).expenses).toHaveLength(1);
    expect(
      (await expenseService.getGroupExpenses(groupId, { tag: 'Monthly housing' })).expenses,
    ).toHaveLength(1);
    expect((await recurringExpenseService.list(groupId))[0]).toMatchObject({
      tagId,
      tag: 'Monthly housing',
    });
    await recurringExpenseService.generateDueExpenses(groupId, new Date('2099-02-02'));
    const generated = await Expense.find({ recurringExpense: template!._id }).lean();
    expect(generated).toHaveLength(2);
    expect(
      generated.every(
        (record) => String(record.tagId) === tagId && record.tag === 'Monthly housing',
      ),
    ).toBe(true);
  });

  it('backfills exact legacy names before rename while preserving fallback values', async () => {
    const { groupId, tagId } = await household();
    const expense = await expenseService.create(groupId, { ...expenseInput, tag: 'Rent' }, alice);
    await Expense.collection.updateOne({ _id: expense._id }, { $unset: { tagId: '' } });
    const before = await Expense.findById(expense._id).lean();
    await groupService.updateTag(groupId, tagId, { name: 'Housing' }, alice);
    const stored = await Expense.findById(expense._id).lean();
    expect(stored?.tag).toBe('Rent');
    expect(String(stored?.tagId)).toBe(tagId);
    expect(stored?.updatedAt).toEqual(before?.updatedAt);
    expect((await expenseService.getGroupExpenses(groupId, { tagId })).expenses[0].tag).toBe(
      'Housing',
    );
  });

  it('rejects foreign IDs and new archived assignments, while preserving an existing archived ID', async () => {
    const { groupId, tagId } = await household();
    const foreign = await household();
    await expect(
      expenseService.create(groupId, { ...expenseInput, tagId: foreign.tagId }, alice),
    ).rejects.toThrow('INVALID_TAG');
    const expense = await expenseService.create(groupId, { ...expenseInput, tagId }, alice);
    await groupService.updateTag(groupId, tagId, { isArchived: true }, alice);
    await expect(expenseService.create(groupId, { ...expenseInput, tagId }, alice)).rejects.toThrow(
      'INVALID_TAG',
    );
    const updated = await expenseService.update(
      { actorId: alice, groupId, expenseId: String(expense._id) },
      { description: 'Correction', tagId },
    );
    expect(String(updated?.tagId)).toBe(tagId);
    expect(updated?.description).toBe('Correction');
  });

  it('blocks deletion for soft-deleted Expenses and paused recurring templates', async () => {
    const { groupId, tagId } = await household();
    const expense = await expenseService.create(groupId, { ...expenseInput, tagId }, alice);
    await Expense.updateOne({ _id: expense._id }, { $set: { isDeleted: true } });
    await expect(groupService.deleteTag(groupId, tagId, alice)).rejects.toThrow('TAG_IN_USE:1:0');
    const second = await household();
    const template = await recurringExpenseService.create(
      second.groupId,
      { ...templateInput, tagId: second.tagId },
      alice,
    );
    await RecurringExpense.updateOne({ _id: template!._id }, { $set: { isPaused: true } });
    await expect(groupService.deleteTag(second.groupId, second.tagId, alice)).rejects.toThrow(
      'TAG_IN_USE:0:1',
    );
  });

  it('retains deleted identity while rejecting subsequent assignments', async () => {
    const { groupId, tagId } = await household();
    await groupService.deleteTag(groupId, tagId, alice);
    const group = await Group.findById(groupId).lean();
    expect(group?.tags.find((tag) => String(tag._id) === tagId)).toMatchObject({
      name: 'Rent',
      isDeleted: true,
      isArchived: true,
    });
    await expect(expenseService.create(groupId, { ...expenseInput, tagId }, alice)).rejects.toThrow(
      'INVALID_TAG',
    );
    // A write admitted just before deletion retains a resolvable historical ID.
    const admitted = await Expense.create({
      ...expenseInput,
      group: groupId,
      tag: 'Rent',
      tagId,
      createdBy: alice,
      splitBetween: [{ user: alice, amount: 12 }],
    });
    expect(
      await expenseService.getById({ actorId: alice, groupId, expenseId: String(admitted._id) }),
    ).toMatchObject({ tagId, tag: 'Rent' });
  });

  it('makes duplicate adds and conflicting renames atomic', async () => {
    const { groupId } = await household();
    const adds = await Promise.allSettled([
      groupService.addTag(groupId, 'Special [Tag]', alice),
      groupService.addTag(groupId, 'special [tag]', alice),
    ]);
    expect(adds.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const group = await Group.findById(groupId).lean();
    const [first, second] = group!.tags;
    const renames = await Promise.allSettled([
      groupService.updateTag(groupId, String(first._id), { name: 'Combined' }, alice),
      groupService.updateTag(groupId, String(second._id), { name: 'combined' }, alice),
    ]);
    expect(renames.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await Group.findById(groupId))!.tags.filter((tag) => tag.name.toLowerCase() === 'combined'),
    ).toHaveLength(1);
  });

  it('allows an ID-only Tag to be renamed after deleting and reusing its name', async () => {
    const { groupId, tagId } = await household();
    await groupService.deleteTag(groupId, tagId, alice);
    const group = await groupService.addTag(groupId, 'Rent', alice);
    const replacement = group!.tags.find((tag) => tag.name === 'Rent' && !tag.isDeleted)!;
    const replacementId = String(replacement._id);
    const expense = await expenseService.create(
      groupId,
      { ...expenseInput, tagId: replacementId },
      alice,
    );
    await groupService.updateTag(groupId, replacementId, { name: 'New rent' }, alice);
    expect(
      await expenseService.getById({ actorId: alice, groupId, expenseId: String(expense._id) }),
    ).toMatchObject({ tagId: replacementId, tag: 'New rent' });
    const storedGroup = await Group.findById(groupId).lean();
    expect(storedGroup?.tags.find((tag) => String(tag._id) === tagId)).toMatchObject({
      name: 'Rent',
      isDeleted: true,
    });
  });

  it('still blocks a reused-name rename when legacy records make the association ambiguous', async () => {
    const { groupId, tagId } = await household();
    await groupService.deleteTag(groupId, tagId, alice);
    const group = await groupService.addTag(groupId, 'Rent', alice);
    const replacementId = String(
      group!.tags.find((tag) => tag.name === 'Rent' && !tag.isDeleted)!._id,
    );
    const expense = await expenseService.create(
      groupId,
      { ...expenseInput, tagId: replacementId },
      alice,
    );
    await Expense.collection.updateOne({ _id: expense._id }, { $unset: { tagId: '' } });
    await expect(
      groupService.updateTag(groupId, replacementId, { name: 'New rent' }, alice),
    ).rejects.toThrow('AMBIGUOUS_TAG');
    expect((await Expense.collection.findOne({ _id: expense._id }))?.tagId).toBeUndefined();
  });
});
