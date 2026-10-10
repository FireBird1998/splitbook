import { describe, expect, it } from 'vitest';
import {
  groupsKey,
  groupKey,
  homeBalancesKey,
  invitationsKey,
  expensePageKey,
  groupBalancesKey,
  settlementsKey,
  expenseRecordKey,
  activityPageKey,
  recurringExpensesKey,
  queryKeyPath,
  userActivityKey,
  userSpendingKey,
  searchKey,
  groupInsightsKey,
  tripSummaryKey,
} from '@splitbook/shared/query-keys';
import {
  WEB_QUERY_ACCOUNT,
  matchWebGroupRead,
  isWebGroupsRead,
  isWebAccountGroupsRead,
  matchWebGroupContent,
} from './web-query-keys';

const group = 'a'.repeat(24),
  other = 'b'.repeat(24),
  expense = 'c'.repeat(24);
const account = WEB_QUERY_ACCOUNT;
const reads = [
  ['groups', groupsKey(account), '/api/groups'],
  ['group', groupKey(account, group), `/api/groups/${group}`],
  ['home', homeBalancesKey(account), '/api/user/balances'],
  ['invitations', invitationsKey(account), '/api/invitations'],
  [
    'trip total',
    expensePageKey(account, group, { page: 1, limit: 1 }),
    `/api/groups/${group}/expenses?page=1&limit=1`,
  ],
  ['balances', groupBalancesKey(account, group), `/api/groups/${group}/balances`],
  [
    'month',
    expensePageKey(account, group, {
      page: 1,
      limit: 1,
      dateFrom: '2026-10-01T00:00:00.000Z',
      dateTo: '2026-10-31T23:59:59.999Z',
    }),
    `/api/groups/${group}/expenses?dateFrom=2026-10-01T00:00:00.000Z&dateTo=2026-10-31T23:59:59.999Z&page=1&limit=1`,
  ],
  ['payments', settlementsKey(account, group), `/api/groups/${group}/settlements`],
  [
    'list',
    expensePageKey(account, group, {
      page: 2,
      limit: 50,
      search: 'Rent & bills',
      tagId: expense,
      sortBy: 'date',
      sortOrder: 'desc',
    }),
    `/api/groups/${group}/expenses?search=Rent%20%26%20bills&tagId=${expense}&sortBy=date&sortOrder=desc&page=2&limit=50`,
  ],
  ['record', expenseRecordKey(account, group, expense), `/api/groups/${group}/expenses/${expense}`],
  [
    'activity',
    activityPageKey(account, group, { page: 1, limit: 50 }),
    `/api/groups/${group}/activity?page=1&limit=50`,
  ],
  ['recurring', recurringExpensesKey(account, group), `/api/groups/${group}/recurring`],
  ['other group', groupKey(account, other), `/api/groups/${other}`],
  ['latest changes', userActivityKey(account, { limit: 10 }), '/api/user/activity?limit=10'],
  [
    'spending',
    userSpendingKey(account, { months: 6, timeZone: 'Asia/Kolkata' }),
    '/api/user/spending?months=6&tz=Asia%2FKolkata',
  ],
  [
    'insights',
    groupInsightsKey(account, group, { month: '2026-10', compare: 3, timeZone: 'Asia/Kolkata' }),
    `/api/groups/${group}/insights?month=2026-10&compare=3&tz=Asia%2FKolkata`,
  ],
  [
    'trip summary',
    tripSummaryKey(account, group, { timeZone: 'Asia/Kolkata' }),
    `/api/groups/${group}/trip-summary?tz=Asia%2FKolkata`,
  ],
  [
    'quick-add history',
    expensePageKey(account, group, { page: 1, limit: 50 }),
    `/api/groups/${group}/expenses?page=1&limit=50`,
  ],
  [
    'member breakdown',
    expensePageKey(account, group, { page: 1, limit: 1, includeMemberBreakdown: true }),
    `/api/groups/${group}/expenses?page=1&limit=1&includeMemberBreakdown=1`,
  ],
] as const;
const request = (path: string) => {
  const url = new URL(path, 'http://localhost');
  return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
};

describe('the web shared read keys (#235)', () => {
  it('uses distinct keys, sharing one Balances read between the two views', () => {
    expect(new Set(reads.map(([, key]) => JSON.stringify(key))).size).toBe(reads.length);
    expect(groupBalancesKey(account, group)).toEqual(groupBalancesKey(account, group));
    for (const [, key] of reads) expect(key.slice(1, 3)).toEqual(['web', 'web']);
  });
  it.each(reads)('%s preserves the old endpoint and query values', (_, key, oldPath) => {
    expect(request(queryKeyPath(key))).toEqual(request(oldPath));
  });
  it('preserves all three global invalidation predicates’ selected sets', () => {
    for (const oldPredicate of [
      (path: string) => path.startsWith(`/api/groups/${group}`),
      (path: string) => path.startsWith(`/api/groups/${group}`),
      (path: string) => path.includes('/api/groups'),
    ]) {
      const predicate = oldPredicate('/api/groups') ? isWebGroupsRead : matchWebGroupRead(group);
      expect(reads.filter(([, key]) => predicate(key)).map(([name]) => name)).toEqual(
        reads.filter(([, , path]) => oldPredicate(path)).map(([name]) => name),
      );
    }
  });
  it('evicts the Group’s content and the same account-wide reads, never unrelated reads', () => {
    expect(
      reads.filter(([, key]) => matchWebGroupContent(group)(key)).map(([name]) => name),
    ).toEqual([
      'trip total',
      'balances',
      'month',
      'payments',
      'list',
      'record',
      'activity',
      'recurring',
      'insights',
      'trip summary',
      'quick-add history',
      'member breakdown',
    ]);
    expect(isWebAccountGroupsRead(userActivityKey(account))).toBe(true);
    expect(isWebAccountGroupsRead(userSpendingKey(account, { months: 6, timeZone: 'UTC' }))).toBe(
      true,
    );
    expect(isWebAccountGroupsRead(searchKey(account, 'Rent'))).toBe(false);
    expect(isWebGroupsRead(homeBalancesKey(account))).toBe(false);
    expect(isWebGroupsRead(invitationsKey(account))).toBe(false);
    expect(
      matchWebGroupRead(group)(groupKey({ environment: 'other', accountId: 'web' }, group)),
    ).toBe(false);
  });
});
