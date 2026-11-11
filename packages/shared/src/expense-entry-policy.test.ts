import { expect, it } from 'vitest';
import { readExpenseEntry, formSummaryPolicy } from './expense-entry';
import { entries } from './test-support/expense-entry-cases';

it('keeps a blank share as one for a complete-form save and zero in its displayed share count', () => {
  const entry = entries.find((entry) => entry.id === 'shares-partly-blank')!;
  const reading = readExpenseEntry(entry, { kind: 'new' }, formSummaryPolicy);
  expect(reading.result).toMatchObject({
    kind: 'ready', money: { splitBetween: [{ amountMinor: 6667 }, { amountMinor: 3333 }] },
  });
  expect(reading.fields.sharesTotal).toBe(2);
  expect(reading.fields.perShareAmount).toBe(50);
});
