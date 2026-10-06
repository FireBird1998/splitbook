import { describe, expect, it } from 'vitest';
import { UserSpendingReadError, parseUserSpendingResponse } from './user-spending-read';

// Fictional Groups and figures, shaped like the spending read's answer.
const maple = 'b00000000000000000000001';
const lisbon = 'b00000000000000000000003';
const response = {
  status: 200,
  data: {
    timeZone: 'Asia/Kolkata',
    months: ['2026-09', '2026-10'],
    window: { from: '2026-09-01', to: '2026-10-31' },
    groups: [
      { groupId: maple, name: 'Maple House' },
      { groupId: lisbon, name: 'Lisbon Offsite' },
    ],
    currencies: [
      {
        currency: 'INR',
        totalMinor: 192000,
        expenseCount: 3,
        months: [
          {
            month: '2026-09',
            shareMinor: 192000,
            byGroup: [
              { groupId: maple, shareMinor: 152000 },
              { groupId: lisbon, shareMinor: 40000 },
            ],
          },
          { month: '2026-10', shareMinor: 0, byGroup: [] },
        ],
      },
      {
        currency: 'EUR',
        totalMinor: 1250,
        expenseCount: 1,
        months: [
          { month: '2026-09', shareMinor: 1250, byGroup: [{ groupId: lisbon, shareMinor: 1250 }] },
          { month: '2026-10', shareMinor: 0, byGroup: [] },
        ],
      },
    ],
  },
};
const message = 'Unable to load your spending. Please retry.';

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
const september = [...inr, 'months', 0];

describe('the spending read contract', () => {
  it('returns the wire shape, with the fields it does not declare', () => {
    expect(parseUserSpendingResponse(changed(['extra'], 1))).toStrictEqual(response.data);
    const body = changed([...september, 'paidMinor'], 5000);
    expect(parseUserSpendingResponse(body)).toStrictEqual(body.data);
  });

  it('accepts a member with no spending yet', () => {
    const body = changed(['data', 'currencies'], []);
    expect(parseUserSpendingResponse(body).currencies).toEqual([]);
  });

  it('accepts a historical currency', () => {
    const body = changed([...inr, 'currency'], 'DEM');
    expect(parseUserSpendingResponse(body).currencies[0].currency).toBe('DEM');
  });

  it.each([
    ['a wrong status', ['status'], 401],
    ['missing data', ['data'], REMOVE],
    ['no Months', ['data', 'months'], []],
    ['a Month that is not a Month', ['data', 'months', 0], '2026-13'],
    ['a window day that is not a day', ['data', 'window', 'to'], '2026-10-32'],
    ['a missing time zone', ['data', 'timeZone'], REMOVE],
    ['a malformed Group id', ['data', 'groups', 0, 'groupId'], 'maple'],
    ['a Group without a name', ['data', 'groups', 0, 'name'], REMOVE],
    ['a total in major units', [...inr, 'totalMinor'], 1920.5],
    ['a negative share', [...september, 'shareMinor'], -1],
    ['a share as text', [...september, 'shareMinor'], '192000'],
    ['an unsafe share', [...september, 'shareMinor'], Number.MAX_SAFE_INTEGER + 1],
    ['a Group part without its Group', [...september, 'byGroup', 0, 'groupId'], REMOVE],
    ['a missing Expense count', [...inr, 'expenseCount'], REMOVE],
    ['missing currencies', ['data', 'currencies'], REMOVE],
  ])('rejects %s, without the payload in its message', (_label, path, value) => {
    let thrown: unknown;
    try {
      parseUserSpendingResponse(changed(path, value));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UserSpendingReadError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).cause).toBeUndefined();
  });

  it.each([null, [], {}, 'Maple House'])('rejects the response %j', (value) => {
    expect(() => parseUserSpendingResponse(value)).toThrow(message);
  });
});
