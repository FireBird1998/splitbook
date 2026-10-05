import { describe, expect, it } from 'vitest';
import { ExpenseRecordReadError, parseExpenseRecordResponse } from './expense-record-read';

// Fictional people and figures, shaped like the Expense records Android's suites send.
const sam = { _id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const priya = { _id: 'a00000000000000000000003', name: 'Priya Shah', image: null };
const iso = '2026-08-20T10:00:00.000Z';
const response = {
  status: 200,
  data: {
    _id: 'c00000000000000000000001',
    group: 'b00000000000000000000001',
    revision: 2,
    description: 'Electricity bill',
    amount: 30,
    amountMinor: 3000,
    moneyVersion: 1,
    currency: 'INR',
    paidBy: [{ user: priya, amount: 30, amountMinor: 3000 }],
    splitBetween: [
      { user: sam, amount: 15, amountMinor: 1500 },
      { user: priya, amount: 15, amountMinor: 1500 },
    ],
    splitMethod: 'equal',
    date: iso,
    createdAt: iso,
    updatedAt: iso,
    category: 'housing',
    tagId: 'd00000000000000000000001',
    tag: 'Utilities',
    notes: '',
    isDeleted: false,
    createdBy: sam,
    deletedAt: null as string | null,
    receiptUrl: null,
    recurringExpense: null,
    period: null,
    editHistory: [
      { editedBy: priya, editedAt: iso, changes: { amount: { old: 24, new: 30 } } },
      { editedBy: null, editedAt: iso, changes: { notes: { new: 'Paid early' } } },
    ],
  },
};
const message = 'Unable to load this Expense. Please retry.';

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

describe('Expense record read contract', () => {
  it('returns the wire shape, with times as ISO strings and people as sent', () => {
    const record = parseExpenseRecordResponse(changed(['extra'], 1));
    expect(record).toStrictEqual(response.data);
    expect(record.updatedAt).toBe(iso);
    expect(record.createdBy).toStrictEqual(sam);
  });

  it.each([
    ['the record', ['data', 'predefinedItemLabel']],
    ['an allocation', ['data', 'splitBetween', 0, 'note']],
    ['a person', ['data', 'paidBy', 0, 'user', 'email']],
    ['an edit', ['data', 'editHistory', 0, 'source']],
    ['a change', ['data', 'editHistory', 0, 'changes', 'amount', 'currency']],
  ])('keeps a field it does not declare on %s', (_label, path) => {
    const body = changed(path, 'kept');
    expect(parseExpenseRecordResponse(body)).toStrictEqual(body.data);
  });

  // Times keep their offset as sent; a time without a zone is refused, as Android refuses it.
  it.each(['2026-09-27T15:30:00+05:30', '2026-09-27T06:30:00.000-03:30'])(
    'accepts the time %s with its offset, unchanged',
    (time) => {
      const body = changed(['data', 'updatedAt'], time);
      expect(parseExpenseRecordResponse(body)).toStrictEqual(body.data);
    },
  );

  it('accepts an Expense in a historical currency', () => {
    expect(parseExpenseRecordResponse(changed(['data', 'currency'], 'DEM')).currency).toBe('DEM');
  });

  it('accepts a deleted legacy record without its optional fields', () => {
    const body = changed(['data', 'isDeleted'], true);
    const legacy = body.data as Partial<typeof response.data>;
    for (const field of [
      'tag',
      'tagId',
      'notes',
      'createdBy',
      'editHistory',
      'amountMinor',
    ] as const)
      delete legacy[field];
    delete legacy.moneyVersion;
    legacy.deletedAt = iso;
    legacy.paidBy = [{ user: 'a00000000000000000000003', name: 'Priya', amount: 30 } as never];
    legacy.splitBetween = [{ user: null, amount: 30, percentage: 100 } as never];
    expect(parseExpenseRecordResponse(body)).toStrictEqual(body.data);
  });

  it('leaves the Group, the Expense id and stored money to the caller', () => {
    const body = changed(['data', 'group'], 'b00000000000000000000009');
    body.data._id = 'c00000000000000000000009';
    body.data.amountMinor = 2999;
    body.data.amount = 30.005;
    expect(parseExpenseRecordResponse(body)).toStrictEqual(body.data);
  });

  it.each([
    ['a wrong status', ['status'], 201],
    ['missing data', ['data'], REMOVE],
    ['a malformed id', ['data', '_id'], 'bill'],
    ['an id one character too long', ['data', '_id'], `${response.data._id}0`],
    ['a Tag id one character too short', ['data', 'tagId'], response.data.tagId.slice(1)],
    ['a time without a zone', ['data', 'updatedAt'], '2026-08-20T10:00:00'],
    ['a malformed Group id', ['data', 'group'], null],
    ['a missing revision', ['data', 'revision'], REMOVE],
    ['a negative revision', ['data', 'revision'], -1],
    ['a fractional revision', ['data', 'revision'], 1.5],
    ['a non-finite amount', ['data', 'amount'], Infinity],
    ['a currency that is not a string', ['data', 'currency'], 356],
    ['a fractional money version', ['data', 'moneyVersion'], 1.5],
    ['an unknown split', ['data', 'splitMethod'], 'evenly'],
    ['a malformed date', ['data', 'date'], '20/08/2026'],
    ['a missing deleted flag', ['data', 'isDeleted'], REMOVE],
    ['a deleted flag that is not a boolean', ['data', 'isDeleted'], 'no'],
    ['null notes', ['data', 'notes'], null],
    ['a malformed creator', ['data', 'createdBy'], 'sam'],
    ['a malformed deletion time', ['data', 'deletedAt'], 'today'],
    ['a malformed recurring id', ['data', 'recurringExpense'], 'monthly'],
    ['a receipt that is not a string', ['data', 'receiptUrl'], 1],
    ['an allocation amount that is not finite', ['data', 'paidBy', 0, 'amount'], NaN],
    ['an allocation share that is not a number', ['data', 'splitBetween', 0, 'shares'], '1'],
    ['an allocation name that is not a string', ['data', 'splitBetween', 0, 'name'], 2],
    ['a malformed allocation person', ['data', 'splitBetween', 0, 'user'], { _id: 'sam' }],
    ['null edit history', ['data', 'editHistory'], null],
    ['an edit without a time', ['data', 'editHistory', 0, 'editedAt'], REMOVE],
    ['a change that is not an object', ['data', 'editHistory', 0, 'changes', 'amount'], 30],
  ])('rejects %s, without the payload in its message', (_label, path, value) => {
    let thrown: unknown;
    try {
      parseExpenseRecordResponse(changed(path, value));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExpenseRecordReadError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).cause).toBeUndefined();
  });

  it.each([null, [], {}, 'Electricity bill'])('rejects the response %j', (value) => {
    expect(() => parseExpenseRecordResponse(value)).toThrow(message);
  });
});
