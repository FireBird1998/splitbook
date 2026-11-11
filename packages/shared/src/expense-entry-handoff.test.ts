import { expect, it } from 'vitest';
import { ExpenseDraft } from './expense-draft';
import { readQuickAdd, quickAddEntry } from './quick-add';
import {
  alex,
  sam,
  people,
  day,
  groupId,
  tagId,
  savedExpense,
} from './test-support/expense-entry-cases';

const context = {
  groupId,
  accountId: alex,
  memberIds: people.map((p) => p.id),
  currency: 'INR',
  defaultTag: tagId,
  date: day,
};

it('hands Quick add to the form as one Expense entry', () => {
  const quick = { currency: 'INR', today: day, viewerId: alex, members: people };
  const line = readQuickAdd('Dinner 100 paid by me', quick);
  const entry = quickAddEntry(line, { payerId: alex, tagId }, quick);
  expect(entry).toEqual({
    description: 'Dinner',
    amount: '100',
    currency: 'INR',
    date: day,
    category: 'other',
    notes: '',
    tagId,
    payerId: alex,
    multiPayer: false,
    payers: [{ user: alex, amount: '' }],
    splitMethod: 'equal',
    participantIds: people.map((p) => p.id),
    splitValues: {},
  });
  expect(ExpenseDraft.open(context).change(entry).entry).toEqual(entry);
});

it('hands Duplicate to the form as one active split map with its historical weights', () => {
  const saved = {
    ...savedExpense,
    splitMethod: 'shares' as const,
    splitBetween: [
      { user: alex, amount: 66.67, amountMinor: 6667, shares: 2 },
      { user: sam, amount: 33.33, amountMinor: 3333, shares: 1 },
    ],
  };
  const draft = ExpenseDraft.duplicate(context, saved, [tagId]);
  expect(draft.base).toBeNull();
  expect(draft.entry).toEqual({
    description: 'Groceries',
    amount: '100',
    currency: 'INR',
    date: day,
    category: 'food',
    notes: '',
    tagId,
    payerId: alex,
    multiPayer: false,
    payers: [{ user: alex, amount: '100' }],
    splitMethod: 'shares',
    participantIds: [alex, sam],
    splitValues: { [alex]: '2', [sam]: '1' },
  });
});
