import { describe, expect, it } from 'vitest';
import { calculateDebtsMinor } from './debts-before-simplifying';
import { calculateNetBalancesMinor, type BalanceExpense } from './debt-simplifier';
import { toMajorAmount } from './exact-money';

const person = (user: string, amountMinor: number) => ({
  user,
  amount: amountMinor / 100,
  amountMinor,
});
const expense = (paid: [string, number][], shares: [string, number][]): BalanceExpense => ({
  currency: 'INR',
  moneyVersion: 1,
  paidBy: paid.map(([id, amount]) => person(id, amount)),
  splitBetween: shares.map(([id, amount]) => person(id, amount)),
});

describe('Debts before simplifying', () => {
  it.each(['INR', 'USD', 'JPY', 'EUR'])(
    'keeps every member net equal to the ledger balance in %s',
    (currency) => {
      // Deterministic small ledgers exercise uneven weights, ties, zero shares and rounding paths.
      let seed = 608;
      const random = (limit: number) => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed % limit;
      };
      const ids = ['alex', 'sam', 'priya', 'jo', 'lee'];
      for (let run = 0; run < 200; run += 1) {
        const total = 1 + random(50000);
        const partition = () => {
          const cuts = [0, total, ...ids.slice(1).map(() => random(total + 1))].sort(
            (a, b) => a - b,
          );
          return ids.map((id, i) => [id, cuts[i + 1] - cuts[i]] as [string, number]);
        };
        const participant = ([user, amountMinor]: [string, number]) => ({
          user,
          amountMinor,
          amount: toMajorAmount(amountMinor, currency),
        });
        const entry = {
          currency,
          moneyVersion: 1,
          paidBy: partition().map(participant),
          splitBetween: partition().map(participant),
        };
        const amountMinor = random(2000);
        const settlements = [
          {
            currency,
            moneyVersion: 1,
            paidBy: 'sam',
            paidTo: 'jo',
            amount: toMajorAmount(amountMinor, currency),
            amountMinor,
          },
        ];
        const debts = calculateDebtsMinor([entry], settlements, currency);
        for (const balance of calculateNetBalancesMinor([entry], settlements, currency)) {
          const net = debts.reduce(
            (sum, debt) =>
              sum +
              (debt.to === balance.userId ? debt.amountMinor : 0) -
              (debt.from === balance.userId ? debt.amountMinor : 0),
            0,
          );
          expect(net, `${currency} ledger ${run}, ${balance.userId}`).toBe(balance.amountMinor);
        }
        expect(
          debts.every(
            (debt) =>
              debt.amountMinor > 0 &&
              Number.isSafeInteger(debt.amountMinor) &&
              debt.from !== debt.to,
          ),
        ).toBe(true);
        expect(
          calculateDebtsMinor(
            [
              {
                ...entry,
                paidBy: [...entry.paidBy].reverse(),
                splitBetween: [...entry.splitBetween].reverse(),
              },
            ],
            settlements,
            currency,
          ),
        ).toEqual(debts);
      }
    },
  );

  it('nets opposite Expenses and drops a fully paid pair', () => {
    const expenses = [
      expense([['sam', 10000]], [['you', 10000]]),
      expense([['you', 2000]], [['sam', 2000]]),
    ];
    expect(calculateDebtsMinor(expenses, [], 'INR')).toEqual([
      { from: 'you', to: 'sam', amountMinor: 8000 },
    ]);
    expect(
      calculateDebtsMinor(expenses, [{ paidBy: 'you', paidTo: 'sam', amount: 80 }], 'INR'),
    ).toEqual([]);
  });

  it('applies partial, opposite and excess Settlements to the same pair', () => {
    const expenses = [expense([['sam', 10000]], [['you', 10000]])];
    expect(calculateDebtsMinor(expenses, [{ paidBy: 'you', paidTo: 'sam', amount: 30 }])).toEqual([
      { from: 'you', to: 'sam', amountMinor: 7000 },
    ]);
    expect(calculateDebtsMinor(expenses, [{ paidBy: 'sam', paidTo: 'you', amount: 30 }])).toEqual([
      { from: 'you', to: 'sam', amountMinor: 13000 },
    ]);
    expect(calculateDebtsMinor(expenses, [{ paidBy: 'you', paidTo: 'sam', amount: 120 }])).toEqual([
      { from: 'sam', to: 'you', amountMinor: 2000 },
    ]);
  });

  it('keeps currencies separate by refusing a mixed-currency invocation', () => {
    expect(() =>
      calculateDebtsMinor(
        [{ ...expense([['sam', 100]], [['you', 100]]), currency: 'USD' }],
        [],
        'INR',
      ),
    ).toThrow(expect.objectContaining({ code: 'CURRENCY_MISMATCH' }));
    expect(() =>
      calculateDebtsMinor(
        [],
        [{ currency: 'USD', paidBy: 'sam', paidTo: 'you', amount: 1 }],
        'INR',
      ),
    ).toThrow(expect.objectContaining({ code: 'CURRENCY_MISMATCH' }));
  });
  it('divides a two-payer Expense without losing a paise from either payer or share', () => {
    const expenses = [
      expense(
        [
          ['you', 200000],
          ['sam', 100000],
        ],
        [
          ['you', 100000],
          ['sam', 100000],
          ['priya', 100000],
        ],
      ),
    ];
    expect(calculateDebtsMinor(expenses, [], 'INR')).toEqual([
      { from: 'priya', to: 'sam', amountMinor: 33333 },
      { from: 'priya', to: 'you', amountMinor: 66667 },
      { from: 'sam', to: 'you', amountMinor: 33333 },
    ]);
  });
  it('keeps the three worked-example Debts behind the two Suggested payments', () => {
    const expenses = [
      expense(
        [['sam', 106000]],
        [
          ['you', 88000],
          ['priya', 18000],
        ],
      ),
      expense([['priya', 60000]], [['you', 60000]]),
    ];
    expect(calculateDebtsMinor(expenses, [], 'INR')).toEqual([
      { from: 'priya', to: 'sam', amountMinor: 18000 },
      { from: 'you', to: 'priya', amountMinor: 60000 },
      { from: 'you', to: 'sam', amountMinor: 88000 },
    ]);
    expect(calculateNetBalancesMinor(expenses, [], 'INR')).toEqual(
      expect.arrayContaining([
        { userId: 'you', amountMinor: -148000 },
        { userId: 'sam', amountMinor: 106000 },
        { userId: 'priya', amountMinor: 42000 },
      ]),
    );
  });
});
