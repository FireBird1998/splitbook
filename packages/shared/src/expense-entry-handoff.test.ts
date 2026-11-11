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

it('reads an existing Expense with its historical zero payer without rewriting it (#1117)', async () => {
  const { entries, savedFor } = await import('./test-support/expense-entry-cases');
  const row = entries.find((row) => row.id === 'saved-zero-payer-unchanged')!;
  const saved = savedFor(row);
  const before = JSON.stringify(saved);
  const draft = ExpenseDraft.open(context, saved);
  expect(draft.reading().result).toMatchObject({
    kind: 'ready',
    financialEdit: false,
    money: {
      paidBy: [
        { user: alex, amountMinor: 10000 },
        { user: sam, amountMinor: 0 },
      ],
    },
  });
  expect(JSON.stringify(saved)).toBe(before);
  expect(
    JSON.parse(
      draft.change({ notes: 'Checked' }).prepare([tagId], 'historical-readback').submission!.body,
    ).paidBy,
  ).toEqual([
    { user: alex, amount: 100, amountMinor: 10000 },
    { user: sam, amount: 0, amountMinor: 0 },
  ]);
});
