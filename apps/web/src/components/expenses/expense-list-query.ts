/**
 * The Expenses tab's view, kept in the address (#310): search, the filters (Paid by, Tag,
 * involves me, an amount range and, outside a Household, a date window), the sort and the
 * page. Reading the address is forgiving: a value that doesn't fit this Group (a member who
 * isn't in it, a Tag it doesn't have, an amount with too many decimals) is dropped, so a
 * shared or hand-edited link always opens a view the Group can show. Every other parameter in
 * the address, such as a Household's `month` or the open Expense (#311), is left as it is.
 */
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { ExpenseFilters } from '@splitbook/shared/types';

export type ExpenseSort = 'newest' | 'oldest' | 'largest' | 'smallest';

export const EXPENSE_SORTS: ReadonlyArray<{ id: ExpenseSort; label: string }> = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'largest', label: 'Largest first' },
  { id: 'smallest', label: 'Smallest first' },
];

/** Today's date quick-filters, for Groups without a Household's Month bar. */
export type ExpenseDateWindow =
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'last30Days'
  | 'custom';

export const EXPENSE_DATE_WINDOWS: ReadonlyArray<{ id: ExpenseDateWindow; label: string }> = [
  { id: 'thisWeek', label: 'This week' },
  { id: 'lastWeek', label: 'Last week' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'last30Days', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom range' },
];

/** The longest custom date window, as before #310. */
export const MAX_CUSTOM_RANGE_DAYS = 31;

export interface ExpenseListQuery {
  /** Text to find in descriptions; '' for none. */
  search: string;
  /** The member who paid, by id. */
  paidBy: string | null;
  /** The Tag, by id. */
  tag: string | null;
  /** Only Expenses the viewer paid part of or has a share of. */
  involvesMe: boolean;
  /** The amount range, inclusive, as decimal text in the Group's currency. */
  min: string | null;
  max: string | null;
  sort: ExpenseSort;
  when: ExpenseDateWindow | null;
  /** A custom window's first and last day, `YYYY-MM-DD`. */
  from: string | null;
  to: string | null;
  /** 1-based. */
  page: number;
}

export const DEFAULT_EXPENSE_LIST_QUERY: ExpenseListQuery = {
  search: '',
  paidBy: null,
  tag: null,
  involvesMe: false,
  min: null,
  max: null,
  sort: 'newest',
  when: null,
  from: null,
  to: null,
  page: 1,
};

/** What a link to the tab may name, and how its amounts are written. */
export interface ExpenseListContext {
  memberIds: readonly string[];
  tagIds: readonly string[];
  currency: string;
  /** Whether the date quick-filters apply: not in a Household, whose Month bar picks dates. */
  dateWindows: boolean;
}

/** A search longer than any description can't match one. */
const MAX_SEARCH_LENGTH = 200;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The address parameter behind each part of the view. */
const PARAM = {
  search: 'search',
  paidBy: 'paidBy',
  tag: 'tag',
  involvesMe: 'involvesMe',
  min: 'min',
  max: 'max',
  sort: 'sort',
  when: 'when',
  from: 'from',
  to: 'to',
  page: 'page',
} as const satisfies Record<keyof ExpenseListQuery, string>;

/** The amount as the Group's currency writes it, or null when it isn't a plain amount. */
export function readAmount(raw: string | null | undefined, currency: string): string | null {
  const text = raw?.trim() ?? '';
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  try {
    parseAmountMinor(text, currency);
    return text;
  } catch {
    return null;
  }
}

function amountMinor(text: string, currency: string): number {
  return parseAmountMinor(text, currency);
}

/** The view a link describes, with whatever doesn't fit the Group left out. */
export function readExpenseListQuery(
  params: Pick<URLSearchParams, 'get'>,
  context: ExpenseListContext,
): ExpenseListQuery {
  const get = (name: string) => params.get(name);
  const search = (get(PARAM.search) ?? '').slice(0, MAX_SEARCH_LENGTH);
  const paidBy = get(PARAM.paidBy);
  const tag = get(PARAM.tag);
  let min = readAmount(get(PARAM.min), context.currency);
  let max = readAmount(get(PARAM.max), context.currency);
  if (min && max && amountMinor(min, context.currency) > amountMinor(max, context.currency))
    [min, max] = [null, null];
  const sort = EXPENSE_SORTS.find(({ id }) => id === get(PARAM.sort))?.id ?? 'newest';
  const when = context.dateWindows
    ? (EXPENSE_DATE_WINDOWS.find(({ id }) => id === get(PARAM.when))?.id ?? null)
    : null;
  const day = (name: string) => {
    const value = get(name);
    return when === 'custom' && value && DAY.test(value) ? value : null;
  };
  const page = Number(get(PARAM.page));
  return {
    search,
    paidBy: paidBy && context.memberIds.includes(paidBy) ? paidBy : null,
    tag: tag && context.tagIds.includes(tag) ? tag : null,
    involvesMe: get(PARAM.involvesMe) === '1',
    min,
    max,
    sort,
    when,
    from: day(PARAM.from),
    to: day(PARAM.to),
    page: Number.isSafeInteger(page) && page > 1 ? page : 1,
  };
}

const writtenValue = (key: keyof ExpenseListQuery, value: ExpenseListQuery[typeof key]) => {
  if (value === DEFAULT_EXPENSE_LIST_QUERY[key] || value === null || value === '') return null;
  if (key === 'involvesMe') return '1';
  return String(value);
};

/**
 * The address's query after a change to the view. Parts at their default leave the address,
 * other parameters stay, and a change to anything but the page goes back to the first page.
 */
export function writeExpenseListQuery(
  current: URLSearchParams | string,
  change: Partial<ExpenseListQuery>,
): string {
  const next = new URLSearchParams(current);
  const keys = Object.keys(change) as Array<keyof ExpenseListQuery>;
  for (const key of keys) {
    const value = writtenValue(key, change[key] as ExpenseListQuery[typeof key]);
    if (value === null) next.delete(PARAM[key]);
    else next.set(PARAM[key], value);
  }
  if (keys.some((key) => key !== 'page') && !('page' in change)) next.delete(PARAM.page);
  if (change.when !== undefined && change.when !== 'custom') {
    next.delete(PARAM.from);
    next.delete(PARAM.to);
  }
  return next.toString();
}

/**
 * The address parameter naming the open Expense (#311): the side panel on a computer, the
 * opened card on a phone. It sits beside the view's parameters and never changes them.
 */
export const OPEN_EXPENSE_PARAM = 'expense';
const EXPENSE_ID = /^[a-f\d]{24}$/i;

/** The Expense a link opens, or null when it names none or nothing an Expense id could be. */
export function readOpenExpense(params: Pick<URLSearchParams, 'get'>): string | null {
  const id = params.get(OPEN_EXPENSE_PARAM);
  return id && EXPENSE_ID.test(id) ? id : null;
}

/** The address's query with this Expense open, or none; every other parameter stays. */
export function writeOpenExpense(
  current: URLSearchParams | string,
  expenseId: string | null,
): string {
  const next = new URLSearchParams(current);
  if (expenseId) next.set(OPEN_EXPENSE_PARAM, expenseId);
  else next.delete(OPEN_EXPENSE_PARAM);
  return next.toString();
}

/**
 * The query of a link that opens one Expense, with the list searched for it when `search` is
 * given (#321's results): `expense=…&search=…`, each value encoded so it never changes the
 * address's shape.
 */
export function openExpenseQuery(expenseId: string, { search }: { search?: string } = {}) {
  const parts = [`${OPEN_EXPENSE_PARAM}=${encodeURIComponent(expenseId)}`];
  if (search) parts.push(`${PARAM.search}=${encodeURIComponent(search)}`);
  return parts.join('&');
}

/** The parts of the view that narrow the list (the sort and page don't). */
export function activeFilterCount(query: ExpenseListQuery): number {
  return [
    query.search.trim() !== '',
    query.paidBy !== null,
    query.tag !== null,
    query.involvesMe,
    query.min !== null || query.max !== null,
    query.when !== null,
  ].filter(Boolean).length;
}

/** Every filter cleared; the sort stays. */
export const CLEARED_FILTERS: Partial<ExpenseListQuery> = {
  search: '',
  paidBy: null,
  tag: null,
  involvesMe: false,
  min: null,
  max: null,
  when: null,
  from: null,
  to: null,
};

/** Why a custom window can't be read yet, or null when it can (or isn't custom). */
export function customRangeError(query: Pick<ExpenseListQuery, 'when' | 'from' | 'to'>) {
  if (query.when !== 'custom') return null;
  if (!query.from || !query.to) return 'Choose the first and last day.';
  const from = Date.parse(`${query.from}T00:00:00Z`);
  const to = Date.parse(`${query.to}T00:00:00Z`);
  if (from > to) return 'The first day must be on or before the last day.';
  if ((to - from) / 86_400_000 + 1 > MAX_CUSTOM_RANGE_DAYS)
    return `Choose ${MAX_CUSTOM_RANGE_DAYS} days or fewer.`;
  return null;
}

const SORT_REQUEST: Record<ExpenseSort, Pick<ExpenseFilters, 'sortBy' | 'sortOrder'>> = {
  newest: { sortBy: 'date', sortOrder: 'desc' },
  oldest: { sortBy: 'date', sortOrder: 'asc' },
  largest: { sortBy: 'amount', sortOrder: 'desc' },
  smallest: { sortBy: 'amount', sortOrder: 'asc' },
};

export interface ExpenseListRequest {
  /** The viewer, for "involves me". */
  userId: string;
  pageSize: number;
  /** A Household's Month, which sets the dates instead of the quick-filters. */
  month?: { dateFrom: string; dateTo: string } | null;
}

/** The Expense list read for a view. */
export function expenseListFilters(
  query: ExpenseListQuery,
  { userId, pageSize, month }: ExpenseListRequest,
): ExpenseFilters {
  const dates: Pick<ExpenseFilters, 'quickFilter' | 'dateFrom' | 'dateTo'> = month
    ? { dateFrom: month.dateFrom, dateTo: month.dateTo }
    : query.when === 'custom'
      ? { dateFrom: query.from ?? undefined, dateTo: query.to ?? undefined }
      : { quickFilter: query.when ?? undefined };
  return {
    page: query.page,
    limit: pageSize,
    ...dates,
    search: query.search.trim() || undefined,
    paidByUser: query.paidBy ?? undefined,
    tagId: query.tag ?? undefined,
    ...SORT_REQUEST[query.sort],
    involvesUser: query.involvesMe ? userId : undefined,
    amountMin: query.min ?? undefined,
    amountMax: query.max ?? undefined,
  };
}
