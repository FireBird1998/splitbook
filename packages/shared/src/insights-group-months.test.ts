import { describe, expect, it } from 'vitest';
import {
  COMPARE_MONTHS,
  compareMonths,
  earlierMonths,
  groupMonthInsights,
  memberPaidMinor,
  readCompareMonths,
  type GroupInsightExpense,
  type MonthValue,
} from './insights';
import { MoneyValidationError } from './exact-money';
import { TimeZoneError } from './zoned-calendar';

/*
 * A Group's Months on the Insights tab (#314): each Month's figures, and the Month against the
 * average of the Months before it, which never includes the Month itself. Every instant below
 * is written in UTC and every Month is bucketed in a named zone, so the results are the same
 * whatever zone the tests run in (CI also runs them in Tongatapu, Kiritimati and Pago Pago).
 * Fictional people and figures.
 */

const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';

const values = (...pairs: [string, number][]): MonthValue[] =>
  pairs.map(([month, valueMinor]) => ({ month, valueMinor }));

describe('the earlier Months a Month is compared with', () => {
  it('are the Months just before it, oldest first, never the Month itself', () => {
    expect(earlierMonths('2026-09', { previousMonths: 6 })).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
    expect(earlierMonths('2026-09', { previousMonths: 1 })).toEqual(['2026-08']);
  });

  it('cross the year', () => {
    expect(earlierMonths('2026-02', { previousMonths: 3 })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('start no earlier than the Group’s first Month', () => {
    expect(earlierMonths('2026-09', { previousMonths: 12, since: '2026-07' })).toEqual([
      '2026-07',
      '2026-08',
    ]);
    expect(earlierMonths('2026-09', { previousMonths: 2, since: '2025-01' })).toEqual([
      '2026-07',
      '2026-08',
    ]);
  });

  it('are none in the Group’s first Month, before it, or when none are asked for', () => {
    expect(earlierMonths('2026-09', { previousMonths: 6, since: '2026-09' })).toEqual([]);
    expect(earlierMonths('2026-09', { previousMonths: 6, since: '2026-11' })).toEqual([]);
    expect(earlierMonths('2026-09', { previousMonths: 0 })).toEqual([]);
  });
});

describe('compare months', () => {
  // April to August average ₹17,853.00; September is ₹18,420.00 (PR #242's example).
  const maple = values(
    ['2026-04', 1698000],
    ['2026-05', 1764000],
    ['2026-06', 1921000],
    ['2026-07', 1805000],
    ['2026-08', 1738500],
    ['2026-09', 1842000],
  );

  it('leaves the Month out of its own average', () => {
    const result = compareMonths(maple, { month: '2026-09', previousMonths: 5 });
    expect(result).toEqual({
      month: '2026-09',
      valueMinor: 1842000,
      earlierMonths: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
      earlierTotalMinor: 8926500,
      averageMinor: 1785300,
      differenceMinor: 56700,
      direction: 'up',
      changePercent: 3.2,
    });
  });

  it('is not pulled up by a very big Month', () => {
    const big = [...maple.slice(0, 5), { month: '2026-09', valueMinor: 99999999 }];
    expect(compareMonths(big, { month: '2026-09', previousMonths: 5 }).averageMinor).toBe(1785300);
  });

  it('counts a Month with no Expenses as zero, and ignores Months not compared', () => {
    const result = compareMonths(values(['2026-06', 900], ['2026-08', 300], ['2026-10', 5000]), {
      month: '2026-09',
      previousMonths: 3,
    });
    expect(result).toMatchObject({
      valueMinor: 0,
      earlierMonths: ['2026-06', '2026-07', '2026-08'],
      earlierTotalMinor: 1200,
      averageMinor: 400,
      differenceMinor: -400,
      direction: 'down',
      changePercent: -100,
    });
  });

  it('averages only the earlier Months there are when the Group is younger than asked', () => {
    const result = compareMonths(values(['2026-07', 1000], ['2026-08', 3000], ['2026-09', 2500]), {
      month: '2026-09',
      previousMonths: 6,
      since: '2026-07',
    });
    expect(result).toMatchObject({
      earlierMonths: ['2026-07', '2026-08'],
      averageMinor: 2000,
      differenceMinor: 500,
      direction: 'up',
      changePercent: 25,
    });
  });

  it('has no average with no earlier Month', () => {
    const empty = {
      averageMinor: null,
      differenceMinor: null,
      direction: null,
      changePercent: null,
      earlierMonths: [],
      earlierTotalMinor: 0,
    };
    // The Group's first Month.
    expect(
      compareMonths(values(['2026-09', 500]), {
        month: '2026-09',
        previousMonths: 6,
        since: '2026-09',
      }),
    ).toEqual({ month: '2026-09', valueMinor: 500, ...empty });
    // No earlier Months asked for.
    expect(
      compareMonths(values(['2026-08', 900], ['2026-09', 500]), {
        month: '2026-09',
        previousMonths: 0,
      }),
    ).toMatchObject(empty);
  });

  it('rounds a half-unit average up, and compares the Month with the average as shown', () => {
    // 100 and 101 over two Months: 100.5, shown as 101. September's 101 is level with it.
    expect(
      compareMonths(values(['2026-07', 100], ['2026-08', 101], ['2026-09', 101]), {
        month: '2026-09',
        previousMonths: 2,
      }),
    ).toMatchObject({
      averageMinor: 101,
      differenceMinor: 0,
      direction: 'level',
      changePercent: 0,
    });
  });

  it('gives the change to one decimal place, rounding half away from zero', () => {
    const change = (value: number, average: number) =>
      compareMonths(values(['2026-08', average], ['2026-09', value]), {
        month: '2026-09',
        previousMonths: 1,
      }).changePercent;
    expect(change(1700, 1600)).toBe(6.3); // 6.25%
    expect(change(1500, 1600)).toBe(-6.3); // −6.25%
    expect(change(400, 300)).toBe(33.3);
    expect(change(200, 300)).toBe(-33.3);
    expect(change(300, 300)).toBe(0);
  });

  it('has no percentage against an average of zero, but still says the Month is up', () => {
    expect(
      compareMonths(values(['2026-09', 4200]), { month: '2026-09', previousMonths: 6 }),
    ).toMatchObject({
      averageMinor: 0,
      differenceMinor: 4200,
      direction: 'up',
      changePercent: null,
    });
  });

  it('adds large values exactly', () => {
    const big = Math.floor(Number.MAX_SAFE_INTEGER / 4);
    expect(
      compareMonths(values(['2026-07', big], ['2026-08', big + 2], ['2026-09', big + 1]), {
        month: '2026-09',
        previousMonths: 2,
      }),
    ).toMatchObject({ averageMinor: big + 1, direction: 'level' });
  });
});

describe('the earlier-Month count a client asks for', () => {
  it('defaults to six when unset', () => {
    for (const unset of [undefined, null, '']) expect(readCompareMonths(unset)).toBe(6);
    expect(COMPARE_MONTHS.default).toBe(6);
  });

  it.each(['1', '6', '12', 1, 12])('accepts %s', (value) => {
    expect(readCompareMonths(value)).toBe(Number(value));
  });

  it.each(['0', '13', 'six', '2.5', '-1', '06x', 0, 13, 2.5])('refuses %s', (value) => {
    expect(() => readCompareMonths(value)).toThrow(RangeError);
    expect(() => readCompareMonths(value)).toThrow('Compare with 1 to 12 earlier months.');
  });
});

/** An exact Expense: `shares` maps each person to their share; `paid` to what they paid. */
function expense(
  id: string,
  date: string,
  shares: Record<string, number>,
  {
    paid,
    currency = 'INR',
    recurring = false,
    description = 'Synthetic expense',
  }: {
    paid?: Record<string, number>;
    currency?: string;
    recurring?: boolean;
    description?: string;
  } = {},
): GroupInsightExpense {
  const totalMinor = Object.values(shares).reduce((sum, share) => sum + share, 0);
  const payers = paid ?? { [Object.keys(shares)[0]]: totalMinor };
  const row = ([user, amountMinor]: [string, number]) => ({
    user,
    amountMinor,
    amount: amountMinor / 100,
  });
  return {
    id,
    description,
    currency,
    date,
    moneyVersion: 1,
    amountMinor: totalMinor,
    amount: totalMinor / 100,
    paidBy: Object.entries(payers).map(row),
    splitBetween: Object.entries(shares).map(row),
    recurring,
  };
}

const id = (n: number) => `c${String(n).padStart(23, '0')}`;

function insights(
  expenses: GroupInsightExpense[],
  options: Partial<Parameters<typeof groupMonthInsights>[0]> = {},
) {
  return groupMonthInsights({
    memberId: alex,
    timeZone: 'Asia/Kolkata',
    month: '2026-09',
    compare: 6,
    currency: 'INR',
    expenses,
    recurringExpenses: true,
    ...options,
  });
}

describe("a Group's Months", () => {
  it('gives each Month the Group’s Spent, its count, the member’s share and what they paid', () => {
    const result = insights([
      // A third of ₹1,000.00 each: the shares only add up exactly in minor units.
      expense(id(1), '2026-09-02T06:00:00Z', { [alex]: 33334, [sam]: 33333, [priya]: 33333 }),
      expense(id(2), '2026-09-03T06:00:00Z', { [sam]: 50000, [priya]: 50000 }),
      expense(
        id(3),
        '2026-09-04T06:00:00Z',
        { [alex]: 1, [sam]: 2 },
        { paid: { [sam]: 1, [alex]: 2 } },
      ),
      expense(id(4), '2026-08-20T06:00:00Z', { [alex]: 40000, [sam]: 40000 }),
    ]);

    expect(result.months.map((month) => month.month)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(result.months.at(-1)).toEqual({
      month: '2026-09',
      spentMinor: 200003,
      expenseCount: 3,
      yourShareMinor: 33335,
      youPaidMinor: 100002,
      recurringCount: 0,
    });
    expect(result.months[5]).toMatchObject({
      month: '2026-08',
      spentMinor: 80000,
      yourShareMinor: 40000,
      youPaidMinor: 80000,
    });
    expect(result.months[0]).toEqual({
      month: '2026-03',
      spentMinor: 0,
      expenseCount: 0,
      yourShareMinor: 0,
      youPaidMinor: 0,
      recurringCount: 0,
    });
    expect(result.window).toEqual({ from: '2026-03-01', to: '2026-09-30' });
    expect(result).toMatchObject({
      timeZone: 'Asia/Kolkata',
      month: '2026-09',
      compare: 6,
      currency: 'INR',
    });
  });

  it('averages the Months before the Month, never the Month itself', () => {
    const result = insights(
      [
        expense(id(1), '2026-07-10T06:00:00Z', { [alex]: 1000, [sam]: 1000 }),
        expense(id(2), '2026-08-10T06:00:00Z', { [alex]: 2000, [sam]: 2000 }),
        // A very big September.
        expense(id(3), '2026-09-10T06:00:00Z', { [alex]: 500000, [sam]: 500000 }),
      ],
      { compare: 2 },
    );
    expect(result.months.map((month) => month.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(result.average).toEqual({
      monthCount: 2,
      spentMinor: 3000,
      yourShareMinor: 1500,
      youPaidMinor: 3000,
    });
    expect(result.change).toEqual({
      direction: 'up',
      differenceMinor: 997000,
      changePercent: 33233.3,
    });
  });

  it('compares with fewer Months when the Group started more recently', () => {
    const result = insights(
      [
        expense(id(1), '2026-08-10T06:00:00Z', { [alex]: 3000 }),
        expense(id(2), '2026-09-10T06:00:00Z', { [alex]: 1500 }),
      ],
      { compare: 12, firstMonth: '2026-08' },
    );
    expect(result.months.map((month) => month.month)).toEqual(['2026-08', '2026-09']);
    expect(result.firstMonth).toBe('2026-08');
    expect(result.average).toMatchObject({ monthCount: 1, spentMinor: 3000 });
    expect(result.change).toEqual({
      direction: 'down',
      differenceMinor: -1500,
      changePercent: -50,
    });
    expect(result.window).toEqual({ from: '2026-08-01', to: '2026-09-30' });
  });

  it('has no average in the Group’s first Month, or a Month before it', () => {
    for (const firstMonth of ['2026-09', '2026-12']) {
      const result = insights([expense(id(1), '2026-09-10T06:00:00Z', { [alex]: 1500 })], {
        firstMonth,
      });
      expect(result.months.map((month) => month.month)).toEqual(['2026-09']);
      expect(result.average).toBeNull();
      expect(result.change).toBeNull();
      expect(result.months[0].spentMinor).toBe(1500);
    }
  });

  it('buckets Months in the viewer’s zone, never the runtime’s', () => {
    // 20:00 UTC on 31 August: 1 September in Kolkata and Kiritimati, 31 August in New York.
    const late = [expense(id(1), '2026-08-31T20:00:00Z', { [alex]: 4200 })];
    const spentIn = (timeZone: string) =>
      insights(late, { timeZone, compare: 1 }).months.map((month) => month.spentMinor);
    expect(spentIn('Asia/Kolkata')).toEqual([0, 4200]);
    expect(spentIn('Pacific/Kiritimati')).toEqual([0, 4200]);
    expect(spentIn('America/New_York')).toEqual([4200, 0]);
    expect(spentIn('Pacific/Pago_Pago')).toEqual([4200, 0]);
  });

  it('keeps a Month’s edges exact across daylight saving (New York)', () => {
    // March ends in summer time (−04): 03:59 UTC on 1 April is still 31 March.
    const edges = [
      expense(id(1), '2026-04-01T03:59:00Z', { [alex]: 100 }),
      expense(id(2), '2026-04-01T04:00:00Z', { [alex]: 200 }),
    ];
    const result = insights(edges, { timeZone: 'America/New_York', month: '2026-04', compare: 1 });
    expect(result.months.map((month) => [month.month, month.spentMinor])).toEqual([
      ['2026-03', 100],
      ['2026-04', 200],
    ]);
  });

  it('counts what recurring Expenses added only while they are switched on', () => {
    const expenses = [
      expense(id(1), '2026-09-02T06:00:00Z', { [alex]: 100000 }, { recurring: true }),
      expense(id(2), '2026-09-05T06:00:00Z', { [alex]: 2000 }, { recurring: true }),
      expense(id(3), '2026-09-09T06:00:00Z', { [alex]: 3000 }),
      expense(id(4), '2026-08-02T06:00:00Z', { [alex]: 100000 }, { recurring: true }),
    ];
    const on = insights(expenses, { compare: 1 });
    expect(on.recurringExpenses).toBe(true);
    expect(on.months.map((month) => month.recurringCount)).toEqual([1, 2]);

    const off = insights(expenses, { compare: 1, recurringExpenses: false });
    expect(off.recurringExpenses).toBe(false);
    for (const month of off.months) expect(month).not.toHaveProperty('recurringCount');
    // The Expenses themselves still count: they are in the ledger.
    expect(off.months.map((month) => month.expenseCount)).toEqual([1, 3]);
  });

  it('names the Month’s biggest Expense, the latest of equal ones, with its payers', () => {
    const result = insights([
      expense(id(1), '2026-09-02T06:00:00Z', { [alex]: 150000, [sam]: 150000 }),
      expense(
        id(2),
        '2026-09-20T06:00:00Z',
        { [alex]: 100000, [sam]: 100000, [priya]: 100000 },
        { paid: { [sam]: 100000, [priya]: 200000 }, description: 'Cook (September)' },
      ),
      expense(id(3), '2026-09-25T06:00:00Z', { [alex]: 100 }),
      // Bigger, but in August.
      expense(id(4), '2026-08-02T06:00:00Z', { [alex]: 900000 }),
    ]);
    expect(result.biggestExpense).toEqual({
      id: id(2),
      description: 'Cook (September)',
      amountMinor: 300000,
      date: '2026-09-20T06:00:00.000Z',
      paidBy: [priya, sam],
    });
  });

  it('has no biggest Expense in a Month without Expenses', () => {
    const result = insights([expense(id(1), '2026-08-02T06:00:00Z', { [alex]: 900 })]);
    expect(result.biggestExpense).toBeNull();
    expect(result.months.at(-1)).toMatchObject({ spentMinor: 0, expenseCount: 0 });
  });

  it('lists Expenses in another currency, never converting or counting them', () => {
    const result = insights(
      [
        expense(id(1), '2026-09-02T06:00:00Z', { [alex]: 150000, [sam]: 150000 }),
        // A legacy Group's euro Expenses, the biggest by number but not in its currency.
        expense(id(2), '2026-09-03T06:00:00Z', { [alex]: 999999 }, { currency: 'EUR' }),
        expense(id(3), '2026-08-03T06:00:00Z', { [alex]: 1275, [sam]: 1275 }, { currency: 'EUR' }),
        expense(id(4), '2026-09-04T06:00:00Z', { [alex]: 500 }, { currency: 'USD' }),
        // Outside the Months compared.
        expense(id(5), '2026-01-03T06:00:00Z', { [alex]: 700 }, { currency: 'GBP' }),
      ],
      { compare: 1 },
    );
    expect(result.months.map((month) => month.spentMinor)).toEqual([0, 300000]);
    expect(result.months.map((month) => month.expenseCount)).toEqual([0, 1]);
    expect(result.biggestExpense?.id).toBe(id(1));
    expect(result.otherCurrencies).toEqual([
      { currency: 'EUR', spentMinor: 1002549, expenseCount: 2 },
      { currency: 'USD', spentMinor: 500, expenseCount: 1 },
    ]);
  });

  it('reads legacy amounts exactly, and refuses one more precise than its currency', () => {
    const legacy: GroupInsightExpense = {
      id: id(1),
      description: 'Written before minor units',
      currency: 'INR',
      date: '2026-09-02T06:00:00Z',
      amount: 1000,
      paidBy: [{ user: alex, amount: 1000 }],
      splitBetween: [
        { user: alex, amount: 333.34 },
        { user: sam, amount: 666.66 },
      ],
      recurring: false,
    };
    expect(insights([legacy], { compare: 1 }).months.at(-1)).toMatchObject({
      spentMinor: 100000,
      yourShareMinor: 33334,
      youPaidMinor: 100000,
    });
    const tooPrecise = { ...legacy, amount: 1000.001 };
    expect(() => insights([tooPrecise])).toThrow(MoneyValidationError);
  });

  it('counts nothing outside the Months compared', () => {
    const result = insights(
      [
        expense(id(1), '2026-07-31T12:00:00Z', { [alex]: 100 }),
        expense(id(2), '2026-10-01T12:00:00Z', { [alex]: 100 }),
      ],
      { compare: 1 },
    );
    expect(result.months.map((month) => month.spentMinor)).toEqual([0, 0]);
    expect(result.otherCurrencies).toEqual([]);
  });

  it('crosses the year', () => {
    const result = insights(
      [
        expense(id(1), '2025-12-15T06:00:00Z', { [alex]: 600 }),
        expense(id(2), '2026-01-15T06:00:00Z', { [alex]: 900 }),
      ],
      { month: '2026-01', compare: 2 },
    );
    expect(result.months.map((month) => [month.month, month.spentMinor])).toEqual([
      ['2025-11', 0],
      ['2025-12', 600],
      ['2026-01', 900],
    ]);
    expect(result.average).toMatchObject({ monthCount: 2, spentMinor: 300 });
  });

  it('refuses a zone that is not a named IANA zone', () => {
    expect(() => insights([], { timeZone: '+05:30' })).toThrow(TimeZoneError);
    expect(() => insights([], { timeZone: 'Mars/Phobos' })).toThrow(TimeZoneError);
  });
});

describe('what a member paid towards an Expense', () => {
  it('is their own payer rows, and zero when they paid nothing', () => {
    const shared = expense(
      id(1),
      '2026-09-02T06:00:00Z',
      { [alex]: 500, [sam]: 500 },
      { paid: { [alex]: 300, [sam]: 700 } },
    );
    expect(memberPaidMinor(shared, alex)).toBe(300);
    expect(memberPaidMinor(shared, priya)).toBe(0);
  });

  it('reads a populated payer as their id', () => {
    const populated = {
      currency: 'INR',
      moneyVersion: 1,
      paidBy: [{ user: { _id: alex, name: 'Alex' }, amountMinor: 1250, amount: 12.5 }],
    };
    expect(memberPaidMinor(populated, alex)).toBe(1250);
  });
});
