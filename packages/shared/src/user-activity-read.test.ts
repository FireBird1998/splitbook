import { describe, expect, it } from 'vitest';
import {
  USER_ACTIVITY_DEFAULT_LIMIT,
  USER_ACTIVITY_MAX_LIMIT,
  UserActivityReadError,
  parseUserActivityResponse,
} from './user-activity-read';

// Fictional people, Groups and events, shaped like the latest changes the server sends.
const maple = { _id: 'b00000000000000000000001', name: 'Maple House' };
const goa = { _id: 'b00000000000000000000002', name: 'Goa Friends Trip' };
const expenseId = 'c00000000000000000000001';
const iso = '2026-10-06T14:10:00.000Z';
const response = {
  status: 200,
  data: {
    activities: [
      {
        _id: 'e00000000000000000000001',
        type: 'expense_updated',
        createdAt: iso,
        group: maple,
        actor: { _id: 'a00000000000000000000003', name: 'Priya Shah' },
        currency: 'INR',
        metadata: {
          expenseId,
          description: 'Wi-Fi',
          changes: {
            amount: { old: 899, new: 999 },
            amountMinor: { old: 89900, new: 99900 },
          },
        },
      },
      {
        _id: 'e00000000000000000000002',
        type: 'settlement_recorded',
        createdAt: iso,
        group: goa,
        actor: null,
        currency: 'INR',
        metadata: {
          settlementId: 'f00000000000000000000001',
          amount: 620,
          currency: 'INR',
          paidByName: 'Sam Chen',
          paidToName: 'Alex Rivera',
        },
      },
      {
        _id: 'e00000000000000000000003',
        type: 'member_joined',
        createdAt: iso,
        group: goa,
        actor: { _id: 'a00000000000000000000002', name: 'Sam Chen' },
        metadata: { method: 'invite' },
      },
    ],
    limit: 10,
  },
};
const message = 'Unable to load the latest changes. Please retry.';

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
const event = ['data', 'activities', 0];

describe('latest changes read contract', () => {
  it('caps a read at 50 events and asks for 10 by default', () => {
    expect(USER_ACTIVITY_DEFAULT_LIMIT).toBe(10);
    expect(USER_ACTIVITY_MAX_LIMIT).toBe(50);
  });

  it('returns the wire shape: times as ISO strings, Groups and people as sent', () => {
    const read = parseUserActivityResponse(changed(['extra'], 1));
    expect(read).toStrictEqual(response.data);
    expect(read.activities[0].group).toEqual(maple);
    expect(read.activities[1].actor).toBeNull();
  });

  it('accepts no events, and a full read', () => {
    expect(parseUserActivityResponse(changed(['data', 'activities'], [])).activities).toStrictEqual(
      [],
    );
    const full = changed(['data', 'activities'], Array(50).fill(response.data.activities[2]));
    full.data.limit = 50;
    expect(parseUserActivityResponse(full).activities).toHaveLength(50);
  });

  it.each([
    ['an event', [...event, 'expense']],
    ['a Group', [...event, 'group', 'category']],
    ['metadata', [...event, 'metadata', 'tag']],
    ['the changes', [...event, 'metadata', 'changes', 'notes']],
  ])('keeps a field it does not declare on %s', (_label, path) => {
    const body = changed(path, 'kept');
    expect(parseUserActivityResponse(body)).toStrictEqual(body.data);
  });

  it('accepts an amount in a historical currency', () => {
    const read = parseUserActivityResponse(changed([...event, 'currency'], 'DEM'));
    expect(read.activities[0].currency).toBe('DEM');
  });

  it.each([
    ['a wrong status', ['status'], 404],
    ['missing data', ['data'], REMOVE],
    ['a missing event list', ['data', 'activities'], REMOVE],
    ['a missing limit', ['data', 'limit'], REMOVE],
    ['a limit over the cap', ['data', 'limit'], 51],
    ['a zero limit', ['data', 'limit'], 0],
    [
      'more events than the cap',
      ['data', 'activities'],
      Array(51).fill(response.data.activities[2]),
    ],
    ['a malformed id', [...event, '_id'], 'wifi'],
    ['an empty type', [...event, 'type'], ''],
    ['a time without a zone', [...event, 'createdAt'], '2026-10-06T14:10:00'],
    ['an event without its Group', [...event, 'group'], REMOVE],
    ['a Group named only by its id', [...event, 'group'], maple._id],
    ['a Group without a name', [...event, 'group', 'name'], REMOVE],
    ['a malformed Group id', [...event, 'group', '_id'], 'maple'],
    ['a malformed actor id', [...event, 'actor', '_id'], 'priya'],
    ['an actor sent as a bare id, without a name', [...event, 'actor'], 'a00000000000000000000003'],
    ['an actor name that is not a string', [...event, 'actor', 'name'], 1],
    ['a currency that is not a string', [...event, 'currency'], 356],
    ['missing metadata', [...event, 'metadata'], REMOVE],
    ['a malformed Expense id', [...event, 'metadata', 'expenseId'], 'wifi'],
    ['an amount that is not a number', ['data', 'activities', 1, 'metadata', 'amount'], '620'],
    ['a change that is not an object', [...event, 'metadata', 'changes', 'amount'], 999],
  ])('rejects %s, without the payload in its message', (_label, path, value) => {
    let thrown: unknown;
    try {
      parseUserActivityResponse(changed(path, value));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UserActivityReadError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).cause).toBeUndefined();
  });

  it.each([null, [], {}, 'Wi-Fi'])('rejects the response %j', (value) => {
    expect(() => parseUserActivityResponse(value)).toThrow(message);
  });
});
