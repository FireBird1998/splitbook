import {
  queryKeyPath,
  type QueryKey,
  type AccountQueryKey,
  type GroupQueryKey,
} from '@splitbook/shared/query-keys';
import { parseHomeBalancesResponse } from '@splitbook/shared/home-balances-read';
import { parseGroupBalancesResponse } from '@splitbook/shared/group-balances-read';
import { parseExpensePageResponse } from '@splitbook/shared/expense-page-read';
import { parseExpenseRecordResponse } from '@splitbook/shared/expense-record-read';
import { parseActivityPageResponse } from '@splitbook/shared/activity-page-read';
import { fetcher } from '@/lib/utils/fetcher';
import { fetchGroupRead, readWebGroupListResponse, readWebGroupResponse } from '@/lib/group-read';

/** Every fetcher gets its request path from the shared key. SWR remains the cache owner. */
export const fetchWebRead = (key: QueryKey) => fetcher(queryKeyPath(key));

function decoded<T>(decode: (payload: unknown) => T) {
  return async (key: QueryKey) => ({ status: 200 as const, data: decode(await fetchWebRead(key)) });
}
// One cached response shape per resource, so different views can share the same entry.
export const fetchWebHomeBalances = decoded(parseHomeBalancesResponse);
export async function fetchWebBalances(key: QueryKey) {
  const payload = await fetchWebRead(key);
  parseGroupBalancesResponse(payload);
  // Legacy currency/balances/debts beside byCurrency remain the web views' own wire shape.
  // The shared contract deliberately passes those fields through without Android checks.
  return payload;
}
export const fetchWebExpensePage = decoded(parseExpensePageResponse);
export const fetchWebExpenseRecord = decoded(parseExpenseRecordResponse);
export const fetchWebActivity = decoded(parseActivityPageResponse);

export const fetchWebGroups = (key: AccountQueryKey, actorId: string) =>
  fetchGroupRead(queryKeyPath(key), (payload) => readWebGroupListResponse(payload, actorId));
export const fetchWebGroup = (key: GroupQueryKey, actorId: string) =>
  fetchGroupRead(queryKeyPath(key), (payload) => readWebGroupResponse(payload, actorId, key[3]));
