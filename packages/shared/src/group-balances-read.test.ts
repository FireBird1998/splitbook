import { describe, expect, it } from 'vitest';
import { GroupBalancesReadError, parseGroupBalancesResponse } from './group-balances-read';

// Fictional people and figures, shaped like the Balances Android's suites send.
const sam = { _id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const priya = 'a00000000000000000000003';
const response = {
  status: 200,
  data: {
    currency: 'INR',
    balances: [{ user: { ...sam, email: 'sam@example.test' }, balance: -30 }],
    debts: [],
    byCurrency: [
      {
        currency: 'INR',
        balances: [
          { user: sam, balance: -30 },
          { user: priya, balance: 30 },
          { user: null, balance: 0 },
        ],
        debts: [{ from: sam, to: { _id: priya, name: 'Priya Shah' }, amount: 30 }],
      },
    ],
    hasMixedCurrencies: false,
  },
};
const message = 'Unable to load Balances. Please retry.';

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
const bucket = ['data', 'byCurrency', 0];

describe('Group Balances read contract', () => {
  it('returns the wire shape, with the fields it does not declare', () => {
    expect(parseGroupBalancesResponse(changed(['extra'], 1))).toStrictEqual(response.data);
  });

  it.each([
    ['a bucket', [...bucket, 'note']],
    ['a balance', [...bucket, 'balances', 0, 'settled']],
    ['a debt', [...bucket, 'debts', 0, 'amountMinor']],
    ['a person', [...bucket, 'balances', 0, 'user', 'email']],
  ])('keeps a field it does not declare on %s', (_label, path) => {
    const body = changed(path, 'kept');
    expect(parseGroupBalancesResponse(body)).toStrictEqual(body.data);
  });

  it('accepts a Balance in a historical currency', () => {
    const body = changed([...bucket, 'currency'], 'DEM');
    expect(parseGroupBalancesResponse(body).byCurrency[0].currency).toBe('DEM');
  });

  it('leaves exact amounts to the caller', () => {
    const body = changed([...bucket, 'debts', 0, 'amount'], 30.005);
    expect(parseGroupBalancesResponse(body)).toStrictEqual(body.data);
  });

  it.each([
    ['a missing byCurrency', ['data', 'byCurrency'], REMOVE],
    ['a currency that is not a string', [...bucket, 'currency'], 356],
    ['a missing balance list', [...bucket, 'balances'], REMOVE],
    ['a non-finite balance', [...bucket, 'balances', 0, 'balance'], Infinity],
    ['a balance that is not a number', [...bucket, 'balances', 0, 'balance'], '30'],
    ['a zero debt', [...bucket, 'debts', 0, 'amount'], 0],
    ['a negative debt', [...bucket, 'debts', 0, 'amount'], -30],
    ['a NaN debt', [...bucket, 'debts', 0, 'amount'], NaN],
    ['a malformed person id', [...bucket, 'balances', 1, 'user'], 'priya'],
    ['a malformed populated id', [...bucket, 'debts', 0, 'from'], { _id: 'sam' }],
    ['a name that is not a string', [...bucket, 'debts', 0, 'to', 'name'], 7],
    ['an image that is not a string', [...bucket, 'balances', 0, 'user', 'image'], {}],
    ['a missing debtor', [...bucket, 'debts', 0, 'from'], REMOVE],
    ['a wrong status', ['status'], 201],
    ['missing data', ['data'], REMOVE],
    ['null data', ['data'], null],
  ])('rejects %s, without the payload in its message', (_label, path, value) => {
    let thrown: unknown;
    try {
      parseGroupBalancesResponse(changed(path, value));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GroupBalancesReadError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).cause).toBeUndefined();
  });

  it.each([null, [], {}, 'Sam Chen'])('rejects the response %j', (value) => {
    expect(() => parseGroupBalancesResponse(value)).toThrow(message);
  });
});
