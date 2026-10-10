import { describe, expect, it } from 'vitest';
import { keepSavedPayers, type ExpenseMoneyInput } from './expense-money-edit';
import { maxExpenseAmountMinor } from './exact-money';

describe('keeping historical payer rows (#255)', () => {
  it.each(['INR', 'JPY'])('keeps saved zero payers only for unchanged %s money', (currency) => {
    const stored = {
      currency,
      amount: 3,
      splitMethod: 'equal' as const,
      paidBy: [
        { user: 'b', amount: 3 },
        { user: 'a', amount: 0 },
      ],
      splitBetween: [{ user: 'b', amount: 3 }],
    };
    const input: ExpenseMoneyInput = {
      currency,
      amount: '3',
      splitMethod: 'equal',
      paidBy: [{ user: 'b', amount: '3' }],
      splitBetween: [{ user: 'b' }],
    };
    expect(keepSavedPayers(stored, input)?.paidBy).toEqual(stored.paidBy);
    for (const change of [
      { amount: '4', paidBy: [{ user: 'b', amount: '4' }] },
      { splitBetween: [{ user: 'b' }, { user: 'c' }] },
      { paidBy: [{ user: 'c', amount: '3' }] },
      {
        paidBy: [
          { user: 'b', amount: '3' },
          { user: 'b', amount: '3' },
        ],
      },
      { paidBy: [{ user: 'b', amount: 'unreadable' }] },
      { currency: currency === 'INR' ? 'JPY' : 'INR' },
    ])
      expect(keepSavedPayers(stored, { ...input, ...change })).toBeNull();
    expect(input.paidBy).toEqual([{ user: 'b', amount: '3' }]);
  });
  it.each([
    ['INR', 1_000_000_000],
    ['JPY', 10_000_000],
  ] as const)('has an exact %s maximum', (currency, expected) =>
    expect(maxExpenseAmountMinor(currency)).toBe(expected),
  );
});
