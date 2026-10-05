import { describe, expect, it } from 'vitest';
import { ExpensePageReadError, parseExpensePageResponse } from './expense-page-read';

// Fictional people and figures, shaped like the Expense pages Android's suites send.
const groupId = 'b00000000000000000000001';
const sam = { _id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const iso = '2026-09-27T10:00:00.000Z';
const expense = {
  _id: 'c00000000000000000000001',
  group: groupId,
  description: 'Groceries',
  currency: 'INR',
  amount: 10,
  amountMinor: 1000,
  moneyVersion: 1,
  category: 'food',
  tag: 'Shared',
  tagId: 'd00000000000000000000001',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  paidBy: [{ user: sam, amount: 10, amountMinor: 1000 }],
  splitBetween: [
    { user: sam, amount: 5, amountMinor: 500 },
    { user: 'a00000000000000000000003', amount: 5, amountMinor: 500 },
  ],
  splitMethod: 'equal',
  isDeleted: false,
};
const response = {
  status: 200,
  data: {
    expenses: [expense],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    summary: {
      count: 1,
      totalAmount: 10,
      totalsByCurrency: [{ currency: 'INR', totalAmount: 10 }],
      userOwes: 0,
      userGetsBack: 5,
      byMember: [{ user: sam, paid: 10, share: 5, net: -5 }],
    },
  },
};
const message = 'Unable to load Expenses. Please retry.';

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
const row = ['data', 'expenses', 0];
const summary = ['data', 'summary'];

describe('Expense page read contract', () => {
  it('returns the wire shape, with times as ISO strings', () => {
    const page = parseExpensePageResponse(changed(['extra'], 1));
    expect(page).toStrictEqual(response.data);
    expect(page.expenses[0].date).toBe(iso);
  });

  it("keeps the summary's totalAmount, which the web shows", () => {
    expect(parseExpensePageResponse(changed([...summary, 'totalAmount'], 1234.5)).summary).toEqual(
      expect.objectContaining({ totalAmount: 1234.5 }),
    );
  });

  it.each([
    ['an Expense', [...row, 'notes']],
    ['an allocation', [...row, 'splitBetween', 0, 'percentage']],
    ['a person', [...row, 'paidBy', 0, 'user', 'email']],
    ['the pagination', ['data', 'pagination', 'hasMore']],
    ['a currency total', [...summary, 'totalsByCurrency', 0, 'count']],
    ['a member row', [...summary, 'byMember', 0, 'owes']],
    ['the page', ['data', 'filters']],
  ])('keeps a field it does not declare on %s', (_label, path) => {
    const body = changed(path, 'kept');
    expect(parseExpensePageResponse(body)).toStrictEqual(body.data);
  });

  it.each([1, 20, 50])('accepts %i-row pages', (limit) => {
    expect(
      parseExpensePageResponse(changed(['data', 'pagination', 'limit'], limit)).pagination.limit,
    ).toBe(limit);
  });

  it('accepts an Expense and a total in a historical currency', () => {
    const body = changed([...row, 'currency'], 'DEM');
    body.data.summary.totalsByCurrency[0].currency = 'FRF';
    const page = parseExpensePageResponse(body);
    expect(page.expenses[0].currency).toBe('DEM');
    expect(page.summary.totalsByCurrency[0].currency).toBe('FRF');
  });

  it('accepts legacy Expenses without Tag identity, money version, minor units or breakdown', () => {
    const body = changed([...row, 'tag'], REMOVE);
    const legacy = body.data.expenses[0] as Partial<typeof expense>;
    delete legacy.tagId;
    delete legacy.moneyVersion;
    delete legacy.amountMinor;
    legacy.paidBy = [{ user: sam, amount: 10 } as never];
    legacy.splitBetween = [{ user: null, amount: 10 } as never];
    delete (body.data.summary as Partial<typeof response.data.summary>).byMember;
    expect(parseExpensePageResponse(body)).toStrictEqual(body.data);
  });

  it('leaves the Group, the page, the count, stored money and exact amounts to the caller', () => {
    const body = changed([...row, 'group'], 'b00000000000000000000009');
    body.data.pagination.page = 7;
    body.data.summary.count = 4;
    body.data.expenses[0].amountMinor = 999;
    body.data.summary.totalsByCurrency[0].totalAmount = 10.005;
    body.data.summary.userGetsBack = 0.001;
    expect(parseExpensePageResponse(body)).toStrictEqual(body.data);
  });

  it.each([
    ['a wrong status', ['status'], 500],
    ['missing data', ['data'], REMOVE],
    ['a missing summary', [...summary], REMOVE],
    ['missing pagination', ['data', 'pagination'], REMOVE],
    ['a zero page size', ['data', 'pagination', 'limit'], 0],
    ['a fractional page size', ['data', 'pagination', 'limit'], 1.5],
    ['a zero page', ['data', 'pagination', 'page'], 0],
    ['a negative total', ['data', 'pagination', 'total'], -1],
    ['a malformed id', [...row, '_id'], 'groceries'],
    ['a malformed Group id', [...row, 'group'], 'maple'],
    ['a malformed Tag id', [...row, 'tagId'], 'shared'],
    ['a non-finite amount', [...row, 'amount'], Infinity],
    ['a fractional minor amount', [...row, 'amountMinor'], 10.5],
    ['a malformed date', [...row, 'date'], 'yesterday'],
    ['a date without a zone', [...row, 'createdAt'], '2026-09-27T10:00:00'],
    ['an unknown split', [...row, 'splitMethod'], 'magic'],
    ['a description that is not a string', [...row, 'description'], 4],
    ['a missing category', [...row, 'category'], REMOVE],
    ['a Tag that is not a string', [...row, 'tag'], null],
    ['an allocation amount that is not finite', [...row, 'paidBy', 0, 'amount'], NaN],
    ['a malformed allocation person', [...row, 'splitBetween', 1, 'user'], 'priya'],
    ['an image that is not a string', [...row, 'paidBy', 0, 'user', 'image'], 5],
    ['a negative count', [...summary, 'count'], -1],
    ['a negative total', [...summary, 'totalsByCurrency', 0, 'totalAmount'], -10],
    ['a negative amount owed', [...summary, 'userOwes'], -1],
    ['a missing amount owed back', [...summary, 'userGetsBack'], REMOVE],
    ['a negative member share', [...summary, 'byMember', 0, 'share'], -5],
    ['a non-finite member net', [...summary, 'byMember', 0, 'net'], -Infinity],
    ['a null breakdown', [...summary, 'byMember'], null],
  ])('rejects %s, without the payload in its message', (_label, path, value) => {
    let thrown: unknown;
    try {
      parseExpensePageResponse(changed(path, value));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExpensePageReadError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).cause).toBeUndefined();
  });

  it.each([null, [], {}, 'Groceries'])('rejects the response %j', (value) => {
    expect(() => parseExpensePageResponse(value)).toThrow(message);
  });
});
