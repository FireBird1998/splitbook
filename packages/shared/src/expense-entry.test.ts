import { expect, it } from 'vitest';
import { readExpenseEntry } from './expense-entry';
import { entries, alex, sam } from './test-support/expense-entry-cases';

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
