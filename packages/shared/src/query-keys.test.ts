import { describe, expect, it } from 'vitest';
import {
  activityPagePath,
  expensePagePath,
  expenseRecordPath,
  groupBalancesPath,
  groupPath,
  groupsPath,
  homeBalancesPath,
  invitationsPath,
  recurringExpensesPath,
  settlementsPath,
  userActivityPath,
} from './api-paths';
import {
  activityPageKey,
  expensePageKey,
  expenseRecordKey,
  groupBalancesKey,
  groupKey,
  groupsKey,
  homeBalancesKey,
  invitationsKey,
  isQueryKey,
  matchAccount,
  matchGroup,
  matchScope,
  queryKeyPath,
  recurringExpensesKey,
  settlementsKey,
  userActivityKey,
  type QueryAccount,
  type QueryKey,
} from './query-keys';

const environment = 'https://api.example.test';
const alex: QueryAccount = { environment, accountId: 'a00000000000000000000001' };
const sam: QueryAccount = { environment, accountId: 'a00000000000000000000002' };
const alexOnStaging: QueryAccount = { ...alex, environment: 'https://staging.example.test' };
const maple = 'b00000000000000000000001';
const goa = 'b00000000000000000000002';
const expenseId = 'c00000000000000000000001';
const monthPage = { page: 1, limit: 20, includeMemberBreakdown: true, dateFrom: '2026-09-01' };

describe('key factories', () => {
  it.each([
    ['the Groups list', groupsKey(alex), ['groups', environment, alex.accountId, '/api/groups']],
    ['Home', homeBalancesKey(alex), ['home', environment, alex.accountId, '/api/user/balances']],
    [
      "Home's latest changes",
      userActivityKey(alex, { limit: 10 }),
      ['home', environment, alex.accountId, userActivityPath({ limit: 10 })],
    ],
    [
      'invitations',
      invitationsKey(alex),
      ['invitations', environment, alex.accountId, '/api/invitations'],
    ],
    [
      'a Group',
      groupKey(alex, maple),
      ['group', environment, alex.accountId, maple, groupPath(maple)],
    ],
    [
      'its Balances',
      groupBalancesKey(alex, maple),
      ['balances', environment, alex.accountId, maple, groupBalancesPath(maple)],
    ],
    [
      'an Expense page',
      expensePageKey(alex, maple, monthPage),
      ['ledger', environment, alex.accountId, maple, expensePagePath(maple, monthPage)],
    ],
    [
      'an Expense record',
      expenseRecordKey(alex, maple, expenseId),
      ['ledger', environment, alex.accountId, maple, expenseRecordPath(maple, expenseId)],
    ],
    [
      'an Activity page',
      activityPageKey(alex, maple, { page: 2, limit: 20 }),
      [
        'ledger',
        environment,
        alex.accountId,
        maple,
        activityPagePath(maple, { page: 2, limit: 20 }),
      ],
    ],
    [
      'an Expense history page',
      activityPageKey(alex, maple, { expenseId, page: 1, limit: 20 }),
      [
        'ledger',
        environment,
        alex.accountId,
        maple,
        activityPagePath(maple, { expenseId, page: 1, limit: 20 }),
      ],
    ],
    [
      'Settlements',
      settlementsKey(alex, maple),
      ['ledger', environment, alex.accountId, maple, settlementsPath(maple)],
    ],
    [
      'recurring Expenses',
      recurringExpensesKey(alex, maple),
      ['ledger', environment, alex.accountId, maple, recurringExpensesPath(maple)],
    ],
  ])('%s: scope, environment, account, Group, then the path', (_label, key, expected) => {
    expect(key).toEqual(expected);
    expect(key.every((part) => typeof part === 'string')).toBe(true);
    expect(queryKeyPath(key)).toBe(expected.at(-1));
    expect(isQueryKey(key)).toBe(true);
  });
});

describe('keys need an environment and an account', () => {
  // As a caller might pass them before an account is known.
  it.each([
    ['an empty environment', { environment: '', accountId: alex.accountId }],
    ['no environment', { accountId: alex.accountId }],
    ['an empty account', { environment, accountId: '' }],
    ['no account id', { environment }],
    ['no account at all', undefined],
  ] as [string, QueryAccount][])('refuses %s', (_label, account) => {
    for (const read of reads) expect(() => read(account, maple)).toThrow(RangeError);
    expect(() => matchAccount(account)).toThrow(RangeError);
  });
});

describe('keys differ', () => {
  it('by account', () => {
    expect(groupsKey(alex)).not.toEqual(groupsKey(sam));
    expect(groupBalancesKey(alex, maple)).not.toEqual(groupBalancesKey(sam, maple));
  });

  it('by environment', () => {
    expect(homeBalancesKey(alex)).not.toEqual(homeBalancesKey(alexOnStaging));
    expect(expenseRecordKey(alex, maple, expenseId)).not.toEqual(
      expenseRecordKey(alexOnStaging, maple, expenseId),
    );
  });

  it('by Group', () => {
    expect(groupKey(alex, maple)).not.toEqual(groupKey(alex, goa));
    expect(settlementsKey(alex, maple)[3]).not.toBe(settlementsKey(alex, goa)[3]);
  });

  it('by path', () => {
    expect(expensePageKey(alex, maple, { page: 1, limit: 20 })).not.toEqual(
      expensePageKey(alex, maple, { page: 2, limit: 20 }),
    );
    expect(activityPageKey(alex, maple, { page: 1, limit: 20 })).not.toEqual(
      activityPageKey(alex, maple, { expenseId, page: 1, limit: 20 }),
    );
    expect(expenseRecordKey(alex, maple, expenseId)).not.toEqual(settlementsKey(alex, maple));
    expect(userActivityKey(alex, { limit: 10 })).not.toEqual(homeBalancesKey(alex));
    expect(userActivityKey(alex, { limit: 10 })).not.toEqual(userActivityKey(alex, { limit: 50 }));
  });

  it('never between an account and a Group that share an id', () => {
    const twin: QueryAccount = { environment, accountId: maple };
    expect(groupsKey(twin)).not.toEqual(groupKey(alex, maple));
  });
});

/** Every read's factory. */
const reads: ((account: QueryAccount, groupId: string) => QueryKey)[] = [
  (account) => groupsKey(account),
  (account) => homeBalancesKey(account),
  (account) => userActivityKey(account, { limit: 10 }),
  (account) => invitationsKey(account),
  (account, groupId) => groupKey(account, groupId),
  (account, groupId) => groupBalancesKey(account, groupId),
  (account, groupId) => expensePageKey(account, groupId, monthPage),
  (account, groupId) => expenseRecordKey(account, groupId, expenseId),
  (account, groupId) => activityPageKey(account, groupId, { page: 1, limit: 20 }),
  (account, groupId) => settlementsKey(account, groupId),
  (account, groupId) => recurringExpensesKey(account, groupId),
];
/** Every read, for each account, environment and Group below. */
const everyKey = (account: QueryAccount, groupId: string) =>
  reads.map((read) => read(account, groupId));
const keys = [alex, sam, alexOnStaging].flatMap((account) =>
  [maple, goa].flatMap((groupId) => everyKey(account, groupId)),
);

describe('matchers', () => {
  it("select a Group's group, balances and ledger keys, and nothing else", () => {
    const selected = keys.filter(matchGroup(maple));
    expect(selected).toHaveLength(3 * 7);
    for (const key of selected) {
      expect(['group', 'balances', 'ledger']).toContain(key[0]);
      expect(key[3]).toBe(maple);
    }
    for (const key of keys.filter((key) => !matchGroup(maple)(key)))
      expect(
        key[0] === 'groups' || key[0] === 'home' || key[0] === 'invitations' || key[3] === goa,
      ).toBe(true);
  });

  it('never select the Groups list, Home or invitations for a Group, even one named like an account', () => {
    const twin: QueryAccount = { environment, accountId: maple };
    for (const key of [
      groupsKey(twin),
      homeBalancesKey(twin),
      userActivityKey(twin),
      invitationsKey(twin),
    ])
      expect(matchGroup(maple)(key)).toBe(false);
  });

  it('never select a Group whose id only starts or ends like this one', () => {
    expect(everyKey(alex, `${maple}0`).filter(matchGroup(maple))).toEqual([]);
    expect(keys.filter(matchGroup(maple.slice(0, -1)))).toEqual([]);
    expect(keys.filter(matchGroup(maple.slice(1)))).toEqual([]);
  });

  it.each([groupsPath(), homeBalancesPath(), userActivityPath({ limit: 10 }), invitationsPath()])(
    'never select an account read for a Group id equal to its path, %s',
    (path) => {
      expect(keys.filter(matchGroup(path))).toEqual([]);
    },
  );

  it("select only this account's keys in this environment", () => {
    const selected = keys.filter(matchAccount(alex));
    expect(selected).toHaveLength(2 * 11);
    expect(selected).toEqual(
      expect.arrayContaining([...everyKey(alex, maple), ...everyKey(alex, goa)]),
    );
    for (const key of selected) {
      expect(key[1]).toBe(environment);
      expect(key[2]).toBe(alex.accountId);
    }
    expect(keys.filter(matchAccount(alexOnStaging)).every((key) => key[1] !== environment)).toBe(
      true,
    );
  });

  it.each(['groups', 'home', 'group', 'balances', 'ledger', 'invitations'] as const)(
    'select only the %s scope',
    (scope) => {
      const selected = keys.filter(matchScope(scope));
      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every((key) => key[0] === scope)).toBe(true);
      expect(keys.filter((key) => key[0] === scope)).toEqual(selected);
    },
  );

  it.each([
    ['a bare path', '/api/groups'],
    ['an older Group read key', ['group-read', alex.accountId, '/api/groups']],
    ['a Group key without its path', ['ledger', environment, alex.accountId, maple]],
    ['an account key with a Group', ['groups', environment, alex.accountId, maple, '/api/groups']],
    ['an unknown scope', ['expenses', environment, alex.accountId, maple, '/api/groups']],
    ['a key with a number', ['group', environment, alex.accountId, maple, 1]],
    ['nothing', null],
    ['an object', { 0: 'groups' }],
  ])('select no other key: %s', (_label, value) => {
    expect(isQueryKey(value)).toBe(false);
    expect(matchAccount(alex)(value)).toBe(false);
    expect(matchGroup(maple)(value)).toBe(false);
    expect(matchScope('ledger')(value)).toBe(false);
    expect(matchScope('groups')(value)).toBe(false);
  });
});
