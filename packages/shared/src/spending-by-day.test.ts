import { describe, expect, it } from 'vitest';
import { memberSpendingByMonth, type InsightExpense } from './insights';
import { MoneyValidationError } from './exact-money';
import { dayShareReadAloud, dayTint, memberSpendingByDay } from './spending-by-day';

// Fictional people and Groups.
const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';
const maple = 'b00000000000000000000001';
const goa = 'b00000000000000000000002';

type Fixture = InsightExpense & { id: string; paidBy: { user: string; amountMinor: number }[] };

/** An Expense with exact amounts: `shares` maps each person to their share in minor units. */
function expense(
  id: string,
  groupId: string,
  date: string,
  shares: Record<string, number>,
  { currency = 'INR', payer = alex }: { currency?: string; payer?: string } = {},
): Fixture {
  const total = Object.values(shares).reduce((sum, share) => sum + share, 0);
  return {
    id,
    groupId,
    currency,
    date,
    moneyVersion: 1,
    paidBy: [{ user: payer, amountMinor: total }],
    splitBetween: Object.entries(shares).map(([user, amountMinor]) => ({ user, amountMinor })),
  };
}

const byDay = <E extends InsightExpense>(expenses: E[], month = '2026-11') =>
  memberSpendingByDay({ memberId: alex, month, expenses });

describe("the member's spending by day", () => {
  it("gives a Month's own share per day, the days with spending and the Expenses behind them", () => {
    const rent = expense('e1', maple, '2026-11-13', { [alex]: 124_000_000, [sam]: 496_000_000 });
    const dinner = expense('e2', goa, '2026-11-13', { [alex]: 220_000, [priya]: 220_000 });
    const taxi = expense('e3', goa, '2026-11-02', { [alex]: 64_000 });
    expect(byDay([rent, dinner, taxi])).toEqual({
      month: '2026-11',
      currencies: [
        {
          currency: 'INR',
          totalMinor: 124_284_000,
          dayCount: 2,
          days: [
            { day: '2026-11-02', shareMinor: 64_000 },
            { day: '2026-11-13', shareMinor: 124_220_000 },
          ],
          expenses: [
            { expense: taxi, day: '2026-11-02', shareMinor: 64_000 },
            { expense: rent, day: '2026-11-13', shareMinor: 124_000_000 },
            { expense: dinner, day: '2026-11-13', shareMinor: 220_000 },
          ],
        },
      ],
    });
  });

  it('leaves out an Expense the member has no share in, even one they paid for', () => {
    const fronted = expense('e1', maple, '2026-11-05', { [sam]: 90_000 }, { payer: alex });
    const zeroShare = expense('e2', maple, '2026-11-06', { [alex]: 0, [sam]: 90_000 });
    const shared = expense('e3', maple, '2026-11-07', { [alex]: 30_000, [sam]: 60_000 });
    const [inr] = byDay([fronted, zeroShare, shared]).currencies;
    expect(inr.days).toEqual([{ day: '2026-11-07', shareMinor: 30_000 }]);
    expect(inr.dayCount).toBe(1);
    expect(inr.expenses.map((entry) => entry.expense.id)).toEqual(['e3']);
    expect(byDay([fronted, zeroShare]).currencies).toEqual([]);
  });

  it('counts only the Month asked for, its first and last days included', () => {
    const result = byDay([
      expense('before', maple, '2026-10-31T00:00:00.000Z', { [alex]: 100 }),
      expense('first', maple, '2026-11-01T00:00:00.000Z', { [alex]: 200 }),
      expense('last', maple, '2026-11-30T00:00:00.000Z', { [alex]: 300 }),
      expense('after', maple, '2026-12-01T00:00:00.000Z', { [alex]: 400 }),
    ]);
    expect(result.currencies[0].days).toEqual([
      { day: '2026-11-01', shareMinor: 200 },
      { day: '2026-11-30', shareMinor: 300 },
    ]);
    expect(result.currencies[0].totalMinor).toBe(500);
  });

  it('puts an Expense on the calendar day it is dated, with no time zone shift (#437)', () => {
    // Older dates stored at another time of day keep their UTC day.
    const result = byDay([
      expense('late', maple, '2026-11-30T23:30:00.000Z', { [alex]: 100 }),
      expense('early', maple, '2026-10-31T20:00:00.000-05:00', { [alex]: 200 }),
      expense('next', maple, '2026-11-30T20:00:00.000-05:00', { [alex]: 400 }),
    ]);
    expect(result.currencies[0].days).toEqual([
      { day: '2026-11-01', shareMinor: 200 },
      { day: '2026-11-30', shareMinor: 100 },
    ]);
  });

  it("adds a day's shares exactly, in minor units", () => {
    const [inr] = byDay([
      expense('e1', maple, '2026-11-09', { [alex]: 33_334, [sam]: 33_333, [priya]: 33_333 }),
      expense('e2', maple, '2026-11-09', { [alex]: 33_333, [sam]: 33_334, [priya]: 33_333 }),
      expense('e3', goa, '2026-11-09', { [alex]: 1, [sam]: 1 }),
      expense('e4', goa, '2026-11-09', { [alex]: 10, [sam]: 20 }),
    ]).currencies;
    expect(inr.days).toEqual([{ day: '2026-11-09', shareMinor: 66_678 }]);
    expect(inr.totalMinor).toBe(66_678);
  });

  it('keeps currencies apart, the one with most Expenses first, then by code', () => {
    const result = byDay([
      expense('yen', goa, '2026-11-04', { [alex]: 4_200, [sam]: 4_200 }, { currency: 'JPY' }),
      expense('euro', goa, '2026-11-04', { [alex]: 8_600 }, { currency: 'EUR' }),
      expense('rent', maple, '2026-11-01', { [alex]: 2_350_000 }),
      expense('food', maple, '2026-11-04', { [alex]: 50 }),
    ]);
    expect(
      result.currencies.map(({ currency, totalMinor, days }) => ({ currency, totalMinor, days })),
    ).toEqual([
      {
        currency: 'INR',
        totalMinor: 2_350_050,
        days: [
          { day: '2026-11-01', shareMinor: 2_350_000 },
          { day: '2026-11-04', shareMinor: 50 },
        ],
      },
      { currency: 'EUR', totalMinor: 8_600, days: [{ day: '2026-11-04', shareMinor: 8_600 }] },
      { currency: 'JPY', totalMinor: 4_200, days: [{ day: '2026-11-04', shareMinor: 4_200 }] },
    ]);
  });

  it('reads a legacy share without minor units exactly, in its currency’s precision', () => {
    const legacy = {
      id: 'legacy',
      groupId: maple,
      currency: 'INR',
      date: '2026-11-03',
      splitBetween: [{ user: alex, amount: 1249.5 }],
    };
    const yen = {
      ...legacy,
      id: 'yen',
      currency: 'JPY',
      splitBetween: [{ user: alex, amount: 980 }],
    };
    const result = byDay([legacy, yen]);
    expect(result.currencies.map((currency) => currency.totalMinor)).toEqual([124_950, 980]);
  });

  it('refuses a stored share it cannot read exactly', () => {
    const broken = {
      groupId: maple,
      currency: 'INR',
      date: '2026-11-03',
      splitBetween: [{ user: alex, amount: 333.3333 }],
    };
    expect(() => byDay([broken])).toThrow(MoneyValidationError);
  });

  it('has no currencies in a Month without spending', () => {
    expect(byDay([], '2026-08')).toEqual({ month: '2026-08', currencies: [] });
  });

  it('refuses a malformed Month', () => {
    for (const month of ['2026-13', '2026-1', '26-11', '2026-11-01', ''])
      expect(() => byDay([], month)).toThrow(RangeError);
  });

  it('gives Month totals equal to the monthly spending figures for the same Expenses', () => {
    const expenses = [
      expense('a', maple, '2026-10-31T23:59:00.000Z', { [alex]: 12_345, [sam]: 1 }),
      expense('b', maple, '2026-11-01', { [alex]: 33_334, [sam]: 33_333, [priya]: 33_333 }),
      expense('c', goa, '2026-11-15T18:00:00.000Z', { [alex]: 700_000 }),
      expense('d', goa, '2026-11-30T23:59:59.000Z', { [alex]: 1 }),
      expense('e', goa, '2026-11-16', { [alex]: 8_600 }, { currency: 'EUR' }),
      expense('f', maple, '2026-11-17', { [sam]: 500 }),
      expense('g', goa, '2026-12-01', { [alex]: 99 }),
      expense('h', goa, '2026-10-02', { [alex]: 4_200 }, { currency: 'JPY' }),
    ];
    const months = ['2026-10', '2026-11', '2026-12'];
    const monthly = memberSpendingByMonth({
      memberId: alex,
      timeZone: 'Asia/Kolkata',
      months,
      groups: [
        { groupId: maple, name: 'Maple House' },
        { groupId: goa, name: 'Goa Friends Trip' },
      ],
      expenses,
    });
    for (const [index, month] of months.entries()) {
      const fromMonthly = monthly.currencies
        .map((currency) => [currency.currency, currency.months[index].shareMinor] as const)
        .filter(([, shareMinor]) => shareMinor > 0);
      const fromDays = byDay(expenses, month).currencies.map(
        (currency) => [currency.currency, currency.totalMinor] as const,
      );
      expect(new Map(fromDays)).toEqual(new Map(fromMonthly));
    }
    // November by hand: Alex's ₹333.34 + ₹7,000.00 + ₹0.01, and €86.00.
    expect(byDay(expenses).currencies.map((currency) => currency.totalMinor)).toEqual([
      733_335, 8_600,
    ]);
  });
});

describe("a day's tint", () => {
  it('is nothing for a day without spending', () => {
    expect(dayTint(0, 'INR')).toBe(0);
    expect(dayTint(0, 'EUR')).toBe(0);
  });

  it('steps up at ₹500, ₹1,000 and ₹2,500 for rupees', () => {
    expect(dayTint(1, 'INR')).toBe(1);
    expect(dayTint(49_999, 'INR')).toBe(1);
    expect(dayTint(50_000, 'INR')).toBe(2);
    expect(dayTint(99_999, 'INR')).toBe(2);
    expect(dayTint(100_000, 'INR')).toBe(3);
    expect(dayTint(249_999, 'INR')).toBe(3);
    expect(dayTint(250_000, 'INR')).toBe(4);
    expect(dayTint(124_000_000, 'INR')).toBe(4);
  });

  it('uses steps of similar worth for a currency in the table: ¥1,000, ¥2,000 and ¥5,000', () => {
    expect(dayTint(1, 'JPY')).toBe(1);
    expect(dayTint(999, 'JPY')).toBe(1);
    expect(dayTint(1_000, 'JPY')).toBe(2);
    expect(dayTint(1_999, 'JPY')).toBe(2);
    expect(dayTint(2_000, 'JPY')).toBe(3);
    expect(dayTint(4_999, 'JPY')).toBe(3);
    expect(dayTint(5_000, 'JPY')).toBe(4);
  });

  it('uses the default steps, 5, 10 and 25, for the rest', () => {
    expect(dayTint(499, 'EUR')).toBe(1);
    expect(dayTint(500, 'EUR')).toBe(2);
    expect(dayTint(999, 'EUR')).toBe(2);
    expect(dayTint(1_000, 'EUR')).toBe(3);
    expect(dayTint(2_499, 'EUR')).toBe(3);
    expect(dayTint(2_500, 'EUR')).toBe(4);
    expect(dayTint(2_500, 'USD')).toBe(4);
  });
});

describe('a day read aloud', () => {
  it('says the date and the full amount, never the short form', () => {
    expect(dayShareReadAloud('2026-11-13', 124_000_000, 'INR')).toBe('13 November, ₹1,240,000.00');
    expect(dayShareReadAloud('2026-11-01', 50, 'EUR')).toBe('1 November, €0.50');
  });
});
