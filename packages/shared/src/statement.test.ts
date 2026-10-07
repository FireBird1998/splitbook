import { describe, expect, it } from 'vitest';
import { buildStatement } from './statement';
import type { BackupGroupInput } from './export-backup';
const group: BackupGroupInput = {
  id: 'g',
  name: 'Ferry Trip',
  theme: 'trip',
  currency: 'INR',
  tags: [],
  members: [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ],
  names: { a: 'Alice', b: 'Bob' },
  expenses: [
    {
      id: 'e',
      date: '2026-09-01',
      description: 'Lunch',
      category: 'food',
      tag: 'Meals',
      currency: 'INR',
      amountMinor: 101,
      splitMethod: 'equal',
      paidBy: [{ userId: 'a', amountMinor: 101 }],
      splitBetween: [
        { userId: 'a', amountMinor: 51 },
        { userId: 'b', amountMinor: 50 },
      ],
    },
  ],
  settlements: [
    {
      id: 'p',
      at: '2026-09-02T12:00:00Z',
      fromId: 'b',
      toId: 'a',
      currency: 'INR',
      amountMinor: 20,
      recordedById: 'b',
    },
  ],
};
describe('printable statement figures', () => {
  it('keeps Paid and Share equal to Spent, Nets zero, and suggestions identical to the ledger', () => {
    const bucket = buildStatement(group).currencies[0];
    expect(bucket.spentMinor).toBe(101);
    expect(bucket.expenseCount).toBe(1);
    expect(bucket.people).toEqual([
      { id: 'a', name: 'Alice', paidMinor: 101, shareMinor: 51, netMinor: 50, balanceMinor: 30 },
      { id: 'b', name: 'Bob', paidMinor: 0, shareMinor: 50, netMinor: -50, balanceMinor: -30 },
    ]);
    expect(bucket.suggestedPayments).toEqual([{ from: 'b', to: 'a', amountMinor: 30 }]);
    expect(bucket.people.reduce((total, row) => total + row.netMinor, 0)).toBe(0);
    expect(JSON.stringify(bucket)).not.toContain('You');
  });
  it('sorts Payments by instant, independently of server time zone', () => {
    const result = buildStatement({
      ...group,
      settlements: [
        group.settlements[0],
        { ...group.settlements[0], id: 'earlier', at: '2026-09-01T23:30:00Z' },
      ],
    });
    expect(result.currencies[0].payments.map((row) => row.id)).toEqual(['earlier', 'p']);
  });
  it('keeps legacy currencies separate and gives zero contributions for an empty period', () => {
    const legacy = {
      ...group,
      expenses: [...group.expenses, { ...group.expenses[0], id: 'euro', currency: 'EUR' }],
    };
    const result = buildStatement(legacy, { from: '2026-10-01', to: '2026-10-31' });
    expect(
      result.currencies.map((row) => [row.currency, row.spentMinor, row.expenseCount]),
    ).toEqual([
      ['EUR', 0, 0],
      ['INR', 0, 0],
    ]);
    expect(result.currencies[1].people.map((row) => row.balanceMinor)).toEqual([30, -30]);
    expect(buildStatement(legacy).currencies.map((row) => row.spentMinor)).toEqual([101, 101]);
  });
  it('includes before and after Trip Expenses only for whole-trip wrap-ups', () => {
    const trip = {
      ...group,
      expenses: [
        ...group.expenses,
        { ...group.expenses[0], id: 'before', date: '2026-08-31' },
        { ...group.expenses[0], id: 'after', date: '2026-09-03' },
      ],
    };
    const window = { from: '2026-09-01', to: '2026-09-02' };
    expect(buildStatement(trip, window).currencies[0].spentMinor).toBe(101);
    expect(buildStatement(trip, { ...window, wholeTrip: true }).currencies[0].spentMinor).toBe(303);
  });
});
