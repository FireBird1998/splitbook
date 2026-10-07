import { describe, expect, it } from 'vitest';
import {
  GroupLastChangesReadError,
  SpendingThisMonthReadError,
  UserSpendingReadError,
  parseUserSpendingResponse,
  readGroupLastChanges,
  readSpendingThisMonth,
} from './user-spending-read';

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

describe("the fields #308 adds: this Month in detail and each Group's last change", () => {
  const thisMonth = {
    month: '2026-10',
    byCategory: [
      {
        currency: 'INR',
        totalMinor: 52000,
        expenseCount: 3,
        categories: [
          { category: 'housing', shareMinor: 40000, expenseCount: 1 },
          { category: 'food', shareMinor: 12000, expenseCount: 2 },
        ],
      },
    ],
    groups: [
      { groupId: maple, spent: [{ currency: 'INR', totalMinor: 156000, expenseCount: 4 }] },
      { groupId: lisbon, spent: [] },
    ],
  };
  const lastChanges = [
    { groupId: maple, at: '2026-10-07T03:44:00.000Z' },
    { groupId: lisbon, at: null },
  ];
  const read = (fields: Record<string, unknown>) =>
    parseUserSpendingResponse({ ...response, data: { ...response.data, ...fields } });
  /** The read with one field of the additions set to `value`, or removed. */
  function withField(
    field: 'thisMonth' | 'lastChanges',
    path: readonly (string | number)[],
    value: unknown,
  ) {
    const body = JSON.parse(JSON.stringify({ thisMonth, lastChanges }));
    let node = body[field];
    for (const key of path.slice(0, -1)) node = node[key];
    if (value === REMOVE) delete node[path[path.length - 1]];
    else node[path[path.length - 1]] = value;
    return read(body);
  }

  it('reads them, with the fields they do not declare', () => {
    const decoded = read({ thisMonth: { ...thisMonth, note: 1 }, lastChanges });
    expect(readSpendingThisMonth(decoded)).toStrictEqual({ ...thisMonth, note: 1 });
    expect(readGroupLastChanges(decoded)).toStrictEqual(lastChanges);
  });

  it('leaves the spending chart’s fields readable whatever they hold', () => {
    const decoded = read({ thisMonth: 'unexpected', lastChanges: [{ groupId: 'maple' }] });
    expect(decoded.currencies).toEqual(response.data.currencies);
    expect(() => readSpendingThisMonth(decoded)).toThrow(SpendingThisMonthReadError);
    expect(() => readGroupLastChanges(decoded)).toThrow(GroupLastChangesReadError);
  });

  it('refuses a read without them, from a server before #308, without the payload', () => {
    const decoded = parseUserSpendingResponse(response);
    expect(() => readSpendingThisMonth(decoded)).toThrow(
      'Unable to load this month’s spending. Please retry.',
    );
    expect(() => readGroupLastChanges(decoded)).toThrow(
      'Unable to load when your Groups last changed. Please retry.',
    );
  });

  it('accepts a Month with no spending and no Groups', () => {
    const empty = { month: '2026-10', byCategory: [], groups: [] };
    const decoded = read({ thisMonth: empty, lastChanges: [] });
    expect(readSpendingThisMonth(decoded)).toEqual(empty);
    expect(readGroupLastChanges(decoded)).toEqual([]);
  });

  it.each([
    ['another Month than the read’s current one', ['month'], '2026-09'],
    ['a Month that is not a Month', ['month'], '2026-13'],
    ['a Category without a name', ['byCategory', 0, 'categories', 0, 'category'], ''],
    ['a share in major units', ['byCategory', 0, 'categories', 0, 'shareMinor'], 120.5],
    ['a negative total', ['byCategory', 0, 'totalMinor'], -1],
    ['a missing currency', ['byCategory', 0, 'currency'], REMOVE],
    ['a malformed Group id', ['groups', 0, 'groupId'], 'maple'],
    ['spending as text', ['groups', 0, 'spent', 0, 'totalMinor'], '156000'],
    ['a missing Expense count', ['groups', 0, 'spent', 0, 'expenseCount'], REMOVE],
    ['missing Groups', ['groups'], REMOVE],
  ])('refuses this Month with %s', (_label, path, value) => {
    const decoded = withField('thisMonth', path, value);
    expect(() => readSpendingThisMonth(decoded)).toThrow(SpendingThisMonthReadError);
  });

  it.each([
    ['a malformed Group id', [0, 'groupId'], 'maple'],
    ['a time that is not a time', [0, 'at'], 'today'],
    ['a missing time', [0, 'at'], REMOVE],
  ])('refuses last changes with %s', (_label, path, value) => {
    const decoded = withField('lastChanges', path, value);
    expect(() => readGroupLastChanges(decoded)).toThrow(GroupLastChangesReadError);
  });
});
