import { expect, it } from 'vitest';
import { readExpenseEntry, recurringEntryPolicy } from './expense-entry';
import { entries } from './test-support/expense-entry-cases';

it('refuses a blank recurring amount at its row instead of supplying zero', () => {
  const entry = entries.find((entry) => entry.id === 'amounts-partly-blank')!;
  expect(readExpenseEntry(entry, { kind: 'new' }, recurringEntryPolicy).result).toMatchObject({
    kind: 'refused',
    problems: [{ field: 'form', message: 'Enter a valid decimal amount' }],
  });
});
