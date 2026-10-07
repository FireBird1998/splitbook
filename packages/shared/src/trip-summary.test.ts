import { describe, expect, it } from 'vitest';
import { calculateNetBalancesMinor, simplifyDebtsMinor } from './debt-simplifier';
import {
  TRIP_SUMMARY_MAX_DAYS,
  addDays,
  dayCount,
  daysBetween,
  hasTripSummary,
  tripSummary,
  type TripExpense,
  type TripSettlement,
} from './trip-summary';
import { TimeZoneError } from './zoned-calendar';

/*
 * A Trip's summary (#316). Every instant below is written in UTC and every day is read in a
 * named zone, so the results are the same whatever zone the tests run in (CI also runs them in
 * Tongatapu, Kiritimati and Pago Pago). Dates the forms save are UTC midnight of the chosen
 * day, as here. Fictional people, Tags and figures.
 */

const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';

const TRANSPORT = { id: 'e00000000000000000000001', name: 'Transport' };
const STAY = { id: 'e00000000000000000000002', name: 'Stay' };
const DINING = { id: 'e00000000000000000000003', name: 'Dining' };
const GROCERIES = { id: 'e00000000000000000000004', name: 'Groceries' };

let sequence = 0;

/** An exact Expense: `paid` and `shares` map each person to minor units. */
function expense(
  date: string,
  description: string,
  paid: Record<string, number>,
  shares: Record<string, number>,
  tag: TripExpense['tag'] = TRANSPORT,
  { currency = 'INR', id }: { currency?: string; id?: string } = {},
): TripExpense {
  sequence += 1;
  const totalMinor = Object.values(shares).reduce((sum, share) => sum + share, 0);
  const rows = (entries: Record<string, number>) =>
    Object.entries(entries).map(([user, amountMinor]) => ({
      user,
      amount: amountMinor / 100,
      amountMinor,
    }));
  return {
    id: id ?? `d${String(sequence).padStart(23, '0')}`,
    description,
    currency,
    date,
    moneyVersion: 1,
    amount: totalMinor / 100,
    amountMinor: totalMinor,
    paidBy: rows(paid),
    splitBetween: rows(shares),
    tag,
  };
}

const each = (minor: number) => ({ [alex]: minor, [sam]: minor, [priya]: minor });

/** Four days in Goa, 17 to 20 September 2026: ₹9,840.00 in eight Expenses. */
const GOA = [
  expense(
    '2026-09-17T00:00:00Z',
    'Groceries for the villa',
    { [alex]: 108000 },
    each(36000),
    GROCERIES,
  ),
  expense(
    '2026-09-17T00:00:00Z',
    'Airport cab',
    { [sam]: 64000 },
    { [sam]: 21334, [alex]: 21333, [priya]: 21333 },
  ),
  expense(
    '2026-09-18T00:00:00Z',
    'Villa stay',
    { [sam]: 280000 },
    { [alex]: 93333, [sam]: 93334, [priya]: 93333 },
    STAY,
  ),
  expense(
    '2026-09-18T00:00:00Z',
    'Breakfast café',
    { [priya]: 38000 },
    { [alex]: 12667, [sam]: 12667, [priya]: 12666 },
    DINING,
  ),
  expense('2026-09-19T00:00:00Z', 'Scooter rental', { [alex]: 240000 }, each(80000)),
  expense(
    '2026-09-19T00:00:00Z',
    'Fuel',
    { [priya]: 26000 },
    { [alex]: 8667, [sam]: 8667, [priya]: 8666 },
  ),
  expense('2026-09-20T00:00:00Z', 'Beach shack lunch', { [priya]: 186000 }, each(62000), DINING),
  expense('2026-09-20T00:00:00Z', 'Snacks and water', { [alex]: 42000 }, each(14000), GROCERIES),
];

const goa = (overrides: Partial<Parameters<typeof tripSummary>[0]> = {}) =>
  tripSummary({
    memberId: alex,
    timeZone: 'Asia/Kolkata',
    currency: 'INR',
    startDate: '2026-09-17T00:00:00Z',
    endDate: '2026-09-20T00:00:00Z',
    expenses: GOA,
    ...overrides,
  });

const days = (summary: ReturnType<typeof tripSummary>) => summary.days.map((entry) => entry.day);
const spentByDay = (summary: ReturnType<typeof tripSummary>) =>
  summary.days.map((entry) => entry.spentMinor);

describe('which Groups have one', () => {
  it('is only a Trip', () => {
    expect(hasTripSummary('trip')).toBe(true);
    for (const category of ['home', 'couple', 'work', 'other'] as const)
      expect(hasTripSummary(category)).toBe(false);
    expect(hasTripSummary(null)).toBe(false);
  });
});

describe('the whole trip', () => {
  it('is exact: Spent, the member’s share, what they paid, and per person per day', () => {
    const summary = goa();
    expect(summary).toMatchObject({
      timeZone: 'Asia/Kolkata',
      currency: 'INR',
      tripDates: { start: '2026-09-17', end: '2026-09-20' },
      window: { from: '2026-09-17', to: '2026-09-20' },
      dayCount: 4,
      tooManyDays: false,
      spentMinor: 984000,
      expenseCount: 8,
      yourShareMinor: 328000,
      youPaidMinor: 390000,
      yourExpenseCount: 8,
      peopleCount: 3,
      // ₹9,840.00 ÷ (3 people × 4 days).
      perPersonPerDayMinor: 82000,
      // ₹9,840.00 ÷ 4 days.
      dailyAverageMinor: 246000,
      beforeTrip: null,
      afterTrip: null,
      otherCurrencies: [],
    });
  });

  it('gives each member their own share and payments of the same Expenses', () => {
    const forSam = goa({ memberId: sam });
    expect(forSam).toMatchObject({ spentMinor: 984000, yourShareMinor: 328002 });
    expect(forSam.youPaidMinor).toBe(344000);
    const outsider = goa({ memberId: 'a00000000000000000000009' });
    expect(outsider).toMatchObject({ yourShareMinor: 0, youPaidMinor: 0, yourExpenseCount: 0 });
  });

  it('rounds per person per day and the daily average half up to a minor unit', () => {
    const summary = tripSummary({
      memberId: alex,
      timeZone: 'UTC',
      currency: 'INR',
      startDate: '2026-09-17T00:00:00Z',
      endDate: '2026-09-19T00:00:00Z',
      expenses: [
        // ₹10.01 over 2 people × 3 days is 166.83… paise; over 3 days, 333.66… paise.
        expense('2026-09-17T00:00:00Z', 'Tea', { [alex]: 1001 }, { [alex]: 501, [sam]: 500 }),
      ],
    });
    expect(summary.perPersonPerDayMinor).toBe(167);
    expect(summary.dailyAverageMinor).toBe(334);
    // Exactly half a paisa rounds up.
    expect(
      tripSummary({
        memberId: alex,
        timeZone: 'UTC',
        currency: 'INR',
        startDate: '2026-09-17T00:00:00Z',
        endDate: '2026-09-18T00:00:00Z',
        expenses: [expense('2026-09-17T00:00:00Z', 'Tea', { [alex]: 1 }, { [alex]: 1 })],
      }),
    ).toMatchObject({ perPersonPerDayMinor: 1, dailyAverageMinor: 1 });
  });

  it('counts only people with a share, not everyone in an Expense', () => {
    const summary = tripSummary({
      memberId: alex,
      timeZone: 'UTC',
      currency: 'INR',
      startDate: '2026-09-17T00:00:00Z',
      endDate: '2026-09-18T00:00:00Z',
      expenses: [
        expense('2026-09-17T00:00:00Z', 'Museum', { [priya]: 4000 }, { [alex]: 4000, [sam]: 0 }),
      ],
    });
    expect(summary.peopleCount).toBe(1);
    expect(summary.perPersonPerDayMinor).toBe(2000);
  });

  it('reads a legacy Expense, written before exact amounts, exactly', () => {
    const legacy: TripExpense = {
      id: 'd00000000000000000000099',
      description: 'Ferry',
      currency: 'INR',
      date: '2026-09-17T00:00:00Z',
      amount: 1000.01,
      paidBy: [{ user: alex, amount: 1000.01 }],
      splitBetween: [
        { user: alex, amount: 500.01 },
        { user: sam, amount: 500 },
      ],
      tag: TRANSPORT,
    };
    const summary = goa({ expenses: [legacy] });
    expect(summary).toMatchObject({ spentMinor: 100001, yourShareMinor: 50001 });
  });

  it('refuses a zone that is not a named IANA zone', () => {
    expect(() => goa({ timeZone: '+05:30' })).toThrow(TimeZoneError);
    expect(() => goa({ timeZone: 'Mars/Phobos' })).toThrow(TimeZoneError);
  });
});

describe('day by day', () => {
  it('lists every day of the Trip with its Spent, count and the member’s share', () => {
    const summary = goa();
    expect(
      summary.days.map(({ day, number, spentMinor, expenseCount, yourShareMinor }) => ({
        day,
        number,
        spentMinor,
        expenseCount,
        yourShareMinor,
      })),
    ).toEqual([
      { day: '2026-09-17', number: 1, spentMinor: 172000, expenseCount: 2, yourShareMinor: 57333 },
      { day: '2026-09-18', number: 2, spentMinor: 318000, expenseCount: 2, yourShareMinor: 106000 },
      { day: '2026-09-19', number: 3, spentMinor: 266000, expenseCount: 2, yourShareMinor: 88667 },
      { day: '2026-09-20', number: 4, spentMinor: 228000, expenseCount: 2, yourShareMinor: 76000 },
    ]);
    // The days add up to the whole trip, to the paisa.
    expect(summary.days.reduce((sum, day) => sum + day.yourShareMinor, 0)).toBe(328000);
    expect(spentByDay(summary).reduce((sum, value) => sum + value, 0)).toBe(984000);
  });

  it('names each day’s two biggest Expenses, largest first', () => {
    const [first, second] = goa().days;
    expect(first.biggest).toEqual([
      { id: GOA[0].id, description: 'Groceries for the villa', amountMinor: 108000 },
      { id: GOA[1].id, description: 'Airport cab', amountMinor: 64000 },
    ]);
    expect(second.biggest.map((entry) => entry.description)).toEqual([
      'Villa stay',
      'Breakfast café',
    ]);
  });

  it('keeps two of three, breaking ties by the later instant, then the higher id', () => {
    const summary = goa({
      expenses: [
        expense('2026-09-17T03:00:00Z', 'Early', { [alex]: 5000 }, { [alex]: 5000 }, TRANSPORT, {
          id: 'd00000000000000000000001',
        }),
        expense('2026-09-17T09:00:00Z', 'Later', { [alex]: 5000 }, { [alex]: 5000 }, TRANSPORT, {
          id: 'd00000000000000000000002',
        }),
        expense(
          '2026-09-17T09:00:00Z',
          'Same time',
          { [alex]: 5000 },
          { [alex]: 5000 },
          TRANSPORT,
          {
            id: 'd00000000000000000000003',
          },
        ),
        expense('2026-09-17T10:00:00Z', 'Small', { [alex]: 100 }, { [alex]: 100 }),
      ],
    });
    expect(summary.days[0].biggest.map((entry) => entry.description)).toEqual([
      'Same time',
      'Later',
    ]);
    expect(summary.days[0]).toMatchObject({ spentMinor: 15100, expenseCount: 4 });
    expect(summary.days[1].biggest).toEqual([]);
  });

  it('counts a day with no Expenses as zero, in the days and the daily average', () => {
    const summary = goa({ expenses: [GOA[0], GOA[7]] });
    expect(spentByDay(summary)).toEqual([108000, 0, 0, 42000]);
    expect(summary.dailyAverageMinor).toBe(37500);
  });

  it('lists the Trip’s days even before it has any Expenses', () => {
    const summary = goa({ expenses: [] });
    expect(spentByDay(summary)).toEqual([0, 0, 0, 0]);
    expect(summary).toMatchObject({
      dayCount: 4,
      dailyAverageMinor: 0,
      perPersonPerDayMinor: null,
      peopleCount: 0,
      byTag: [],
      suggestedPayments: [],
    });
  });
});

describe('days in the viewer’s time zone', () => {
  // 20:00 UTC on 18 September: still the 18th in UTC, already the 19th in Kolkata.
  const lateDinner = expense(
    '2026-09-18T20:00:00Z',
    'Late dinner',
    { [alex]: 9000 },
    each(3000),
    DINING,
  );

  it('puts an Expense late at night on the day the viewer lives it', () => {
    expect(spentByDay(goa({ timeZone: 'UTC', expenses: [lateDinner] }))).toEqual([0, 9000, 0, 0]);
    expect(spentByDay(goa({ timeZone: 'Asia/Kolkata', expenses: [lateDinner] }))).toEqual([
      0, 0, 9000, 0,
    ]);
  });

  it('reads the Trip’s dates in the same zone, so a first day’s Expense is always on Day 1', () => {
    // UTC midnight is the evening before in New York: the Trip runs 16 to 19 September there.
    const newYork = goa({ timeZone: 'America/New_York', expenses: [...GOA, lateDinner] });
    expect(newYork.tripDates).toEqual({ start: '2026-09-16', end: '2026-09-19' });
    expect(days(newYork)).toEqual(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']);
    expect(spentByDay(newYork)).toEqual([172000, 318000, 275000, 228000]);
    expect(newYork).toMatchObject({ beforeTrip: null, afterTrip: null, spentMinor: 993000 });

    const kiritimati = goa({ timeZone: 'Pacific/Kiritimati' });
    expect(days(kiritimati)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
    expect(spentByDay(kiritimati)).toEqual(spentByDay(goa()));
  });

  it('keeps four days across New York’s change back from summer time', () => {
    // Noon on 30 October (EDT) to noon on 2 November (EST); the clocks go back on 1 November.
    const summary = tripSummary({
      memberId: alex,
      timeZone: 'America/New_York',
      currency: 'USD',
      startDate: '2026-10-30T16:00:00Z',
      endDate: '2026-11-02T17:00:00Z',
      expenses: [
        // 23:30 EDT on 31 October.
        expense(
          '2026-11-01T03:30:00Z',
          'Halloween party',
          { [alex]: 3000 },
          { [alex]: 3000 },
          DINING,
          {
            currency: 'USD',
          },
        ),
        // 01:30 EDT on 1 November, before the clocks go back.
        expense('2026-11-01T05:30:00Z', 'Late cab', { [alex]: 2000 }, { [alex]: 2000 }, TRANSPORT, {
          currency: 'USD',
        }),
        // 23:30 EST on 1 November.
        expense('2026-11-02T04:30:00Z', 'Diner', { [alex]: 1500 }, { [alex]: 1500 }, DINING, {
          currency: 'USD',
        }),
        // 00:30 EST on 2 November.
        expense('2026-11-02T05:30:00Z', 'Bagels', { [alex]: 700 }, { [alex]: 700 }, DINING, {
          currency: 'USD',
        }),
      ],
    });
    expect(days(summary)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(spentByDay(summary)).toEqual([0, 3000, 3500, 700]);
    expect(summary.dailyAverageMinor).toBe(1800);
  });

  it('keeps three days across Sydney’s change to summer time', () => {
    // Noon on 3 October (AEST) to noon on 5 October (AEDT); the clocks go forward on the 4th.
    const summary = tripSummary({
      memberId: alex,
      timeZone: 'Australia/Sydney',
      currency: 'AUD',
      startDate: '2026-10-03T02:00:00Z',
      endDate: '2026-10-05T01:00:00Z',
      expenses: [
        // 23:30 AEST on 3 October, then 00:30 AEST on the 4th, then 00:30 AEDT on the 5th.
        expense(
          '2026-10-03T13:30:00Z',
          'Fish and chips',
          { [alex]: 2400 },
          { [alex]: 2400 },
          DINING,
          {
            currency: 'AUD',
          },
        ),
        expense('2026-10-03T14:30:00Z', 'Night bus', { [alex]: 600 }, { [alex]: 600 }, TRANSPORT, {
          currency: 'AUD',
        }),
        expense('2026-10-04T13:30:00Z', 'Ferry', { [alex]: 900 }, { [alex]: 900 }, TRANSPORT, {
          currency: 'AUD',
        }),
      ],
    });
    expect(days(summary)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
    expect(spentByDay(summary)).toEqual([2400, 600, 900]);
  });
});

describe('Expenses dated outside the Trip’s dates', () => {
  const booking = expense('2026-08-30T00:00:00Z', 'Train tickets', { [sam]: 60000 }, each(20000));
  const deposit = expense(
    '2026-09-01T00:00:00Z',
    'Villa deposit',
    { [sam]: 30000 },
    each(10000),
    STAY,
  );
  const laundry = expense(
    '2026-09-22T00:00:00Z',
    'Laundry',
    { [priya]: 3000 },
    each(1000),
    GROCERIES,
  );

  it('count in the whole trip, are summed before and after, and are never drawn as days', () => {
    const summary = goa({ expenses: [...GOA, booking, deposit, laundry] });
    expect(summary).toMatchObject({
      spentMinor: 1077000,
      expenseCount: 11,
      yourShareMinor: 359000,
      beforeTrip: {
        spentMinor: 90000,
        expenseCount: 2,
        yourShareMinor: 30000,
        from: '2026-08-30',
        to: '2026-09-01',
      },
      afterTrip: {
        spentMinor: 3000,
        expenseCount: 1,
        yourShareMinor: 1000,
        from: '2026-09-22',
        to: '2026-09-22',
      },
    });
    expect(days(summary)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
    expect(spentByDay(summary)).toEqual(spentByDay(goa()));
    // The daily average is the Trip's own days; per person per day is the whole trip.
    expect(summary.dailyAverageMinor).toBe(246000);
    expect(summary.perPersonPerDayMinor).toBe(89750);
    expect(summary.byTag.find((tag) => tag.name === 'Transport')).toMatchObject({
      spentMinor: 390000,
      expenseCount: 4,
    });
  });
});

describe('a Trip without both dates', () => {
  const on = (day: string, description: string, minor: number) =>
    expense(`${day}T00:00:00Z`, description, { [alex]: minor }, { [alex]: minor });

  it('without dates, runs from its first Expense’s day to its last', () => {
    const summary = goa({
      startDate: null,
      endDate: null,
      expenses: [on('2026-09-19', 'Ferry', 300), on('2026-09-17', 'Bus', 100)],
    });
    expect(summary.tripDates).toEqual({ start: null, end: null });
    expect(summary.window).toEqual({ from: '2026-09-17', to: '2026-09-19' });
    expect(spentByDay(summary)).toEqual([100, 0, 300]);
  });

  it('with only a start, runs to the last Expense’s day, and earlier Expenses are before it', () => {
    const summary = goa({
      endDate: null,
      expenses: [on('2026-09-16', 'Visa fee', 500), on('2026-09-19', 'Ferry', 300)],
    });
    expect(summary.window).toEqual({ from: '2026-09-17', to: '2026-09-19' });
    expect(summary.beforeTrip).toMatchObject({ spentMinor: 500, expenseCount: 1 });
    expect(goa({ endDate: null, expenses: [] }).window).toEqual({
      from: '2026-09-17',
      to: '2026-09-17',
    });
  });

  it('with only an end, starts at the first Expense’s day, and later Expenses are after it', () => {
    const summary = goa({
      startDate: null,
      expenses: [on('2026-09-18', 'Bus', 100), on('2026-09-22', 'Laundry', 300)],
    });
    expect(summary.window).toEqual({ from: '2026-09-18', to: '2026-09-20' });
    expect(summary.afterTrip).toMatchObject({ spentMinor: 300, expenseCount: 1 });
  });

  it('without dates or Expenses, has no days and nothing to average', () => {
    expect(goa({ startDate: null, endDate: null, expenses: [] })).toMatchObject({
      window: null,
      dayCount: 0,
      days: [],
      dailyAverageMinor: null,
      perPersonPerDayMinor: null,
    });
  });

  it('reads a start saved after the end as one span', () => {
    expect(
      goa({ startDate: '2026-09-20T00:00:00Z', endDate: '2026-09-17T00:00:00Z' }).window,
    ).toEqual({ from: '2026-09-17', to: '2026-09-20' });
  });
});

describe('a very long Trip', () => {
  it('is counted, but not listed day by day', () => {
    const summary = goa({
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-06-30T00:00:00Z',
      expenses: [expense('2026-03-01T00:00:00Z', 'Rent', { [alex]: 54300 }, each(18100))],
    });
    expect(TRIP_SUMMARY_MAX_DAYS).toBe(120);
    expect(summary).toMatchObject({ dayCount: 181, tooManyDays: true, days: [] });
    expect(summary.dailyAverageMinor).toBe(300);
    expect(summary.perPersonPerDayMinor).toBe(100);
  });

  it('lists exactly the most days it may', () => {
    const summary = goa({
      startDate: '2026-01-01T00:00:00Z',
      endDate: `${addDays('2026-01-01', TRIP_SUMMARY_MAX_DAYS - 1)}T00:00:00Z`,
      timeZone: 'UTC',
    });
    expect(summary.tooManyDays).toBe(false);
    expect(summary.days).toHaveLength(TRIP_SUMMARY_MAX_DAYS);
  });
});

describe('By Tag', () => {
  it('gives each Tag its Spent, share of spend, count and the member’s share', () => {
    expect(goa().byTag).toEqual([
      {
        tagId: TRANSPORT.id,
        name: 'Transport',
        spentMinor: 330000,
        expenseCount: 3,
        yourShareMinor: 110000,
        percent: 34,
      },
      {
        tagId: STAY.id,
        name: 'Stay',
        spentMinor: 280000,
        expenseCount: 1,
        yourShareMinor: 93333,
        percent: 28,
      },
      {
        tagId: DINING.id,
        name: 'Dining',
        spentMinor: 224000,
        expenseCount: 2,
        yourShareMinor: 74667,
        percent: 23,
      },
      {
        tagId: GROCERIES.id,
        name: 'Groceries',
        spentMinor: 150000,
        expenseCount: 2,
        yourShareMinor: 50000,
        percent: 15,
      },
    ]);
  });

  it('keeps Tags apart by identity, not by name, and a legacy name on its own', () => {
    const renamed = { id: 'e00000000000000000000009', name: 'Transport' };
    const legacy = { id: null, name: 'Taxi' };
    const summary = goa({
      expenses: [
        expense('2026-09-17T00:00:00Z', 'Bus', { [alex]: 100 }, { [alex]: 100 }, TRANSPORT),
        expense('2026-09-17T00:00:00Z', 'Train', { [alex]: 100 }, { [alex]: 100 }, renamed),
        expense('2026-09-17T00:00:00Z', 'Cab', { [alex]: 200 }, { [alex]: 200 }, legacy),
      ],
    });
    expect(
      summary.byTag.map(({ tagId, name, spentMinor, percent }) => [
        tagId,
        name,
        spentMinor,
        percent,
      ]),
    ).toEqual([
      [null, 'Taxi', 200, 50],
      [TRANSPORT.id, 'Transport', 100, 25],
      [renamed.id, 'Transport', 100, 25],
    ]);
  });
});

describe('the wrap-up’s suggested payments', () => {
  it('are what the Group’s Balances suggest, Settlements included', () => {
    expect(goa().suggestedPayments).toEqual([
      { from: priya, to: alex, amountMinor: 62000 },
      { from: priya, to: sam, amountMinor: 15998 },
    ]);
    const settlement: TripSettlement = {
      currency: 'INR',
      moneyVersion: 1,
      amount: 200,
      amountMinor: 20000,
      paidBy: priya,
      paidTo: alex,
    };
    const summary = goa({ settlements: [settlement] });
    expect(summary.suggestedPayments).toEqual([
      { from: priya, to: alex, amountMinor: 42000 },
      { from: priya, to: sam, amountMinor: 15998 },
    ]);
    // The same simplifier, over the same balances, as Balances.
    const net = calculateNetBalancesMinor(
      GOA.map((entry) => ({
        currency: entry.currency,
        moneyVersion: entry.moneyVersion,
        paidBy: entry.paidBy.map((row) => ({ ...row, user: String(row.user) })),
        splitBetween: entry.splitBetween.map((row) => ({ ...row, user: String(row.user) })),
      })),
      [settlement],
      'INR',
    );
    expect(summary.suggestedPayments).toEqual(simplifyDebtsMinor(net));
  });

  it('are none once everyone has settled', () => {
    const settled = goa({
      settlements: [
        {
          currency: 'INR',
          amount: 620,
          amountMinor: 62000,
          moneyVersion: 1,
          paidBy: priya,
          paidTo: alex,
        },
        {
          currency: 'INR',
          amount: 159.98,
          amountMinor: 15998,
          moneyVersion: 1,
          paidBy: priya,
          paidTo: sam,
        },
      ],
    });
    expect(settled.suggestedPayments).toEqual([]);
  });
});

describe('a legacy Trip with Expenses in another currency', () => {
  it('counts only the Group’s currency and lists the others, never converted', () => {
    const lounge = expense(
      '2026-09-17T00:00:00Z',
      'Airport lounge passes',
      { [alex]: 2500 },
      { [alex]: 1250, [priya]: 1250 },
      TRANSPORT,
      { currency: 'EUR' },
    );
    const summary = goa({
      expenses: [...GOA, lounge],
      settlements: [
        {
          currency: 'EUR',
          amount: 12.5,
          amountMinor: 1250,
          moneyVersion: 1,
          paidBy: priya,
          paidTo: alex,
        },
      ],
    });
    expect(summary).toMatchObject({ spentMinor: 984000, expenseCount: 8, yourShareMinor: 328000 });
    expect(spentByDay(summary)).toEqual(spentByDay(goa()));
    expect(summary.otherCurrencies).toEqual([
      { currency: 'EUR', spentMinor: 2500, expenseCount: 1 },
    ]);
    expect(summary.suggestedPayments).toEqual(goa().suggestedPayments);
  });
});

describe('calendar days', () => {
  it('runs across months and years, both ends included', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(daysBetween('2028-02-28', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(dayCount('2026-09-17', '2026-09-20')).toBe(4);
    expect(dayCount('2026-09-20', '2026-09-17')).toBe(0);
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('0099-01-01', -1)).toBe('0098-12-31');
  });

  it('refuses a day that does not exist', () => {
    expect(() => dayCount('2026-02-30', '2026-03-01')).toThrow(RangeError);
    expect(() => daysBetween('2026-9-1', '2026-09-02')).toThrow(RangeError);
  });
});
