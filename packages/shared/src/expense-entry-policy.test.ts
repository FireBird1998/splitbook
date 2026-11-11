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
    error: { message: 'Use a whole number of shares.' },
  });
  const blank = entries.find((entry) => entry.id === 'shares-all-blank')!;
  expect(readExpenseEntry(blank, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'refused',
    problems: [{ field: 'split', message: 'Give at least one person a share.' }],
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
  ['shares-all-blank', 'Give at least one person a share.', 'split'],
  ['shares-all-zero', 'Give at least one person a share.', 'split'],
  ['shares-fractional', 'Use a whole number of shares.', 'split'],
  ['lone-listed-payer-blank', 'Choose who paid.', 'payers'],
  ['amounts-not-total', 'Split amounts must add up to the expense amount', 'split'],
  ['percentage-not-total', 'Percentages must add up to 100', 'split'],
  ['unreadable-amount', 'Use digits and one decimal point, such as 250.50.', 'amount'],
  ['unreadable-payer', 'Use digits and one decimal point, such as 250.50.', 'payers'],
  ['unreadable-split-amount', 'Use digits and one decimal point, such as 250.50.', 'split'],
  ['unreadable-percentage', 'Use digits and one decimal point, such as 33.5.', 'split'],
  ['unreadable-share', 'Use a whole number of shares.', 'split'],
  ['no-participants', 'Choose at least one person to share this Expense.', 'split'],
])('explains %s with the shared client correction', (id, message, field) => {
  const reading = readExpenseEntry(
    entries.find((row) => row.id === id)!,
    { kind: 'new' },
    formSummaryPolicy,
  );
  expect(reading.result).toMatchObject({
    kind: 'refused',
    error: { message },
    problems: [{ field, message }],
  });
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

it('does not show a whole-share total by truncating a fractional box (#1117 decision 5)', () => {
  const entry = entries.find((row) => row.id === 'shares-fractional')!;
  expect(readExpenseEntry(entry, { kind: 'new' }, formSummaryPolicy).fields.sharesTotal).toBeNaN();
});

it('uses the Split sheet’s no-shares correction for the complete form (#1117 decision 6)', () => {
  const row = entries.find((row) => row.id === 'shares-all-blank')!;
  expect(readExpenseEntry(row, { kind: 'new' }, formSummaryPolicy).result).toMatchObject({
    kind: 'refused',
    problems: [{ field: 'split', message: 'Give at least one person a share.' }],
    error: { message: 'Give at least one person a share.' },
  });
});
