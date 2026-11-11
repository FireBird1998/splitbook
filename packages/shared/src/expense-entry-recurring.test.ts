import { expect, it } from 'vitest';
import { readExpenseEntry, formSummaryPolicy } from './expense-entry';
import { entries } from './test-support/expense-entry-cases';

const policy = {
  ...formSummaryPolicy,
  blankShare: 'zero' as const,
  singlePayer: 'field' as const,
  blankSplitAmount: 'refuse' as const,
  weightInput: 'numbers-or-zero' as const,
  feedback: 'allocation-summary' as const,
};

it('refuses a blank recurring amount at its row instead of supplying zero', () => {
  const entry = entries.find((entry) => entry.id === 'amounts-partly-blank')!;
  expect(readExpenseEntry(entry, {kind: 'new'}, policy).result).toMatchObject({
    kind: 'refused', problems: [{field: 'form', message: 'Enter a valid decimal amount'}],
  });
});
