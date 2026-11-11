import { expect, it } from 'vitest';
import { readExpenseEntry } from './expense-entry';
import { entries, alex, sam, savedFor } from './test-support/expense-entry-cases';

it('reads the same exact split for the sheet and the new Expense command', () => {
  const entry = entries.find((entry) => entry.id === 'shares')!;
  const reading = readExpenseEntry(entry, { kind: 'new' });
  expect(reading.split).toEqual({
    total: 10000,
    shares: { [alex]: 6667, [sam]: 3333 },
    errors: {},
    status: { kind: 'adds-up', leftover: { amountMinor: 1, users: [alex] } },
  });
  expect(reading.result).toMatchObject({
    kind: 'ready',
    money: {
      amountMinor: 10000,
      paidBy: [{ user: alex, amountMinor: 10000 }],
      splitBetween: [
        { user: alex, amountMinor: 6667, shares: 2 },
        { user: sam, amountMinor: 3333, shares: 1 },
      ],
    },
  });
});

it('drops blank and zero payers from the command while explaining the entries still to assign', () => {
  const entry = entries.find((entry) => entry.id === 'multiple-payers')!;
  const reading = readExpenseEntry(
    {
      ...entry,
      payers: [
        { user: alex, amount: '40' },
        { user: sam, amount: '' },
      ],
    },
    { kind: 'new' },
  );
  expect(reading.payers).toMatchObject({
    entries: [{ user: alex, amount: '40' }],
    totalMinor: 10000,
    assignedMinor: 4000,
    remainingMinor: 6000,
    errors: {},
  });
  expect(reading.split.shares).toEqual({ [alex]: 5000, [sam]: 5000 });
  expect(reading.result).toMatchObject({
    kind: 'refused',
    problems: [{ field: 'payers', message: 'Payer amounts must add up to the expense amount' }],
  });
});

it('explains unreadable boxes on their rows without hiding a separately readable split', () => {
  const entry = entries.find((entry) => entry.id === 'unreadable-payer')!;
  const reading = readExpenseEntry(entry, { kind: 'new' });
  expect(reading.payers.errors).toEqual({
    [sam]: 'Use digits and one decimal point, such as 250.50.',
  });
  expect(reading.split.status.kind).toBe('adds-up');
  const fraction = readExpenseEntry(entries.find((entry) => entry.id === 'shares-fractional')!, {
    kind: 'new',
  });
  expect(fraction.split.errors).toEqual({ [alex]: 'Use a whole number of shares.' });
  expect(fraction.split.status).toEqual({
    kind: 'problem',
    message: 'Correct the entry marked above.',
  });
  const amount = readExpenseEntry({ ...entry, amount: '0' }, { kind: 'new' });
  expect(amount.amount).toEqual({ minor: null, error: 'Enter an amount greater than 0.' });
  expect(amount.result).toMatchObject({
    kind: 'refused',
    problems: [{ field: 'amount', message: 'Enter an amount greater than 0.' }],
  });
});

it('keeps a historical zero payer for unchanged money and drops it for a money edit', () => {
  const unchanged = entries.find((entry) => entry.id === 'saved-zero-payer-unchanged')!;
  expect(
    readExpenseEntry(unchanged, { kind: 'edit', saved: savedFor(unchanged) }).result,
  ).toMatchObject({
    kind: 'ready',
    financialEdit: false,
    money: {
      paidBy: [
        { user: alex, amountMinor: 10000 },
        { user: sam, amountMinor: 0 },
      ],
    },
  });
  const changed = entries.find((entry) => entry.id === 'saved-zero-payer-money-change')!;
  expect(
    readExpenseEntry(changed, { kind: 'edit', saved: savedFor(changed) }).result,
  ).toMatchObject({
    kind: 'ready',
    financialEdit: true,
    money: { paidBy: [{ user: alex, amountMinor: 12000 }] },
  });
});

it.each([
  { id: 'equal', shares: [5000, 5000], paid: [10000] },
  { id: 'amounts', shares: [4000, 6000], paid: [10000] },
  { id: 'exact', shares: [4000, 6000], paid: [10000] },
  { id: 'percentage', shares: [4000, 6000], paid: [10000] },
  { id: 'shares', shares: [6667, 3333], paid: [10000] },
  { id: 'multiple-payers', shares: [5000, 5000], paid: [4000, 6000] },
  { id: 'leftover-cent', shares: [3334, 3333, 3333], paid: [10000] },
  { id: 'shares-partly-blank', shares: [10000, 0], paid: [10000] },
  { id: 'shares-one-zero', shares: [10000, 0], paid: [10000] },
  { id: 'payers-partly-blank', shares: [5000, 5000], paid: [10000] },
  { id: 'payers-zero', shares: [5000, 5000], paid: [10000] },
  { id: 'single-payer-blank', shares: [5000, 5000], paid: [10000] },
  { id: 'amounts-partly-blank', shares: [10000, 0], paid: [10000] },
  { id: 'percentage-partly-blank', shares: [10000, 0], paid: [10000] },
  { id: 'unticked-typed-value', shares: [10000], paid: [10000] },
  { id: 'single-payer-field-differs', shares: [5000, 5000], paid: [10000] },
])(
  'reads $id without changing the entry and agrees with the displayed shares',
  ({ id, shares, paid }) => {
    const entry = entries.find((entry) => entry.id === id)!;
    const before = JSON.parse(JSON.stringify(entry));
    const reading = readExpenseEntry(entry, { kind: 'new' });
    expect(entry).toEqual(before);
    expect(reading.result.kind).toBe('ready');
    if (reading.result.kind !== 'ready') throw new Error('Expected ready figures');
    expect(reading.result.money.splitBetween.map((row) => row.amountMinor)).toEqual(shares);
    expect(reading.result.money.paidBy.map((row) => row.amountMinor)).toEqual(paid);
    expect(Object.values(reading.split.shares)).toEqual(shares);
    expect(reading.split.status.kind).toBe('adds-up');
    expect(reading.result.money.paidBy[0].user).toBe(
      id === 'single-payer-field-differs' ? sam : alex,
    );
  },
);

it.each([
  ['shares-all-blank', 'Give at least one person a share.'],
  ['shares-all-zero', 'Give at least one person a share.'],
  ['shares-fractional', 'Use a whole number of shares.'],
  ['lone-listed-payer-blank', 'Choose who paid.'],
  ['amounts-not-total', 'Split amounts must add up to the expense amount'],
  ['percentage-not-total', 'Percentages must add up to 100'],
  ['unreadable-amount', 'Use digits and one decimal point, such as 250.50.'],
  ['unreadable-payer', 'Use digits and one decimal point, such as 250.50.'],
  ['unreadable-split-amount', 'Use digits and one decimal point, such as 250.50.'],
  ['unreadable-percentage', 'Use digits and one decimal point, such as 33.5.'],
  ['unreadable-share', 'Use a whole number of shares.'],
  ['no-participants', 'Choose at least one person to share this Expense.'],
])('explains %s with the shared client correction', (id, message) => {
  const reading = readExpenseEntry(entries.find((row) => row.id === id)!, { kind: 'new' });
  expect(reading.result).toMatchObject({ kind: 'refused', error: { message } });
});

it('keeps incomplete amount and percentage allocations visible with their remaining units', () => {
  const amounts = readExpenseEntry(entries.find((entry) => entry.id === 'amounts-not-total')!, {
    kind: 'new',
  });
  expect(amounts.split).toMatchObject({
    shares: { [alex]: 4000, [sam]: 4000 },
    status: { kind: 'remaining', unit: 'amount', entered: 8000, target: 10000 },
  });
  const percentages = readExpenseEntry(
    entries.find((entry) => entry.id === 'percentage-not-total')!,
    { kind: 'new' },
  );
  expect(percentages.split).toMatchObject({
    shares: { [alex]: 4000, [sam]: 4000 },
    status: { kind: 'remaining', unit: 'percent', entered: 8000, target: 10000 },
  });
});

it('gives sheets the counted people and shares without reading typed fields again', () => {
  const reading = readExpenseEntry(entries.find((entry) => entry.id === 'shares-partly-blank')!, {
    kind: 'new',
  });
  expect(reading.splitSummary).toEqual({ participants: 2, shares: 2 });
  expect(reading.payers.ids).toEqual([alex]);
  const several = readExpenseEntry(entries.find((entry) => entry.id === 'payers-zero')!, {
    kind: 'new',
  });
  expect(several.payers.ids).toEqual([alex]);
});

it.each([
  ['1.5', 1.5],
  ['not a number', 0],
  ['', 0],
  ['0', 0],
  ['-1', -1],
])('keeps the Shares stepper display for an older typed value %s', (value, shown) => {
  const entry = entries.find((entry) => entry.id === 'shares')!;
  expect(
    readExpenseEntry({ ...entry, splitValues: { [alex]: value } }, { kind: 'new' }).shareSteps[
      alex
    ],
  ).toBe(shown);
});

it('keeps a duplicate payer’s first visible box separate from the footer’s all-row problems', () => {
  const entry = entries.find((entry) => entry.id === 'multiple-payers')!;
  const reading = readExpenseEntry(
    {
      ...entry,
      payers: [
        { user: alex, amount: '40' },
        { user: alex, amount: 'bad' },
      ],
    },
    { kind: 'new' },
  );
  expect(reading.payers.errors).toEqual({});
  expect(reading.payers.problems).toEqual({ [alex]: 'invalid' });
  expect(reading.result.kind).toBe('refused');
});

it('uses one no-shares sentence in the Split sheet and its save correction (#1117 decision 6)', () => {
  const row = entries.find((row) => row.id === 'shares-all-zero')!;
  const reading = readExpenseEntry(row, { kind: 'new' });
  expect(reading.result).toMatchObject({
    kind: 'refused',
    problems: [{ field: 'split', message: 'Give at least one person a share.' }],
  });
});
