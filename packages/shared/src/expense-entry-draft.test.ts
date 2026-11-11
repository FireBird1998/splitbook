import { expect, it } from 'vitest';
import { draftForExpenseEntry, entryForExpenseDraft } from './expense-entry-draft';
import { expenseEntryPolicy } from './expense-entry';
import { entries, alex, sam } from './test-support/expense-entry-cases';

it('keeps zero payers and omits a blank share when an entry is set aside', () => {
  const entry = {
    ...entries.find((row) => row.id === 'payers-zero')!,
    splitMethod: 'shares' as const,
    splitValues: { [alex]: '2', [sam]: '' },
  };
  expect(draftForExpenseEntry(entry)).toMatchObject({
    amount: 100,
    paidBy: [
      { user: alex, amount: 100 },
      { user: sam, amount: 0 },
    ],
    splitBetween: [{ user: alex, shares: 2 }, { user: sam }],
  });
  expect(draftForExpenseEntry(entry).splitBetween![1]).not.toHaveProperty('shares');
});

it('leaves a Draft’s missing choices and figures not given in the entry', () => {
  expect(
    entryForExpenseDraft({
      description: 'Lunch',
      paidBy: [{ user: alex }],
      splitBetween: [{ user: sam }],
    }),
  ).toMatchObject({
    amount: '',
    currency: '',
    category: '',
    splitMethod: '',
    payers: [{ user: alex, amount: '' }],
    splitValues: { [sam]: '' },
  });
});

it('changes a note without inventing omitted facts or losing a retained Tag name and item', () => {
  const from = {
    description: 'Lunch',
    tag: 'Food',
    predefinedItem: 'Coffee',
    paidBy: [{ user: alex }],
    splitBetween: [{ user: sam }],
  };
  const entry = { ...entryForExpenseDraft(from), notes: 'Receipt checked' };
  expect(
    draftForExpenseEntry(entry, expenseEntryPolicy, { from, changed: { notes: true } }),
  ).toEqual({ ...from, notes: 'Receipt checked' });
});

it('keeps unedited split facts for both field and sheet edits', () => {
  const from = {
    amount: 100,
    currency: 'INR',
    splitMethod: 'shares' as const,
    splitBetween: [
      { user: alex, amount: 50, percentage: 50, shares: 1 },
      { user: sam, amount: 50, percentage: 50, shares: 1 },
    ],
  };
  const entry = { ...entryForExpenseDraft(from), splitValues: { [alex]: '2', [sam]: '1' } };
  const policy = expenseEntryPolicy;
  expect(
    draftForExpenseEntry(entry, policy, { from, changed: { splitValues: true } }).splitBetween,
  ).toEqual([
    { user: alex, amount: 50, percentage: 50, shares: 2 },
    { user: sam, amount: 50, percentage: 50, shares: 1 },
  ]);
  expect(
    draftForExpenseEntry(entry, expenseEntryPolicy, { from, changed: { splitValues: true } })
      .splitBetween,
  ).toEqual([
    { user: alex, amount: 50, percentage: 50, shares: 2 },
    { user: sam, amount: 50, percentage: 50, shares: 1 },
  ]);
});
it('merges repeated people for one-box-per-person fields and retains rows for the sheet projection', () => {
  const from = {
    paidBy: [
      { user: alex, amount: 40 },
      { user: alex, amount: 60 },
    ],
  };
  const policy = { ...expenseEntryPolicy, repeatedPeople: 'merge' as const };
  expect(entryForExpenseDraft(from, policy).payers).toEqual([{ user: alex, amount: '60' }]);
  expect(entryForExpenseDraft(from).payers).toEqual([
    { user: alex, amount: '40' },
    { user: alex, amount: '60' },
  ]);
});

it('keeps an unreadable saved amount visible for correction instead of throwing while opening', () => {
  expect(
    entryForExpenseDraft({ amount: 0 }, { ...expenseEntryPolicy, repeatedPeople: 'merge' }).amount,
  ).toBe('0');
});

it('leaves an omitted split method to the caller’s explicit choice', () => {
  const from = { description: 'Lunch' };
  const entry = { ...entryForExpenseDraft(from), participantIds: [alex] };
  expect(
    draftForExpenseEntry(entry, expenseEntryPolicy, { from, changed: { participantIds: true } }),
  ).toEqual({
    description: 'Lunch',
    splitBetween: [{ user: alex }],
  });
});

it('keeps existing row positions when a field unticks and reticks a participant', () => {
  const from = { splitMethod: 'equal' as const, splitBetween: [{ user: alex }, { user: sam }] };
  const entry = { ...entryForExpenseDraft(from), participantIds: [sam, alex] };
  expect(
    draftForExpenseEntry(entry, expenseEntryPolicy, { from, changed: { participantIds: true } })
      .splitBetween,
  ).toEqual([{ user: alex }, { user: sam }]);
});

it('keeps a phone Tag identity distinct from a form’s legacy named Tag', () => {
  const entry = { ...entries[0], tagId: 'Food' };
  expect(() => draftForExpenseEntry(entry)).toThrow('tagId: Invalid Tag identity');
  expect(
    draftForExpenseEntry(entry, { ...expenseEntryPolicy, tagReference: 'identity-or-name' }),
  ).toMatchObject({ tag: 'Food' });
});

it('retains assistant split facts a sheet did not edit (#1117 decision 10)', () => {
  const from = {
    splitMethod: 'shares' as const,
    splitBetween: [
      { user: alex, amount: 50, percentage: 50, shares: 1 },
      { user: sam, amount: 50, percentage: 50, shares: 1 },
    ],
  };
  const entry = { ...entryForExpenseDraft(from), splitValues: { [alex]: '2', [sam]: '1' } };
  expect(
    draftForExpenseEntry(entry, expenseEntryPolicy, { from, changed: { splitValues: true } })
      .splitBetween,
  ).toEqual([
    { user: alex, amount: 50, percentage: 50, shares: 2 },
    { user: sam, amount: 50, percentage: 50, shares: 1 },
  ]);
});
