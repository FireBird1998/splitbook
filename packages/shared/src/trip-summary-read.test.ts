import { describe, expect, it } from 'vitest';
import { parseTripSummaryResponse, TripSummaryReadError } from './trip-summary-read';

/* The Trip summary read's decoder (#316). Fictional people, Tags and figures. */

const alex = 'a00000000000000000000001';
const priya = 'a00000000000000000000003';

const day = (key: string, number: number, spentMinor: number) => ({
  day: key,
  number,
  spentMinor,
  expenseCount: spentMinor > 0 ? 1 : 0,
  yourShareMinor: Math.floor(spentMinor / 3),
  biggest:
    spentMinor > 0
      ? [{ id: 'd00000000000000000000001', description: 'Villa stay', amountMinor: spentMinor }]
      : [],
});

const DATA = {
  timeZone: 'Asia/Kolkata',
  currency: 'INR',
  tripDates: { start: '2026-09-17', end: '2026-09-19' },
  window: { from: '2026-09-17', to: '2026-09-19' },
  dayCount: 3,
  tooManyDays: false,
  spentMinor: 300000,
  expenseCount: 2,
  yourShareMinor: 100000,
  youPaidMinor: 0,
  yourExpenseCount: 2,
  peopleCount: 3,
  perPersonPerDayMinor: 33333,
  days: [day('2026-09-17', 1, 280000), day('2026-09-18', 2, 0), day('2026-09-19', 3, 20000)],
  dailyAverageMinor: 100000,
  beforeTrip: null,
  afterTrip: {
    spentMinor: 900,
    expenseCount: 1,
    yourShareMinor: 300,
    from: '2026-09-21',
    to: '2026-09-21',
  },
  byTag: [
    {
      tagId: 'e00000000000000000000002',
      name: 'Stay',
      spentMinor: 280000,
      expenseCount: 1,
      yourShareMinor: 93333,
      percent: 93,
    },
    {
      tagId: null,
      name: 'Taxi',
      spentMinor: 20000,
      expenseCount: 1,
      yourShareMinor: 6667,
      percent: 7,
    },
  ],
  suggestedPayments: [
    {
      from: { id: alex, name: 'Alex Rivera' },
      to: { id: priya, name: 'Priya Shah' },
      amountMinor: 100000,
    },
  ],
  otherCurrencies: [],
  hasExpenses: true,
};

const response = (data: unknown) => ({ status: 200, data });

describe('the Trip summary read', () => {
  it('reads a Trip summary as the route sends it', () => {
    const read = parseTripSummaryResponse(response(DATA));
    expect(read.days.map((entry) => entry.day)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19']);
    expect(read.byTag[1].tagId).toBeNull();
    expect(read.suggestedPayments[0].from.name).toBe('Alex Rivera');
  });

  it('reads one with too many days to list, and one with no days at all', () => {
    expect(
      parseTripSummaryResponse(response({ ...DATA, dayCount: 181, tooManyDays: true, days: [] }))
        .tooManyDays,
    ).toBe(true);
    expect(
      parseTripSummaryResponse(
        response({
          ...DATA,
          tripDates: { start: null, end: null },
          window: null,
          dayCount: 0,
          days: [],
          dailyAverageMinor: null,
          perPersonPerDayMinor: null,
          hasExpenses: false,
        }),
      ).window,
    ).toBeNull();
  });

  it.each([
    ['a refusal', { status: 403, error: 'Forbidden' }],
    ['a fractional amount', response({ ...DATA, spentMinor: 300000.5 })],
    ['a negative share', response({ ...DATA, yourShareMinor: -1 })],
    ['a missing day', response({ ...DATA, days: DATA.days.slice(1) })],
    ['days out of order', response({ ...DATA, days: [DATA.days[1], DATA.days[0], DATA.days[2]] })],
    [
      'days numbered wrongly',
      response({ ...DATA, days: DATA.days.map((entry) => ({ ...entry, number: 7 })) }),
    ],
    ['days listed when there are too many', response({ ...DATA, tooManyDays: true })],
    [
      'three biggest Expenses on a day',
      response({
        ...DATA,
        days: [
          {
            ...DATA.days[0],
            biggest: [...DATA.days[0].biggest, ...DATA.days[0].biggest, ...DATA.days[0].biggest],
          },
          DATA.days[1],
          DATA.days[2],
        ],
      }),
    ],
    ['a malformed day', response({ ...DATA, window: { from: '17 Sep', to: '2026-09-19' } })],
    ['a Tag id that is not one', response({ ...DATA, byTag: [{ ...DATA.byTag[0], tagId: 'x' }] })],
    ['a percentage over 100', response({ ...DATA, byTag: [{ ...DATA.byTag[0], percent: 101 }] })],
    [
      'a payment without names',
      response({
        ...DATA,
        suggestedPayments: [{ from: alex, to: priya, amountMinor: 100000 }],
      }),
    ],
  ])('refuses %s, with a message safe to show', (_label, value) => {
    expect(() => parseTripSummaryResponse(value)).toThrow(TripSummaryReadError);
    expect(() => parseTripSummaryResponse(value)).toThrow(
      'Unable to load this Trip summary. Please retry.',
    );
  });
});
