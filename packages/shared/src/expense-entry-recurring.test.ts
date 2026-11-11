import { expect, it } from 'vitest';
import { readExpenseEntry, recurringEntryPolicy } from './expense-entry';
import { entries, alex, sam } from './test-support/expense-entry-cases';

it('refuses a blank recurring amount at its row instead of supplying zero', () => {
  const entry = entries.find((entry) => entry.id === 'amounts-partly-blank')!;
  expect(readExpenseEntry(entry, { kind: 'new' }, recurringEntryPolicy).result).toMatchObject({
    kind: 'refused',
    problems: [{ field: 'form', message: 'Enter a valid decimal amount' }],
  });
});

it.each(['unreadable-share', 'unreadable-percentage'])(
  'keeps the recurring zero reading of %s',
  (id) => {
    const entry = entries.find((entry) => entry.id === id)!;
    expect(readExpenseEntry(entry, { kind: 'new' }, recurringEntryPolicy).result).toMatchObject({
      kind: 'ready',
      money: { splitBetween: [{ amountMinor: 10000 }, { amountMinor: 0 }] },
    });
  },
);

it('returns the template figures separately from its allocated preview without changing the method', () => {
  const entry = entries.find((entry) => entry.id === 'shares')!;
  const reading = readExpenseEntry(entry, {kind: 'new'}, recurringEntryPolicy);
  expect(reading.result).toMatchObject({
    kind: 'ready',
    figures: {
      amount: 100, currency: 'INR', paidBy: [{user: alex, amount: 100}],
      splitMethod: 'shares', splitBetween: [{user: alex, shares: 2}, {user: sam, shares: 1}],
    },
    money: {splitBetween: [{amountMinor: 6667}, {amountMinor: 3333}]},
  });
});
