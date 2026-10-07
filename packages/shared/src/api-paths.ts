/**
 * The request path of every API read the apps make, one builder per read (#210). This
 * package has no `URL` or `URLSearchParams` (ADR 0002), so builders encode by hand: every
 * path segment and query value goes through `encodeURIComponent`, and an id or a search can
 * never change which route is called. Android's paths come out exactly as its controller
 * builds them today, so its saved copies and path-based invalidation still match.
 */
import { normalizeSearchQuery } from './search';
import type { ExportRequest } from './export-request';
import type { ExpenseFilters } from './types';

/**
 * One path segment. An empty or dot-only id would change the route even when encoded, and an
 * id with a broken character (a lone surrogate) can't be encoded without aliasing another id.
 */
function segment(id: string) {
  if (id === '' || id === '.' || id === '..') throw new RangeError('Invalid path segment');
  try {
    return encodeURIComponent(id);
  } catch {
    throw new RangeError('Invalid path segment');
  }
}

// encodeURIComponent throws on a lone surrogate. A query value is sent with U+FFFD in its
// place instead, as URLSearchParams does, so a search with a broken character still runs.
const surrogates = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;
const queryValue = (value: string) =>
  encodeURIComponent(value.replace(surrogates, (unit) => (unit.length === 2 ? unit : '\uFFFD')));

/** `?name=value&…` in the order given, without the values that aren't set. */
function query(entries: [name: string, value: string | number | undefined][]) {
  const pairs = entries
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => `${name}=${queryValue(String(value))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

const group = (groupId: string) => `/api/groups/${segment(groupId)}`;

export const groupsPath = () => '/api/groups';
export const groupPath = (groupId: string) => group(groupId);
export const groupBalancesPath = (groupId: string) => `${group(groupId)}/balances`;

/**
 * Every filter the Expense list route reads, in the order they are sent. Android's order
 * comes first: page, limit, member breakdown, then a Month's range. The filters #310 added
 * come last, so every path built before them is unchanged.
 */
function expenseQuery(filters: ExpenseFilters): {
  [Name in keyof Required<ExpenseFilters>]: string | number | undefined;
} {
  return {
    page: filters.page,
    limit: filters.limit,
    includeMemberBreakdown: filters.includeMemberBreakdown ? '1' : undefined,
    quickFilter: filters.quickFilter,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    category: filters.category,
    tag: filters.tag,
    tagId: filters.tagId,
    search: filters.search,
    paidByUser: filters.paidByUser,
    owedByUser: filters.owedByUser,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    involvesUser: filters.involvesUser,
    amountMin: filters.amountMin,
    amountMax: filters.amountMax,
    includeRecurringCount: filters.includeRecurringCount ? '1' : undefined,
  };
}

/** A page of a Group's Expenses. Filters that aren't set are left out, so the server's defaults apply. */
export const expensePagePath = (groupId: string, filters: ExpenseFilters = {}) =>
  `${group(groupId)}/expenses${query(Object.entries(expenseQuery(filters)))}`;

export const expenseRecordPath = (groupId: string, expenseId: string) =>
  `${group(groupId)}/expenses/${segment(expenseId)}`;

export interface ActivityPageQuery {
  page: number;
  limit: number;
  /** Only this Expense's events: its history. */
  expenseId?: string;
}

export const activityPagePath = (groupId: string, { expenseId, page, limit }: ActivityPageQuery) =>
  `${group(groupId)}/activity${query([
    ['expenseId', expenseId],
    ['page', page],
    ['limit', limit],
  ])}`;

/**
 * Every page of one Expense's history, with no page: the key of the one query that reads them
 * page by page on Android (#220). Each page's own path is `activityPagePath` with `expenseId`.
 */
export const expenseHistoryPath = (groupId: string, expenseId: string, limit: number) =>
  `${group(groupId)}/activity${query([
    ['expenseId', expenseId],
    ['limit', limit],
  ])}`;

/** Home's totals across the member's Groups. */
export const homeBalancesPath = () => '/api/user/balances';

export interface UserActivityQuery {
  /** How many of the latest events to read. The server caps it (`user-activity-read`). */
  limit?: number;
}

/** The latest Activity across the member's Groups, newest first: Home's latest changes (#309). */
export const userActivityPath = ({ limit }: UserActivityQuery = {}) =>
  `/api/user/activity${query([['limit', limit]])}`;

export interface UserSpendingQuery {
  /** How many Months, ending with the current one: 1–12. */
  months: number;
  /** The viewer's named IANA time zone, such as `Asia/Kolkata`: it decides each Month. */
  timeZone: string;
}

/** The member's share of spending across their Groups, by Month (#307). */
export const userSpendingPath = ({ months, timeZone }: UserSpendingQuery) =>
  `/api/user/spending${query([
    ['months', months],
    ['tz', timeZone],
  ])}`;

export interface GroupInsightsQuery {
  /** The Month, `YYYY-MM`; the server's default is the current Month in the time zone. */
  month?: string;
  /** How many Months before it to compare it with: 1–12. */
  compare?: number;
  /** The viewer's named IANA time zone, such as `Asia/Kolkata`: it decides each Month. */
  timeZone: string;
}

/** A Group's Month against the Months before it: the Insights tab (#314). */
export const groupInsightsPath = (
  groupId: string,
  { month, compare, timeZone }: GroupInsightsQuery,
) =>
  `${group(groupId)}/insights${query([
    ['month', month],
    ['compare', compare],
    ['tz', timeZone],
  ])}`;

export interface TripSummaryQuery {
  /** The viewer's named IANA time zone, such as `Asia/Kolkata`: it decides each day. */
  timeZone: string;
}

/** A Trip's whole-trip summary: a Trip's Insights tab (#316). */
export const tripSummaryPath = (groupId: string, { timeZone }: TripSummaryQuery) =>
  `${group(groupId)}/trip-summary${query([['tz', timeZone]])}`;

export const invitationsPath = () => '/api/invitations';
export const settlementsPath = (groupId: string) => `${group(groupId)}/settlements`;
export const recurringExpensesPath = (groupId: string) => `${group(groupId)}/recurring`;
/**
 * Search across the member's Groups (#321), for the query as it is searched: trimmed, its
 * whitespace collapsed, so the same search always has one path.
 */
export const searchPath = (searchQuery: string) =>
  `/api/search${query([['q', normalizeSearchQuery(searchQuery)]])}`;

/**
 * An export's files (#317): `groups` as ids joined by commas, the window's two days (left out
 * for all time), the includes joined by commas, the format and the viewer's time zone.
 */
export const exportPath = ({ groupIds, from, to, include, format, timeZone }: ExportRequest) =>
  `/api/export${query([
    ['groups', groupIds.join(',')],
    ['from', from],
    ['to', to],
    ['include', include.join(',')],
    ['format', format],
    ['tz', timeZone],
  ])}`;
