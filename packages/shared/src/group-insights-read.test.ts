import { describe, expect, it } from 'vitest';
import { GroupInsightsReadError, parseGroupInsightsResponse } from './group-insights-read';

// A fictional Household's September against the two Months before it, as the read answers.
const priya = 'a00000000000000000000003';
const cook = 'c00000000000000000000001';
const response = {
  status: 200,
  data: {
    timeZone: 'Asia/Kolkata',
    month: '2026-09',
    compare: 2,
    firstMonth: '2026-03',
    currency: 'INR',
    window: { from: '2026-07-01', to: '2026-09-30' },
    months: [
      {
        month: '2026-07',
        spentMinor: 1805000,
        expenseCount: 12,
        yourShareMinor: 601667,
        youPaidMinor: 450000,
        recurringCount: 2,
      },
      {
        month: '2026-08',
        spentMinor: 1738500,
        expenseCount: 13,
        yourShareMinor: 579500,
        youPaidMinor: 610000,
        recurringCount: 2,
      },
      {
        month: '2026-09',
        spentMinor: 1842000,
        expenseCount: 14,
        yourShareMinor: 614000,
        youPaidMinor: 521000,
        recurringCount: 3,
      },
    ],
    average: { monthCount: 2, spentMinor: 1771750, yourShareMinor: 590584, youPaidMinor: 530000 },
    change: { direction: 'up', differenceMinor: 70250, changePercent: 4 },
    biggestExpense: {
      id: cook,
      description: 'Cook (September)',
      amountMinor: 300000,
      date: '2026-09-05T00:00:00.000Z',
      paidBy: [{ id: priya, name: 'Priya Shah' }],
    },
    otherCurrencies: [],
    recurringExpenses: true,
    hasExpenses: true,
  },
};
const message = 'Unable to load these insights. Please retry.';

const REMOVE = Symbol('remove');
/** A copy of the response with the field at `path` set to `value`, or removed. */
function changed(path: readonly (string | number)[], value: unknown) {
  const body: unknown = JSON.parse(JSON.stringify(response));
  let node = body as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  if (value === REMOVE) delete node[path[path.length - 1]];
  else node[path[path.length - 1]] = value;
  return body as typeof response;
}
const september = ['data', 'months', 2];

describe('the Group insights read contract', () => {
  it('returns the wire shape, with the fields it does not declare', () => {
    expect(parseGroupInsightsResponse(changed(['extra'], 1))).toStrictEqual(response.data);
    const body = changed([...september, 'settledMinor'], 5000);
    expect(parseGroupInsightsResponse(body)).toStrictEqual(body.data);
  });

  it('accepts a Month with nothing to compare, no Expenses and recurring Expenses off', () => {
    const body = changed(['data'], {
      ...response.data,
      compare: 6,
      firstMonth: '2026-09',
      window: { from: '2026-09-01', to: '2026-09-30' },
      months: [
        {
          month: '2026-09',
          spentMinor: 0,
          expenseCount: 0,
          yourShareMinor: 0,
          youPaidMinor: 0,
        },
      ],
      average: null,
      change: null,
      biggestExpense: null,
      recurringExpenses: false,
      hasExpenses: false,
    });
    const read = parseGroupInsightsResponse(body);
    expect(read.average).toBeNull();
    expect(read.months[0]).not.toHaveProperty('recurringCount');
  });

  it('accepts a Month below its average, with no percentage against a zero average', () => {
    expect(
      parseGroupInsightsResponse(
        changed(['data', 'change'], {
          direction: 'down',
          differenceMinor: -400,
          changePercent: null,
        }),
      ).change,
    ).toEqual({ direction: 'down', differenceMinor: -400, changePercent: null });
  });

  it('accepts a legacy Group’s Expenses in other currencies', () => {
    const others = [{ currency: 'EUR', spentMinor: 2550, expenseCount: 1 }];
    expect(
      parseGroupInsightsResponse(changed(['data', 'otherCurrencies'], others)).otherCurrencies,
    ).toEqual(others);
  });

  it.each([
    ['a wrong status', ['status'], 401],
    ['missing data', ['data'], REMOVE],
    ['a Month that is not a Month', ['data', 'month'], '2026-13'],
    ['no Months', ['data', 'months'], []],
    ['Months that do not end with the Month', ['data', 'month'], '2026-08'],
    ['a count of earlier Months over a year', ['data', 'compare'], 13],
    ['a window day that is not a day', ['data', 'window', 'to'], '2026-09-31x'],
    ['a missing time zone', ['data', 'timeZone'], REMOVE],
    ['Spent in major units', [...september, 'spentMinor'], 18420.5],
    ['a negative share', [...september, 'yourShareMinor'], -1],
    ['an amount as text', [...september, 'youPaidMinor'], '521000'],
    ['an unsafe amount', [...september, 'spentMinor'], Number.MAX_SAFE_INTEGER + 1],
    ['a recurring count as text', [...september, 'recurringCount'], '3'],
    ['an average over no Months', ['data', 'average', 'monthCount'], 0],
    ['an unknown direction', ['data', 'change', 'direction'], 'sideways'],
    ['a difference in major units', ['data', 'change', 'differenceMinor'], 702.5],
    ['a malformed Expense id', ['data', 'biggestExpense', 'id'], 'cook'],
    ['a payer without a name', ['data', 'biggestExpense', 'paidBy', 0, 'name'], REMOVE],
    ['a date that is not a time', ['data', 'biggestExpense', 'date'], 'September'],
    ['no recurring switch', ['data', 'recurringExpenses'], REMOVE],
    ['no Expenses flag', ['data', 'hasExpenses'], REMOVE],
    ['missing other currencies', ['data', 'otherCurrencies'], REMOVE],
  ])('rejects %s, without the payload in its message', (_label, path, value) => {
    let thrown: unknown;
    try {
      parseGroupInsightsResponse(changed(path, value));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GroupInsightsReadError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).cause).toBeUndefined();
  });

  it.each([null, [], {}, 'Maple House'])('rejects the response %j', (value) => {
    expect(() => parseGroupInsightsResponse(value)).toThrow(message);
  });
});
