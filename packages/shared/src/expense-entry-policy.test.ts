import { expect, it } from 'vitest';
import { readExpenseEntry, formSummaryPolicy } from './expense-entry';
import { entries, savedFor, sam } from './test-support/expense-entry-cases';

it('keeps a blank share as one for a complete-form save and zero in its displayed share count', () => {
  const entry = entries.find((entry) => entry.id === 'shares-partly-blank')!;
  const reading = readExpenseEntry(entry, { kind: 'new' }, formSummaryPolicy);
  expect(reading.result).toMatchObject({
    kind: 'ready',
    money: { splitBetween: [{ amountMinor: 6667 }, { amountMinor: 3333 }] },
  });
  expect(reading.fields.sharesTotal).toBe(2);
  expect(reading.fields.perShareAmount).toBe(50);
});

it('keeps complete-form refusals and numeric weights while withholding partial allocations and rounding notes', () => {
  const fractional = entries.find((entry) => entry.id === 'shares-fractional')!;
  expect(readExpenseEntry(fractional, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'refused',
    error: { message: 'Shares must be whole numbers within the supported range' },
  });
  const blank = entries.find((entry) => entry.id === 'shares-all-blank')!;
  expect(readExpenseEntry(blank, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'refused',
    problems: [{ field: 'form', message: 'Each member needs at least 1 share' }],
  });
  const partial = entries.find((entry) => entry.id === 'amounts-not-total')!;
  expect(readExpenseEntry(partial, { kind: 'new' }, formSummaryPolicy).split.shares).toEqual({});
  const rounded = entries.find((entry) => entry.id === 'leftover-cent')!;
  expect(readExpenseEntry(rounded, { kind: 'new' }, formSummaryPolicy).split.status).toEqual({
    kind: 'adds-up',
    leftover: null,
  });
});

it('keeps all entered payer rows, uses their first identity for one payer, and retains saved zero rows on a money edit', () => {
  const zero = entries.find((entry) => entry.id === 'payers-zero')!;
  expect(readExpenseEntry(zero, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'ready',
    money: { paidBy: [{ amountMinor: 10000 }, { user: sam, amountMinor: 0 }] },
  });
  const blank = entries.find((entry) => entry.id === 'payers-partly-blank')!;
  expect(readExpenseEntry(blank, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'refused',
  });
  const changed = entries.find((entry) => entry.id === 'saved-zero-payer-money-change')!;
  expect(
    readExpenseEntry(changed, { kind: 'edit', saved: savedFor(changed) }, formSummaryPolicy).result,
  ).toMatchObject({
    kind: 'ready',
    money: { paidBy: [{ amountMinor: 12000 }, { amountMinor: 0 }] },
  });
  const single = entries.find((entry) => entry.id === 'single-payer-field-differs')!;
  expect(readExpenseEntry(single, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'ready',
    money: { paidBy: [{ user: single.payers[0].user }] },
  });
});
