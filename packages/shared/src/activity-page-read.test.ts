import { describe, expect, it } from 'vitest';
import { ActivityPageReadError, parseActivityPageResponse } from './activity-page-read';

// Fictional people and events, shaped like the Activity pages Android's suites send.
const groupId = 'b00000000000000000000001';
const expenseId = 'c00000000000000000000001';
const iso = '2026-09-28T12:00:00.000Z';
const response = {
  status: 200,
  data: {
    activities: [
      {
        _id: 'e00000000000000000000001',
        group: groupId,
        actor: { _id: 'a00000000000000000000001', name: 'Alex Rivera' },
        type: 'expense_added',
        createdAt: iso,
        metadata: { expenseId, description: 'Dinner', amount: 12.34, currency: 'INR' },
      },
      {
        _id: 'e00000000000000000000002',
        group: groupId,
        actor: 'a00000000000000000000002',
        type: 'settlement_recorded',
        createdAt: iso,
        metadata: {
          settlementId: 'f00000000000000000000001',
          amount: 15,
          currency: 'INR',
          paidByName: 'Sam Chen',
          paidToName: 'Priya Shah',
        },
      },
      {
        _id: 'e00000000000000000000003',
        group: groupId,
        actor: null,
        type: 'expense_edited',
        createdAt: iso,
        metadata: {
          expenseId,
          changes: { amount: { old: 10, new: 12.34 }, notes: { new: 'Tip included' } },
        },
      },
      {
        _id: 'e00000000000000000000004',
        group: groupId,
        actor: { _id: 'a00000000000000000000001', name: 'Alex Rivera' },
        type: 'group_updated',
        createdAt: iso,
        metadata: null,
      },
    ],
    pagination: { page: 1, limit: 20, total: 4, totalPages: 1 },
  },
};
const message = 'Unable to load Activity. Please retry.';

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

describe('Activity page read contract', () => {
  it('returns the wire shape: times as ISO strings, actors and metadata as sent', () => {
    const page = parseActivityPageResponse(changed(['extra'], 1));
    expect(page).toStrictEqual(response.data);
    expect(page.activities[0].createdAt).toBe(iso);
    expect(page.activities[1].actor).toBe('a00000000000000000000002');
    expect(page.activities[3].metadata).toBeNull();
  });

  // Times keep their offset as sent; a time without a zone is refused, as Android refuses it.
  it.each(['2026-09-27T15:30:00+05:30', '2026-09-27T06:30:00.000-03:30'])(
    'accepts the time %s with its offset, unchanged',
    (time) => {
      const body = changed([...event, 'createdAt'], time);
      expect(parseActivityPageResponse(body)).toStrictEqual(body.data);
    },
  );

  it('accepts an event without metadata', () => {
    const body = changed([...event, 'metadata'], REMOVE);
    expect(parseActivityPageResponse(body)).toStrictEqual(body.data);
  });

  it.each([
    ['an event', [...event, 'expense']],
    ['an actor', [...event, 'actor', 'image']],
    ['metadata', [...event, 'metadata', 'tag']],
    ['a change', ['data', 'activities', 2, 'metadata', 'changes', 'amount', 'currency']],
    ['the pagination', ['data', 'pagination', 'hasMore']],
  ])('keeps a field it does not declare on %s', (_label, path) => {
    const body = changed(path, 'kept');
    expect(parseActivityPageResponse(body)).toStrictEqual(body.data);
  });

  it.each([1, 20, 50])('accepts %i-row pages', (limit) => {
    expect(
      parseActivityPageResponse(changed(['data', 'pagination', 'limit'], limit)).pagination.limit,
    ).toBe(limit);
  });

  it('accepts an amount in a historical currency', () => {
    const page = parseActivityPageResponse(changed([...event, 'metadata', 'currency'], 'DEM'));
    expect(page.activities[0].metadata?.currency).toBe('DEM');
  });

  it('leaves the Group, the page, the Expense and exact amounts to the caller', () => {
    const body = changed([...event, 'group'], 'b00000000000000000000009');
    body.data.pagination.page = 9;
    body.data.activities[0].metadata!.expenseId = 'c00000000000000000000009';
    body.data.activities[0].metadata!.amount = 12.345;
    expect(parseActivityPageResponse(body)).toStrictEqual(body.data);
  });

  it.each([
    ['a wrong status', ['status'], 404],
    ['missing data', ['data'], REMOVE],
    ['a missing event list', ['data', 'activities'], REMOVE],
    ['missing pagination', ['data', 'pagination'], REMOVE],
    ['a zero page size', ['data', 'pagination', 'limit'], 0],
    ['a fractional page', ['data', 'pagination', 'page'], 1.5],
    ['a negative page count', ['data', 'pagination', 'totalPages'], -1],
    ['a malformed id', [...event, '_id'], 'dinner'],
    ['an id one character too long', [...event, '_id'], 'e000000000000000000000010'],
    [
      'an Expense id one character too short',
      [...event, 'metadata', 'expenseId'],
      expenseId.slice(1),
    ],
    ['a time without a zone', [...event, 'createdAt'], '2026-09-28T12:00:00'],
    ['a malformed Group id', [...event, 'group'], 7],
    ['an empty type', [...event, 'type'], ''],
    ['a malformed actor id', [...event, 'actor'], 'alex'],
    ['an actor name that is not a string', [...event, 'actor', 'name'], 1],
    ['a malformed time', [...event, 'createdAt'], 'noon'],
    ['metadata that is not an object', [...event, 'metadata'], 'Dinner'],
    ['a malformed Expense id', [...event, 'metadata', 'expenseId'], 'dinner'],
    ['a non-finite amount', [...event, 'metadata', 'amount'], Infinity],
    ['an amount that is not a number', [...event, 'metadata', 'amount'], '12.34'],
    ['a currency that is not a string', [...event, 'metadata', 'currency'], 356],
    ['a recurring flag that is not a boolean', [...event, 'metadata', 'recurring'], 'yes'],
    [
      'a change that is not an object',
      ['data', 'activities', 2, 'metadata', 'changes', 'amount'],
      1,
    ],
  ])('rejects %s, without the payload in its message', (_label, path, value) => {
    let thrown: unknown;
    try {
      parseActivityPageResponse(changed(path, value));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ActivityPageReadError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).cause).toBeUndefined();
  });

  it.each([null, [], {}, 'Dinner'])('rejects the response %j', (value) => {
    expect(() => parseActivityPageResponse(value)).toThrow(message);
  });
});
