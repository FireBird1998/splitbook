import { expect, it } from 'vitest';
import { readExpenseEntry, formSummaryPolicy } from './expense-entry';
import { entries, savedFor, sam } from './test-support/expense-entry-cases';

it('counts a blank share as zero both on save and in its displayed share count', () => {
  const entry = entries.find((entry) => entry.id === 'shares-partly-blank')!;
  const reading = readExpenseEntry(entry, { kind: 'new' }, formSummaryPolicy);
  expect(reading.result).toMatchObject({
    kind: 'ready',
    money: { splitBetween: [{ amountMinor: 10000 }, { amountMinor: 0 }] },
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

it('drops unpaid rows and keeps saved zero rows only until money changes', () => {
  const zero = entries.find((entry) => entry.id === 'payers-zero')!;
  expect(readExpenseEntry(zero, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'ready',
    money: { paidBy: [{ amountMinor: 10000 }] },
  });
  const blank = entries.find((entry) => entry.id === 'payers-partly-blank')!;
  expect(readExpenseEntry(blank, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'ready',
  });
  const changed = entries.find((entry) => entry.id === 'saved-zero-payer-money-change')!;
  expect(
    readExpenseEntry(changed, { kind: 'edit', saved: savedFor(changed) }, formSummaryPolicy).result,
  ).toMatchObject({
    kind: 'ready',
    money: { paidBy: [{ amountMinor: 12000 }] },
  });
  const single = entries.find((entry) => entry.id === 'single-payer-field-differs')!;
  expect(readExpenseEntry(single, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'ready',
    money: { paidBy: [{ user: single.payerId }] },
  });
});

it('retains an existing zero payer while no money value changes', () => {
  const original = entries.find((row) => row.id === 'saved-zero-payer-unchanged')!;
  expect(
    readExpenseEntry(
      { ...original, payers: original.payers.slice(0, 1) },
      { kind: 'edit', saved: savedFor(original) },
      formSummaryPolicy,
    ).result,
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
  ['shares-partly-blank', [10000, 0], 1],
  ['shares-one-zero', [10000, 0], 1],
  ['payers-zero', [5000, 5000], 1],
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
  ['lone-listed-payer-blank', 'At least one payer and participant are required'],
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

it('saves a blank share as zero on the complete form (#1117 decision 1)', () => {
  const entry = entries.find((row) => row.id === 'shares-partly-blank')!;
  expect(readExpenseEntry(entry, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'ready',
    money: { splitBetween: [{ amountMinor: 10000 }, { amountMinor: 0 }] },
  });
});

it.each(['payers-zero', 'payers-partly-blank'])(
  'leaves an unpaid row out of the web command for %s (#1117 decision 2)',
  (id) => {
    const entry = entries.find((row) => row.id === id)!;
    expect(readExpenseEntry(entry, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
      kind: 'ready',
      money: { paidBy: [{ user: entry.payerId, amountMinor: 10000 }] },
    });
    const result = readExpenseEntry(entry, { kind: 'new' }, formSummaryPolicy).result;
    if (result.kind === 'ready') expect(result.money.paidBy).toHaveLength(1);
  },
);
