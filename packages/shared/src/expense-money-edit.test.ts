import { describe, expect, it } from 'vitest';
import { decideExpenseMoneyEdit } from './expense-money-edit';

describe('Expense money edits', () => {
  it('preserves historical allocations when people are reordered or populated', () => {
    const stored = {
      currency: 'USD',
      amount: 0.03,
      splitMethod: 'equal' as const,
      paidBy: [
        { user: { _id: 'b' }, amount: 0.02 },
        { user: 'a', amount: 0.01 },
      ],
      splitBetween: [
        { user: 'b', amount: 0.02 },
        { user: { _id: 'a' }, amount: 0.01 },
      ],
    };
    const result = decideExpenseMoneyEdit(stored, {
      paidBy: [
        { user: 'a', amount: '0.010' },
        { user: 'b', amount: '0.02' },
      ],
      splitBetween: [
        { user: 'a', amount: 0.02 },
        { user: 'b', amount: 0.01 },
      ],
    });
    expect(result.financialEdit).toBe(false);
    expect(result.money.splitBetween).toEqual([
      { user: 'b', amount: 0.02, amountMinor: 2 },
      { user: 'a', amount: 0.01, amountMinor: 1 },
    ]);
  });
});

const historical = {
  amount: 0.03,
  currency: 'USD',
  splitMethod: 'equal' as const,
  paidBy: [{ user: 'a', amount: 0.03 }],
  splitBetween: [
    { user: 'a', amount: 0.01 },
    { user: 'b', amount: 0.02 },
  ],
};

it.each(['equal', 'percentage', 'shares', 'exact', 'unequal'] as const)(
  '%s preserves history but recalculates deliberate complete financial changes',
  (splitMethod) => {
    const splitBetween = historical.splitBetween.map((row) => ({
      ...row,
      percentage: 50,
      shares: 1,
    }));
    const stored = { ...historical, splitMethod, splitBetween };
    expect(
      decideExpenseMoneyEdit(stored, {}).money.splitBetween.map((row) => row.amountMinor),
    ).toEqual([1, 2]);
    const result = decideExpenseMoneyEdit(stored, {
      amount: 0.05,
      paidBy: [{ user: 'a', amount: 0.05 }],
      ...(['exact', 'unequal'].includes(splitMethod)
        ? {
            splitBetween: [
              { user: 'a', amount: 0.03 },
              { user: 'b', amount: 0.02 },
            ],
          }
        : {}),
    });
    expect(result.financialEdit).toBe(true);
    expect(result.money.splitBetween.map((row) => row.amountMinor)).toEqual([3, 2]);
  },
);

it('merges partial edits and rejects unbalanced payers, duplicate people and invalid precision', () => {
  expect(() => decideExpenseMoneyEdit(historical, { amount: 1 })).toThrow(/Payer amounts/);
  expect(() =>
    decideExpenseMoneyEdit(historical, { splitBetween: [{ user: 'a' }, { user: 'a' }] }),
  ).toThrow(/once/);
  expect(() => decideExpenseMoneyEdit(historical, { amount: '0.031' })).toThrow(/decimal places/);
});

it('distinguishes payer, participant, percentage and shares changes from derived amounts', () => {
  expect(
    decideExpenseMoneyEdit(historical, { paidBy: [{ user: 'b', amount: 0.03 }] }).financialEdit,
  ).toBe(true);
  expect(
    decideExpenseMoneyEdit(historical, { splitBetween: [{ user: 'a' }] }).money.splitBetween[0]
      .amountMinor,
  ).toBe(3);
  for (const splitMethod of ['percentage', 'shares'] as const) {
    const stored = {
      ...historical,
      splitMethod,
      splitBetween: historical.splitBetween.map((row) => ({ ...row, percentage: 50, shares: 1 })),
    };
    const result = decideExpenseMoneyEdit(stored, {
      splitBetween: [
        { user: 'a', percentage: 100, shares: 1 },
        { user: 'b', percentage: 0, shares: 0 },
      ],
    });
    expect(result.financialEdit).toBe(true);
    expect(result.money.splitBetween.map((row) => row.amountMinor)).toEqual([3, 0]);
  }
});

it('reads compatible floating tails but refuses contradictory or partial canonical money', () => {
  const stored = {
    ...historical,
    amount: 0.1 + 0.2,
    paidBy: [{ user: 'a', amount: 0.1 + 0.2 }],
    splitBetween: [{ user: 'a', amount: 0.3 }],
  };
  expect(decideExpenseMoneyEdit(stored, {}).money.amountMinor).toBe(30);
  expect(() => decideExpenseMoneyEdit({ ...stored, moneyVersion: 1, amountMinor: 31 }, {})).toThrow(
    /disagree/,
  );
  expect(() => decideExpenseMoneyEdit({ ...stored, amountMinor: 30 }, {})).toThrow(/version/);
});

it.each([
  ['JPY', 3, 1, 2],
  ['USD', 0.03, 0.01, 0.02],
] as const)('retains historical %s precision', (currency, amount, first, second) => {
  const result = decideExpenseMoneyEdit(
    {
      ...historical,
      currency,
      amount,
      paidBy: [{ user: 'a', amount }],
      splitBetween: [
        { user: 'a', amount: first },
        { user: 'b', amount: second },
      ],
    },
    {},
  );
  expect(result.money.splitBetween.map((row) => row.amountMinor)).toEqual([1, 2]);
});
