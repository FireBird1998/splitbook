import { describe, expect, it } from 'vitest';
import { SpendingByDayReadError, parseSpendingByDayResponse } from './spending-by-day-read';

// Fictional people, Groups and figures, shaped like the Spending by day read's answer (#1273).
const alex = 'a00000000000000000000001';
const maple = 'b00000000000000000000001';
const lisbon = 'b00000000000000000000003';
const response = {
  status: 200,
  data: {
    month: '2026-11',
    timeZone: 'Asia/Kolkata',
    currencies: [
      {
        currency: 'INR',
        totalMinor: 124_064_000,
        dayCount: 2,
        days: [
          { day: '2026-11-02', shareMinor: 64_000 },
          { day: '2026-11-13', shareMinor: 124_000_000 },
        ],
        expenses: [
          {
            _id: 'c00000000000000000000001',
            group: { _id: maple, name: 'Maple House' },
            description: 'Taxi',
            tag: 'Transport',
            paidBy: [{ _id: alex, name: 'Alex Rao' }],
            day: '2026-11-02',
            shareMinor: 64_000,
            amountMinor: 64_000,
          },
          {
            _id: 'c00000000000000000000002',
            group: { _id: maple, name: 'Maple House' },
            description: 'Flat deposit',
            tag: 'Rent',
            paidBy: [{ _id: alex }],
            day: '2026-11-13',
            shareMinor: 124_000_000,
            amountMinor: 620_000_000,
          },
        ],
      },
      {
        currency: 'EUR',
        totalMinor: 8_600,
        dayCount: 1,
        days: [{ day: '2026-11-04', shareMinor: 8_600 }],
        expenses: [
          {
            _id: 'c00000000000000000000003',
            group: { _id: lisbon, name: 'Lisbon Offsite' },
            description: 'Dinner',
            tag: 'Food',
            paidBy: [],
            day: '2026-11-04',
            shareMinor: 8_600,
            amountMinor: 34_400,
          },
        ],
      },
    ],
  },
};
const message = 'Unable to load your spending by day. Please retry.';

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
const inr = ['data', 'currencies', 0];
const taxi = [...inr, 'expenses', 0];

describe('the Spending by day read contract', () => {
  it('returns the wire shape, with the fields it does not declare', () => {
    expect(parseSpendingByDayResponse(changed(['extra'], 1))).toStrictEqual(response.data);
    const body = changed([...taxi, 'category'], 'transport');
    expect(parseSpendingByDayResponse(body)).toStrictEqual(body.data);
  });

  it('accepts a Month without spending', () => {
    const body = changed(['data', 'currencies'], []);
    expect(parseSpendingByDayResponse(body).currencies).toEqual([]);
  });

  it('accepts a payer whose account no longer exists, named by id alone', () => {
    expect(parseSpendingByDayResponse(response).currencies[0].expenses[1].paidBy).toEqual([
      { _id: alex },
    ]);
  });

  it.each([
    ['a wrong status', ['status'], 401],
    ['missing data', ['data'], REMOVE],
    ['a Month that is not a Month', ['data', 'month'], '2026-13'],
    ['a missing time zone', ['data', 'timeZone'], REMOVE],
    ['missing currencies', ['data', 'currencies'], REMOVE],
    ['a total in major units', [...inr, 'totalMinor'], 1240.64],
    ['a missing day count', [...inr, 'dayCount'], REMOVE],
    ['a day that is not a day', [...inr, 'days', 0, 'day'], '2026-11-31x'],
    ['a day in another Month', [...inr, 'days', 0, 'day'], '2026-10-31'],
    ['a negative day share', [...inr, 'days', 0, 'shareMinor'], -1],
    ['an unsafe share', [...taxi, 'shareMinor'], Number.MAX_SAFE_INTEGER + 1],
    ['a share as text', [...taxi, 'shareMinor'], '64000'],
    ['an Expense on a day in another Month', [...taxi, 'day'], '2026-12-01'],
    ['an Expense without its id', [...taxi, '_id'], REMOVE],
    ['a malformed Group id', [...taxi, 'group', '_id'], 'maple'],
    ['a Group without a name', [...taxi, 'group', 'name'], REMOVE],
    ['an Expense without a description', [...taxi, 'description'], REMOVE],
    ['an Expense without a Tag', [...taxi, 'tag'], REMOVE],
    ['a payer without an id', [...taxi, 'paidBy', 0, '_id'], REMOVE],
    ['a missing Expense total', [...taxi, 'amountMinor'], REMOVE],
  ])('rejects %s, without the payload in its message', (_label, path, value) => {
    let thrown: unknown;
    try {
      parseSpendingByDayResponse(changed(path, value));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SpendingByDayReadError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).cause).toBeUndefined();
  });
});
