import { describe, expect, it } from 'vitest';
import {
  insightCategory,
  memberShareMinor,
  memberSpendingByMonth,
  readSpendingMonths,
  spendingInMonth,
  spendingTrend,
  type InsightExpense,
  type MonthDetailExpense,
  type MonthSpending,
} from './insights';
import { MoneyValidationError } from './exact-money';
import { TimeZoneError, lastMonths } from './zoned-calendar';

// Fictional people and Groups.
const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';
const maple = 'b00000000000000000000001';
const goa = 'b00000000000000000000002';
const lisbon = 'b00000000000000000000003';
const left = 'b00000000000000000000009';
const groups = [
  { groupId: maple, name: 'Maple House' },
  { groupId: goa, name: 'Goa Friends Trip' },
  { groupId: lisbon, name: 'Lisbon Offsite' },
];
const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

/** An Expense with exact amounts: `shares` maps each person to their share in minor units. */
function expense(
  groupId: string,
  date: string,
  shares: Record<string, number>,
  currency = 'INR',
): InsightExpense {
  return {
    groupId,
    currency,
    date,
    moneyVersion: 1,
    splitBetween: Object.entries(shares).map(([user, amountMinor]) => ({
      user,
      amountMinor,
      amount: amountMinor / 100,
    })),
  };
}

function spending(expenses: InsightExpense[], timeZone = 'Asia/Kolkata', months = MONTHS) {
  return memberSpendingByMonth({ memberId: alex, timeZone, months, groups, expenses });
}

const shares = (months: MonthSpending[]) => months.map((month) => month.shareMinor);

describe("a member's share of one Expense", () => {
  it('is their own share row, in minor units', () => {
    expect(
      memberShareMinor(expense(maple, '2026-09-10', { [alex]: 33334, [sam]: 33333 }), alex),
    ).toBe(33334);
  });

  it('is zero when they are not in the split, even if they paid', () => {
    const paidForOthers = {
      ...expense(maple, '2026-09-10', { [sam]: 5000 }),
      paidBy: [{ user: alex, amountMinor: 5000, amount: 50 }],
    };
    expect(memberShareMinor(paidForOthers, alex)).toBe(0);
  });

  it('reads a populated person as their id', () => {
    const row = { user: { _id: alex, name: 'Alex' }, amountMinor: 1250, amount: 12.5 };
    expect(memberShareMinor({ currency: 'INR', moneyVersion: 1, splitBetween: [row] }, alex)).toBe(
      1250,
    );
  });

  it('reads a legacy share without minor units exactly', () => {
    const legacy = { currency: 'INR', splitBetween: [{ user: alex, amount: 333.33 }] };
    expect(memberShareMinor(legacy, alex)).toBe(33333);
    // The old calculator's binary tail, read as the amount it stood for.
    const tail = { currency: 'INR', splitBetween: [{ user: alex, amount: 0.1 + 0.2 }] };
    expect(memberShareMinor(tail, alex)).toBe(30);
  });

  it('refuses a legacy share with more decimals than its currency has', () => {
    const legacy = { currency: 'INR', splitBetween: [{ user: alex, amount: 333.3333 }] };
    expect(() => memberShareMinor(legacy, alex)).toThrow(MoneyValidationError);
  });

  it('uses the currency’s own precision', () => {
    const yen = { currency: 'JPY', splitBetween: [{ user: alex, amount: 1500 }] };
    expect(memberShareMinor(yen, alex)).toBe(1500);
  });
});

describe("the member's spending by Month", () => {
  it('covers every Month, oldest first, with zero Months kept', () => {
    const result = spending([
      expense(maple, '2026-07-12T10:00:00Z', { [alex]: 120000, [sam]: 120000 }),
    ]);
    expect(result.months).toEqual(MONTHS);
    expect(result.window).toEqual({ from: '2026-05-01', to: '2026-10-31' });
    expect(result.timeZone).toBe('Asia/Kolkata');
    expect(result.currencies).toHaveLength(1);
    expect(result.currencies[0].months.map((month) => month.month)).toEqual(MONTHS);
    expect(shares(result.currencies[0].months)).toEqual([0, 0, 120000, 0, 0, 0]);
    expect(result.currencies[0].months[0].byGroup).toEqual([]);
  });

  it('adds shares exactly, in minor units', () => {
    // Three thirds of ₹1,000.00 and a ₹0.01 share: no floating-point drift.
    const result = spending([
      expense(maple, '2026-09-02', { [alex]: 33334, [sam]: 33333, [priya]: 33333 }),
      expense(maple, '2026-09-03', { [alex]: 33333, [sam]: 33334, [priya]: 33333 }),
      expense(maple, '2026-09-04', { [alex]: 33333, [sam]: 33333, [priya]: 33334 }),
      expense(goa, '2026-09-05', { [alex]: 1, [sam]: 1 }),
      expense(goa, '2026-09-06', { [alex]: 10, [sam]: 20 }),
    ]);
    const [inr] = result.currencies;
    expect(inr.months[4]).toEqual({
      month: '2026-09',
      shareMinor: 100011,
      byGroup: [
        { groupId: maple, shareMinor: 100000 },
        { groupId: goa, shareMinor: 11 },
      ],
    });
    expect(inr.totalMinor).toBe(100011);
    expect(inr.expenseCount).toBe(5);
  });

  it("breaks each Month down by Group, largest first, and lists only that Month's Groups", () => {
    const result = spending([
      expense(maple, '2026-08-02', { [alex]: 614000, [sam]: 614000 }),
      expense(goa, '2026-08-20', { [alex]: 328000, [priya]: 100000 }),
      expense(maple, '2026-09-02', { [alex]: 500000 }),
    ]);
    const [inr] = result.currencies;
    expect(inr.months[3].byGroup).toEqual([
      { groupId: maple, shareMinor: 614000 },
      { groupId: goa, shareMinor: 328000 },
    ]);
    expect(inr.months[4].byGroup).toEqual([{ groupId: maple, shareMinor: 500000 }]);
  });

  it('keeps currencies apart, never converting or adding them', () => {
    const result = spending([
      expense(maple, '2026-09-02', { [alex]: 150000 }),
      expense(maple, '2026-09-03', { [alex]: 2000 }),
      // A legacy Group with Expenses in two currencies.
      expense(lisbon, '2026-09-04', { [alex]: 1250 }, 'EUR'),
      expense(lisbon, '2026-09-05', { [alex]: 40000 }, 'INR'),
      expense(goa, '2026-10-02', { [alex]: 500 }, 'USD'),
    ]);
    expect(result.currencies.map((currency) => currency.currency)).toEqual(['INR', 'EUR', 'USD']);
    const [inr, eur, usd] = result.currencies;
    expect(inr.months[4]).toMatchObject({
      shareMinor: 192000,
      byGroup: [
        { groupId: maple, shareMinor: 152000 },
        { groupId: lisbon, shareMinor: 40000 },
      ],
    });
    expect(eur.months[4]).toMatchObject({
      shareMinor: 1250,
      byGroup: [{ groupId: lisbon, shareMinor: 1250 }],
    });
    expect(shares(usd.months)).toEqual([0, 0, 0, 0, 0, 500]);
  });

  it('orders currencies by how many Expenses the member shares, then by code', () => {
    const result = spending([
      expense(maple, '2026-09-02', { [alex]: 100 }, 'USD'),
      expense(maple, '2026-09-03', { [alex]: 100 }, 'EUR'),
      expense(maple, '2026-09-04', { [alex]: 100 }, 'INR'),
      expense(maple, '2026-09-05', { [alex]: 100 }, 'INR'),
    ]);
    expect(result.currencies.map((currency) => currency.currency)).toEqual(['INR', 'EUR', 'USD']);
  });

  it('counts nothing outside the Months, outside the listed Groups, or not shared by the member', () => {
    const result = spending([
      expense(maple, '2026-04-30T12:00:00Z', { [alex]: 100 }),
      expense(maple, '2026-11-01T12:00:00Z', { [alex]: 100 }),
      expense(left, '2026-09-10', { [alex]: 100 }),
      expense(goa, '2026-09-10', { [sam]: 100, [priya]: 100 }),
      expense(goa, '2026-09-11', { [alex]: 0, [sam]: 100 }),
    ]);
    expect(result.currencies).toEqual([]);
  });

  it('lists every covered Group, in the order given, with spending or not', () => {
    expect(spending([]).groups).toEqual(groups);
  });

  it('buckets by Month in the viewer’s zone, never the runtime’s', () => {
    // 21:00 on 30 September in New York is already 1 October in Kolkata and Kiritimati.
    const late = expense(maple, '2026-10-01T01:00:00Z', { [alex]: 4200 });
    const months = ['2026-09', '2026-10'];
    expect(shares(spending([late], 'America/New_York', months).currencies[0].months)).toEqual([
      4200, 0,
    ]);
    expect(shares(spending([late], 'Asia/Kolkata', months).currencies[0].months)).toEqual([
      0, 4200,
    ]);
    expect(shares(spending([late], 'Pacific/Kiritimati', months).currencies[0].months)).toEqual([
      0, 4200,
    ]);
    expect(shares(spending([late], 'Pacific/Pago_Pago', months).currencies[0].months)).toEqual([
      4200, 0,
    ]);
  });

  it('buckets across a daylight-saving change at a Month edge', () => {
    const months = ['2026-10', '2026-11'];
    // New York: 23:30 on 31 October (summer time) and 01:30 on 1 November, twice.
    const result = spending(
      [
        expense(maple, '2026-11-01T03:30:00Z', { [alex]: 100 }),
        expense(maple, '2026-11-01T05:30:00Z', { [alex]: 200 }),
        expense(maple, '2026-11-01T06:30:00Z', { [alex]: 400 }),
      ],
      'America/New_York',
      months,
    );
    expect(shares(result.currencies[0].months)).toEqual([100, 600]);
  });

  it('follows the Months the read asks for, as `lastMonths` gives them', () => {
    const now = '2026-09-30T20:00:00Z';
    const result = spending(
      [expense(maple, '2026-09-30T19:00:00Z', { [alex]: 700 })],
      'Asia/Kolkata',
      lastMonths(6, { now, timeZone: 'Asia/Kolkata' }),
    );
    expect(result.months.at(-1)).toBe('2026-10');
    expect(shares(result.currencies[0].months)).toEqual([0, 0, 0, 0, 0, 700]);
  });

  it('refuses an unknown zone', () => {
    expect(() => spending([], 'Mars/Phobos')).toThrow(TimeZoneError);
  });

  it('refuses a stored share it cannot read exactly', () => {
    const broken = {
      ...expense(maple, '2026-09-02', { [alex]: 100 }),
      splitBetween: [{ user: alex, amountMinor: 100, amount: 2 }],
    };
    expect(() => spending([broken])).toThrow(MoneyValidationError);
  });
});

describe('the Month count', () => {
  it.each([
    [undefined, 6],
    [null, 6],
    ['', 6],
    ['6', 6],
    ['1', 1],
    ['12', 12],
    [3, 3],
  ])('reads %j as %i', (value, expected) => {
    expect(readSpendingMonths(value)).toBe(expected);
  });

  it.each(['0', '13', '6.5', '-1', 'six', ' 6', 0, 13, 2.5, Number.NaN, {}])(
    'refuses %j',
    (value) => {
      expect(() => readSpendingMonths(value)).toThrow('Ask for 1 to 12 months of spending.');
    },
  );
});

function month(shareMinor: number, byGroup: Record<string, number> = {}): MonthSpending {
  return {
    month: '',
    shareMinor,
    byGroup: Object.entries(byGroup).map(([groupId, share]) => ({ groupId, shareMinor: share })),
  };
}

function series(...months: MonthSpending[]) {
  return { months: months.map((entry, index) => ({ ...entry, month: MONTHS[index] })) };
}

describe("the current Month's trend", () => {
  it('names the Group that drove a rise, against each Group’s own average', () => {
    // The canvas example: Goa Friends Trip is new this Month; Maple House is about level.
    const trend = spendingTrend(
      series(
        month(611000, { [maple]: 566000, [lisbon]: 45000 }),
        month(638000, { [maple]: 588000, [lisbon]: 50000 }),
        month(678333, { [maple]: 640333, [lisbon]: 38000 }),
        month(643667, { [maple]: 601667, [lisbon]: 42000 }),
        month(619500, { [maple]: 579500, [lisbon]: 40000 }),
        month(942000, { [maple]: 614000, [goa]: 328000 }),
      ),
    );
    expect(trend).toEqual({
      kind: 'up',
      month: '2026-10',
      totalMinor: 942000,
      groupId: goa,
      groupShareMinor: 328000,
    });
  });

  it('can name a Group that is not the largest part of the Month', () => {
    const trend = spendingTrend(
      series(month(10000, { [maple]: 10000 }), month(13000, { [maple]: 10000, [goa]: 3000 })),
    );
    expect(trend).toMatchObject({ kind: 'up', groupId: goa, groupShareMinor: 3000 });
  });

  it('breaks a tie between equal rises by the larger share, then by Group id', () => {
    const tie = spendingTrend(series(month(0), month(200, { [goa]: 100, [maple]: 100 })));
    expect(tie).toMatchObject({ kind: 'up', groupId: maple });
  });

  it('leaves the Month out of its own average', () => {
    // Earlier Months: 100, 0 and 1, an average of 33.67 minor units, rounded to 34.
    const trend = spendingTrend(series(month(100), month(0), month(1), month(20, { [maple]: 20 })));
    expect(trend).toEqual({ kind: 'down', month: '2026-08', totalMinor: 20, averageMinor: 34 });
  });

  it('rounds a half-unit average up', () => {
    // Earlier Months: 3 and 0, an average of 1.5 minor units.
    const trend = spendingTrend(series(month(3), month(0), month(1, { [maple]: 1 })));
    expect(trend).toEqual({ kind: 'down', month: '2026-07', totalMinor: 1, averageMinor: 2 });
  });

  it('is level when the Month equals the average exactly', () => {
    const trend = spendingTrend(series(month(300), month(100), month(200, { [maple]: 200 })));
    expect(trend).toEqual({ kind: 'level', month: '2026-07', totalMinor: 200, averageMinor: 200 });
  });

  it('says nothing has happened yet when the Month is empty', () => {
    expect(spendingTrend(series(month(500, { [maple]: 500 }), month(0)))).toEqual({
      kind: 'none',
      month: '2026-06',
    });
  });

  it('has no trend without an earlier Month', () => {
    expect(spendingTrend(series(month(500, { [maple]: 500 })))).toBeNull();
    expect(spendingTrend({ months: [] })).toBeNull();
  });

  it('compares large totals exactly', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    const trend = spendingTrend(series(month(big), month(big, { [maple]: big })));
    expect(trend).toEqual({ kind: 'level', month: '2026-06', totalMinor: big, averageMinor: big });
  });
});

/**
 * An Expense of a Category, with exact amounts: `shares` maps each person to their share, and
 * its stored total is their sum.
 */
function categorised(
  groupId: string,
  date: string,
  category: string | undefined,
  shares: Record<string, number>,
  currency = 'INR',
): MonthDetailExpense {
  const totalMinor = Object.values(shares).reduce((sum, share) => sum + share, 0);
  return {
    ...expense(groupId, date, shares, currency),
    amount: totalMinor / 100,
    amountMinor: totalMinor,
    category,
  };
}

function october(expenses: MonthDetailExpense[], timeZone = 'Asia/Kolkata', month = '2026-10') {
  return spendingInMonth({ memberId: alex, timeZone, month, groups, expenses });
}

describe('an Expense’s Category', () => {
  it('keeps a global Category and counts anything else as Other', () => {
    expect(insightCategory('food')).toBe('food');
    expect(insightCategory('housing')).toBe('housing');
    // A Tag's name, an unknown value or none at all.
    for (const stored of ['Groceries', 'Food', '', undefined, null, 7])
      expect(insightCategory(stored)).toBe('other');
  });
});

describe('the Month in detail', () => {
  it("totals the member's share by Category across Groups, exactly, the largest first", () => {
    const result = october([
      categorised(maple, '2026-10-02', 'food', { [alex]: 33334, [sam]: 33333 }),
      categorised(goa, '2026-10-03', 'food', { [alex]: 33333, [priya]: 33334 }),
      categorised(maple, '2026-10-04', 'housing', { [alex]: 500000, [sam]: 500000 }),
      categorised(goa, '2026-10-05', 'transport', { [alex]: 1 }),
    ]);
    expect(result.month).toBe('2026-10');
    expect(result.byCategory).toEqual([
      {
        currency: 'INR',
        totalMinor: 566668,
        expenseCount: 4,
        categories: [
          { category: 'housing', shareMinor: 500000, expenseCount: 1 },
          // Food from two Groups, as one Category: ₹333.34 + ₹333.33.
          { category: 'food', shareMinor: 66667, expenseCount: 2 },
          { category: 'transport', shareMinor: 1, expenseCount: 1 },
        ],
      },
    ]);
  });

  it('never merges Tags: Categories are global, Tags with one name in two Groups are not', () => {
    // Both Groups have a Tag named "Groceries"; only the Expenses' Categories are counted.
    const tagged = (expense: MonthDetailExpense) => Object.assign(expense, { tag: 'Groceries' });
    const result = october([
      tagged(categorised(maple, '2026-10-02', 'food', { [alex]: 1000 })),
      tagged(categorised(goa, '2026-10-02', 'shopping', { [alex]: 2000 })),
    ]);
    expect(result.byCategory[0].categories.map((part) => part.category)).toEqual([
      'shopping',
      'food',
    ]);
  });

  it('counts an Expense of an unknown or missing Category as Other', () => {
    const result = october([
      categorised(maple, '2026-10-02', undefined, { [alex]: 100 }),
      categorised(maple, '2026-10-03', 'Groceries', { [alex]: 200 }),
      categorised(maple, '2026-10-04', 'other', { [alex]: 300 }),
    ]);
    expect(result.byCategory[0].categories).toEqual([
      { category: 'other', shareMinor: 600, expenseCount: 3 },
    ]);
  });

  it('breaks a tie between equal Categories by Category', () => {
    const result = october([
      categorised(maple, '2026-10-02', 'transport', { [alex]: 500 }),
      categorised(maple, '2026-10-03', 'food', { [alex]: 500 }),
    ]);
    expect(result.byCategory[0].categories.map((part) => part.category)).toEqual([
      'food',
      'transport',
    ]);
  });

  it('gives what each Group spent: every Expense, whoever shares it', () => {
    const result = october([
      categorised(maple, '2026-10-02', 'food', { [alex]: 33334, [sam]: 33333, [priya]: 33333 }),
      // Not Alex's: it counts toward Maple House's spending, never toward her Categories.
      categorised(maple, '2026-10-03', 'housing', { [sam]: 250000, [priya]: 250000 }),
      categorised(goa, '2026-10-04', 'food', { [priya]: 1 }),
    ]);
    expect(result.groups).toEqual([
      { groupId: maple, spent: [{ currency: 'INR', totalMinor: 600000, expenseCount: 2 }] },
      { groupId: goa, spent: [{ currency: 'INR', totalMinor: 1, expenseCount: 1 }] },
      { groupId: lisbon, spent: [] },
    ]);
    expect(result.byCategory).toEqual([
      {
        currency: 'INR',
        totalMinor: 33334,
        expenseCount: 1,
        categories: [{ category: 'food', shareMinor: 33334, expenseCount: 1 }],
      },
    ]);
  });

  it("counts a Group's spending from each Expense's stored total, legacy amounts exactly", () => {
    // Written before minor units: ₹0.30 stored with the old calculator's binary tail.
    const legacy: MonthDetailExpense = {
      groupId: maple,
      currency: 'INR',
      date: '2026-10-02',
      amount: 0.1 + 0.2,
      category: 'food',
      splitBetween: [
        { user: alex, amount: 0.1 },
        { user: sam, amount: 0.2 },
      ],
    };
    const result = october([legacy]);
    expect(result.groups[0].spent).toEqual([{ currency: 'INR', totalMinor: 30, expenseCount: 1 }]);
    expect(result.byCategory[0].categories).toEqual([
      { category: 'food', shareMinor: 10, expenseCount: 1 },
    ]);
  });

  it('lists every Group given, in order, even with nothing spent', () => {
    expect(october([])).toEqual({
      month: '2026-10',
      byCategory: [],
      groups: groups.map(({ groupId }) => ({ groupId, spent: [] })),
    });
  });

  it('keeps currencies apart, never converting or adding them', () => {
    const result = october([
      categorised(lisbon, '2026-10-02', 'food', { [alex]: 1250, [sam]: 1250 }, 'EUR'),
      categorised(lisbon, '2026-10-03', 'food', { [alex]: 40000 }, 'INR'),
      categorised(lisbon, '2026-10-04', 'transport', { [alex]: 2000 }, 'EUR'),
      categorised(maple, '2026-10-05', 'food', { [alex]: 999 }, 'USD'),
    ]);
    expect(result.byCategory).toEqual([
      {
        currency: 'EUR',
        totalMinor: 3250,
        expenseCount: 2,
        categories: [
          { category: 'transport', shareMinor: 2000, expenseCount: 1 },
          { category: 'food', shareMinor: 1250, expenseCount: 1 },
        ],
      },
      {
        currency: 'INR',
        totalMinor: 40000,
        expenseCount: 1,
        categories: [{ category: 'food', shareMinor: 40000, expenseCount: 1 }],
      },
      {
        currency: 'USD',
        totalMinor: 999,
        expenseCount: 1,
        categories: [{ category: 'food', shareMinor: 999, expenseCount: 1 }],
      },
    ]);
    // A legacy Group with Expenses in two currencies spent in both, each on its own.
    expect(result.groups.find((group) => group.groupId === lisbon)!.spent).toEqual([
      { currency: 'EUR', totalMinor: 4500, expenseCount: 2 },
      { currency: 'INR', totalMinor: 40000, expenseCount: 1 },
    ]);
  });

  it('counts nothing outside the Month or outside the listed Groups', () => {
    const result = october([
      categorised(maple, '2026-09-30T12:00:00Z', 'food', { [alex]: 100 }),
      categorised(maple, '2026-11-01T12:00:00Z', 'food', { [alex]: 100 }),
      categorised(left, '2026-10-10', 'food', { [alex]: 100 }),
    ]);
    expect(result.byCategory).toEqual([]);
    expect(result.groups.every((group) => group.spent.length === 0)).toBe(true);
  });

  it('puts an Expense in the Month of the viewer’s zone, never the runtime’s', () => {
    // 01:00 UTC on 1 October: 30 September in New York and Pago Pago, 1 October in Kolkata,
    // Tongatapu and Kiritimati.
    const late = [categorised(maple, '2026-10-01T01:00:00Z', 'food', { [alex]: 4200 })];
    const inOctober = (timeZone: string) => october(late, timeZone).byCategory.length === 1;
    expect(inOctober('America/New_York')).toBe(false);
    expect(inOctober('Pacific/Pago_Pago')).toBe(false);
    expect(inOctober('Asia/Kolkata')).toBe(true);
    expect(inOctober('Pacific/Tongatapu')).toBe(true);
    expect(inOctober('Pacific/Kiritimati')).toBe(true);
    // And the Group's spending follows the same Month.
    expect(october(late, 'Pacific/Pago_Pago', '2026-09').groups[0].spent).toEqual([
      { currency: 'INR', totalMinor: 4200, expenseCount: 1 },
    ]);
  });

  it('agrees with the Months’ figures for the same Month', () => {
    const expenses = [
      categorised(maple, '2026-10-02', 'food', { [alex]: 33334, [sam]: 33333 }),
      categorised(goa, '2026-10-03', 'travel', { [alex]: 120000 }),
      categorised(goa, '2026-10-04', 'travel', { [sam]: 50000 }),
      categorised(lisbon, '2026-10-05', 'food', { [alex]: 1250 }, 'EUR'),
    ];
    const months = spending(expenses);
    const detail = october(expenses);
    for (const currency of months.currencies) {
      const category = detail.byCategory.find((entry) => entry.currency === currency.currency)!;
      expect(category.totalMinor).toBe(currency.months.at(-1)!.shareMinor);
    }
  });

  it('refuses an unknown zone, a malformed Month and a share it cannot read exactly', () => {
    expect(() => october([], 'Mars/Phobos')).toThrow(TimeZoneError);
    expect(() => october([], 'Asia/Kolkata', '2026-13')).toThrow(RangeError);
    const broken = {
      ...categorised(maple, '2026-10-02', 'food', { [alex]: 100 }),
      splitBetween: [{ user: alex, amountMinor: 100, amount: 2 }],
    };
    expect(() => october([broken])).toThrow(MoneyValidationError);
  });
});
