import {
  hashKey,
  InfiniteQueryObserver,
  QueryObserver,
  type focusManager,
  type InfiniteData,
  type onlineManager,
  type QueryClient,
  type QueryFunctionContext,
  type QueryState,
} from '@tanstack/query-core';
import { groupCurrenciesPath, tagActionsPath } from '@splitbook/shared/api-paths';
import { groupCurrencySettingsSchema } from '@splitbook/shared/group-currency-settings';
import { monthKeyInZone } from '@splitbook/shared/zoned-calendar';
import { parseExpensePageResponse } from '@splitbook/shared/expense-page-read';
import { expenseMonthRange } from '@splitbook/shared/expense-day';
import { groupCurrencies } from '@splitbook/shared/group-currencies';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import {
  parseTripSummaryResponse,
  type TripSummaryRead,
} from '@splitbook/shared/trip-summary-read';
import { tagSnapshotSchema } from '@splitbook/shared/tag-management';
import {
  expensePageKey,
  groupBalancesKey,
  groupKey,
  groupCurrenciesKey,
  queryKeyPath,
  tagActionsKey,
  tripSummaryKey,
  type QueryAccount,
  type QueryKey,
} from '@splitbook/shared/query-keys';
import type { FindableRecordStore } from './account-record-storage';
import { objectId, parseGroup } from './dto';
import { parseExpensePage, parseGroupBalances } from './financial-dto';
import {
  createSavedReadEngine,
  parseOnce,
  uniqueRows,
  STALE,
  rowPaths,
  type Envelope,
  type PageEnvelope,
} from './saved-read-engine';
import { queryOwner } from './query-owner';
import { RequestError, Superseded } from './transport';
import type {
  AccountStorageLease,
  GroupDestination,
  GroupFinancialState,
  MobileGroup,
  MobileSnapshot,
  Route,
  TripSummaryState,
} from './types';

type Pages = InfiniteData<PageEnvelope, number>;
type Expenses = GroupFinancialState['expenses'];
type Balances = GroupFinancialState['balances'];
/** Before a Trip's summary is first read (#730). */
const noTrip: TripSummaryState = {
  status: 'idle',
  data: null,
  message: null,
  refreshedAt: null,
  stale: false,
  chosen: null,
};

/** A page holds 20 Expenses; a list keeps at most 5 pages, 100 rows, and slides past them (M1-3). */
const PAGE_SIZE = 20;
/**
 * What stays on screen when Splitbook can't be reached and this phone keeps no copy to show
 * instead: removed by a change, withheld (#323) or never saved. Beside the time it was read, as
 * Home says of its balances since #332 (#219).
 */
const notKept = {
  group: (name: string) => `Couldn’t refresh ${name}, and this phone no longer keeps a copy of it.`,
  expenses: 'Couldn’t refresh these expenses, and this phone no longer keeps a copy of them.',
  balances: 'Couldn’t refresh these balances, and this phone no longer keeps a copy of them.',
  trip: 'Couldn’t refresh this trip’s figures, and this phone no longer keeps a copy of them.',
};
const balancesNotUpdated = 'Could not update balances. Please try again.';

/** One parse per answer (and currency): structural sharing keeps an unchanged answer the same. */
const parsedGroup = parseOnce((value) => parseGroup(value));
const groupOf = (value: unknown) => parsedGroup(value, '');
const parsedPage = parseOnce((value, scope) => {
  const [groupId, currency] = scope.split(':');
  return parseExpensePage(value, groupId, currency);
});
const pageOf = (value: unknown, groupId: string, currency: string) =>
  parsedPage(value, `${groupId}:${currency}`);
const parsedBalances = parseOnce((value) => parseGroupBalances(value));
const balancesOf = (value: unknown) => parsedBalances(value, '');
const parsedTrip = parseOnce((value) => parseTripSummaryResponse(value));
const tripOf = (value: unknown) => parsedTrip(value, '');

/** `shown` again when nothing in `next` differs from it, so an unchanged read publishes nothing. */
const same = <T extends object>(shown: T, next: T): T =>
  (Object.keys(next) as (keyof T)[]).every((field) => shown[field] === next[field]) ? shown : next;
/** A refusal or failure, unless it's no answer at all (the read was superseded). */
const failure = (state: QueryState<unknown, Error>) =>
  state.status !== 'error' || state.error instanceof Superseded ? null : state.error;
/** The server couldn't be reached, and this device has no saved copy of the view. */
const unreachable = (error: unknown) =>
  error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';
const messageOf = (error: Error, fallback: string) =>
  error instanceof RequestError ? error.message : fallback;

/** No Expenses shown for `month` yet. */
export function emptyExpenses(month: string | null = null): Expenses {
  return {
    month,
    status: 'idle',
    data: [],
    summary: null,
    pagination: null,
    message: null,
    moreStatus: 'idle',
    moreMessage: null,
    refreshedAt: null,
    firstPage: 1,
    newerStatus: 'idle',
    newerMessage: null,
  };
}

/** A Group's rows on this device, as removals name them: all of them, or its ledger and Balances. */
export type GroupRows = 'group' | 'ledger';
const groupPrefix = (groupId: string) => `/api/groups/${groupId}`;
/** Whether the row at `path` is one of this Group's rows in `scope`. */
const inRows = (path: string, groupId: string, scope: GroupRows) => {
  const prefix = groupPrefix(groupId);
  return scope === 'group'
    ? path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)
    : path.startsWith(`${prefix}/expenses?`) ||
        path === `${prefix}/balances` ||
        // Its Trip summary in each currency (#730): a ledger change makes it obsolete too.
        path.startsWith(`${prefix}/trip-summary?`) ||
        // What uses each of its currencies (#722) changes with its ledger too.
        path === `${prefix}/currencies`;
};
/**
 * Removes a Group's saved copies from the persister's rows (M3-1): every row of the Group, or
 * only those a ledger change makes obsolete (each Month's Expenses and its Balances).
 */
export async function removeGroupRows(
  rows: FindableRecordStore | undefined,
  accountId: string,
  groupId: string,
  scope: GroupRows,
  known: Iterable<string> = [],
) {
  if (!rows) return;
  for (const path of await rowPaths(rows, accountId, [
    ...known,
    groupPrefix(groupId),
    `${groupPrefix(groupId)}/balances`,
  ]))
    if (inRows(path, groupId, scope)) await rows.remove(accountId, path);
}

/** What a Group's view needs from the session that owns it: the controller. */
export interface GroupSession {
  client: QueryClient;
  /** The persister's rows (M3-1); without them nothing is saved or restored. */
  rows?: FindableRecordStore;
  /** The signed-in account in this environment; throws `Superseded` when there is none. */
  account(): QueryAccount;
  generation(): number;
  current(owner: number): boolean;
  snapshot(): MobileSnapshot;
  publish(next: Partial<MobileSnapshot>): void;
  /** Where the member is (ADR 0006, M8-2). */
  route(): Route;
  lease(): AccountStorageLease | null;
  /** The account lease's own checks, at write time: still this account, with no clean-up. */
  owns(accountId: string): boolean;
  /** Saved copies of `key` verified at or before this are never shown (see `HomeSession`). */
  distrusted(key: QueryKey, early: boolean): number;
  /** These saved copies couldn't be removed: never shown again, and deleted at the next start. */
  distrust(accountId: string, scopes: string[]): void;
  /** Whether this device keeps saved copies of this read's Group (a listed Group). */
  savable(key: QueryKey): boolean;
  /** How long a verified read is reused without reading it again. */
  freshness: number;
  /** The phone's time zone, such as `Asia/Kolkata`: a Trip summary's days are its days (#730). */
  timeZone(): string;
  /** The session is offline: nothing read before is reused. */
  offline(): boolean;
  /** Sends the read, checking the session first while offline; `signal` cancels it. */
  read(path: string, owner: number, signal?: AbortSignal): Promise<unknown>;
  /** Where a read's answer came from: the server, or this device's copy from then (or none). */
  answered(path: string, saved?: number | null): void;
  /** The Group no longer lists the member: it is forgotten, as for a refusal. */
  lose(groupId: string, owner: number): Promise<void>;
  /**
   * An Expense list read begins: it may add due recurring Expenses on the server, so Balances and
   * Home read before it no longer describe the same ledger (M1-5). `fresh`: the list is read
   * again from its first page.
   */
  expensesRead(groupId: string, fresh: boolean): void;
  now(): number;
  /** Read projections such as the Widget copy observe the completed queries without a UI publish. */
  readSettled?(): void;
  /** A placed Group widget requests the complete Recent ledger on its next open. */
  recentRequested?(groupId: string): Promise<boolean>;
}

/** This open of a Group view, until the member opens another. */
interface View {
  groupId: string;
  /** This open's check of the Group passed: its Expenses and Balances can be read and shown. */
  checked: boolean;
  /** The Group refused the member during this open: nothing more is read until it opens again. */
  lost: boolean;
  /** Reads of this open (or a refresh of it) are running. */
  reading: number;
  /**
   * The internet returned while this open's reads ran (#678): once they end, it reads again if
   * they ended offline.
   */
  recovering: boolean;
  /** Whether the Group is a Household, once known: only a Household has a Month to show. */
  household: boolean | null;
  /** The Month shown before, kept when this Group opens again; undefined for a first open. */
  previousMonth: string | null | undefined;
  /** When this open began: what its reads answer before its check of the Group waits for it. */
  since: number;
  /** Which open this is, counted: a read begun before it was sent for an earlier one (2A). */
  open: number;
  /**
   * The latest change written in this Group that its Balances haven't been read after (0: none).
   * Counted, not timed, so a clock moved back never holds them (#219).
   */
  change: number;
}
/** A fetch's view context: the changes and opens before it, for screen decisions (#219, 2A). */
interface Start {
  change: number;
  open: number;
}
/**
 * Where a read of a Group's view starts: its Group, its Month's Expenses, its Balances, or a
 * Trip's summary in the currency chosen (#730).
 */
export type Step = 'group' | 'expenses' | 'balances' | 'trip';
/**
 * The Group's details show this phone's copy, as an offline read leaves them: that copy keeps the
 * offline banner until the Group is read again (#682). A failure Splitbook answered shows as an
 * error instead, and is read again only by Retry or a pull.
 */
export const savedGroupShown = (detail: MobileSnapshot['detail']) =>
  detail.status === 'ready' && !!detail.restored;

/**
 * A Group's own view on declarative queries (ADR 0006, M1-1; #219): the Group, its Expenses for
 * the chosen Month as one query of up to 5 pages, and its Balances, with a Trip's summary in more
 * than one currency (#730) where its All time card shows. While the Group's view shows,
 * their observers keep them active: a query they lack is read, including one a change or a
 * denial removed, so Balances read again after every read of the Group or its Expenses (M1-5).
 * Reads keep today's order, Group then Expenses then Balances (then a Trip's summary), and the
 * snapshot's `detail` and
 * `financial` are projected from them in today's shape. Their saved copies are the persister's
 * rows, one per query, in the wire JSON (M3-1), written on a saved-copy queue (M3-2) and
 * restored with their own time, never fresh (AMEND-2).
 */
export function createGroupQueries(session: GroupSession) {
  const { client, rows } = session;
  /** Each fetch's start, by its promise. */
  const starts = new WeakMap<object, Start>();
  /** How many changes have been written, or may have been, in this session's Group views. */
  let changes = 0;
  /** How many Group views have opened in this session. */
  let opens = 0;
  /** Each Expense list or Balances read from the server, by its data: its fetch's start. */
  const answers = new WeakMap<object, Start>();
  // An app read's arrival order survives clock rollback and query freshness expiry.
  // This projection marker stays in memory. The engine persists the wire value and its own time.
  let recentAnswerOrder = 0;
  const noteRecentAnswer = <T extends Envelope | PageEnvelope>(read: T): T =>
    read.source === 'network' ? { ...read, widgetRecentOrder: ++recentAnswerOrder } : read;
  /** Data restored from this device to show while the view is first read: never verified here. */
  const previews = new WeakSet<object>();
  /** The returns whose pages a read has shown again. */
  const shownRereads = new WeakSet<object>();
  let view: View | null = null;
  let observers: {
    group?: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>;
    list?: InfiniteQueryObserver<PageEnvelope, Error, Pages, QueryKey, number>;
    balances?: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>;
    trip?: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>;
  } = {};
  let pending = false;
  /** The Record payment sheet's latest live read of its Group's Balances (`sheetBalances`). */
  let sheetRead: {
    groupId: string;
    owner: number;
    owns(): boolean;
    refreshedAt: number;
    value: unknown;
  } | null = null;

  const held = <T>(key: QueryKey) => client.getQueryCache().get<T, Error>(hashKey(key));
  /** A query's state once it holds something: a query an observer only created holds nothing. */
  const stateOf = <T>(key: QueryKey | null) => {
    const query = key && held<T>(key);
    return query &&
      (query.state.data !== undefined ||
        query.state.fetchStatus === 'fetching' ||
        query.state.status === 'error')
      ? query.state
      : undefined;
  };
  const lists = (group: MobileGroup) =>
    group.members.some((entry) => entry.user.id === session.snapshot().auth.user?.id);

  const groupQueryKey = (groupId: string) => groupKey(session.account(), groupId);
  const balancesKey = (groupId: string) => groupBalancesKey(session.account(), groupId);
  /** One Month's Expenses (`null`: All time, or a Theme without a Month lens), every page. */
  const listKey = (groupId: string, household: boolean, month: string | null) =>
    expensePageKey(session.account(), groupId, {
      limit: PAGE_SIZE,
      // Every Theme's summary shows the member's own share and paid amount.
      includeMemberBreakdown: true,
      // The Expenses dated in the Month, the same for every viewer (#437).
      ...(household && month ? expenseMonthRange(month) : {}),
    });
  /** The summary-only consumer keeps one page, independent of the visible list's window. */
  const monthPageKey = (groupId: string, month: string) =>
    expensePageKey(session.account(), groupId, {
      page: 1,
      limit: PAGE_SIZE,
      includeMemberBreakdown: true,
      ...expenseMonthRange(month),
    });
  const isMonthPage = (key: QueryKey) =>
    queryKeyPath(key).includes('/expenses?page=1&') && queryKeyPath(key).includes('&dateFrom=');
  /** A page of it, with the page first, as Android has always sent it. */
  const pagePath = (key: QueryKey, page: number) =>
    queryKeyPath(key).replace('/expenses?', `/expenses?page=${page}&`);
  const isList = (key: QueryKey) => queryKeyPath(key).includes('/expenses?') && !isMonthPage(key);
  const isTrip = (key: QueryKey) => queryKeyPath(key).includes('/trip-summary?');
  /** The Group's currencies, as its Currencies read them: one of its saved reads (#722). */
  const isCurrencies = (key: QueryKey) =>
    key[0] === 'ledger' && queryKeyPath(key) === groupCurrenciesPath(key[3] as string);
  const currenciesOf = (value: unknown) => groupCurrencySettingsSchema.parse(Object(value).data);
  /** The Group's Tags, as the Tags screen reads them: one of the Group's own rows (#638). */
  const isTags = (key: QueryKey) =>
    key[0] === 'group' && queryKeyPath(key) === tagActionsPath(key[3] as string);
  /** The Tags in a Tags answer, or a decoder's error. */
  const tagsOf = (value: unknown) => tagSnapshotSchema.parse(Object(value).data);

  /** The Group view on screen, or under the Record payment sheet; null anywhere else. */
  const onScreen = () => {
    const at = session.route();
    if (session.snapshot().auth.status !== 'authenticated' || !view) return null;
    if ((at.screen !== 'group' && at.screen !== 'settlement') || at.groupId !== view.groupId)
      return null;
    return {
      destination: (at.screen === 'group' ? at.destination : 'balances') as GroupDestination,
      sheet: at.screen === 'settlement',
    };
  };
  /** The key of the Month shown, once it is known for this Group's Theme. */
  const shownList = (financial = session.snapshot().financial) => {
    return view && view.household !== null && financial.groupId === view.groupId
      ? listKey(view.groupId, view.household, financial.month)
      : null;
  };
  /**
   * The Trip summary the All time card shows (#730), in the currency chosen or, before one is,
   * the one the read opens on: only for a Trip in more than one currency, by its own list or
   * the Expenses it was spent in (an older Group's). Null for any other Group.
   */
  const shownTrip = (financial = session.snapshot().financial) => {
    if (!view || financial.groupId !== view.groupId) return null;
    const { detail, groups } = session.snapshot();
    const group =
      (detail.id === view.groupId ? detail.data : null) ??
      groups.data.find(({ id }) => id === view!.groupId);
    if (!group || getGroupTheme(group.category).header !== 'strip') return null;
    const several =
      groupCurrencies(group).length > 1 ||
      !!financial.expenses.summary?.totalsByCurrency.some(
        (row) => row.currency !== group.defaultCurrency && row.totalAmount > 0,
      );
    if (!several) return null;
    const chosen = financial.trip?.chosen;
    return tripSummaryKey(session.account(), view.groupId, {
      timeZone: session.timeZone(),
      ...(chosen ? { currency: chosen } : {}),
    });
  };
  /** The Group's currency, which an Expense page's summary is read in. */
  const currencyOf = (groupId: string) => {
    const { detail, groups } = session.snapshot();
    const known =
      (detail.id === groupId ? detail.data : null) ?? groups.data.find(({ id }) => id === groupId);
    return known?.defaultCurrency ?? 'INR';
  };
  /**
   * A saved copy shows only if its decoder reads it, and a saved Group lists the member. A
   * Month's list is saved page by page, each page under its own path with its own time.
   */
  const readable = (key: QueryKey, value: unknown, expectedPage?: number) => {
    try {
      if (isTags(key)) return Boolean(tagsOf(value));
      if (isCurrencies(key)) return Boolean(currenciesOf(value));
      if (key[0] === 'group') return lists(groupOf(value));
      if (key[0] === 'balances') return Boolean(balancesOf(value));
      if (isTrip(key)) return Boolean(tripOf(value));
      const page = pageOf(value, key[3] as string, currencyOf(key[3] as string));
      return expectedPage === undefined || page.pagination.page === expectedPage;
    } catch {
      return false;
    }
  };
  /** The resources whose wire answers this view saves and projects, whoever reads them. */
  const ownsKey = (key: QueryKey) =>
    key[0] === 'group' ||
    key[0] === 'balances' ||
    (key[0] === 'ledger' && (isList(key) || isMonthPage(key) || isTrip(key) || isCurrencies(key)));
  const engine = createSavedReadEngine<GroupRows>(session, {
    path: (key, page) => (page === undefined ? queryKeyPath(key) : pagePath(key, page)),
    readable,
    ownsKey,
    rowScope: {
      groupId: (key) => key[3] as string,
      defaultScope: 'group',
      scopes: (key) => (key[0] === 'group' ? ['group'] : ['group', 'ledger']),
      remove: (store, accountId, groupId, known, scope = 'group') =>
        removeGroupRows(store, accountId, groupId, scope, known),
      pathGroup: (path) => /^\/api\/groups\/([a-f\d]{24})(?:\/|\?|$)/i.exec(path)?.[1] ?? null,
      distrust: (key) => [`${key[0]}:${key[3]}`],
    },
    refusal: 'forbidden-or-missing',
    preview: 'same-run-unanswered',
    automaticRefetch: false,
    cancelOnRemove: true,
    staleWhenOffline: true,
  });
  /**
   * The screen remembers changes and opens at a fetch's start (#219, 2A). Query ownership,
   * cancellation and persistence belong to the engine; these are only projection decisions.
   */
  const noteStart = (key: QueryKey) => {
    const query = held(key);
    if (query?.promise && !starts.has(query.promise))
      starts.set(query.promise, { change: changes, open: opens });
    return query;
  };
  /**
   * While the view is first read, each saved row shows with its own time (a Month's first page,
   * for its list). The engine checks trust, readability and the same unanswered run; what counts
   * as a preview for the screen remains the view's.
   */
  const restore = (key: QueryKey, owner: number) => {
    const list = isList(key);
    return engine.restore<Envelope | Pages>(key, owner, {
      ...(list ? { page: 1 } : {}),
      project: (copy) => {
        const data = list ? { pages: [{ ...copy, page: 1 }], pageParams: [1] } : copy;
        previews.add(data);
        return data;
      },
    });
  };

  /** The Group. One that no longer lists the member is refused, as the server refuses one. */
  const readGroup = ({ queryKey }: QueryFunctionContext) => {
    const key = queryKey as QueryKey,
      groupId = key[3] as string;
    noteStart(key);
    if (!objectId.safeParse(groupId).success)
      return Promise.reject(new RequestError('This group is no longer available.', 404));
    return engine.read({
      key,
      accept: async (value) => {
        const group = groupOf(value);
        if (group.id !== groupId)
          throw new RequestError('The server returned a different Group. Please retry.', 500);
        if (lists(group)) return;
        // As for a refusal from the server: what was read and saved for it goes too.
        await session.lose(groupId, session.generation());
        throw new RequestError('You no longer have access to this group.', 403);
      },
    });
  };
  const readBalances = ({ queryKey }: QueryFunctionContext) => {
    const key = queryKey as QueryKey;
    noteStart(key);
    return engine.read({ key, accept: (value) => void balancesOf(value) });
  };
  const readMonth = ({ queryKey }: QueryFunctionContext) => {
    const key = queryKey as QueryKey,
      groupId = key[3] as string;
    noteStart(key);
    session.expensesRead(groupId, true);
    return engine
      .read({
        key,
        accept: (value) => {
          if (pageOf(value, groupId, currencyOf(groupId)).pagination.page !== 1)
            throw new Error('Unexpected expense page.');
        },
      })
      .then(noteRecentAnswer);
  };
  /** A Trip's summary in one currency (#730), checked by its decoder before it is kept. */
  const readTrip = ({ queryKey }: QueryFunctionContext) => {
    const key = queryKey as QueryKey;
    noteStart(key);
    return engine.read({ key, accept: (value) => void tripOf(value) });
  };
  /** The Group's currencies for its Currencies (#722), checked by their decoder before they're kept. */
  const readCurrencies = ({ queryKey }: QueryFunctionContext) => {
    const key = queryKey as QueryKey;
    noteStart(key);
    return engine.read({ key, accept: (value) => void currenciesOf(value) });
  };
  /**
   * The Group's Tags, read by the Tags screen with its own request (`send`), which tells a
   * refusal of the Tag role apart from one of the Group (#638). Answered as the Group's other
   * reads are: saved as one of its rows, and offline from that row, with its own time.
   */
  const readTags =
    (send: (signal?: AbortSignal) => Promise<unknown>) =>
    ({ queryKey }: QueryFunctionContext) => {
      const key = queryKey as QueryKey;
      noteStart(key);
      return engine.read({ key, accept: (value) => void tagsOf(value), send });
    };
  const paging = engine.paging({
    pagination: (key, value) =>
      pageOf(value, key[3] as string, currencyOf(key[3] as string)).pagination,
    failedMessage: (error) =>
      messageOf(error as Error, 'Could not load more expenses. Please try again.'),
    reopen: 'multiple-pages',
  });
  /** A Month's page: its Expense read invalidates figures, and wire pages check their number. */
  const readPage = (context: QueryFunctionContext<QueryKey, unknown>) => {
    const key = context.queryKey,
      groupId = key[3] as string,
      page = context.pageParam as number;
    noteStart(key);
    return paging
      .read(context, {
        before: (fresh) => session.expensesRead(groupId, fresh),
        accept: (value) => {
          if (pageOf(value, groupId, currencyOf(groupId)).pagination.page !== page)
            throw new Error('Unexpected expense page.');
        },
      })
      .then(noteRecentAnswer);
  };

  // Only what the view lacks is read on its own; the view's commands, the foreground, a
  // reconnect and the internet's return read in order, Group then Expenses then Balances.
  // A failed read stays until Retry, a pull or the next open; offline, also until recover (#678).
  const shared = engine.shared;
  const hasFreshRead = (key: QueryKey) => {
    const query = held(key);
    return !!query && !query.isStaleByTime(shared.staleTime(query));
  };
  const groupOptions = (groupId: string, fresh = false) => ({
    ...shared,
    queryKey: groupQueryKey(groupId),
    queryFn: readGroup,
    ...(fresh ? { staleTime: STALE } : {}),
  });
  const monthOptions = (groupId: string, month: string, fresh = false) => ({
    ...shared,
    queryKey: monthPageKey(groupId, month),
    queryFn: readMonth,
    ...(fresh ? { staleTime: STALE } : {}),
  });
  const balancesOptions = (groupId: string, enabled = true, fresh = false) => ({
    ...shared,
    queryKey: balancesKey(groupId),
    queryFn: readBalances,
    enabled,
    ...(fresh ? { staleTime: STALE } : {}),
  });
  const tripOptions = (key: QueryKey, fresh = false) => ({
    ...shared,
    queryKey: key,
    queryFn: readTrip,
    ...(fresh ? { staleTime: STALE } : {}),
  });
  /** A return's pages of this list, until a read has shown them again (from the route). */
  const rereadOf = (key: QueryKey) => {
    const at = session.route(),
      { financial } = session.snapshot();
    const expenses = 'reread' in at && at.reread?.groupId === key[3] ? at.reread.expenses : null;
    return expenses && financial.month === expenses.month && !shownRereads.has(expenses)
      ? expenses
      : null;
  };
  const listOptions = (key: QueryKey, fresh = false) => {
    const reread = rereadOf(key);
    // Read again from the window's first page: a return reads every page it left (#215), from
    // where the window began when a change removed the list (owner decision 1A).
    const start = reread?.first ?? 1;
    const first = stateOf<Pages>(key)?.data?.pageParams[0] ?? start;
    const pages = reread ? Math.max(1, reread.pages - first + 1) : undefined;
    return {
      ...shared,
      queryKey: key,
      queryFn: readPage,
      ...paging.options(key, start),
      ...(pages ? { pages } : {}),
      ...(fresh || (reread && reread.pages > 1) ? { staleTime: STALE } : {}),
    };
  };
  /**
   * The Month shown has settled well enough for Balances to follow it: read (or offline without
   * a saved copy), and not being read. A list a change removed, which nothing reads now (on
   * Balances), leaves no read for Balances to follow.
   */
  const listSettled = (key: QueryKey | null) => {
    if (!key) return false;
    const state = stateOf<Pages>(key);
    if (!state) return held(key)?.state.fetchStatus !== 'fetching';
    if (state.fetchStatus === 'fetching') return false;
    return state.status === 'success' || !!state.fetchMeta?.fetchMore || unreachable(state.error);
  };

  /**
   * Observed while the Group's view shows, and not once it refused the member. An observer reads
   * only what its query lacks, such as a query a change or a denial removed: Expenses only after
   * the Group's read, and Balances only after the Expenses of the Month shown, and outside the
   * view's own reads, which read them in order themselves.
   */
  const bind = () => {
    pending = false;
    const shown = onScreen();
    if (!shown || shown.sheet || !view || view.lost) return unbind();
    const { groupId } = view;
    // Not while the Group is read again, nor once that read failed: the view's figures stay as
    // they were, with their time, until the Group is read.
    const group = held(groupQueryKey(groupId))?.state;
    const after =
      shown.destination !== 'activity' &&
      view.checked &&
      group?.fetchStatus !== 'fetching' &&
      group?.status !== 'error';
    const list = after ? shownList() : null;
    // The Month's list is observed where it shows: on Balances, Balances follow its last read.
    const listed = shown.destination === 'expenses' ? list : null;
    const groupNext = groupOptions(groupId);
    if (observers.group) observers.group.setOptions(groupNext);
    else {
      const observer = new QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>(
        client,
        groupNext,
      );
      observers.group = observer;
      observer.subscribe(() => undefined);
    }
    if (listed) {
      const next = listOptions(listed);
      if (observers.list) observers.list.setOptions(next);
      else {
        const observer = new InfiniteQueryObserver<PageEnvelope, Error, Pages, QueryKey, number>(
          client,
          next,
        );
        observers.list = observer;
        observer.subscribe(() => undefined);
      }
    } else {
      observers.list?.destroy();
      observers.list = undefined;
    }
    if (after && !view.reading && listSettled(list)) {
      const next = balancesOptions(groupId);
      if (observers.balances) observers.balances.setOptions(next);
      else {
        const observer = new QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>(
          client,
          next,
        );
        observers.balances = observer;
        observer.subscribe(() => undefined);
      }
    } else {
      observers.balances?.destroy();
      observers.balances = undefined;
    }
    // A Trip's summary, where its All time card shows, follows the same Expense reads (#730).
    const trip = after && shown.destination === 'expenses' ? shownTrip() : null;
    if (trip && !view.reading && listSettled(list)) {
      const next = tripOptions(trip);
      if (observers.trip) observers.trip.setOptions(next);
      else {
        const observer = new QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>(
          client,
          next,
        );
        observers.trip = observer;
        observer.subscribe(() => undefined);
      }
    } else {
      observers.trip?.destroy();
      observers.trip = undefined;
    }
  };
  const unbind = () => {
    observers.group?.destroy();
    observers.list?.destroy();
    observers.balances?.destroy();
    observers.trip?.destroy();
    observers = {};
  };
  const bindLater = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      if (pending) bind();
    });
  };
  /**
   * The view as its queries now hold it: published only when that changes what shows; the
   * observers follow either way (#219).
   */
  const reproject = () => {
    const before = session.snapshot();
    if (project(before) !== before) session.publish({});
    else bindLater();
  };

  /**
   * The Month this open shows, once its Group (or a saved copy of it) is known: a Household's
   * Month stays as the member chose it, and starts at the one shown before or the current one.
   */
  const decide = (group: MobileGroup) => {
    if (!view || group.id !== view.groupId) return;
    const household = group.category === 'home';
    const { financial } = session.snapshot();
    const kept = view.household === household && financial.groupId === group.id;
    view.household = household;
    if (kept) return;
    const month = !household
      ? null
      : view.previousMonth === undefined
        ? monthKeyInZone(session.now(), session.timeZone())
        : view.previousMonth;
    if (financial.groupId !== group.id || financial.month !== month)
      session.publish({ financial: { ...financial, groupId: group.id, month } });
  };

  /**
   * A cancelled read may retry only while this open hasn't lost the Group (B7). This guard
   * belongs here: readGroup also serves other screens whose wanted callback may always be true.
   */
  const readNow = <T>(options: { queryKey: QueryKey }, owner: number, wanted: () => boolean) =>
    engine.readNow<T>(
      options,
      owner,
      () => wanted() && !(view?.groupId === options.queryKey[3] && view.lost),
    );
  /**
   * Waits until the Group's view reads nothing, including a read that replaced another. `group`:
   * a read of the Group itself counts too; a Month's own reads don't wait for one.
   */
  const settle = async (owner: number, { group = true } = {}) => {
    for (let round = 0; round < 1000; round += 1) {
      await Promise.resolve();
      const shown = onScreen();
      if (!session.current(owner) || !view || !shown) return;
      const list = shownList(),
        trip = shown.destination === 'expenses' ? shownTrip() : null;
      const busy = [
        group ? groupQueryKey(view.groupId) : null,
        list,
        balancesKey(view.groupId),
        trip,
      ]
        .map((key) => key && held(key))
        .find((query) => query?.state.fetchStatus === 'fetching');
      if (busy) {
        await busy.promise?.catch(() => undefined);
        await engine.settle(busy.queryKey as QueryKey);
        continue;
      }
      // Balances follow a list that just settled: their observer reads them now.
      const balanceState = stateOf(balancesKey(view.groupId));
      if (
        !shown.sheet &&
        shown.destination !== 'activity' &&
        view.checked &&
        !view.lost &&
        listSettled(list) &&
        (!balanceState || balanceState.status === 'pending')
      ) {
        bind();
        if (held(balancesKey(view.groupId))?.state.fetchStatus === 'fetching') continue;
      }
      // So does a Trip's summary (#730).
      const tripState = stateOf(trip);
      if (
        trip &&
        !shown.sheet &&
        view.checked &&
        !view.lost &&
        listSettled(list) &&
        (!tripState || tripState.status === 'pending')
      ) {
        bind();
        if (held(trip)?.state.fetchStatus === 'fetching') continue;
      }
      return;
    }
  };

  /**
   * While the Group is first read, what this device saved for its view shows, each part with its
   * own time: the Group, and when it lists the member, the Month's Expenses and Balances. Each
   * shows as its query takes it.
   */
  const preview = async (owner: number, opened: View) => {
    const key = groupQueryKey(opened.groupId);
    if (held(key)?.state.data === undefined) await restore(key, owner);
    const data = held<Envelope>(key)?.state.data;
    let group: MobileGroup | null = null;
    try {
      group = data ? groupOf(data.value) : null;
    } catch {
      group = null;
    }
    if (!group || !lists(group) || view !== opened || !session.current(owner)) return;
    decide(group);
    const list = shownList(),
      balances = balancesKey(opened.groupId),
      trip = onScreen()?.destination === 'expenses' ? shownTrip() : null;
    await Promise.all([
      list && held(list)?.state.data === undefined ? restore(list, owner) : null,
      held(balances)?.state.data === undefined ? restore(balances, owner) : null,
      trip && held(trip)?.state.data === undefined ? restore(trip, owner) : null,
    ]);
  };
  /**
   * The view's reads: the Group and the Expenses of the Month shown together, then Balances.
   * `fresh` reads each again (a pull, Retry or a change); otherwise a read verified within the
   * freshness window is reused. `from` starts at a later step, as a Month change does. A refusal
   * is thrown; any other failure shows on its section.
   */
  const read = async (owner: number, { fresh = false, from = 'group' as Step } = {}) => {
    const opened = view;
    if (!opened || opened.lost) return;
    const still = () => view === opened && !opened.lost && onScreen() !== null;
    opened.reading += 1;
    // Shown with the first of its reads to start, which says what is being read.
    let ended = false;
    try {
      ended = await steps(opened, owner, fresh, from, still);
    } finally {
      opened.reading -= 1;
      if (session.current(owner)) {
        reproject();
        session.readSettled?.();
      }
      // The internet returned while they ran: whether to read again waits until all have ended.
      if (!opened.reading && opened.recovering) {
        opened.recovering = false;
        if (view === opened) recover();
      }
    }
    // What its reads set off meanwhile, such as Balances read again after another Month's read.
    if (ended && session.current(owner) && view === opened && !onScreen()?.sheet)
      await settle(owner, { group: from === 'group' });
  };
  const recentRead = (groupId: string) => {
    const candidates: Envelope[] = client
      .getQueriesData<Pages | Envelope>({
        queryKey: listKey(groupId, false, null).slice(0, 4),
        predicate: ({ queryKey }) =>
          typeof queryKey[4] === 'string' &&
          queryKey[4].startsWith(`${groupPrefix(groupId)}/expenses?`),
      })
      .flatMap(([, data]) => {
        if (!data) return [];
        return 'pages' in data ? data.pages.filter((page) => page.source !== 'failed') : [data];
      });
    const order = (read: Envelope & { widgetRecentOrder?: number }) => read.widgetRecentOrder ?? 0;
    return (
      candidates
        .filter(
          (read) =>
            read.source === 'network' && parseExpensePageResponse(read.value).recent !== undefined,
        )
        .sort((a, b) => order(b) - order(a) || b.refreshedAt - a.refreshedAt)[0] ?? null
    );
  };
  const steps = async (
    opened: View,
    owner: number,
    fresh: boolean,
    from: Step,
    still: () => boolean,
  ): Promise<boolean> => {
    let recentMissing = false;
    if (from === 'group' && session.recentRequested) {
      try {
        recentMissing =
          (await session.recentRequested(opened.groupId)) && !recentRead(opened.groupId);
      } catch {
        // Widget metadata cannot prevent ordinary Group reads.
      }
      if (!still() || !session.current(owner)) return false;
    }
    const recentPage = (key: QueryKey) =>
      recentMissing &&
      (!queryKeyPath(key).includes('&dateFrom=') ||
        hashKey(key) ===
          hashKey(
            listKey(opened.groupId, true, monthKeyInZone(session.now(), session.timeZone())),
          ));
    /** A Month changed meanwhile reads its own list: this one isn't read again. */
    const sameMonth = (list: QueryKey) => () =>
      still() && hashKey(shownList() ?? []) === hashKey(list);
    /**
     * The Month's Expenses, read once: the read that began beside the Group, if it's this list.
     * That read isn't read again before the Group's check passes; one a change cancelled
     * meanwhile is read again then.
     */
    let early: { hash: string; reading: Promise<Pages> } | null = null;
    const readList = (list: QueryKey) => {
      const read = () =>
        readNow<Pages>(listOptions(list, fresh || recentPage(list)), owner, sameMonth(list));
      if (early?.hash !== hashKey(list)) return read();
      return early.reading.catch((error: unknown) => {
        if (error instanceof Superseded && opened.checked && sameMonth(list)()) return read();
        throw error;
      });
    };
    /** Balances, once the Expense reads of the Month shown have settled: they follow them. */
    const followBalances = async () => {
      // An Expense read of the Month shown is still running: Balances follow it there.
      if (!listSettled(shownList())) return false;
      // An Expense read of the Month shown that begins meanwhile reads Balances after it.
      const after = () => still() && listSettled(shownList());
      await readNow(balancesOptions(opened.groupId, true, fresh), owner, after).catch(
        (error: unknown) => {
          if (engine.refuses(error) || error instanceof Superseded) throw error;
        },
      );
      await followTrip();
      return true;
    };
    /**
     * A Trip's summary in the currency shown on its All time card, where that card shows (#730),
     * once the Expense reads of the Month shown have settled: it follows them, as Balances do.
     */
    const followTrip = async () => {
      const trip = onScreen()?.destination === 'expenses' ? shownTrip() : null;
      if (!trip || !opened.checked || !listSettled(shownList())) return;
      // A currency chosen meanwhile reads its own.
      const same = () => still() && hashKey(shownTrip() ?? []) === hashKey(trip);
      await readNow(tripOptions(trip, fresh), owner, same).catch((error: unknown) => {
        if (engine.refuses(error) || error instanceof Superseded) throw error;
      });
    };
    if (from === 'trip') {
      await followTrip();
      return still();
    }
    if (from === 'group') {
      const reading = readNow<Envelope>(
        groupOptions(opened.groupId, fresh),
        owner,
        () => view === opened && !opened.lost,
      );
      reading.catch(() => undefined);
      // With the Month known, from this view, a saved copy or the Groups list, its Expenses are
      // read beside the Group: neither waits for the other. They show only once the Group's check
      // passes (`projectExpenses`). Balances still follow both, since each read can add due
      // recurring Expenses (M1-5, AMEND-1).
      const beside = () => {
        const list = view === opened ? shownList() : null,
          shown = onScreen();
        if (!list || !shown || shown.destination === 'activity') return null;
        const listing = readNow<Pages>(
          listOptions(list, fresh || recentPage(list)),
          owner,
          () => opened.checked && sameMonth(list)(),
        );
        listing.catch(() => undefined);
        return { hash: hashKey(list), reading: listing };
      };
      // After a change written here (a confirmed save), the Month shown is read at once, not
      // after this phone's saved copies are looked up: on a phone each lookup waits its turn on
      // the account's storage, and the change has already removed the ledger's copies (#912).
      if (opened.change !== 0) early = beside();
      await preview(owner, opened).catch(() => undefined);
      const listed = session.snapshot().groups.data.find(({ id }) => id === opened.groupId);
      if (opened.household === null && listed && lists(listed)) decide(listed);
      early ??= beside();
      let answer: Envelope;
      try {
        answer = await reading;
      } catch (error) {
        // The Expense read beside it ends first: nothing this read began runs on after it. When
        // the Group fails, but not as a refusal, that read shows if the Group was checked before,
        // or if the server answered a request sent in this open, which proves the member belongs
        // (owner decision 2A, amending #180's Risk 5); one sent before it, which this read
        // joined, proves nothing about now. Balances then follow it; the Group's details show
        // the failure.
        const read = early;
        if (read) await read.reading.catch(() => undefined);
        const list = read && shownList();
        const pages = list && hashKey(list) === read.hash ? stateOf<Pages>(list) : undefined;
        const answered =
          pages?.status === 'success' &&
          !!pages.data &&
          answers.get(pages.data)?.open === opened.open;
        if (
          (opened.checked || answered) &&
          !engine.refuses(error) &&
          !(error instanceof Superseded) &&
          session.current(owner) &&
          still()
        ) {
          opened.checked = true;
          reproject();
          await followBalances().catch(() => undefined);
        }
        throw error;
      }
      if (!session.current(owner) || view !== opened || opened.lost) return false;
      opened.checked = true;
      decide(groupOf(answer.value));
      reproject();
    }
    const shown = onScreen();
    if (!shown || !opened.checked || shown.destination === 'activity') return false;
    const list = shownList();
    // Owner decision, 14 Nov 2026: every Theme reads the current Month. A Household
    // already showing it reuses its ordinary list. Other views keep their existing lens.
    const month = monthKeyInZone(session.now(), session.timeZone());
    const currentMonth = listKey(opened.groupId, true, month);
    const recentMonth =
      recentMissing && opened.household && session.snapshot().financial.month !== null;
    if (
      from === 'group' &&
      hashKey(currentMonth) !== hashKey(list ?? []) &&
      (fresh || recentMonth || !hasFreshRead(currentMonth))
    ) {
      try {
        await readNow<Envelope>(
          monthOptions(opened.groupId, month, fresh || recentMonth),
          owner,
          still,
        );
      } catch (error) {
        if (engine.refuses(error) || error instanceof Superseded) throw error;
      }
      if (!still() || !session.current(owner)) return false;
    }
    if (list && from !== 'balances') {
      const reread = rereadOf(list);
      try {
        await readList(list);
        if (reread) shownRereads.add(reread);
      } catch (error) {
        if (engine.refuses(error) || error instanceof Superseded) throw error;
        // Shown on Expenses, beside what was read before.
      }
      // A Month the member has left leaves Balances to the Month shown, which follows it.
      if (!session.current(owner)) return false;
      if (!sameMonth(list)()) return still();
    }
    return followBalances();
  };
  /**
   * The view on Expenses or Balances reads again what is past its stale time, in order, as the
   * foreground and a reconnect read it (M1-4, M1-6). Activity reads itself (#222).
   */
  const again = () => {
    const shown = onScreen();
    if (!shown || shown.sheet || shown.destination === 'activity' || !view || view.lost) return;
    void read(session.generation()).catch(() => undefined);
  };
  /**
   * The internet returned while the device stayed connected, so the online manager didn't change
   * (#678). A view that shows this phone's copy, or a read that failed offline, reads again once,
   * as on a reconnect: the offline banner, and the write rules it carries (#219), clear when that
   * read lands. A failure Splitbook answered stays until Retry, a pull or the next open. A read
   * under way may still end offline, so the view first waits for its reads to end.
   */
  const recover = () => {
    if (!view) return;
    if (view.reading) view.recovering = true;
    else if (session.offline()) again();
  };

  /** The Expenses shown for the Month, from their query, in the snapshot's shape. */
  const expensesFrom = (shown: Expenses, opened: View, financial: GroupFinancialState) => {
    const key = shownList(financial),
      state = stateOf<Pages>(key);
    if (!key) return shown;
    // A change written here removed the list it shows: until it is read again, the rows shown are
    // marked as being read, never as current beside the change's message (#219).
    if (!state)
      return opened.change !== 0 && shown.status === 'ready' && shown.month === financial.month
        ? same(shown, { ...shown, status: 'loading' as const })
        : shown;
    const groupId = opened.groupId,
      { month } = financial,
      data = state.data;
    const read = data?.pages.filter((page) => page.source !== 'failed') ?? [];
    const failed = data?.pages.find((page) => page.source === 'failed');
    let base: Expenses = shown.month === month ? shown : emptyExpenses(month);
    // Read beside the Group in this open, before its check passed: shown only once it has.
    const unchecked =
      !opened.checked && !!data && !previews.has(data) && state.dataUpdatedAt >= opened.since;
    if (read.length && !unchecked) {
      const parsed = read.map((page) => pageOf(page.value, groupId, currencyOf(groupId)));
      // A row read on two pages, as Expenses are added above it, is listed once; the rows shown
      // stay the same list when nothing in them changed, so an unchanged read publishes nothing.
      const rows = uniqueRows(
        parsed.map((page) => page.expenses),
        (row) => row.id,
        base.data,
      );
      base = {
        ...base,
        month,
        data: rows,
        summary: parsed[0].summary,
        pagination: parsed[parsed.length - 1].pagination,
        firstPage: read[0].page,
        // Never fresher than its oldest page (#215).
        refreshedAt: Math.min(...read.map((page) => page.refreshedAt)),
        // A page this device restored is never presented as read in this session (#219).
        restored: read.some((page) => page.source === 'saved'),
        moreStatus: failed ? 'error' : 'idle',
        moreMessage: failed?.message ?? null,
      };
    }
    const direction = state.fetchMeta?.fetchMore?.direction;
    if (state.fetchStatus === 'fetching') {
      if (direction === 'forward')
        return same(shown, { ...base, status: 'ready', moreStatus: 'loading', moreMessage: null });
      if (direction === 'backward')
        return same(shown, {
          ...base,
          status: 'ready',
          newerStatus: 'loading',
          newerMessage: null,
        });
      return same(shown, {
        ...base,
        status: 'loading',
        message: null,
        moreStatus: 'idle',
        moreMessage: null,
        newerStatus: 'idle',
        newerMessage: null,
      });
    }
    // Not checked by this open yet: a saved or earlier copy shows while the Group is read.
    if (!opened.checked || previews.has(data as object))
      return same(shown, { ...base, status: opened.reading ? 'loading' : 'idle', message: null });
    const error = failure(state);
    if (state.status === 'error' && !error) return shown;
    if (error && direction === 'forward')
      return same(shown, {
        ...base,
        status: 'ready',
        moreStatus: 'error',
        moreMessage: messageOf(error, 'Could not load more expenses. Please try again.'),
      });
    if (error && direction === 'backward')
      return same(shown, {
        ...base,
        status: 'ready',
        newerStatus: 'error',
        newerMessage: messageOf(error, 'Could not load newer expenses. Please try again.'),
      });
    if (error)
      return same(shown, {
        ...base,
        status: 'error',
        // Expenses still on screen: what is true of them, never "not saved" (#219, as #332).
        message:
          unreachable(error) && (base.summary !== null || base.data.length > 0)
            ? notKept.expenses
            : messageOf(error, 'Could not load expenses. Please try again.'),
      });
    return same(shown, {
      ...base,
      status: 'ready',
      message: null,
      newerStatus: 'idle',
      newerMessage: null,
    });
  };
  /**
   * The Expenses shown, and whether a change written in this Group made them out of date: they
   * weren't read since by a read begun after it (#219). The rows stay while they're read again,
   * and say so; Balances' `changed` is the same for their payments.
   */
  const projectExpenses = (shown: Expenses, opened: View, financial: GroupFinancialState) => {
    let next = expensesFrom(shown, opened, financial);
    const pages = stateOf<Pages>(shownList(financial))?.data;
    const changed =
      opened.change !== 0 && !(pages && (answers.get(pages)?.change ?? -1) >= opened.change);
    if ((next.changed ?? false) !== changed) next = { ...next, changed };
    return next;
  };
  /** The Group's all-time Balances, from their query, in the snapshot's shape. */
  const balancesFrom = (shown: Balances, opened: View, financial: GroupFinancialState) => {
    const state = stateOf<Envelope>(balancesKey(opened.groupId));
    const list = stateOf<Pages>(shownList(financial));
    // The Expense read Balances follow failed: they weren't read again after it.
    const behind =
      opened.checked &&
      list?.status === 'error' &&
      list.fetchStatus !== 'fetching' &&
      !list.fetchMeta?.fetchMore &&
      !!failure(list) &&
      !unreachable(list.error);
    if (!state) {
      // Not read since a change or a read that may have changed them removed their query: kept,
      // unverified, so none of their payments is offered until they're read again (#219).
      const kept = { ...shown, stale: shown.data !== null };
      if (behind)
        return same(shown, { ...kept, status: 'error' as const, message: balancesNotUpdated });
      if (!opened.reading && shown.status === 'loading')
        return same(shown, { ...kept, status: 'idle' as const });
      return same(shown, kept);
    }
    let figures: Balances['data'] = null;
    try {
      figures = state.data ? balancesOf(state.data.value) : null;
    } catch {
      figures = null;
    }
    // Whether they're this device's copy, as their time says: "Saved", never "Updated" (#219).
    const restored = state.data?.source === 'saved';
    const kept = figures ? { data: figures, refreshedAt: state.data!.refreshedAt, restored } : {};
    if (state.fetchStatus === 'fetching')
      return same(shown, {
        ...shown,
        ...kept,
        status: 'loading',
        message: null,
        stale: !figures && shown.data !== null,
      });
    if (!opened.checked || previews.has(state.data as object))
      return same(shown, {
        ...shown,
        ...kept,
        status: opened.reading ? 'loading' : 'idle',
        message: null,
        stale: false,
      });
    const error = failure(state);
    if (state.status === 'error' && !error) return shown;
    if (error)
      return same(shown, {
        ...shown,
        ...kept,
        status: 'error',
        // Balances still on screen: what is true of them, never "not saved" (#219, as #332).
        message:
          unreachable(error) && (figures ?? shown.data) !== null
            ? notKept.balances
            : messageOf(error, 'Could not load balances. Please try again.'),
      });
    return same(shown, {
      status: 'ready',
      data: figures,
      message: null,
      refreshedAt: state.data!.refreshedAt,
      stale: false,
      restored,
    });
  };
  /**
   * Out of date since a change written in this Group: no payment is offered until read (#219).
   * With no Group to show (owner decision 2A), they count as up to date only while the server's
   * answer to a read sent in this open shows, never a saved copy. The open is checked as 2A
   * checks the Expenses, as defence in depth: Balances read before this open can't show without
   * the Group, which stays once read.
   */
  const projectBalances = (shown: Balances, opened: View, financial: GroupFinancialState) => {
    let next = balancesFrom(shown, opened, financial);
    const changed = opened.change !== 0;
    if ((next.changed ?? false) !== changed) next = { ...next, changed };
    const data = stateOf<Envelope>(balancesKey(opened.groupId))?.data;
    const answered =
      held(groupQueryKey(opened.groupId))?.state.data === undefined &&
      next.status === 'ready' &&
      !!data &&
      answers.get(data)?.open === opened.open;
    if ((next.answeredThisOpen ?? false) !== answered)
      next = { ...next, answeredThisOpen: answered };
    return next;
  };
  /**
   * A Trip's summary in the currency shown, from its query (#730), as Balances are projected:
   * kept while it is read again, with its time, and this device's copy says so. Unset for any
   * Group whose All time card has no switch.
   */
  const projectTrip = (
    shown: TripSummaryState | undefined,
    opened: View,
    financial: GroupFinancialState,
  ): TripSummaryState | undefined => {
    const key = shownTrip(financial);
    if (!key) return undefined;
    const base = shown ?? noTrip;
    const state = stateOf<Envelope>(key);
    if (!state)
      // Not read yet in this currency, or removed by a change: read once the Expenses settle.
      return same(base, {
        ...base,
        status: opened.checked ? 'loading' : base.status,
        message: null,
        stale: base.data !== null,
      });
    let figures: TripSummaryRead | null = null;
    try {
      figures = state.data ? tripOf(state.data.value) : null;
    } catch {
      figures = null;
    }
    const restored = state.data?.source === 'saved';
    const kept = figures ? { data: figures, refreshedAt: state.data!.refreshedAt, restored } : {};
    if (state.fetchStatus === 'fetching' || !opened.checked || previews.has(state.data as object))
      return same(base, {
        ...base,
        ...kept,
        status: state.fetchStatus === 'fetching' || opened.reading ? 'loading' : 'idle',
        message: null,
        stale: !figures && base.data !== null,
      });
    const error = failure(state);
    if (state.status === 'error' && !error) return base;
    if (error)
      return same(base, {
        ...base,
        ...kept,
        status: 'error',
        // A currency this phone never read is no copy lost: it waits for a connection (#868).
        message:
          unreachable(error) && !figures && financial.trip?.chosen
            ? `Couldn’t load this trip’s figures in ${financial.trip.chosen}. Connect to see them.`
            : unreachable(error) && (figures ?? base.data) !== null
              ? notKept.trip
              : messageOf(error, 'Could not load this trip’s figures. Please try again.'),
      });
    return same(base, {
      ...base,
      status: 'ready',
      data: figures,
      message: null,
      refreshedAt: state.data!.refreshedAt,
      stale: false,
      restored,
    });
  };
  /** The Group as its query holds it, in the snapshot's shape. */
  const projectDetail = (shown: MobileSnapshot['detail'], opened: View) => {
    const state = stateOf<Envelope>(groupQueryKey(opened.groupId));
    if (!state) return shown;
    let group: MobileGroup | null = null;
    try {
      group = state.data ? groupOf(state.data.value) : null;
    } catch {
      group = null;
    }
    const known =
      group && group.id === opened.groupId && lists(group)
        ? {
            data: group,
            refreshedAt: state.data!.refreshedAt,
            // This device's copy: the offline banner says what's shown was saved (#219).
            restored: state.data!.source === 'saved',
          }
        : {};
    if (state.fetchStatus === 'fetching' || (!opened.checked && opened.reading))
      return same(shown, { ...shown, ...known, status: 'loading', message: null });
    const error = failure(state);
    if (state.status === 'error' && !error) return shown;
    // The Group still on screen: what is true of it, never "not saved" (#219, as #332).
    const kept = 'data' in known ? known.data : shown.data;
    if (error)
      return same(shown, {
        ...shown,
        ...known,
        status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
        message:
          unreachable(error) && kept
            ? notKept.group(kept.name)
            : messageOf(error, 'The server returned invalid group data. Please try again.'),
      });
    if (!('data' in known) || (previews.has(state.data as object) && !opened.checked)) return shown;
    return same(shown, { ...shown, ...known, status: 'ready', message: null });
  };
  /** The Group's view, projected from its queries into `next`. */
  const project = (next: MobileSnapshot): MobileSnapshot => {
    const opened = view;
    // Only where the Group's view shows: on it, the Record payment sheet over it, and Members.
    if (
      !opened ||
      next.auth.status !== 'authenticated' ||
      !['group', 'settlement', 'members'].includes(next.screen) ||
      next.detail.id !== opened.groupId
    )
      return next;
    const detail = projectDetail(next.detail, opened);
    let { financial } = next;
    if (
      next.screen !== 'members' &&
      financial.groupId === opened.groupId &&
      opened.household !== null
    ) {
      const expenses = projectExpenses(financial.expenses, opened, financial);
      const balances = projectBalances(financial.balances, opened, financial);
      const trip = projectTrip(financial.trip, opened, { ...financial, expenses });
      if (
        expenses !== financial.expenses ||
        balances !== financial.balances ||
        trip !== financial.trip
      ) {
        financial = { ...financial, expenses, balances };
        if (trip) financial.trip = trip;
        else delete financial.trip;
      }
    }
    return detail === next.detail && financial === next.financial
      ? next
      : { ...next, detail, financial };
  };
  return {
    project,
    /** The existing Group open survives destination switches; a later open owns its own tasks. */
    ownsView() {
      const opened = view;
      return () => view === opened;
    },
    shownKeys(next: MobileSnapshot): QueryKey[] {
      if (
        !view ||
        view.lost ||
        !['group', 'members', 'settlement'].includes(next.screen) ||
        view.groupId !== (next.screen === 'settlement' ? next.settlement.groupId : next.detail.id)
      )
        return [];
      const keys = [groupQueryKey(view.groupId)];
      if (
        next.screen !== 'members' &&
        !(next.screen === 'group' && next.destination === 'activity')
      ) {
        keys.push(balancesKey(view.groupId));
        const list = shownList(next.financial);
        if (list) keys.push(list);
        const trip =
          next.screen === 'group' && next.destination === 'expenses'
            ? shownTrip(next.financial)
            : null;
        if (trip) keys.push(trip);
      }
      return keys;
    },
    /** After the publish that showed the view, and what runs in the same turn (a denial's purge). */
    bindLater,
    /**
     * The observers take their queries again: removing a query never tells them (module-4 brief
     * F5), so they move to the new ones, which read what they lack.
     */
    rebind: () => {
      if (!observers.group) return;
      engine.rebind(bind);
    },
    /**
     * The member opens this Group's view, or the view on screen is read again (`again`). A new
     * open checks the Group again before its Expenses and Balances read, or show as current; the
     * Month shown before (`previousMonth`) is kept for the same Group.
     */
    open(
      groupId: string,
      { again, previousMonth }: { again: boolean; previousMonth?: string | null },
    ) {
      if (again && view?.groupId === groupId && !view.lost) return;
      view = {
        groupId,
        checked: false,
        lost: false,
        reading: 0,
        recovering: false,
        household: null,
        previousMonth,
        since: Date.now(),
        open: ++opens,
        // A change still to be read stays so when its Group opens again.
        change: view?.groupId === groupId ? view.change : 0,
      };
      // A Group opened anew lists each Month from its newest page, as a return or a refresh of
      // the view on screen never does: their pages beyond it go from memory (#215).
      for (const query of client.getQueryCache().getAll()) {
        const key = query.queryKey as QueryKey;
        if (key[3] === groupId && isList(key)) paging.reopen(key);
      }
      // A Group read earlier shows its Month at once.
      const data = held<Envelope>(groupQueryKey(groupId))?.state.data;
      try {
        const group = data ? groupOf(data.value) : null;
        if (group && lists(group)) decide(group);
      } catch {
        // Decided when the Group lands.
      }
    },
    read,
    settle,
    /**
     * The Group's query as this view reads it, for another screen that shows the Group (an
     * Expense, #220): one key per resource, read and saved one way.
     */
    groupOptions: (groupId: string) => groupOptions(groupId),
    /**
     * The Group's currencies as its Currencies read them (#722): read as every view reads, saved
     * as one of the Group's rows, and offline answered from that row with its own time. Each open
     * reads them again.
     */
    currenciesOptions: (groupId: string) => ({
      ...shared,
      queryKey: groupCurrenciesKey(session.account(), groupId),
      queryFn: readCurrencies,
      staleTime: STALE,
    }),
    /**
     * A currency added to the Group answered with its currencies (#722): they stand verified now,
     * and are saved as the read's row.
     */
    currenciesAnswered(groupId: string, value: unknown) {
      const key = groupCurrenciesKey(session.account(), groupId);
      const verified: Envelope = { source: 'network', refreshedAt: Date.now(), value };
      client.setQueryData(key, verified, { updatedAt: verified.refreshedAt });
      engine.save(key, { owner: session.generation(), owns: queryOwner(client, key) }, verified);
      return verified;
    },
    /** The Group's currencies in their read, as its Currencies show them. */
    currenciesOf,
    /**
     * The query function for the Group's Tags (#638): its answers are saved as the Group's
     * `tag-actions` row, retired with its other rows, and answer for it offline.
     */
    tagsQuery: (send: (signal?: AbortSignal) => Promise<unknown>) => readTags(send),
    /**
     * This phone's saved Tags of a Group, checked as an offline answer is: never a copy a change,
     * a denial or a failed removal made obsolete, nor one it can't read (#638). Null without one.
     */
    async savedTags(groupId: string) {
      if (!session.lease() || !rows) return null;
      const key = tagActionsKey(session.account(), groupId);
      const copy = await engine.saved(key);
      return copy ? { refreshedAt: copy.refreshedAt, tags: tagsOf(copy.value).tags } : null;
    },
    /**
     * Load more: the next older page. Past 5 pages the window slides and the newest page drops; a
     * page that couldn't be read before is read again, in its place.
     */
    async loadMore(owner: number) {
      const key = shownList();
      if (!onScreen() || !key || !view?.checked) return;
      if (
        (await paging.older(key, () => {
          bind();
          return observers.list;
        })) === false
      )
        return;
      await settle(owner);
    },
    /** Load newer: the page before the window, which drops its oldest page. */
    async loadNewer(owner: number) {
      const key = shownList();
      if (!onScreen() || !key || !view?.checked) return;
      if (
        (await paging.newer(key, () => {
          bind();
          return observers.list;
        })) === false
      )
        return;
      await settle(owner);
    },
    /**
     * The member left a Month before a return's pages of it showed: its list goes, with the read
     * of those pages, so the Month reads from its first page when it shows again (#215).
     */
    dropReturn(reread: object & { month: string | null }) {
      if (!view || view.household === null || shownRereads.has(reread)) return;
      shownRereads.add(reread);
      client.removeQueries({
        queryKey: listKey(view.groupId, view.household, reread.month),
        exact: true,
      });
    },
    /**
     * The Record payment sheet read the Group's Balances live, after its own check of the Group:
     * kept with their actual query owner, for `adoptSheetBalances`.
     */
    sheetBalances(groupId: string, value: unknown) {
      sheetRead = {
        groupId,
        owner: session.generation(),
        owns: queryOwner(client, balancesKey(groupId)),
        refreshedAt: Date.now(),
        value,
      };
    },
    /**
     * Closing the sheet: when its Balances are the ones the view shows, and nothing has read the
     * Group or its Expenses since, they stand verified then, in place of a read (M1-5). Newer
     * ones, or a payment that may be recorded, are read again.
     */
    adoptSheetBalances(groupId: string) {
      const read = sheetRead,
        key = balancesKey(groupId);
      sheetRead = null;
      if (
        read?.groupId !== groupId ||
        !session.current(read.owner) ||
        !read.owns() ||
        stateOf(key)?.data !== undefined
      )
        return;
      const verified: Envelope = {
        source: 'network',
        refreshedAt: read.refreshedAt,
        value: read.value,
      };
      client.setQueryData(key, verified, { updatedAt: read.refreshedAt });
      engine.save(key, { owner: read.owner, owns: read.owns }, verified);
    },
    /**
     * This open of the Group's view has passed its check of the Group, and hasn't lost it since:
     * what another destination reads beside the Group shows from now on (#222).
     */
    checked: (groupId: string) => !!view && view.groupId === groupId && view.checked && !view.lost,
    recentRead,
    /** A Month summary already read by the app, carrying the time of that page's own read. */
    monthRead(groupId: string, month: string) {
      const key = listKey(groupId, true, month);
      const pages = stateOf<Pages>(key)?.data?.pages;
      const listed = pages?.find((page) => page.source !== 'failed');
      const separate = stateOf<Envelope>(monthPageKey(groupId, month))?.data;
      const showingCurrent = hashKey(shownList() ?? []) === hashKey(key);
      const read =
        showingCurrent || hasFreshRead(key) ? (listed ?? separate) : (separate ?? listed);
      return read ? { month, read } : null;
    },
    /** The first page of the Month's window shown for this Group: past 1 once it has slid. */
    firstPage(groupId: string) {
      const key = view?.groupId === groupId ? shownList() : null;
      return stateOf<Pages>(key)?.data?.pageParams[0] ?? 1;
    },
    /**
     * Reads the Group for another screen (an Expense, Members, an Activity event), joining a read
     * in flight; `fresh: false` reuses one verified within the freshness window.
     */
    async readGroup(
      groupId: string,
      owner: number,
      {
        fresh = true,
        wanted = (): boolean => true,
      }: { fresh?: boolean; wanted?: () => boolean } = {},
    ) {
      return (await readNow<Envelope>(groupOptions(groupId, fresh), owner, wanted)).value;
    },
    /**
     * A change was written in this Group, or may have been: its Balances wait to be read. Returns
     * the change's count, which `listedSince` compares reads with.
     */
    changed(groupId: string) {
      const change = ++changes;
      if (view?.groupId === groupId) view.change = change;
      return change;
    },
    /**
     * Whether the Expenses `financial` shows were read from the server by a read begun after
     * `change` (#219); never while the change isn't known yet (`Infinity`). The comparison with
     * the change is defence in depth, not the guard: the change removes the Group's lists
     * (`ledgerChanged`) before anything publishes, so a list shown after it was read after it,
     * and no test can tell this comparison from a looser one.
     */
    listedSince(groupId: string, financial: GroupFinancialState, change: number) {
      const key = view?.groupId === groupId ? shownList(financial) : null,
        pages = key && held<Pages>(key)?.state.data;
      return !!pages && (answers.get(pages)?.change ?? -1) >= change;
    },
    /**
     * The member lost this Group: its view reads and observes nothing more, so a removed query's
     * observer can't read it back, and a late answer lands nowhere.
     */
    lose(groupId: string) {
      if (view?.groupId !== groupId) return;
      view.lost = true;
      view.checked = false;
      unbind();
    },
    /**
     * Removes these rows of a Group, inside a lease write: a lost Group's (`group`), or a ledger
     * change's (`ledger`). It never waits for the saved-copy queue: a row written meanwhile goes
     * once it lands.
     */
    forget: (accountId: string, groupId: string, scope: GroupRows) =>
      engine.forget(accountId, groupId, scope),
    /** Keeps only these Groups' rows: a Groups list from the server left the others out. */
    retain: engine.retain,
    /**
     * Returning to the foreground and reconnecting (M1-4, M1-6): the Group's view on screen reads
     * again what is past its stale time, in order. Answers publish wherever they land, and are
     * saved as rows. Returns what stops listening.
     */
    listen(focus: typeof focusManager, online: typeof onlineManager) {
      const stops = [
        engine.listen(),
        client.getQueryCache().subscribe((event) => {
          // Invalidation changes preview eligibility, not the content a response projects.
          if (event.type !== 'updated' || event.action.type === 'invalidate') return;
          const { query } = event,
            key = query.queryKey as QueryKey;
          // A Group's view owns its Group, its Balances, its Months' Expenses, a Trip's summary
          // (#730) and its Currencies (#722), whoever reads them.
          if (!ownsKey(key)) return;
          if (event.action.type === 'success' && !event.action.manual) {
            // An Expense list or Balances read from the server: when its read began, by its data
            // (#219).
            const data = query.state.data as Pages | Envelope | undefined,
              start = query.promise && starts.get(query.promise);
            const fromServer = isList(key)
              ? (data as Pages | undefined)?.pages.every((page) => page.source !== 'saved')
              : key[0] === 'balances' && (data as Envelope | undefined)?.source === 'network';
            if (data && start && fromServer) answers.set(data, start);
          }
          if (!view || key[3] !== view.groupId) return;
          if (client.getQueryCache().get(query.queryHash) !== query) return;
          // Balances read from the server, by a read begun after the latest change written here:
          // payments are offered again.
          const answered = query.state.data as Envelope | undefined,
            start = query.promise && starts.get(query.promise);
          if (
            key[0] === 'balances' &&
            view.change !== 0 &&
            event.action.type === 'success' &&
            answered?.source === 'network' &&
            start &&
            start.change >= view.change
          )
            view.change = 0;
          const before = session.snapshot();
          if (project(before) !== before) session.publish({});
          if (observers.group)
            queueMicrotask(() => {
              if (observers.group) bind();
            });
        }),
        focus.subscribe((focused) => focused && again()),
        online.subscribe((connected) => connected && again()),
      ];
      return () => stops.forEach((stop) => stop());
    },
    /** The internet returned on the connection the device kept (#678): Home's NetInfo says so. */
    recover,
    /** Settles once no saved copy is being written. */
    idle: engine.idle,
    /** The session ended (M10-2): nothing waiting is written, nothing is observed. */
    reset() {
      unbind();
      engine.reset();
      view = null;
    },
  };
}
