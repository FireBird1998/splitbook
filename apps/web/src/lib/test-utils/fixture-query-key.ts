/** Adapt old URL-based cache fixtures to the shared factories; request assertions stay URLs. */
import {
  groupsKey,
  groupKey,
  homeBalancesKey,
  invitationsKey,
  userActivityKey,
  userSpendingKey,
  expensePageKey,
  expenseRecordKey,
  groupBalancesKey,
  settlementsKey,
  recurringExpensesKey,
  activityPageKey,
} from '@splitbook/shared/query-keys';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';

export function fixtureQueryKey(path: string) {
  const url = new URL(path, 'http://localhost');
  const query = url.searchParams,
    account = WEB_QUERY_ACCOUNT;
  const number = (key: string) => (query.has(key) ? Number(query.get(key)) : undefined);
  if (url.pathname === '/api/groups') return groupsKey(account);
  if (url.pathname === '/api/user/balances') return homeBalancesKey(account);
  if (url.pathname === '/api/invitations') return invitationsKey(account);
  if (url.pathname === '/api/user/activity')
    return userActivityKey(account, { limit: number('limit') });
  if (url.pathname === '/api/user/spending')
    return userSpendingKey(account, {
      months: number('months') ?? 6,
      timeZone: query.get('tz') ?? 'UTC',
    });
  const match = /^\/api\/groups\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
  if (!match) return path;
  const [, group, resource] = match;
  if (!resource) return groupKey(account, group);
  if (resource === 'balances') return groupBalancesKey(account, group);
  if (resource === 'settlements') return settlementsKey(account, group);
  if (resource === 'recurring') return recurringExpensesKey(account, group);
  if (resource === 'activity')
    return activityPageKey(account, group, {
      page: number('page') ?? 1,
      limit: number('limit') ?? 50,
    });
  if (resource.startsWith('expenses/'))
    return expenseRecordKey(account, group, resource.slice('expenses/'.length));
  if (resource === 'expenses')
    return expensePageKey(account, group, {
      page: number('page'),
      limit: number('limit'),
      sortBy: query.get('sortBy') === 'date' ? 'date' : undefined,
      sortOrder: query.get('sortOrder') === 'desc' ? 'desc' : undefined,
      dateFrom: query.get('dateFrom') ?? undefined,
      dateTo: query.get('dateTo') ?? undefined,
    });
  throw new Error(`Unhandled cache fixture: ${path}`);
}
