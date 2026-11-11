import { expect, it } from 'vitest';
import { draftForExpenseEntry, entryForExpenseDraft } from './expense-entry-draft';
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
  expect(entryForExpenseDraft({description: 'Lunch', paidBy: [{user: alex}], splitBetween: [{user: sam}]})).toMatchObject({
    amount: '', currency: '', category: '', splitMethod: '',
    payers: [{user: alex, amount: ''}], splitValues: {[sam]: ''},
  });
});
