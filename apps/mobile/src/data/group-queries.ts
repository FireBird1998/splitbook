import {
  CancelledError,
  hashKey,
  InfiniteQueryObserver,
  QueryObserver,
  replaceEqualDeep,
  type focusManager,
  type InfiniteData,
  type onlineManager,
  type Query,
  type QueryClient,
  type QueryFunctionContext,
  type QueryState,
} from '@tanstack/query-core';
import { currentMonthKey, getLocalMonthIsoRange } from '@splitbook/shared/date';
import {
  expensePageKey,
  groupBalancesKey,
  groupKey,
  queryKeyPath,
  type QueryAccount,
  type QueryKey,
} from '@splitbook/shared/query-keys';
import type { AccountGroupRecordStore } from './account-record-storage';
import { objectId, parseGroup } from './dto';
import { parseExpensePage, parseGroupBalances } from './financial-dto';
import { createSavedCopyQueue, notSaved, type Envelope } from './home-queries';
import { cachedRead } from './offline-cache';
import { RequestError, Superseded } from './transport';
import type {
  AccountStorageLease,
  GroupDestination,
  GroupFinancialState,
  MobileGroup,
  MobileSnapshot,
  Route,
} from './types';

/**
 * A page of a Group's Expenses as its query holds it: the server's page with its own time (a
 * saved copy keeps the time it was verified), or `failed`, a page that couldn't be read after the
 * ones before it, which ends the list there and is what Load more reads next.
 */
export type PageEnvelope =
  | (Envelope & { page: number })
  | { source: 'failed'; page: number; refreshedAt: number; value: null; message: string };
type Pages = InfiniteData<PageEnvelope, number>;
/**
 * A list read again keeps each page that answered the same, matched by its number, not its place:
 * after the window slides, the pages that stayed keep their rows, which then render as they were
 * (#219). TanStack shares by position, which a dropped page would shift.
 */
const sharePages = (old: unknown, next: unknown): unknown => {
  const before = old as Pages | undefined,
    after = next as Pages;
  if (!before?.pages || !after?.pages) return next;
  const pages = after.pages.map((page, index) => {
    const at = before.pageParams.indexOf(after.pageParams[index]);
    return at < 0 ? page : (replaceEqualDeep(before.pages[at], page) as PageEnvelope);
  });
  const pageParams = replaceEqualDeep(before.pageParams, after.pageParams);
  return pageParams === before.pageParams &&
    pages.length === before.pages.length &&
    pages.every((page, index) => page === before.pages[index])
    ? before
    : { pages, pageParams };
};
type Expenses = GroupFinancialState['expenses'];
type Balances = GroupFinancialState['balances'];

/** A page holds 20 Expenses; a list keeps at most 5 pages, 100 rows, and slides past them (M1-3). */
const PAGE_SIZE = 20;
export const MAX_PAGES = 5;
/** A stale time that is stale whatever the clock says, even moved back past a read. */
const STALE = -Infinity;
const notSavedHere = 'Could not save this view for offline use. Online data is still available.';
const balancesNotUpdated = 'Could not update balances. Please try again.';

/** One parse per answer (and currency): structural sharing keeps an unchanged answer the same. */
const parsedGroups = new WeakMap<object, MobileGroup>();
const groupOf = (value: unknown) => {
  const known = parsedGroups.get(value as object);
  if (known) return known;
  const group = parseGroup(value);
  parsedGroups.set(value as object, group);
  return group;
};
type ExpensePage = ReturnType<typeof parseExpensePage>;
const parsedPages = new WeakMap<object, Map<string, ExpensePage>>();
const pageOf = (value: unknown, groupId: string, currency: string) => {
  const byGroup = parsedPages.get(value as object) ?? new Map<string, ExpensePage>();
  parsedPages.set(value as object, byGroup);
  const known = byGroup.get(`${groupId}:${currency}`);
  if (known) return known;
  const page = parseExpensePage(value, groupId, currency);
  byGroup.set(`${groupId}:${currency}`, page);
  return page;
};
const parsedBalances = new WeakMap<object, ReturnType<typeof parseGroupBalances>>();
const balancesOf = (value: unknown) => {
  const known = parsedBalances.get(value as object);
  if (known) return known;
  const balances = parseGroupBalances(value);
  parsedBalances.set(value as object, balances);
  return balances;
};

/** `shown` again when nothing in `next` differs from it, so an unchanged read publishes nothing. */
const same = <T extends object>(shown: T, next: T): T =>
  (Object.keys(next) as (keyof T)[]).every((field) => shown[field] === next[field]) ? shown : next;
/** A refusal or failure, unless it's no answer at all (the read was superseded). */
const failure = (state: QueryState<unknown, Error>) =>
  state.status !== 'error' || state.error instanceof Superseded ? null : state.error;
/** The server couldn't be reached, and this device has no saved copy of the view. */
const unreachable = (error: unknown) =>
  error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';
const refused = (error: unknown): error is RequestError =>
  error instanceof RequestError && [403, 404].includes(error.status);
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
    : path.startsWith(`${prefix}/expenses?`) || path === `${prefix}/balances`;
};
/**
 * The paths of the persister's rows for this account: those it lists, so rows saved before this
 * session count too, and those named in `known`, for a store that can't list its rows. Only the
 * keys are read where the store can, so a row that can't be read never stops a removal.
 */
const rowPaths = async (
  rows: AccountGroupRecordStore,
  accountId: string,
  known: Iterable<string> = [],
) => {
  const paths = new Set(known);
  const listed = rows.keys
    ? await rows.keys(accountId)
    : ((await rows.list?.(accountId)) ?? []).map(({ groupId }) => groupId);
  for (const path of listed) paths.add(path);
  return paths;
};
/**
 * Removes a Group's saved copies from the persister's rows (M3-1): every row of the Group, or
 * only those a ledger change makes obsolete (each Month's Expenses and its Balances).
 */
export async function removeGroupRows(
  rows: AccountGroupRecordStore | undefined,
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
  rows?: AccountGroupRecordStore;
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
  versionOf(key: QueryKey): number;
  /** Saved copies of `key` verified at or before this are never shown (see `HomeSession`). */
  distrusted(key: QueryKey, early: boolean): number;
  /** Whether this device keeps saved copies of this read's Group (a listed Group). */
  savable(key: QueryKey): boolean;
  /** How long a verified read is reused without reading it again. */
  freshness: number;
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
}

/**
 * A read of a query: whether its request answered, and when it ends. `abort` cancels its request
 * once its query is removed (a change or a denial made it obsolete); leaving the view never does.
 */
type Run = {
  answered: boolean;
  reading: Promise<unknown>;
  abort?: AbortController;
  before?: Promise<unknown>;
  ended?: boolean;
};
/** This open of a Group view, until the member opens another. */
interface View {
  groupId: string;
  /** This open's check of the Group passed: its Expenses and Balances can be read and shown. */
  checked: boolean;
  /** The Group refused the member during this open: nothing more is read until it opens again. */
  lost: boolean;
  /** Reads of this open (or a refresh of it) are running. */
  reading: number;
  /** Whether the Group is a Household, once known: only a Household has a Month to show. */
  household: boolean | null;
  /** The Month shown before, kept when this Group opens again; undefined for a first open. */
  previousMonth: string | null | undefined;
  /** When this open began: what its reads answer before its check of the Group waits for it. */
  since: number;
  /**
   * The latest change written in this Group that its Balances haven't been read after (0: none).
   * Counted, not timed, so a clock moved back never holds them (#219).
   */
  change: number;
}
type Step = 'group' | 'expenses' | 'balances';

/**
 * A Group's own view on declarative queries (ADR 0006, M1-1; #219): the Group, its Expenses for
 * the chosen Month as one query of up to 5 pages, and its Balances. While the Group's view shows,
 * their observers keep them active: a query they lack is read, including one a change or a
 * denial removed, so Balances read again after every read of the Group or its Expenses (M1-5).
 * Reads keep today's order, Group then Expenses then Balances, and the snapshot's `detail` and
 * `financial` are projected from them in today's shape. Their saved copies are the persister's
 * rows, one per query, in the wire JSON (M3-1), written on a saved-copy queue (M3-2) and
 * restored with their own time, never fresh (AMEND-2).
 */
export function createGroupQueries(session: GroupSession) {
  const { client, rows } = session;
  const queue = createSavedCopyQueue();
  /** Each query's latest read, by query hash. */
  const runs = new Map<string, Run>();
  /** Each fetch's start, by its promise: whose session and which version of its scope it read. */
  const starts = new WeakMap<object, { owner: number; version: number; change: number }>();
  /** How many changes have been written, or may have been, in this session's Group views. */
  let changes = 0;
  /** How many pages each fetch of an Expense list has read so far, by its promise. */
  const pagesRead = new WeakMap<object, number>();
  /** Data restored from this device to show while the view is first read: never verified here. */
  const previews = new WeakSet<object>();
  /** How often `forget` removed each Group's rows, by scope: a row written meanwhile goes too. */
  const forgotten = new Map<string, number>();
  /** The rows this session saved or restored: removable even by a store that can't list rows. */
  const known = new Set<string>();
  /** The requests each query is reading, cancelled once that query is removed. */
  const reading = new WeakMap<object, Set<AbortController>>();
  /** The returns whose pages a read has shown again. */
  const shownRereads = new WeakSet<object>();
  let view: View | null = null;
  let observers: {
    group?: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>;
    list?: InfiniteQueryObserver<PageEnvelope, Error, Pages, QueryKey, number>;
    balances?: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>;
  } = {};
  let pending = false;
  /** The observers are taking the queries a change removed: their reads replace cancelled ones. */
  let rebinding = false;
  /** The Record payment sheet's latest live read of its Group's Balances (`sheetBalances`). */
  let sheetRead: {
    groupId: string;
    owner: number;
    version: number;
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
      ...(household && month ? getLocalMonthIsoRange(month) : {}),
    });
  /** A page of it, with the page first, as Android has always sent it. */
  const pagePath = (key: QueryKey, page: number) =>
    queryKeyPath(key).replace('/expenses?', `/expenses?page=${page}&`);
  const isList = (key: QueryKey) => queryKeyPath(key).includes('/expenses?');

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
  const readable = (key: QueryKey, value: unknown) => {
    try {
      if (key[0] === 'group') return lists(groupOf(value));
      if (key[0] === 'balances') return Boolean(balancesOf(value));
      return Boolean(pageOf(value, key[3] as string, currencyOf(key[3] as string)));
    } catch {
      return false;
    }
  };
  /** The persister's row for `path`, read on the account queue, checked like every saved copy. */
  const savedRow = async (lease: AccountStorageLease, path: string) =>
    cachedRead(
      await lease.write(() => rows!.load(lease.accountId, path)),
      lease.accountId,
      path,
      session.now(),
    );
  /** How often each scope that reaches `key`'s rows has been removed. */
  const removals = (key: QueryKey) => {
    const groupId = key[3] as string;
    return `${forgotten.get(`${groupId}:group`) ?? 0}:${
      key[0] === 'group' ? 0 : (forgotten.get(`${groupId}:ledger`) ?? 0)
    }`;
  };

  /**
   * Saves an answer as its row on the saved-copy queue, where a newer answer replaces it: the
   * Group, its Balances, or one page of a Month's list (`page`). The session, the account, the
   * read's version and whether its Group is kept here are checked at write time, so nothing lands
   * after sign-out, an account change, a change or a denial.
   */
  const saveRow = (
    key: QueryKey,
    { owner, version }: { owner: number; version: number },
    { refreshedAt, value }: { refreshedAt: number; value: unknown },
    page?: number,
  ) => {
    const lease = session.lease(),
      path = page === undefined ? queryKeyPath(key) : pagePath(key, page);
    if (!lease || !rows) return;
    queue.push(path, async () => {
      if (!session.current(owner) || !session.owns(lease.accountId)) return;
      if (version !== session.versionOf(key) || !session.savable(key)) return;
      const { accountId } = lease,
        before = removals(key),
        row = {
          version: 1,
          accountId,
          path,
          groupId: key[3],
          refreshedAt,
          value,
        };
      known.add(path);
      await rows.save(accountId, path, row).catch(() => {
        const { offline } = session.snapshot();
        if (session.current(owner))
          session.publish({ offline: { ...offline, message: notSavedHere } });
      });
      // Removed while it was being written: it goes too, since `forget` never waits for it.
      if (removals(key) !== before) await rows.remove(accountId, path);
    });
  };
  /**
   * While the view is first read, the row this device saved for a query shows, with its own
   * time (a Month's first page, for its list). Never one a change, a denial or a failed removal
   * made obsolete, one it can't read, and never once a read of it answered.
   */
  const restore = async (key: QueryKey, owner: number) => {
    const lease = session.lease(),
      version = session.versionOf(key),
      started = runs.get(hashKey(key));
    if (!lease || !rows) return;
    const list = isList(key);
    const row = await savedRow(lease, list ? pagePath(key, 1) : queryKeyPath(key)).catch(
      () => null,
    );
    const latest = runs.get(hashKey(key));
    if (
      !row ||
      (latest && (latest !== started || latest.answered)) ||
      !session.current(owner) ||
      version !== session.versionOf(key) ||
      held(key)?.state.data !== undefined ||
      row.refreshedAt <= session.distrusted(key, true) ||
      !readable(key, row.value)
    )
      return;
    const copy = savedCopy(row);
    const data = list ? { pages: [{ ...copy, page: 1 }], pageParams: [1] } : copy;
    previews.add(data);
    known.add(row.path);
    client.setQueryData(key, data);
  };
  /**
   * Records a query's read, and its fetch's start, so its answer is saved only while current. A
   * read that replaces one a change cancelled waits for that one's request to end (`before`), with
   * what its answer set off (a refusal, a session), as Home's reads do.
   */
  const track = (key: QueryKey, run: Run) => {
    const query = held(key),
      previous = runs.get(hashKey(key));
    if (rebinding && previous && !previous.ended) run.before = previous.reading;
    runs.set(hashKey(key), run);
    void Promise.resolve()
      .then(() => run.reading)
      .catch(() => undefined)
      .finally(() => (run.ended = true));
    if (query) {
      run.abort = new AbortController();
      const running = reading.get(query) ?? new Set<AbortController>();
      reading.set(query, running.add(run.abort));
    }
    if (query?.promise && !starts.has(query.promise))
      starts.set(query.promise, {
        owner: session.generation(),
        version: session.versionOf(key),
        change: changes,
      });
    return query;
  };
  /** A saved copy as its query holds it, with the time it was verified. */
  const savedCopy = (row: { refreshedAt: number; value: unknown }): Envelope => ({
    source: 'saved',
    refreshedAt: row.refreshedAt,
    value: row.value,
  });
  /**
   * One read of `path`: sends it, or when SplitBook can't be reached, answers with the row saved
   * here for that path and its own time, offline (M4-5). `accept` checks an answer before it is
   * kept. Only its query's removal cancels it, never leaving the view: an answer still current
   * shows wherever it lands.
   */
  const fetchOne = async (
    key: QueryKey,
    path: string,
    run: Run,
    accept: (value: unknown) => Promise<void> | void,
  ): Promise<Envelope> => {
    if (run.before) await run.before.catch(() => undefined);
    const owner = session.generation(),
      version = session.versionOf(key),
      lease = session.lease();
    const obsolete = () => !session.current(owner) || version !== session.versionOf(key);
    let value: unknown;
    try {
      value = await session.read(path, owner, run.abort?.signal);
      run.answered = true;
    } catch (error) {
      run.answered = true;
      if (!(error instanceof RequestError) || !error.networkFailure || !lease || !rows) throw error;
      const row = obsolete() ? null : await savedRow(lease, path).catch(() => null);
      // Overtaken by a change, a denial or a Groups list: it is read again, not shown.
      if (obsolete()) throw new Superseded();
      const saved =
        row && row.refreshedAt > session.distrusted(key, false) && readable(key, row.value)
          ? row
          : null;
      session.answered(path, saved?.refreshedAt ?? null);
      if (!saved)
        throw new RequestError(notSaved, 0, 'OFFLINE_UNAVAILABLE', false, null, 'network');
      return savedCopy(saved);
    }
    if (obsolete()) throw new Superseded();
    await accept(value);
    if (obsolete()) throw new Superseded();
    session.answered(path);
    return { source: 'network', refreshedAt: Date.now(), value };
  };

  /** The Group. One that no longer lists the member is refused, as the server refuses one. */
  const readGroup = ({ queryKey }: QueryFunctionContext) => {
    const key = queryKey as QueryKey,
      groupId = key[3] as string,
      run: Run = { answered: false, reading: Promise.resolve() };
    track(key, run);
    run.reading = (async () => {
      if (!objectId.safeParse(groupId).success)
        throw new RequestError('This group is no longer available.', 404);
      return fetchOne(key, queryKeyPath(key), run, async (value) => {
        const group = groupOf(value);
        if (group.id === groupId && lists(group)) return;
        // As for a refusal from the server: what was read and saved for it goes too.
        await session.lose(groupId, session.generation());
        throw new RequestError('You no longer have access to this group.', 403);
      });
    })();
    return run.reading as Promise<Envelope>;
  };
  const readBalances = ({ queryKey }: QueryFunctionContext) => {
    const key = queryKey as QueryKey,
      run: Run = { answered: false, reading: Promise.resolve() };
    track(key, run);
    run.reading = fetchOne(key, queryKeyPath(key), run, (value) => void balancesOf(value));
    return run.reading as Promise<Envelope>;
  };
  /**
   * A page of a Month's Expenses. When a later page of a read can't be read, the list ends there
   * (`failed`), keeping the pages read before it; offline, the page's saved copy answers for it.
   */
  const readPage = (context: QueryFunctionContext<QueryKey, unknown>) => {
    const key = context.queryKey,
      groupId = key[3] as string,
      page = context.pageParam as number,
      run: Run = { answered: false, reading: Promise.resolve() };
    const query = track(key, run);
    const fetch = query?.promise ?? {};
    const index = pagesRead.get(fetch) ?? 0;
    pagesRead.set(fetch, index + 1);
    const more = Boolean(query?.state.fetchMeta?.fetchMore);
    session.expensesRead(groupId, index === 0 && !more);
    run.reading = (async (): Promise<PageEnvelope> => {
      try {
        const answer = await fetchOne(key, pagePath(key, page), run, (value) => {
          if (pageOf(value, groupId, currencyOf(groupId)).pagination.page !== page)
            throw new Error('Unexpected expense page.');
        });
        return { ...answer, page };
      } catch (error) {
        if (
          index === 0 ||
          more ||
          refused(error) ||
          error instanceof Superseded ||
          (error instanceof RequestError && error.kind === 'cancelled')
        )
          throw error;
        return {
          source: 'failed',
          page,
          refreshedAt: Date.now(),
          value: null,
          message: messageOf(error as Error, 'Could not load more expenses. Please try again.'),
        };
      }
    })();
    return run.reading as Promise<PageEnvelope>;
  };

  /** Fresh for the display freshness window: never a saved copy, never while offline. */
  const staleTime = (query: { state: { data?: unknown; dataUpdatedAt: number } }) => {
    const data = query.state.data as Envelope | Pages | undefined;
    const network = !data
      ? false
      : 'pages' in data
        ? data.pages.every((page) => page.source === 'network')
        : data.source === 'network';
    return network && !session.offline() && query.state.dataUpdatedAt <= Date.now()
      ? session.freshness
      : STALE;
  };
  // Only what the view lacks is read on its own; the view's own reads, the foreground and a
  // reconnect read in order, Group then Expenses then Balances.
  const shared = {
    staleTime,
    // A read that failed shows its failure until Retry, a pull or the next open reads it again.
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  } as const;
  const groupOptions = (groupId: string, fresh = false) => ({
    ...shared,
    queryKey: groupQueryKey(groupId),
    queryFn: readGroup,
    ...(fresh ? { staleTime: STALE } : {}),
  });
  const balancesOptions = (groupId: string, enabled = true, fresh = false) => ({
    ...shared,
    queryKey: balancesKey(groupId),
    queryFn: readBalances,
    enabled,
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
      initialPageParam: start,
      getNextPageParam: (last: PageEnvelope) => {
        if (last.source === 'failed') return undefined;
        const { pagination } = pageOf(last.value, key[3] as string, currencyOf(key[3] as string));
        return pagination.page < pagination.totalPages ? pagination.page + 1 : undefined;
      },
      getPreviousPageParam: (_first: PageEnvelope, _all: PageEnvelope[], param: number) =>
        param > 1 ? param - 1 : undefined,
      maxPages: MAX_PAGES,
      structuralSharing: sharePages,
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
  };
  const unbind = () => {
    observers.group?.destroy();
    observers.list?.destroy();
    observers.balances?.destroy();
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
        ? currentMonthKey(new Date(session.now()))
        : view.previousMonth;
    if (financial.groupId !== group.id || financial.month !== month)
      session.publish({ financial: { ...financial, groupId: group.id, month } });
  };

  /** Reads a query now, joining a read in flight; one a change cancels is read again. */
  const readNow = async <T>(
    options: { queryKey: QueryKey },
    owner: number,
    wanted: () => boolean,
  ): Promise<T> => {
    const hash = hashKey(options.queryKey);
    for (;;) {
      if (!session.current(owner)) throw new Superseded();
      const reading = (
        'getNextPageParam' in options
          ? client.fetchInfiniteQuery(options as never)
          : client.fetchQuery(options as never)
      ) as Promise<T>;
      const run = runs.get(hash);
      try {
        return await reading;
      } catch (error) {
        if (!(error instanceof CancelledError)) throw error;
        // The request ends first, so whatever its answer set off has finished: a session that
        // ended, or a Group whose refusal is this read's answer. An answer a change made
        // obsolete is read again while the view still shows it.
        const answer = await run?.reading.then(
          () => null,
          (cause: unknown) => cause,
        );
        if (!session.current(owner)) throw new Superseded();
        if (answer instanceof RequestError && answer.kind !== 'cancelled') throw answer;
        if (!wanted() || (view?.groupId === options.queryKey[3] && view.lost))
          throw new Superseded();
      }
    }
  };
  /**
   * Waits until the Group's view reads nothing, including a read that replaced another. `group`:
   * a read of the Group itself counts too; a Month's own reads don't wait for one.
   */
  const settle = async (owner: number, { group = true } = {}) => {
    for (let round = 0; round < 1000; round += 1) {
      await Promise.resolve();
      const shown = onScreen();
      if (!session.current(owner) || !view || !shown) return;
      const list = shownList();
      const busy = [group ? groupQueryKey(view.groupId) : null, list, balancesKey(view.groupId)]
        .map((key) => key && held(key))
        .find((query) => query?.state.fetchStatus === 'fetching');
      if (busy) {
        await busy.promise?.catch(() => undefined);
        await runs.get(busy.queryHash)?.reading.catch(() => undefined);
        continue;
      }
      // Balances follow a list that just settled: their observer reads them now.
      if (
        !shown.sheet &&
        shown.destination !== 'activity' &&
        view.checked &&
        !view.lost &&
        listSettled(list) &&
        !stateOf(balancesKey(view.groupId))
      ) {
        bind();
        if (held(balancesKey(view.groupId))?.state.fetchStatus === 'fetching') continue;
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
      balances = balancesKey(opened.groupId);
    await Promise.all([
      list && held(list)?.state.data === undefined ? restore(list, owner) : null,
      held(balances)?.state.data === undefined ? restore(balances, owner) : null,
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
      if (session.current(owner)) reproject();
    }
    // What its reads set off meanwhile, such as Balances read again after another Month's read.
    if (ended && session.current(owner) && view === opened && !onScreen()?.sheet)
      await settle(owner, { group: from === 'group' });
  };
  const steps = async (
    opened: View,
    owner: number,
    fresh: boolean,
    from: Step,
    still: () => boolean,
  ): Promise<boolean> => {
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
      const read = () => readNow<Pages>(listOptions(list, fresh), owner, sameMonth(list));
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
          if (refused(error) || error instanceof Superseded) throw error;
        },
      );
      return true;
    };
    if (from === 'group') {
      const reading = readNow<Envelope>(
        groupOptions(opened.groupId, fresh),
        owner,
        () => view === opened && !opened.lost,
      );
      reading.catch(() => undefined);
      await preview(owner, opened).catch(() => undefined);
      // With the Month known, from this view, a saved copy or the Groups list, its Expenses are
      // read beside the Group: neither waits for the other. They show only once the Group's check
      // passes (`projectExpenses`). Balances still follow both, since each read can add due
      // recurring Expenses (M1-5, AMEND-1).
      const listed = session.snapshot().groups.data.find(({ id }) => id === opened.groupId);
      if (opened.household === null && listed && lists(listed)) decide(listed);
      const list = view === opened ? shownList() : null,
        shown = onScreen();
      if (list && shown && shown.destination !== 'activity') {
        const listing = readNow<Pages>(
          listOptions(list, fresh),
          owner,
          () => opened.checked && sameMonth(list)(),
        );
        early = { hash: hashKey(list), reading: listing };
        early.reading.catch(() => undefined);
      }
      let answer: Envelope;
      try {
        answer = await reading;
      } catch (error) {
        // The Expense read beside it ends first: nothing this read began runs on after it. When
        // the Group fails, but not as a refusal, that read shows if the Group was checked before,
        // or if the server answered it in this open, which proves the member belongs (owner
        // decision 2A, amending #180's Risk 5). Balances then follow it; the Group's details
        // show the failure.
        const read = early;
        if (read) await read.reading.catch(() => undefined);
        const list = read && shownList();
        const pages = list && hashKey(list) === read.hash ? stateOf<Pages>(list) : undefined;
        const answered =
          pages?.status === 'success' &&
          pages.dataUpdatedAt >= opened.since &&
          pages.data?.pages[0]?.source === 'network';
        if (
          (opened.checked || answered) &&
          !refused(error) &&
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
    if (list && from !== 'balances') {
      const reread = rereadOf(list);
      try {
        await readList(list);
        if (reread) shownRereads.add(reread);
      } catch (error) {
        if (refused(error) || error instanceof Superseded) throw error;
        // Shown on Expenses, beside what was read before.
      }
      // A Month the member has left leaves Balances to the Month shown, which follows it.
      if (!session.current(owner)) return false;
      if (!sameMonth(list)()) return still();
    }
    return followBalances();
  };

  /** The Expenses shown for the Month, from their query, in the snapshot's shape. */
  const projectExpenses = (shown: Expenses, opened: View, financial: GroupFinancialState) => {
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
      const rows = [
        ...new Map(parsed.flatMap((page) => page.expenses).map((row) => [row.id, row])).values(),
      ];
      const kept =
        rows.length === base.data.length && rows.every((row, index) => row === base.data[index]);
      base = {
        ...base,
        month,
        data: kept ? base.data : rows,
        summary: parsed[0].summary,
        pagination: parsed[parsed.length - 1].pagination,
        firstPage: read[0].page,
        // Never fresher than its oldest page (#215).
        refreshedAt: Math.min(...read.map((page) => page.refreshedAt)),
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
        message: messageOf(error, 'Could not load expenses. Please try again.'),
      });
    return same(shown, {
      ...base,
      status: 'ready',
      message: null,
      newerStatus: 'idle',
      newerMessage: null,
    });
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
    const kept = figures ? { data: figures, refreshedAt: state.data!.refreshedAt } : {};
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
        message: messageOf(error, 'Could not load balances. Please try again.'),
      });
    return same(shown, {
      status: 'ready',
      data: figures,
      message: null,
      refreshedAt: state.data!.refreshedAt,
      stale: false,
    });
  };
  /** Out of date since a change written in this Group: no payment is offered until read (#219). */
  const projectBalances = (shown: Balances, opened: View, financial: GroupFinancialState) => {
    const next = balancesFrom(shown, opened, financial),
      changed = opened.change !== 0;
    return (next.changed ?? false) === changed ? next : { ...next, changed };
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
        ? { data: group, refreshedAt: state.data!.refreshedAt }
        : {};
    if (state.fetchStatus === 'fetching' || (!opened.checked && opened.reading))
      return same(shown, { ...shown, ...known, status: 'loading', message: null });
    const error = failure(state);
    if (state.status === 'error' && !error) return shown;
    if (error)
      return same(shown, {
        ...shown,
        ...known,
        status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
        message: messageOf(error, 'The server returned invalid group data. Please try again.'),
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
      if (expenses !== financial.expenses || balances !== financial.balances)
        financial = { ...financial, expenses, balances };
    }
    return detail === next.detail && financial === next.financial
      ? next
      : { ...next, detail, financial };
  };
  /** A fetch that answered with data from the server: saved as its row while still current. */
  const saveAnswer = (query: Query) => {
    if (client.getQueryCache().get(query.queryHash) !== query) return;
    const start = query.promise && starts.get(query.promise);
    const data = query.state.data as Envelope | Pages | undefined;
    if (!start || !data) return;
    const key = query.queryKey as QueryKey;
    // A Month's list: each page read from the server, as its own row with its own time.
    if ('pages' in data) {
      for (const page of data.pages)
        if (page.source === 'network') saveRow(key, start, page, page.page);
    } else if (data.source === 'network') saveRow(key, start, data);
  };

  return {
    project,
    /** After the publish that showed the view, and what runs in the same turn (a denial's purge). */
    bindLater,
    /**
     * The observers take their queries again: removing a query never tells them (module-4 brief
     * F5), so they move to the new ones, which read what they lack.
     */
    rebind: () => {
      if (!observers.group) return;
      rebinding = true;
      try {
        bind();
      } finally {
        rebinding = false;
      }
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
        household: null,
        previousMonth,
        since: Date.now(),
        // A change still to be read stays so when its Group opens again.
        change: view?.groupId === groupId ? view.change : 0,
      };
      // A Group opened anew lists each Month from its newest page, as a return or a refresh of
      // the view on screen never does: their pages beyond it go from memory (#215).
      for (const query of client.getQueryCache().getAll()) {
        const key = query.queryKey as QueryKey,
          pages = query.state.data as Pages | undefined;
        if (key[3] !== groupId || !isList(key) || !pages || pages.pages.length < 2) continue;
        if (pages.pageParams[0] === 1 && query.state.fetchStatus !== 'fetching')
          client.setQueryData<Pages>(
            key,
            { pages: pages.pages.slice(0, 1), pageParams: [1] },
            { updatedAt: query.state.dataUpdatedAt },
          );
        else client.removeQueries({ queryKey: key, exact: true });
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
     * Load more: the next older page. Past 5 pages the window slides and the newest page drops; a
     * page that couldn't be read before is read again, in its place.
     */
    async loadMore(owner: number) {
      const key = shownList(),
        state = stateOf<Pages>(key);
      if (!onScreen() || !key || !state?.data || state.fetchStatus === 'fetching' || !view?.checked)
        return;
      const { pages, pageParams } = state.data;
      const last = pages[pages.length - 1];
      if (last.source === 'failed')
        client.setQueryData<Pages>(
          key,
          { pages: pages.slice(0, -1), pageParams: pageParams.slice(0, -1) },
          { updatedAt: held(key)?.state.dataUpdatedAt },
        );
      else {
        const { pagination } = pageOf(last.value, key[3] as string, currencyOf(key[3] as string));
        if (pagination.page >= pagination.totalPages) return;
      }
      bind();
      await observers.list?.fetchNextPage({ cancelRefetch: false });
      await settle(owner);
    },
    /** Load newer: the page before the window, which drops the window's oldest page. */
    async loadNewer(owner: number) {
      const key = shownList(),
        state = stateOf<Pages>(key);
      if (
        !onScreen() ||
        !key ||
        !state?.data ||
        state.fetchStatus === 'fetching' ||
        !view?.checked ||
        (state.data.pageParams[0] ?? 1) <= 1
      )
        return;
      bind();
      await observers.list?.fetchPreviousPage({ cancelRefetch: false });
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
     * kept with the version of their scope then, for `adoptSheetBalances`.
     */
    sheetBalances(groupId: string, value: unknown) {
      sheetRead = {
        groupId,
        owner: session.generation(),
        version: session.versionOf(balancesKey(groupId)),
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
        read.version !== session.versionOf(key) ||
        stateOf(key)
      )
        return;
      const verified: Envelope = {
        source: 'network',
        refreshedAt: read.refreshedAt,
        value: read.value,
      };
      client.setQueryData(key, verified, { updatedAt: read.refreshedAt });
      saveRow(key, { owner: read.owner, version: read.version }, verified);
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
    /** A change was written in this Group, or may have been: its Balances wait to be read. */
    changed(groupId: string) {
      if (view?.groupId === groupId) view.change = ++changes;
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
    async forget(accountId: string, groupId: string, scope: GroupRows) {
      if (!rows) return;
      forgotten.set(`${groupId}:${scope}`, (forgotten.get(`${groupId}:${scope}`) ?? 0) + 1);
      await removeGroupRows(rows, accountId, groupId, scope, known);
    },
    /** Keeps only these Groups' rows: a Groups list from the server left the others out. */
    async retain(accountId: string, listed: string[]) {
      if (!rows) return;
      const keep = new Set(listed);
      for (const path of await rowPaths(rows, accountId, known)) {
        const id = /^\/api\/groups\/([a-f\d]{24})(?:\/|\?|$)/i.exec(path)?.[1];
        if (!id || keep.has(id)) continue;
        forgotten.set(`${id}:group`, (forgotten.get(`${id}:group`) ?? 0) + 1);
        await rows.remove(accountId, path);
      }
    },
    /**
     * Returning to the foreground and reconnecting (M1-4, M1-6): the Group's view on screen reads
     * again what is past its stale time, in order. Answers publish wherever they land, and are
     * saved as rows. Returns what stops listening.
     */
    listen(focus: typeof focusManager, online: typeof onlineManager) {
      // Activity reads itself on the foreground (#222); the Group's view on Expenses or Balances
      // reads here.
      const again = () => {
        const shown = onScreen();
        if (!shown || shown.sheet || shown.destination === 'activity' || !view || view.lost) return;
        void read(session.generation()).catch(() => undefined);
      };
      const stops = [
        client.getQueryCache().subscribe((event) => {
          // A removed query's requests are obsolete: they are cancelled, never offline (#214).
          if (event.type === 'removed') {
            reading.get(event.query)?.forEach((abort) => abort.abort());
            return;
          }
          if (event.type !== 'updated') return;
          const { query } = event,
            key = query.queryKey as QueryKey;
          // A Group's view owns its Group, its Balances and its Months' Expenses, whoever reads them.
          if (key[0] !== 'group' && key[0] !== 'balances' && !(key[0] === 'ledger' && isList(key)))
            return;
          if (event.action.type === 'success' && !event.action.manual) saveAnswer(query);
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
    /** Settles once no saved copy is being written. */
    idle: () => queue.idle(),
    /** The session ended (M10-2): nothing waiting is written, nothing is observed. */
    reset() {
      unbind();
      queue.cancel();
      runs.clear();
      view = null;
    },
  };
}
