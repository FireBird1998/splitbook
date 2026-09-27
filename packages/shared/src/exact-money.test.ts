import { describe, expect, it } from 'vitest';
import { CURRENCIES, formatCurrency, getCurrencyPrecision } from './currency';
import {
  MoneyValidationError,
  calculateSplitAmountsMinor,
  normalizeExpenseMoney,
  parseAmountMinor,
  readLegacyAmountMinor,
  readStoredAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
} from './exact-money';
import { calculateNetBalances, simplifyDebts, simplifyDebtsMinor } from './debt-simplifier';
import { computeMemberBreakdown, computeUserOweGetBack } from './expense-summary';
import { createSettlementSchema } from './validators/settlement';

const expense = {
  amount: 100,
  currency: 'INR',
  paidBy: [{ user: 'a', amount: 100 }],
  splitMethod: 'equal' as const,
  splitBetween: [{ user: 'a' }, { user: 'b' }, { user: 'c' }],
};

describe('currency-aware decimal boundaries', () => {
  it('states the precision of every supported currency', () => {
    for (const currency of CURRENCIES) {
      const digits = getCurrencyPrecision(currency.code);
      expect(digits).toBe(['JPY', 'KRW'].includes(currency.code) ? 0 : 2);
      expect(parseAmountMinor('100', currency.code)).toBe(100 * 10 ** digits);
    }
    expect(() => getCurrencyPrecision('UNKNOWN')).toThrow('INVALID_CURRENCY');
    expect(formatCurrency(100, 'JPY')).toBe('¥100');
    expect(formatCurrency(100, 'KRW')).toBe('₩100');
  });

  it.each([
    ['0.29', 29],
    ['.29', 29],
    ['1.', 100],
    ['01.10', 110],
    ['-0.10', -10],
    ['1e-2', 1],
    ['1.23e3', 123000],
    ['12.3400', 1234],
    [0.29, 29],
    [-0, 0],
  ])('parses %s exactly', (value, minor) => {
    expect(parseAmountMinor(value, 'INR')).toBe(minor);
    expect(parseAmountMinor(toMajorAmount(minor, 'INR'), 'INR')).toBe(minor);
  });

  it.each(['', ' ', '1x', '0x10', '1,000', 'NaN', Infinity, NaN, '1e1001', '9007199254740992'])(
    'rejects malformed or unsafe %s',
    (value) => {
      expect(() => parseAmountMinor(value, 'INR')).toThrow(MoneyValidationError);
    },
  );

  it('rejects rather than rounds unsupported precision on new input', () => {
    expect(() => parseAmountMinor('0.001', 'INR')).toThrow('decimal places');
    expect(() => parseAmountMinor(0.1 + 0.2, 'INR')).toThrow('decimal places');
    expect(() => parseAmountMinor('100.5', 'JPY')).toThrow('0 decimal places');
    expect(() => parseAmountMinor('0.005', 'KRW')).toThrow('0 decimal places');
    expect(() => sumMinorAmounts([Number.MAX_SAFE_INTEGER, 1])).toThrow('exact range');
    expect(() => toMajorAmount(Number.MAX_SAFE_INTEGER, 'INR')).toThrow();
  });

  it('permits only binary tails in legacy values, never real sub-minor units', () => {
    expect(readLegacyAmountMinor(0.1 + 0.2, 'INR')).toBe(30);
    expect(readLegacyAmountMinor(33.33 + 0.01, 'INR')).toBe(3334);
    expect(() => readLegacyAmountMinor(33.333, 'INR')).toThrow('decimal places');
    expect(() => readLegacyAmountMinor(1e-17, 'INR')).toThrow('decimal places');
    expect(() => readLegacyAmountMinor(0.5, 'JPY')).toThrow('decimal places');
  });

  it('reads complete canonical data and rejects drift or partial representations', () => {
    expect(readStoredAmountMinor({ currency: 'INR', amount: 0.29 })).toBe(29);
    expect(
      readStoredAmountMinor({ currency: 'INR', amount: 0.29, amountMinor: 29, moneyVersion: 1 }),
    ).toBe(29);
    expect(readStoredAmountMinor({ currency: 'JPY', amountMinor: 29, moneyVersion: 1 })).toBe(29);
    expect(() =>
      readStoredAmountMinor({ currency: 'INR', amount: 0.3, amountMinor: 29, moneyVersion: 1 }),
    ).toThrow('disagree');
    expect(() =>
      readStoredAmountMinor({ currency: 'INR', amount: 0.29, moneyVersion: 1 }),
    ).toThrow();
    expect(() => readStoredAmountMinor({ currency: 'INR', amount: 0.29, amountMinor: 29 })).toThrow(
      'version',
    );
    expect(() => readStoredAmountMinor({ currency: 'INR', amount: 0.29, moneyVersion: 2 })).toThrow(
      'version',
    );
  });
});

describe('balanced expense normalization', () => {
  it('returns matching canonical and compatible amounts for every participant', () => {
    const normalized = normalizeExpenseMoney(expense);
    expect(normalized).toMatchObject({ moneyVersion: 1, amount: 100, amountMinor: 10000 });
    expect(normalized.paidBy).toEqual([{ user: 'a', amount: 100, amountMinor: 10000 }]);
    expect(normalized.splitBetween.map((row) => row.amountMinor)).toEqual([3334, 3333, 3333]);
    expect(normalized.splitBetween.map((row) => row.amount)).toEqual([33.34, 33.33, 33.33]);
    expect(expense.splitBetween).toEqual([{ user: 'a' }, { user: 'b' }, { user: 'c' }]);
  });

  it('rejects the reproduced underpayment and an invalid merged amount edit', () => {
    expect(() => normalizeExpenseMoney({ ...expense, paidBy: [{ user: 'a', amount: 1 }] })).toThrow(
      'Payer amounts',
    );
    expect(() => normalizeExpenseMoney({ ...expense, amount: 330 })).toThrow('Payer amounts');
    expect(
      normalizeExpenseMoney({
        ...expense,
        amount: 330,
        paidBy: [{ user: 'a', amount: 330 }],
      }).splitBetween.map((row) => row.amount),
    ).toEqual([110, 110, 110]);
  });

  it('validates zero-decimal currencies and retains zero allocations', () => {
    const result = normalizeExpenseMoney({
      ...expense,
      currency: 'JPY',
      amount: 1,
      paidBy: [{ user: 'a', amount: 1 }],
    });
    expect(result.splitBetween.map((row) => row.amount)).toEqual([1, 0, 0]);
    expect(() => normalizeExpenseMoney({ ...expense, currency: 'JPY', amount: 100.5 })).toThrow(
      '0 decimal places',
    );
  });

  it('rejects duplicate payers and participants, missing allocations and negative values', () => {
    expect(() =>
      normalizeExpenseMoney({
        ...expense,
        paidBy: [
          { user: 'a', amount: 50 },
          { user: 'a', amount: 50 },
        ],
      }),
    ).toThrow('only once');
    expect(() =>
      normalizeExpenseMoney({ ...expense, splitBetween: [{ user: 'a' }, { user: 'a' }] }),
    ).toThrow('only once');
    expect(() => normalizeExpenseMoney({ ...expense, splitMethod: 'exact' })).toThrow();
    expect(() =>
      normalizeExpenseMoney({
        ...expense,
        splitMethod: 'unequal',
        splitBetween: [{ user: 'a', amount: 99.99 }],
      }),
    ).toThrow('Split amounts');
    expect(() =>
      normalizeExpenseMoney({
        ...expense,
        paidBy: [
          { user: 'a', amount: -1 },
          { user: 'b', amount: 101 },
        ],
      }),
    ).toThrow('negative');
    expect(() => normalizeExpenseMoney({ ...expense, paidBy: [] })).toThrow('At least one');
    expect(() => normalizeExpenseMoney({ ...expense, amount: 0 })).toThrow('positive');
    expect(() => normalizeExpenseMoney({ ...expense, amount: 10_000_001 })).toThrow('at most');
  });

  it('requires valid percentage totals and positive integral shares', () => {
    expect(() =>
      normalizeExpenseMoney({
        ...expense,
        splitMethod: 'percentage',
        splitBetween: [{ user: 'a', percentage: 99.99 }],
      }),
    ).toThrow('100');
    expect(() =>
      normalizeExpenseMoney({
        ...expense,
        splitMethod: 'percentage',
        splitBetween: [{ user: 'a', percentage: 100.001 }],
      }),
    ).toThrow();
    expect(() =>
      normalizeExpenseMoney({
        ...expense,
        splitMethod: 'shares',
        splitBetween: [{ user: 'a', shares: 0 }],
      }),
    ).toThrow('positive');
    expect(() =>
      normalizeExpenseMoney({
        ...expense,
        splitMethod: 'shares',
        splitBetween: [{ user: 'a', shares: 1.5 }],
      }),
    ).toThrow();
  });
});

describe('deterministic exact allocation', () => {
  it('allocates by largest remainder and person ID independently of input ordering', () => {
    const people = [
      { user: 'c', shares: 1 },
      { user: 'a', shares: 1 },
      { user: 'b', shares: 1 },
    ];
    const result = calculateSplitAmountsMinor('shares', 10000, people);
    expect(result.map((person) => [person.user, person.amountMinor])).toEqual([
      ['c', 3333],
      ['a', 3334],
      ['b', 3333],
    ]);
    const reversed = calculateSplitAmountsMinor('shares', 10000, [...people].reverse());
    expect(Object.fromEntries(reversed.map((person) => [person.user, person.amountMinor]))).toEqual(
      Object.fromEntries(result.map((person) => [person.user, person.amountMinor])),
    );
  });

  it('preserves tiny and very large weighted amounts with overflow-safe intermediates', () => {
    const weights = [
      { user: 'a', shares: 1 },
      { user: 'b', shares: 2 },
      { user: 'c', shares: 4 },
    ];
    expect(
      calculateSplitAmountsMinor('shares', 1, weights).map((person) => person.amountMinor),
    ).toEqual([0, 0, 1]);
    const huge = calculateSplitAmountsMinor('shares', Number.MAX_SAFE_INTEGER, weights);
    expect(sumMinorAmounts(huge.map((person) => person.amountMinor))).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      calculateSplitAmountsMinor('percentage', 1, [
        { user: 'a', percentage: 33.33 },
        { user: 'b', percentage: 33.33 },
        { user: 'c', percentage: 33.34 },
      ]).map((person) => person.amountMinor),
    ).toEqual([0, 0, 1]);
  });

  it('conserves every unit across reproducible varied weights, sizes and participant counts', () => {
    let state = 918273;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    for (let run = 0; run < 500; run += 1) {
      const amount = next() % 1_000_000_001;
      const count = 1 + (next() % 25);
      const people = Array.from({ length: count }, (_, index) => ({
        user: String(index).padStart(2, '0'),
        shares: next() % 100_000,
      }));
      people[0].shares += 1;
      for (const method of ['equal', 'shares'] as const) {
        const allocations = calculateSplitAmountsMinor(method, amount, people);
        expect(sumMinorAmounts(allocations.map((person) => person.amountMinor))).toBe(amount);
        expect(
          allocations.every(
            (person) => Number.isSafeInteger(person.amountMinor) && person.amountMinor >= 0,
          ),
        ).toBe(true);
      }
    }
  });
});

describe('exact downstream ledgers', () => {
  it('settles a one-unit debt completely with canonical records', () => {
    const normalized = normalizeExpenseMoney({
      ...expense,
      currency: 'JPY',
      amount: 1,
      paidBy: [{ user: 'a', amount: 1 }],
      splitBetween: [{ user: 'b' }],
    });
    const balances = calculateNetBalances([normalized], [], 'JPY');
    expect(simplifyDebts(balances, 'JPY')).toEqual([{ from: 'b', to: 'a', amount: 1 }]);
    expect(
      calculateNetBalances(
        [normalized],
        [{ paidBy: 'b', paidTo: 'a', currency: 'JPY', moneyVersion: 1, amount: 1, amountMinor: 1 }],
        'JPY',
      ),
    ).toEqual([
      { userId: 'a', amount: 0 },
      { userId: 'b', amount: 0 },
    ]);
  });

  it('keeps mixed currencies and inconsistent canonical data out of arithmetic', () => {
    const normalized = normalizeExpenseMoney(expense);
    expect(() => calculateNetBalances([normalized], [], 'USD')).toThrow('currencies');
    expect(() => computeMemberBreakdown([normalized], ['a'], 'USD')).toThrow('currencies');
    expect(() =>
      calculateNetBalances(
        [{ ...normalized, paidBy: [{ user: 'a', amount: 99, amountMinor: 10000 }] }],
        [],
        'INR',
      ),
    ).toThrow('disagree');
    expect(() => simplifyDebtsMinor([{ userId: 'a', amountMinor: 1 }])).toThrow('do not balance');
  });

  it('accumulates canonical and compatible summaries with no cent drift', () => {
    const records = [0.1, 0.2].map((amount) =>
      normalizeExpenseMoney({
        ...expense,
        amount,
        paidBy: [{ user: 'a', amount }],
        splitBetween: [{ user: 'b' }],
      }),
    );
    expect(computeMemberBreakdown(records, ['a', 'b'], 'INR')).toEqual([
      { userId: 'a', paid: 0.3, share: 0, net: -0.3 },
      { userId: 'b', paid: 0, share: 0.3, net: 0.3 },
    ]);
    expect(computeUserOweGetBack(records, 'b', 'INR')).toEqual({ userOwes: 0.3, userGetsBack: 0 });
  });

  it('rejects invalid Settlement precision and bounds at the shared request boundary', () => {
    expect(
      createSettlementSchema.safeParse({ paidTo: 'a', amount: 1, currency: 'JPY' }).success,
    ).toBe(true);
    expect(
      createSettlementSchema.safeParse({ paidTo: 'a', amount: 0.01, currency: 'JPY' }).success,
    ).toBe(false);
    expect(
      createSettlementSchema.safeParse({ paidTo: 'a', amount: 0.001, currency: 'INR' }).success,
    ).toBe(false);
    expect(
      createSettlementSchema.safeParse({ paidTo: 'a', amount: 10_000_001, currency: 'INR' })
        .success,
    ).toBe(false);
  });
});
