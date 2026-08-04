import { describe, expect, it } from 'vitest';
import { calculateNetBalances, simplifyDebts } from './debt-simplifier';

describe('calculateNetBalances', () => {
  it('returns empty balances for empty inputs', () => {
    expect(calculateNetBalances([], [])).toEqual([]);
  });

  it('computes two-person equal split: B owes A 50', () => {
    const balances = calculateNetBalances(
      [
        {
          paidBy: [{ user: 'A', amount: 100 }],
          splitBetween: [
            { user: 'A', amount: 50 },
            { user: 'B', amount: 50 },
          ],
        },
      ],
      [],
    );

    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: 'A', amount: 50 },
        { userId: 'B', amount: -50 },
      ]),
    );
    expect(balances).toHaveLength(2);
  });

  it('reduces balances to zero when settlement fully pays debt', () => {
    const balances = calculateNetBalances(
      [
        {
          paidBy: [{ user: 'A', amount: 100 }],
          splitBetween: [
            { user: 'A', amount: 50 },
            { user: 'B', amount: 50 },
          ],
        },
      ],
      [{ paidBy: 'B', paidTo: 'A', amount: 50 }],
    );

    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: 'A', amount: 0 },
        { userId: 'B', amount: 0 },
      ]),
    );
    expect(balances).toHaveLength(2);
  });

  it('partial settlement shrinks the outstanding balance', () => {
    const balances = calculateNetBalances(
      [
        {
          paidBy: [{ user: 'A', amount: 100 }],
          splitBetween: [
            { user: 'A', amount: 50 },
            { user: 'B', amount: 50 },
          ],
        },
      ],
      [{ paidBy: 'B', paidTo: 'A', amount: 20 }],
    );

    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: 'A', amount: 30 },
        { userId: 'B', amount: -30 },
      ]),
    );
  });

  it('over-settlement flips who owes whom', () => {
    const balances = calculateNetBalances(
      [
        {
          paidBy: [{ user: 'A', amount: 100 }],
          splitBetween: [
            { user: 'A', amount: 50 },
            { user: 'B', amount: 50 },
          ],
        },
      ],
      [{ paidBy: 'B', paidTo: 'A', amount: 70 }],
    );

    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: 'A', amount: -20 },
        { userId: 'B', amount: 20 },
      ]),
    );
  });

  it('nets multiple payers against their splits within one expense', () => {
    const balances = calculateNetBalances(
      [
        {
          paidBy: [
            { user: 'A', amount: 60 },
            { user: 'B', amount: 40 },
          ],
          splitBetween: [
            { user: 'A', amount: 50 },
            { user: 'B', amount: 50 },
          ],
        },
      ],
      [],
    );

    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: 'A', amount: 10 },
        { userId: 'B', amount: -10 },
      ]),
    );
  });

  it('always keeps the group zero-sum across expenses and settlements', () => {
    const balances = calculateNetBalances(
      [
        {
          paidBy: [{ user: 'A', amount: 90 }],
          splitBetween: [
            { user: 'A', amount: 30 },
            { user: 'B', amount: 30 },
            { user: 'C', amount: 30 },
          ],
        },
        {
          paidBy: [{ user: 'B', amount: 45 }],
          splitBetween: [
            { user: 'A', amount: 15 },
            { user: 'B', amount: 15 },
            { user: 'C', amount: 15 },
          ],
        },
      ],
      [
        { paidBy: 'C', paidTo: 'A', amount: 25 },
        { paidBy: 'C', paidTo: 'B', amount: 10 },
      ],
    );

    const total = balances.reduce((sum, balance) => sum + balance.amount, 0);
    expect(total).toBeCloseTo(0, 10);
    expect(balances).toHaveLength(3);
  });
});

describe('simplifyDebts', () => {
  it('returns empty transactions for empty balances', () => {
    expect(simplifyDebts([])).toEqual([]);
  });

  it('produces one transaction for two-person settle', () => {
    const transactions = simplifyDebts([
      { userId: 'A', amount: 50 },
      { userId: 'B', amount: -50 },
    ]);

    expect(transactions).toEqual([{ from: 'B', to: 'A', amount: 50 }]);
  });

  it('collapses three-person nets to minimal transfers', () => {
    const transactions = simplifyDebts([
      { userId: 'A', amount: 60 },
      { userId: 'B', amount: -30 },
      { userId: 'C', amount: -30 },
    ]);

    expect(transactions).toHaveLength(2);
    expect(transactions).toEqual(
      expect.arrayContaining([
        { from: 'B', to: 'A', amount: 30 },
        { from: 'C', to: 'A', amount: 30 },
      ]),
    );

    const totalTransferred = transactions.reduce((sum, t) => sum + t.amount, 0);
    expect(totalTransferred).toBe(60);
  });

  it('ignores near-zero amounts below 0.01', () => {
    const transactions = simplifyDebts([
      { userId: 'A', amount: 0.005 },
      { userId: 'B', amount: -0.005 },
    ]);

    expect(transactions).toEqual([]);
  });

  it('integrates with calculateNetBalances for end-to-end two-person flow', () => {
    const balances = calculateNetBalances(
      [
        {
          paidBy: [{ user: 'A', amount: 100 }],
          splitBetween: [
            { user: 'A', amount: 50 },
            { user: 'B', amount: 50 },
          ],
        },
      ],
      [],
    );

    const transactions = simplifyDebts(balances);

    expect(transactions).toEqual([{ from: 'B', to: 'A', amount: 50 }]);
  });
});
