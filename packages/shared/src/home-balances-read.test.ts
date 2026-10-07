import { describe, expect, it } from 'vitest';
import {
  HomeBalancesReadError,
  HomeSuggestedPaymentsReadError,
  parseHomeBalancesResponse,
  readHomeSuggestedPayments,
} from './home-balances-read';

// Fictional Groups and figures, shaped like the Home totals Android's suites send.
const maple = 'b00000000000000000000001';
const goa = 'b00000000000000000000002';
const response = {
  status: 200,
  data: {
    buckets: [
      { currency: 'EUR', youOwe: 0, youAreOwed: 42.5, net: 42.5 },
      { currency: 'INR', youOwe: 1480, youAreOwed: 620, net: -860 },
    ],
    groups: [
      {
        groupId: maple,
        name: 'Maple House',
        category: 'home',
        balances: [{ currency: 'INR', balance: -1480 }],
      },
      {
        groupId: goa,
        name: 'Goa Friends Trip',
        balances: [
          { currency: 'EUR', balance: 12.5 },
          {
            currency: 'INR',
            balance: 620,
            settlement: {
              counterpartyId: 'a00000000000000000000002',
              counterpartyName: 'Sam',
              amount: 620,
            },
          },
        ],
      },
    ],
    hasMixedCurrencies: true,
  },
};
const message = 'Unable to load your balances. Please retry.';

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
const bucket = ['data', 'buckets', 1];
const group = ['data', 'groups', 0];

describe("Home's totals read contract", () => {
  it('returns the wire shape, with the fields it does not declare', () => {
    expect(parseHomeBalancesResponse(changed(['extra'], 1))).toStrictEqual(response.data);
  });

  it('accepts totals without Group balances', () => {
    const body = changed(['data', 'groups'], REMOVE);
    expect(parseHomeBalancesResponse(body)).toStrictEqual(body.data);
  });

  it.each([
    ['a bucket', [...bucket, 'settled']],
    ['a Group', [...group, 'updatedAt']],
    ['a Group balance', [...group, 'balances', 0, 'settlement']],
  ])('keeps a field it does not declare on %s', (_label, path) => {
    const body = changed(path, 'kept');
    expect(parseHomeBalancesResponse(body)).toStrictEqual(body.data);
  });

  it('accepts a bucket and a Group balance in a historical currency', () => {
    const body = changed([...bucket, 'currency'], 'DEM');
    body.data.groups[0].balances[0].currency = 'FRF';
    const home = parseHomeBalancesResponse(body);
    expect(home.buckets[1].currency).toBe('DEM');
    expect(home.groups?.[0].balances[0].currency).toBe('FRF');
  });

  it('leaves exact amounts to the caller', () => {
    const body = changed([...bucket, 'youOwe'], 0.001);
    body.data.groups[0].balances[0].balance = -1480.005;
    expect(parseHomeBalancesResponse(body)).toStrictEqual(body.data);
  });

  it.each([
    ['a wrong status', ['status'], 401],
    ['missing data', ['data'], REMOVE],
    ['missing buckets', ['data', 'buckets'], REMOVE],
    ['a currency that is not a string', [...bucket, 'currency'], null],
    ['a negative amount owed', [...bucket, 'youOwe'], -1],
    ['a negative amount owed back', [...bucket, 'youAreOwed'], -0.5],
    ['a non-finite amount owed', [...bucket, 'youOwe'], Infinity],
    ['a missing amount owed back', [...bucket, 'youAreOwed'], REMOVE],
    ['null Group balances', ['data', 'groups'], null],
    ['a malformed Group id', [...group, 'groupId'], 'maple'],
    ['a Group id one character too long', [...group, 'groupId'], `${maple}0`],
    ['a Group id one character too short', [...group, 'groupId'], maple.slice(1)],
    ['a missing Group balance list', [...group, 'balances'], REMOVE],
    ['a non-finite Group balance', [...group, 'balances', 0, 'balance'], NaN],
    ['a Group balance that is not a number', [...group, 'balances', 0, 'balance'], '-1480'],
  ])('rejects %s, without the payload in its message', (_label, path, value) => {
    let thrown: unknown;
    try {
      parseHomeBalancesResponse(changed(path, value));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HomeBalancesReadError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).cause).toBeUndefined();
  });

  it.each([null, [], {}, 'Maple House'])('rejects the response %j', (value) => {
    expect(() => parseHomeBalancesResponse(value)).toThrow(message);
  });
});

describe('the suggested payments Home adds to the read (#306)', () => {
  const sam = 'a00000000000000000000002';
  const payment = {
    groupId: maple,
    groupName: 'Maple House',
    currency: 'INR',
    direction: 'pay',
    counterpartyId: sam,
    counterpartyName: 'Sam',
    amountMinor: 106_000,
  };
  const withPayments = (value: unknown) =>
    parseHomeBalancesResponse(changed(['data', 'suggestedPayments'], value));

  it('reads every payment, with the fields it does not declare', () => {
    const list = [payment, { ...payment, direction: 'receive', amountMinor: 1, note: 'kept' }];
    expect(readHomeSuggestedPayments(withPayments(list))).toStrictEqual(list);
    expect(readHomeSuggestedPayments(withPayments([]))).toStrictEqual([]);
  });

  it('is never checked by the balances decoder, so a malformed list leaves Android’s read as it was', () => {
    const home = withPayments([{ ...payment, amountMinor: 'lots' }]);
    expect(home.buckets).toStrictEqual(response.data.buckets);
    expect(() => readHomeSuggestedPayments(home)).toThrow(HomeSuggestedPaymentsReadError);
  });

  it('refuses a read without the list: no list never means nothing to pay', () => {
    expect(() => readHomeSuggestedPayments(parseHomeBalancesResponse(response))).toThrow(
      'Unable to load your suggested payments. Please retry.',
    );
  });

  it.each([
    ['a direction it does not know', { direction: 'owe' }],
    ['a malformed Group id', { groupId: 'maple' }],
    ['a malformed person id', { counterpartyId: 'sam' }],
    ['a missing Group name', { groupName: undefined }],
    ['a missing person name', { counterpartyName: undefined }],
    ['a currency that is not a string', { currency: 840 }],
    ['an amount in major units', { amountMinor: 1060.5 }],
    ['an amount of zero', { amountMinor: 0 }],
    ['a negative amount', { amountMinor: -100 }],
    ['an amount beyond the exact range', { amountMinor: 2 ** 53 }],
  ])('rejects %s, without the payload in its message', (_label, change) => {
    let thrown: unknown;
    try {
      readHomeSuggestedPayments(withPayments([{ ...payment, ...change }]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HomeSuggestedPaymentsReadError);
    expect((thrown as Error).message).not.toContain('Maple');
  });

  it.each([null, {}, 'none'])('rejects the list %j', (value) => {
    expect(() => readHomeSuggestedPayments(withPayments(value))).toThrow(
      HomeSuggestedPaymentsReadError,
    );
  });
});
