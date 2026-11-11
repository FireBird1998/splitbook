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
    money: { paidBy: [{ user: single.payerId }] },
  });
});

it('honors removing a historical zero payer only under the keep-entered-rows policy', () => {
  const original = entries.find((entry) => entry.id === 'saved-zero-payer-unchanged')!;
  const entry = { ...original, payers: original.payers.slice(0, 1) };
  const purpose = { kind: 'edit' as const, saved: savedFor(original) };
  expect(readExpenseEntry(entry, purpose, formSummaryPolicy).result).toMatchObject({
    kind: 'ready',
    financialEdit: true,
    money: { paidBy: [{ amountMinor: 10000 }] },
  });
  expect(
    readExpenseEntry(entry, purpose, { ...formSummaryPolicy, savedZeroPayers: 'unchanged' }).result,
  ).toMatchObject({
    kind: 'ready',
    financialEdit: false,
    money: { paidBy: [{ amountMinor: 10000 }, { amountMinor: 0 }] },
  });
});

it.each([
  ['equal', [5000, 5000], 1],
  ['amounts', [4000, 6000], 1],
  ['exact', [4000, 6000], 1],
  ['percentage', [4000, 6000], 1],
  ['shares', [6667, 3333], 1],
  ['multiple-payers', [5000, 5000], 2],
  ['leftover-cent', [3334, 3333, 3333], 1],
  ['shares-partly-blank', [6667, 3333], 1],
  ['shares-one-zero', [10000, 0], 1],
  ['payers-zero', [5000, 5000], 2],
  ['single-payer-blank', [5000, 5000], 1],
  ['amounts-partly-blank', [10000, 0], 1],
  ['percentage-partly-blank', [10000, 0], 1],
  ['unticked-typed-value', [10000], 1],
  ['single-payer-field-differs', [5000, 5000], 1],
] as const)('keeps the complete-form figures for %s', (id, shares, payerCount) => {
  const { result } = readExpenseEntry(
    entries.find((entry) => entry.id === id)!,
    { kind: 'new' },
    formSummaryPolicy,
  );
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') throw new Error('Expected accepted figures');
  expect(result.money.splitBetween.map((row) => row.amountMinor)).toEqual(shares);
  expect(result.money.paidBy).toHaveLength(payerCount);
});

it.each([
  ['shares-all-blank', 'Each member needs at least 1 share'],
  ['shares-all-zero', 'Each member needs at least 1 share'],
  ['shares-fractional', 'Shares must be whole numbers within the supported range'],
  ['payers-partly-blank', 'Enter a valid decimal amount'],
  ['lone-listed-payer-blank', 'Enter a valid decimal amount'],
  ['amounts-not-total', 'Split amounts must add up to the expense amount'],
  ['percentage-not-total', 'Percentages must add up to 100'],
  ['unreadable-amount', 'Enter a valid decimal amount'],
  ['unreadable-payer', 'Enter a valid decimal amount'],
  ['unreadable-split-amount', 'Enter a valid decimal amount'],
  ['unreadable-percentage', 'Enter a valid decimal amount'],
  ['unreadable-share', 'Shares must be whole numbers within the supported range'],
  ['no-participants', 'At least one payer and participant are required'],
])('keeps the complete-form refusal for %s', (id, message) => {
  expect(
    readExpenseEntry(entries.find((entry) => entry.id === id)!, { kind: 'new' }, formSummaryPolicy)
      .result,
  ).toMatchObject({ kind: 'refused', problems: [{ field: 'form', message }] });
});

it('keeps an empty unknown-currency preview as a refusal instead of throwing', async () => {
  const { ExpenseDraft } = await import('./expense-draft');
  const draft = ExpenseDraft.open({
    groupId: 'group',
    accountId: 'alex',
    memberIds: ['alex'],
    currency: 'INR',
    defaultTag: '',
    date: '2026-11-11',
  }).change({ currency: '', amount: '' });
  expect(draft.preview()).toEqual({ money: null, error: 'INVALID_CURRENCY' });
});

it('reads one payer from the payer field for the web command (#1117 decision 7)', () => {
  const entry = entries.find((row) => row.id === 'single-payer-field-differs')!;
  expect(readExpenseEntry(entry, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'ready',
    money: { paidBy: [{ user: sam, amountMinor: 10000 }] },
  });
});
