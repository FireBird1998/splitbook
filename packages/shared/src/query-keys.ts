/**
 * A cache key for every API read, one factory per read (#210, ADR 0006 M1-6). A key is a
 * read-only tuple of strings: scope, environment, account id, the Group id for a Group's
 * reads, then the request path from `api-paths`, so a fetcher reads its path from the end of
 * its key. Strings only, so SWR and TanStack Query hash a key the same way.
 */
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
  searchPath,
  settlementsPath,
  userActivityPath,
  type ActivityPageQuery,
  type UserActivityQuery,
} from './api-paths';
import type { ExpenseFilters } from './types';

/**
 * Which follow-ups must reach a read: the Groups list, Home's reads across the member's
 * Groups (its totals and latest changes), one Group's details, its running Balances, or the
 * rest of its ledger (Expense pages and records, Activity, Settlements and recurring
 * Expenses). Invitations and search (#321), which reads across the member's Groups, belong
 * to no Group.
 */
export type QueryScope = AccountScope | GroupScope;
export type AccountScope = 'groups' | 'home' | 'invitations' | 'search';
export type GroupScope = 'group' | 'balances' | 'ledger';

const accountScopes: readonly unknown[] = [
  'groups',
  'home',
  'invitations',
  'search',
] satisfies AccountScope[];
const groupScopes: readonly unknown[] = ['group', 'balances', 'ledger'] satisfies GroupScope[];

/**
 * Whom a read is for. On Android, the API the app reads from and the signed-in account; on
 * the web, which reads only its own origin for the account a tab was rendered for, one fixed
 * value for each.
 */
export interface QueryAccount {
  environment: string;
  accountId: string;
}

export type AccountQueryKey = readonly [
  scope: AccountScope,
  environment: string,
  accountId: string,
  path: string,
];
export type GroupQueryKey = readonly [
  scope: GroupScope,
  environment: string,
  accountId: string,
  groupId: string,
  path: string,
];
export type QueryKey = AccountQueryKey | GroupQueryKey;

/**
 * The environment and account, both required. A key built without one is selected by no
 * account's matcher, so signing out would leave it behind.
 */
function owner(account: QueryAccount) {
  // Checked at run time too: the types can't stop an account that isn't there yet.
  const environment: unknown = account?.environment;
  const accountId: unknown = account?.accountId;
  if (typeof environment !== 'string' || environment === '')
    throw new RangeError('A query key needs an environment');
  if (typeof accountId !== 'string' || accountId === '')
    throw new RangeError('A query key needs an account');
  return [environment, accountId] as const;
}

const accountKey = (scope: AccountScope, account: QueryAccount, path: string): AccountQueryKey => [
  scope,
  ...owner(account),
  path,
];

const groupScopedKey = (
  scope: GroupScope,
  account: QueryAccount,
  groupId: string,
  path: string,
): GroupQueryKey => [scope, ...owner(account), groupId, path];

export const groupsKey = (account: QueryAccount) => accountKey('groups', account, groupsPath());

export const homeBalancesKey = (account: QueryAccount) =>
  accountKey('home', account, homeBalancesPath());

/** Home's latest changes: every Group's writes reach it, as they reach Home's totals. */
export const userActivityKey = (account: QueryAccount, activity?: UserActivityQuery) =>
  accountKey('home', account, userActivityPath(activity));

export const invitationsKey = (account: QueryAccount) =>
  accountKey('invitations', account, invitationsPath());

/** One search across the member's Groups; the same query, however spaced, has one key. */
export const searchKey = (account: QueryAccount, query: string) =>
  accountKey('search', account, searchPath(query));

export const groupKey = (account: QueryAccount, groupId: string) =>
  groupScopedKey('group', account, groupId, groupPath(groupId));

export const groupBalancesKey = (account: QueryAccount, groupId: string) =>
  groupScopedKey('balances', account, groupId, groupBalancesPath(groupId));

export const expensePageKey = (account: QueryAccount, groupId: string, filters?: ExpenseFilters) =>
  groupScopedKey('ledger', account, groupId, expensePagePath(groupId, filters));

export const expenseRecordKey = (account: QueryAccount, groupId: string, expenseId: string) =>
  groupScopedKey('ledger', account, groupId, expenseRecordPath(groupId, expenseId));

export const activityPageKey = (account: QueryAccount, groupId: string, page: ActivityPageQuery) =>
  groupScopedKey('ledger', account, groupId, activityPagePath(groupId, page));

export const settlementsKey = (account: QueryAccount, groupId: string) =>
  groupScopedKey('ledger', account, groupId, settlementsPath(groupId));

export const recurringExpensesKey = (account: QueryAccount, groupId: string) =>
  groupScopedKey('ledger', account, groupId, recurringExpensesPath(groupId));

/** The request path a key was built for. */
export const queryKeyPath = (key: QueryKey): string => key[key.length - 1];

/** True only for a key these factories build, so a matcher passes over any other cache key. */
export function isQueryKey(value: unknown): value is QueryKey {
  if (!Array.isArray(value) || !value.every((part) => typeof part === 'string')) return false;
  if (accountScopes.includes(value[0])) return value.length === 4;
  return groupScopes.includes(value[0]) && value.length === 5;
}

/**
 * This account's reads in this environment: what sign-out, an account change or a 401 clears.
 * Like the factories, it refuses a missing environment or account rather than match nothing.
 */
export function matchAccount(account: QueryAccount) {
  const [environment, accountId] = owner(account);
  return (key: unknown): key is QueryKey =>
    isQueryKey(key) && key[1] === environment && key[2] === accountId;
}

/**
 * One Group's reads: its details, Balances and ledger. Never the Groups list, Home,
 * invitations or search; a rule that needs those names them.
 */
export const matchGroup =
  (groupId: string) =>
  (key: unknown): key is GroupQueryKey =>
    isQueryKey(key) && key.length === 5 && key[3] === groupId;

export const matchScope =
  (scope: QueryScope) =>
  (key: unknown): key is QueryKey =>
    isQueryKey(key) && key[0] === scope;
