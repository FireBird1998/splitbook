import {
  CancelledError,
  hashKey,
  InfiniteQueryObserver,
  type focusManager,
  type InfiniteData,
  type onlineManager,
  type Query,
  type QueryClient,
  type QueryFunctionContext,
  type QueryState,
} from '@tanstack/query-core';
import { activityPagePath } from '@splitbook/shared/api-paths';
import {
  expenseRecordKey,
  groupActivityKey,
  queryKeyPath,
  type QueryAccount,
  type QueryKey,
} from '@splitbook/shared/query-keys';
import type { FindableRecordStore } from './account-record-storage';
import {
  activityExpenseId,
  emptyActivity,
  parseActivityExpense,
  parseActivityPage,
  type ActivityEvent,
  type ActivityState,
} from './activity';
import { parseGroup } from './dto';
import { MAX_PAGES, rowPaths, sharePages, STALE, type PageEnvelope } from './group-queries';
import { createSavedCopyQueue, notSaved, type Envelope } from './home-queries';
import { cachedRead } from './offline-cache';
import { RequestError, Superseded } from './transport';
import type { AccountStorageLease, MobileSnapshot, Route } from './types';

type Pages = InfiniteData<PageEnvelope, number>;
type Target = ActivityState['target'];

/** A page holds 20 events; Activity keeps at most 5 pages, 100 events, and slides (M1-3, M7-2). */
const PAGE_SIZE = 20;
const notSavedHere = 'Could not save this view for offline use. Online data is still available.';
/** A failed refresh keeps the events shown, and says what that means (unchanged from main). */
const refreshFailed =
  'Could not refresh Activity. Previously loaded events may be stale. A missing event does not mean the ledger change failed.';
/**
 * What stays on screen when SplitBook can't be reached and this phone keeps no copy to show
 * instead: removed by a change, withheld (#323) or never saved (#222, as #219 and #332 say it).
 */
const notKept =
  'Couldn’t refresh this Group’s activity, and this phone no longer keeps a copy of it. A missing event does not mean the ledger change failed.';
const olderFailed = 'Couldn’t load older activity.';
/** Nothing shown, and a failure SplitBook answered that says nothing itself. */
const loadFailed = 'Could not load Activity. Please try again.';

/** One parse per answer: structural sharing keeps an unchanged page, and its events, the same. */
const parsedPages = new WeakMap<object, Map<string, ReturnType<typeof parseActivityPage>>>();
const pageOf = (value: unknown, groupId: string, page: number) => {
  const byScope = parsedPages.get(value as object) ?? new Map();
  parsedPages.set(value as object, byScope);
  const scope = `${groupId}:${page}`;
  const known = byScope.get(scope);
  if (known) return known;
  const parsed = parseActivityPage(value, groupId, page);
  byScope.set(scope, parsed);
  return parsed;
};
/** An event's Expense as the record's answer says it is now: one per answer. */
const targets = new WeakMap<object, Target>();
const none: Target = { status: 'none' },
  checking: Target = { status: 'loading' },
  unavailable: Target = { status: 'unavailable' },
  failed: Target = { status: 'error' };

/** `shown` again when nothing in `next` differs from it, so an unchanged read publishes nothing. */
const same = <T extends object>(shown: T, next: T): T =>
  (Object.keys(next) as (keyof T)[]).every((field) => shown[field] === next[field]) &&
  Object.keys(shown).length === Object.keys(next).length
    ? shown
    : next;
const failure = (state: QueryState<unknown, Error>) =>
  state.status !== 'error' || state.error instanceof Superseded ? null : state.error;
/** The server couldn't be reached, and this device has no saved copy of the page. */
const unreachable = (error: unknown) =>
  error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';
const refused = (error: unknown): error is RequestError =>
  error instanceof RequestError && [403, 404].includes(error.status);
/** A row of a Group's Activity page, never an Expense's history. */
const ownRow = (path: string, groupId: string) =>
  path.startsWith(`/api/groups/${groupId}/activity?page=`);
/**
 * Removes every saved page of a Group's Activity from the persister's rows (M3-1): after a
 * change, on losing the Group, and at the next start for those this device couldn't remove
 * (#212, #323).
 */
export async function removeActivityRows(
  rows: FindableRecordStore | undefined,
  accountId: string,
  groupId: string,
  known: Iterable<string> = [],
) {
  if (!rows) return;
  for (const path of await rowPaths(rows, accountId, known))
    if (ownRow(path, groupId)) await rows.remove(accountId, path);
}

/** What a Group's Activity needs from the session that owns it: the controller. */
export interface ActivitySession {
  client: QueryClient;
  /** The persister's rows (M3-1); without them nothing is saved or restored. */
  rows?: FindableRecordStore;
  account(): QueryAccount;
  generation(): number;
  current(owner: number): boolean;
  snapshot(): MobileSnapshot;
  publish(next: Partial<MobileSnapshot>): void;
  route(): Route;
  lease(): AccountStorageLease | null;
  owns(accountId: string): boolean;
  versionOf(key: QueryKey): number;
  distrusted(key: QueryKey, early: boolean): number;
  distrust(accountId: string, scopes: string[]): void;
  savable(key: QueryKey): boolean;
  freshness: number;
  offline(): boolean;
  read(path: string, owner: number, signal?: AbortSignal): Promise<unknown>;
  answered(path: string, saved?: number | null): void;
  now(): number;
  /** This open of the Group's view has passed its check of the Group (#219): reads show. */
  checked(groupId: string): boolean;
  /** Reads the Group's own query (#219), joining a read in flight. */
  readGroup(
    groupId: string,
    owner: number,
    options: { fresh: boolean; wanted: () => boolean },
  ): Promise<unknown>;
  /** Reads an Expense's record query (#220, D4), joining a read in flight. */
  readRecord(
    groupId: string,
    expenseId: string,
    owner: number,
    wanted: () => boolean,
  ): Promise<unknown>;
  /** The Group refused the member on a read this view made: what it shows goes. */
  refused(groupId: string, error: RequestError): void;
}

/** A read of a query: whether its request answered, and when it ends (as for a Group's view). */
type Run = {
  answered: boolean;
  reading: Promise<unknown>;
  abort?: AbortController;
  before?: Promise<unknown>;
  ended?: boolean;
};
/** An event opened from the list: what it says, and the check of the Expense it names. */
interface Detail {
  event: ActivityEvent;
  expenseId: string | null;
  reading: boolean;
  failure: Target | null;
}
/** This open of the Group's Activity, until the member opens another Group or this one again. */
interface View {
  groupId: string;
  /** The Group refused the member during this open: nothing more is read or shown. */
  lost: boolean;
  /** When this open began: a network answer from before its Group check passed isn't shown. */
  since: number;
  /** Reads of this open running, or waiting for the Group read they follow. */
  reading: number;
  detail: Detail | null;
}

/**
 * A Group's Activity on declarative queries (ADR 0006, M1-1; #222): one query of up to 5 pages
 * per Group that slides past them (M1-3, M7-2), with Load newer. While Activity shows, its
 * observer keeps the query active: a query a change or a denial removed is read again, and the
 * foreground and a reconnect read it again only once it is stale (M1-6, M1-4). Its read starts
 * with its Group's, except a Household's, which follows the Group (owner decision, 2026-10-06);
 * what the server answers shows once this open's check of the Group passes, and a refusal drops
 * it. Its saved copies are the persister's rows, one per page, in the wire JSON (M3-1), written
 * on a saved-copy queue (M3-2) and restored with their own time, never fresh (AMEND-2). An event's
 * detail reads the Group's query (#219) and the Expense's record query (#220).
 */
export function createActivityQueries(session: ActivitySession) {
  const { client, rows } = session;
  const queue = createSavedCopyQueue();
  const runs = new Map<string, Run>();
  /** Each fetch's start, by its promise: whose session, and which version of its scope. */
  const starts = new WeakMap<object, { owner: number; version: number }>();
  /** How many pages each fetch has read so far, by its promise. */
  const pagesRead = new WeakMap<object, number>();
  /** How many events the first page of each fetch counted, by its promise. */
  const firstTotals = new WeakMap<object, number>();
  /** Data restored from this device to show while the Group is first read: never verified here. */
  const previews = new WeakSet<object>();
  /**
   * Data a read answered: from the server, or this device's copy once SplitBook couldn't be
   * reached. A restored copy the read answered the same keeps its object (structural sharing),
   * and is then no longer only a preview.
   */
  const answers = new WeakSet<object>();
  /** Restored to show while the Group is first read, and not answered by a read since. */
  const previewed = (data: unknown) =>
    !!data && previews.has(data as object) && !answers.has(data as object);
  /** How often `forget` removed each Group's rows: a row being written meanwhile goes too. */
  const forgotten = new Map<string, number>();
  /** The rows this session saved or restored: removable even by a store that can't list rows. */
  const known = new Set<string>();
  const reading = new WeakMap<object, Set<AbortController>>();
  /** The returns whose pages a read has shown again. */
  const shownRereads = new WeakSet<object>();
  /** Reads still running, which `settle` waits for. */
  const running = new Set<Promise<unknown>>();
  let view: View | null = null;
  let observer: InfiniteQueryObserver<PageEnvelope, Error, Pages, QueryKey, number> | undefined;
  let pending = false;
  let rebinding = false;

  const held = <T>(key: QueryKey) => client.getQueryCache().get<T, Error>(hashKey(key));
  /** A query's state once it holds something: one an observer only created holds nothing. */
  const stateOf = <T>(key: QueryKey | null) => {
    const query = key && held<T>(key);
    return query &&
      (query.state.data !== undefined ||
        query.state.fetchStatus === 'fetching' ||
        query.state.status === 'error')
      ? query.state
      : undefined;
  };
  const activityKey = (groupId: string) => groupActivityKey(session.account(), groupId, PAGE_SIZE);
  const pagePath = (key: QueryKey, page: number) =>
    activityPagePath(key[3] as string, { page, limit: PAGE_SIZE });
  const isActivity = (key: QueryKey) =>
    key[0] === 'ledger' && key.length === 5 && /\/activity\?limit=\d+$/.test(queryKeyPath(key));
  const readable = (key: QueryKey, value: unknown, page: number) => {
    try {
      return Boolean(pageOf(value, key[3] as string, page));
    } catch {
      return false;
    }
  };
  const savedRow = async (lease: AccountStorageLease, path: string) =>
    cachedRead(
      await lease.write(() => rows!.load(lease.accountId, path)),
      lease.accountId,
      path,
      session.now(),
    );
  const removals = (key: QueryKey) => forgotten.get(key[3] as string) ?? 0;
  const savedCopy = (row: { refreshedAt: number; value: unknown }): Envelope => ({
    source: 'saved',
    refreshedAt: row.refreshedAt,
    value: row.value,
  });

  /** Activity on screen for this open: the Group's view on its Activity destination. */
  const onScreen = () => {
    const at = session.route();
    return (
      !!view &&
      !view.lost &&
      session.snapshot().auth.status === 'authenticated' &&
      at.screen === 'group' &&
      at.destination === 'activity' &&
      at.groupId === view.groupId
    );
  };

  /**
   * Saves one page of an answer as its row on the saved-copy queue, where a newer answer
   * replaces it. The session, the account, the read's version and whether its Group is kept here
   * are checked at write time, so nothing lands after sign-out, an account change, a change or a
   * denial.
   */
  const saveRow = (
    key: QueryKey,
    { owner, version }: { owner: number; version: number },
    { refreshedAt, value }: { refreshedAt: number; value: unknown },
    page: number,
  ) => {
    const lease = session.lease(),
      path = pagePath(key, page);
    if (!lease || !rows) return;
    queue.push(path, async () => {
      if (!session.current(owner) || !session.owns(lease.accountId)) return;
      if (version !== session.versionOf(key) || !session.savable(key)) return;
      const { accountId } = lease,
        before = removals(key);
      known.add(path);
      await rows
        .save(accountId, path, { version: 1, accountId, path, groupId: key[3], refreshedAt, value })
        .catch(() => {
          const { offline } = session.snapshot();
          if (session.current(owner))
            session.publish({ offline: { ...offline, message: notSavedHere } });
        });
      // Removed while it was being written: it goes too, since `forget` never waits for it. One
      // that can't go is no longer trusted (#323).
      if (removals(key) !== before)
        await rows
          .remove(accountId, path)
          .catch(() => session.distrust(accountId, [`ledger:${key[3]}`]));
    });
  };
  /**
   * While Activity is first read, its newest page saved on this device shows, with its own time.
   * Never one a change, a denial or a failed removal made obsolete, one it can't read, and never
   * once a read of it answered.
   */
  const restore = async (key: QueryKey, owner: number) => {
    const lease = session.lease(),
      version = session.versionOf(key),
      started = runs.get(hashKey(key));
    if (!lease || !rows) return;
    const row = await savedRow(lease, pagePath(key, 1)).catch(() => null);
    const latest = runs.get(hashKey(key));
    if (
      !row ||
      (latest && (latest !== started || latest.answered)) ||
      !session.current(owner) ||
      version !== session.versionOf(key) ||
      held(key)?.state.data !== undefined ||
      row.refreshedAt <= session.distrusted(key, true) ||
      !readable(key, row.value, 1)
    )
      return;
    const data: Pages = { pages: [{ ...savedCopy(row), page: 1 }], pageParams: [1] };
    previews.add(data);
    known.add(row.path);
    client.setQueryData(key, data);
  };
  /** Records a read, and its fetch's start, so its answer is saved only while current. */
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
      const reads = reading.get(query) ?? new Set<AbortController>();
      reading.set(query, reads.add(run.abort));
    }
    if (query?.promise && !starts.has(query.promise))
      starts.set(query.promise, {
        owner: session.generation(),
        version: session.versionOf(key),
      });
    return query;
  };
  /**
   * One read of a page: sends it, or when SplitBook can't be reached, answers with the row saved
   * here for that page and its own time, offline (M4-5). Only its query's removal cancels it.
   */
  const fetchOne = async (key: QueryKey, page: number, run: Run): Promise<Envelope> => {
    if (run.before) await run.before.catch(() => undefined);
    const owner = session.generation(),
      version = session.versionOf(key),
      lease = session.lease(),
      path = pagePath(key, page);
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
        row && row.refreshedAt > session.distrusted(key, false) && readable(key, row.value, page)
          ? row
          : null;
      session.answered(path, saved?.refreshedAt ?? null);
      if (!saved)
        throw new RequestError(notSaved, 0, 'OFFLINE_UNAVAILABLE', false, null, 'network');
      return savedCopy(saved);
    }
    if (obsolete()) throw new Superseded();
    pageOf(value, key[3] as string, page);
    session.answered(path);
    return { source: 'network', refreshedAt: Date.now(), value };
  };
  /**
   * A page of the Group's Activity. When a later page of a read can't be read, the list ends
   * there (`failed`), keeping the pages read before it; offline, the page's saved copy answers.
   */
  const readPage = (context: QueryFunctionContext<QueryKey, unknown>) => {
    const key = context.queryKey,
      page = context.pageParam as number,
      run: Run = { answered: false, reading: Promise.resolve() };
    const query = track(key, run);
    const fetch = query?.promise ?? {};
    const index = pagesRead.get(fetch) ?? 0;
    pagesRead.set(fetch, index + 1);
    const more = Boolean(query?.state.fetchMeta?.fetchMore);
    run.reading = (async (): Promise<PageEnvelope> => {
      try {
        const answer = await fetchOne(key, page, run);
        const total = pageOf(answer.value, key[3] as string, page).pagination.total;
        if (index === 0 && !more) firstTotals.set(fetch, total);
        // Offline, an older or newer page shows from this device only while it counted as many
        // events as the window's first page: otherwise events between them would silently go
        // missing, or show twice (#222, as #173's pilot did).
        const first = more ? (query?.state.data as Pages | undefined)?.pages[0] : undefined;
        const reference = more
          ? first && first.source !== 'failed'
            ? pageOf(first.value, key[3] as string, first.page).pagination.total
            : undefined
          : index > 0
            ? firstTotals.get(fetch)
            : undefined;
        if (answer.source === 'saved' && reference !== undefined && total !== reference) {
          const path = pagePath(key, page);
          session.answered(path, null);
          throw new RequestError(notSaved, 0, 'OFFLINE_UNAVAILABLE', false, null, 'network');
        }
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
          message: olderFailed,
        };
      }
    })();
    return run.reading as Promise<PageEnvelope>;
  };

  /** Fresh for the display freshness window: never a saved copy, never while offline. */
  const staleTime = (query: { state: { data?: unknown; dataUpdatedAt: number } }) => {
    const data = query.state.data as Pages | undefined;
    return data?.pages.every((page) => page.source === 'network') &&
      !session.offline() &&
      query.state.dataUpdatedAt <= Date.now()
      ? session.freshness
      : STALE;
  };
  /** A return's pages of this Activity, until a read has shown them again (from the route). */
  const rereadOf = (key: QueryKey) => {
    const at = session.route();
    const activity = 'reread' in at && at.reread?.groupId === key[3] ? at.reread.activity : null;
    return activity && !shownRereads.has(activity) ? activity : null;
  };
  // Nothing reads on its own: Activity's commands, the foreground and a reconnect read it here.
  const listOptions = (key: QueryKey, fresh = false) => {
    const reread = rereadOf(key);
    // A return reads every page it left again, from the window's first (#215).
    const first = stateOf<Pages>(key)?.data?.pageParams[0] ?? 1;
    const pages = reread ? Math.max(1, reread.pages - first + 1) : undefined;
    return {
      staleTime,
      retryOnMount: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      queryKey: key,
      queryFn: readPage,
      initialPageParam: 1,
      getNextPageParam: (last: PageEnvelope) => {
        if (last.source === 'failed') return undefined;
        const { pagination } = pageOf(last.value, key[3] as string, last.page);
        return pagination.page < pagination.totalPages ? pagination.page + 1 : undefined;
      },
      getPreviousPageParam: (_first: PageEnvelope, _all: PageEnvelope[], param: number) =>
        param > 1 ? param - 1 : undefined,
      maxPages: MAX_PAGES,
      structuralSharing: sharePages,
      ...(pages ? { pages } : {}),
      ...(fresh || (reread && reread.pages > 1) ? { staleTime: STALE } : {}),
    } as const;
  };

  /**
   * Observed while Activity shows, once this open's check of the Group passed, and not once the
   * Group refused the member: it reads what its query lacks, such as a query a change removed.
   */
  const bind = () => {
    pending = false;
    if (!view || !onScreen() || !session.checked(view.groupId)) return unbind();
    const next = listOptions(activityKey(view.groupId));
    if (observer) observer.setOptions(next);
    else {
      observer = new InfiniteQueryObserver<PageEnvelope, Error, Pages, QueryKey, number>(
        client,
        next,
      );
      observer.subscribe(() => undefined);
    }
  };
  const unbind = () => {
    observer?.destroy();
    observer = undefined;
  };
  const bindLater = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      if (pending) bind();
    });
  };
  /** Activity as its queries now hold it: published only when that changes what shows. */
  const reproject = () => {
    const before = session.snapshot();
    if (project(before) !== before) session.publish({});
    else bindLater();
  };

  /** Reads a query now, joining a read in flight; one a change cancels is read again. */
  const readNow = async (
    options: ReturnType<typeof listOptions>,
    owner: number,
    wanted: () => boolean,
  ) => {
    const hash = hashKey(options.queryKey);
    for (;;) {
      if (!session.current(owner)) throw new Superseded();
      const fetching = client.fetchInfiniteQuery(options as never);
      const run = runs.get(hash);
      try {
        return await fetching;
      } catch (error) {
        if (!(error instanceof CancelledError)) throw error;
        // The request ends first, so whatever its answer set off has finished: a session that
        // ended, or a Group whose refusal is this read's answer.
        const answer = await run?.reading.then(
          () => null,
          (cause: unknown) => cause,
        );
        if (!session.current(owner)) throw new Superseded();
        if (answer instanceof RequestError && answer.kind !== 'cancelled') throw answer;
        if (!wanted()) throw new Superseded();
      }
    }
  };
  /** A refusal answered for this open: the Group's content goes, as the controller drops it. */
  const refuse = (opened: View, error: unknown) => {
    if (!refused(error) || view !== opened) return false;
    session.refused(opened.groupId, error);
    return true;
  };
  /**
   * Reads Activity for this open: every page loaded, from the window's first, up to 5 (M1-3), or
   * the newest page when none is. `fresh` reads them again now; otherwise a read verified within
   * the freshness window is reused. `after`: the Group read it follows (a Household's, or a
   * Group not known yet); when that fails, Activity isn't read. A refusal drops the Group.
   */
  const read = (
    owner: number,
    {
      fresh = false,
      after,
      saved = false,
    }: { fresh?: boolean; after?: Promise<unknown>; saved?: boolean } = {},
  ): Promise<void> => {
    const opened = view;
    if (!opened || opened.lost) return Promise.resolve();
    const key = activityKey(opened.groupId);
    // Only while Activity shows: one a change cancelled is read again only if the member is on it.
    const still = () => view === opened && !opened.lost && session.current(owner) && onScreen();
    opened.reading += 1;
    const reading = (async (): Promise<boolean> => {
      // What this device saved shows while the Group is first read, with its own time.
      const restoring =
        held(key)?.state.data === undefined
          ? restore(key, owner)
              .then(() => reproject())
              .catch(() => undefined)
          : null;
      /** This read answered with pages read now, which are being saved on this device. */
      let answered = false;
      try {
        reproject();
        if (after) {
          try {
            await after;
          } catch {
            return false;
          }
        }
        if (!still()) return false;
        // A read again would join a Load older or newer still on its way: that page lands first,
        // then every page loaded is read again.
        const loading = held<Pages>(key);
        if (
          fresh &&
          loading?.state.fetchStatus === 'fetching' &&
          loading.state.fetchMeta?.fetchMore
        )
          await loading.promise?.catch(() => undefined);
        if (!still()) return false;
        const reread = rereadOf(key),
          before = held(key)?.state.dataUpdatedAt;
        await readNow(listOptions(key, fresh), owner, still);
        answered = held(key)?.state.dataUpdatedAt !== before;
        if (reread) shownRereads.add(reread);
      } catch (error) {
        // Shown on Activity, beside what was read before; a refusal drops the Group.
        if (!refuse(opened, error) && !(error instanceof Superseded) && !(error instanceof Error))
          throw error;
      } finally {
        await restoring;
        opened.reading -= 1;
        if (session.current(owner)) reproject();
      }
      return answered;
    })();
    running.add(reading);
    void reading.finally(() => running.delete(reading)).catch(() => undefined);
    // `saved`: a command that shows Activity is done once what it read is saved on this device,
    // or removed again by a change confirmed meanwhile, as Activity's reads always were. A
    // refresh, whose cue says a read is running, is done when its read lands (#222, review N1).
    return reading.then(async (answered) => {
      if (answered && saved) await queue.idle();
    });
  };

  /** Waits until Activity reads nothing, including a read that replaced another. */
  const settle = async (owner: number) => {
    for (let round = 0; round < 1000; round += 1) {
      await Promise.resolve();
      if (!session.current(owner) || !view) return;
      const query = held(activityKey(view.groupId));
      if (query?.state.fetchStatus === 'fetching') {
        await query.promise?.catch(() => undefined);
        await runs.get(query.queryHash)?.reading.catch(() => undefined);
        continue;
      }
      if (running.size) {
        await Promise.allSettled([...running]);
        continue;
      }
      return;
    }
  };

  /** The Expense an open event names, as its record query holds it now. */
  const targetOf = (opened: View): Target => {
    const { detail } = opened;
    if (!detail) return none;
    if (detail.reading) return checking;
    if (!detail.expenseId) return none;
    if (detail.failure) return detail.failure;
    const data = held<Envelope>(
      expenseRecordKey(session.account(), opened.groupId, detail.expenseId),
    )?.state.data;
    if (!data) return failed;
    const known = targets.get(data);
    if (known) return known;
    let target: Target;
    try {
      target = parseActivityExpense(data.value, opened.groupId, detail.expenseId);
    } catch {
      target = failed;
    }
    targets.set(data, target);
    return target;
  };
  /** Activity as its query holds it, in the snapshot's shape. */
  const activityFrom = (shown: ActivityState, opened: View): ActivityState => {
    const { groupId } = opened,
      state = stateOf<Pages>(activityKey(groupId)),
      selected = opened.detail?.event ?? null,
      target = targetOf(opened);
    const base: ActivityState = {
      ...emptyActivity(),
      groupId,
      selected,
      target,
      // No events stays the same list, so it publishes nothing new.
      events: shown.events.length ? [] : shown.events,
    };
    // Nothing read, or what was read went with a change, a denial or a Groups list: no event
    // shows, never one from before this device's own change (#280 item 1).
    if (!state) return same(shown, { ...base, status: opened.reading ? 'loading' : 'idle' });
    const data = state.data;
    // Read beside the Group in this open, before its check passed: shown only once it has.
    const unchecked =
      !session.checked(groupId) &&
      !!data &&
      !previewed(data) &&
      state.dataUpdatedAt >= opened.since;
    const pages = unchecked ? [] : (data?.pages ?? []);
    const read = pages.filter((page) => page.source !== 'failed');
    const failedPage = pages.find((page) => page.source === 'failed');
    let next: ActivityState = base;
    if (read.length) {
      const parsed = read.map((page) => pageOf(page.value, groupId, page.page));
      // An event read on two pages, as events are added above it, is listed once; the events
      // shown stay the same list when nothing in them changed, so an unchanged read publishes
      // nothing.
      const events = [
        ...new Map(
          parsed.flatMap((page) => page.events).map((event) => [event._id, event]),
        ).values(),
      ];
      const kept =
        events.length === shown.events.length &&
        events.every((event, index) => event === shown.events[index]);
      next = {
        ...base,
        events: kept ? shown.events : events,
        pagination: parsed[parsed.length - 1].pagination,
        firstPage: read[0].page,
        // Never fresher than its oldest page (#215).
        refreshedAt: Math.min(...read.map((page) => page.refreshedAt)),
        // A page this device restored is never presented as read in this session (#222).
        restored: read.some((page) => page.source === 'saved'),
        moreStatus: failedPage ? 'error' : 'idle',
      };
    }
    const direction = state.fetchMeta?.fetchMore?.direction;
    if (state.fetchStatus === 'fetching') {
      if (direction === 'forward')
        return same(shown, { ...next, status: 'ready', moreStatus: 'loading' });
      if (direction === 'backward')
        return same(shown, { ...next, status: 'ready', newerStatus: 'loading' });
      return same(shown, { ...next, status: 'loading', moreStatus: 'idle' });
    }
    // Not checked by this open yet: a saved copy shows while the Group is read.
    if (unchecked || !session.checked(groupId) || (previewed(data) && !failure(state)))
      return same(shown, { ...next, status: opened.reading ? 'loading' : 'idle' });
    const error = failure(state);
    if (state.status === 'error' && !error) return shown;
    if (error && direction === 'forward')
      return same(shown, { ...next, status: 'ready', moreStatus: 'error' });
    if (error && direction === 'backward')
      return same(shown, { ...next, status: 'ready', newerStatus: 'error' });
    if (error)
      return same(shown, {
        ...next,
        status: 'error',
        // Nothing shown, SplitBook out of reach, and no copy here: "isn't saved on this phone".
        unsaved: unreachable(error) && !next.events.length,
        // Events still on screen: what is true of them, never "not saved" (#222, as #219). With
        // nothing shown, what failed: a server's answer, offline too, says so (#222).
        message: unreachable(error)
          ? next.events.length
            ? notKept
            : error.message
          : next.events.length
            ? refreshFailed
            : error instanceof RequestError
              ? error.message
              : loadFailed,
      });
    return same(shown, { ...next, status: 'ready' });
  };
  /** Activity, projected from its query into `next` while it shows. */
  const project = (next: MobileSnapshot): MobileSnapshot => {
    const opened = view;
    if (!opened || opened.lost || next.auth.status !== 'authenticated') return next;
    if (
      next.screen !== 'group' ||
      next.destination !== 'activity' ||
      next.detail.id !== opened.groupId
    ) {
      // Not shown: events whose query a change, a denial or a Groups list removed go all the
      // same, so nothing from before this device's own change is kept (#280 item 1).
      const kept = next.activity;
      return kept.groupId === opened.groupId &&
        kept.events.length &&
        held(activityKey(opened.groupId))?.state.data === undefined
        ? {
            ...next,
            activity: { ...emptyActivity(), groupId: kept.groupId, status: kept.status },
          }
        : next;
    }
    const activity = activityFrom(next.activity, opened);
    return activity === next.activity ? next : { ...next, activity };
  };
  /** A fetch that answered from the server: each page saved as its row while still current. */
  const saveAnswer = (query: Query) => {
    if (client.getQueryCache().get(query.queryHash) !== query) return;
    const start = query.promise && starts.get(query.promise);
    const data = query.state.data as Pages | undefined;
    if (!start || !data) return;
    for (const page of data.pages)
      if (page.source === 'network') saveRow(query.queryKey as QueryKey, start, page, page.page);
  };
  /** Removes a Group's Activity rows: every page saved, and any being written once it lands. */
  const removeRows = async (accountId: string, groupId: string) => {
    if (!rows) return;
    forgotten.set(groupId, (forgotten.get(groupId) ?? 0) + 1);
    await removeActivityRows(rows, accountId, groupId, known);
  };

  return {
    project,
    bindLater,
    /**
     * The observer takes its query again: removing a query never tells it (module-4 brief F5), so
     * it moves to the new one, which reads what it lacks.
     */
    rebind() {
      if (!observer) return;
      rebinding = true;
      try {
        bind();
      } finally {
        rebinding = false;
      }
    },
    /**
     * The member opens this Group, or its view on screen is read again (`again`), which closes an
     * open event. A Group opened anew lists its Activity from its newest page, as a return or a
     * refresh never does: pages beyond it go from memory (#215). `fresh`: a pull, Retry or a
     * change read the Group's view again, so Activity is read again when it next shows.
     */
    open(groupId: string, { again, fresh }: { again: boolean; fresh: boolean }) {
      if (again && view?.groupId === groupId && !view.lost) view.detail = null;
      else {
        view = { groupId, lost: false, since: Date.now(), reading: 0, detail: null };
        const key = activityKey(groupId),
          query = held<Pages>(key),
          pages = query?.state.data;
        // As a Group's Months do (#219): a window being read, or slid, goes; its read with it.
        if (query && pages && pages.pages.length > 1) {
          if (pages.pageParams[0] === 1 && query.state.fetchStatus !== 'fetching')
            client.setQueryData<Pages>(
              key,
              { pages: pages.pages.slice(0, 1), pageParams: [1] },
              { updatedAt: query.state.dataUpdatedAt },
            );
          else client.removeQueries({ queryKey: key, exact: true });
        }
      }
      if (fresh)
        void client.invalidateQueries({
          queryKey: activityKey(groupId),
          exact: true,
          refetchType: 'none',
        });
    },
    read,
    settle,
    /** Pull or Retry on Activity: every page loaded is read again now (M1-3); an open event closes. */
    async refresh(owner: number) {
      const opened = view;
      if (!opened || !onScreen()) return;
      opened.detail = null;
      await read(owner, { fresh: true });
    },
    /**
     * Load older: the next older page. Past 5 pages the window slides and the newest page drops; a
     * page that couldn't be read before is read again, in its place.
     */
    async loadOlder(owner: number) {
      const opened = view;
      if (!opened || !onScreen() || !session.checked(opened.groupId)) return;
      const key = activityKey(opened.groupId),
        state = stateOf<Pages>(key);
      if (!state?.data || state.fetchStatus === 'fetching') return;
      const { pages, pageParams } = state.data;
      const last = pages[pages.length - 1];
      if (last.source === 'failed')
        client.setQueryData<Pages>(
          key,
          { pages: pages.slice(0, -1), pageParams: pageParams.slice(0, -1) },
          { updatedAt: held(key)?.state.dataUpdatedAt },
        );
      else {
        const { pagination } = pageOf(last.value, opened.groupId, last.page);
        if (pagination.page >= pagination.totalPages) return;
      }
      bind();
      const result = await observer?.fetchNextPage({ cancelRefetch: false });
      if (result?.error) refuse(opened, result.error);
      await settle(owner);
    },
    /** Load newer: the page before the window, which drops the window's oldest page. */
    async loadNewer(owner: number) {
      const opened = view;
      if (!opened || !onScreen() || !session.checked(opened.groupId)) return;
      const state = stateOf<Pages>(activityKey(opened.groupId));
      if (!state?.data || state.fetchStatus === 'fetching' || (state.data.pageParams[0] ?? 1) <= 1)
        return;
      bind();
      const result = await observer?.fetchPreviousPage({ cancelRefetch: false });
      if (result?.error) refuse(opened, result.error);
      await settle(owner);
    },
    /**
     * Opens an event: what was recorded, and, when it names an Expense, that Expense as it is
     * now. The Group's query is read first, checking the member (#219); then the record's (#220).
     */
    async select(eventId: string, owner: number) {
      const opened = view,
        shown = session.snapshot().activity;
      // Opened once read, as the list offers them: not while read again, or after that failed.
      if (!opened || !onScreen() || shown.status !== 'ready') return;
      const event = shown.events.find((item) => item._id === eventId);
      if (!event) return;
      const detail: Detail = {
        event,
        expenseId: activityExpenseId(event) ?? null,
        reading: true,
        failure: null,
      };
      opened.detail = detail;
      reproject();
      const { groupId } = opened;
      const wanted = () => view === opened && opened.detail === detail && session.current(owner);
      let recordRead = false;
      try {
        const group = parseGroup(await session.readGroup(groupId, owner, { fresh: true, wanted }));
        if (!wanted()) return;
        if (
          group.id !== groupId ||
          !group.members.some((member) => member.user.id === session.snapshot().auth.user?.id)
        )
          throw new RequestError('You no longer have access to this Group.', 403);
        if (detail.expenseId) {
          recordRead = true;
          await session.readRecord(groupId, detail.expenseId, owner, wanted);
        }
      } catch (error) {
        if (!wanted() || error instanceof Superseded) return;
        // A refusal of the Group, or the Group gone, drops it; the Expense gone says only that.
        if (
          error instanceof RequestError &&
          (error.status === 403 || (!recordRead && error.status === 404))
        )
          return void refuse(opened, error);
        detail.failure =
          error instanceof RequestError && error.status === 404 ? unavailable : failed;
      } finally {
        detail.reading = false;
        if (view === opened && opened.detail === detail) reproject();
      }
    },
    /** Back to the list from an open event. */
    close() {
      if (!view?.detail) return;
      view.detail = null;
      reproject();
    },
    /**
     * The member lost this Group: Activity reads and observes nothing more, so a removed query's
     * observer can't read it back, and a late answer lands nowhere.
     */
    lose(groupId: string) {
      if (view?.groupId !== groupId) return;
      view.lost = true;
      view.detail = null;
      unbind();
    },
    /** Removes a Group's Activity rows, inside a lease write: a change or a loss. */
    forget: (accountId: string, groupId: string) => removeRows(accountId, groupId),
    /** Keeps only these Groups' rows: a Groups list from the server left the others out. */
    async retain(accountId: string, listed: string[]) {
      if (!rows) return;
      const keep = new Set(listed);
      for (const path of await rowPaths(rows, accountId, known)) {
        const id = /^\/api\/groups\/([a-f\d]{24})\//i.exec(path)?.[1];
        if (!id || keep.has(id) || !ownRow(path, id)) continue;
        forgotten.set(id, (forgotten.get(id) ?? 0) + 1);
        await rows.remove(accountId, path);
      }
    },
    /**
     * Returning to the foreground and reconnecting (M1-4, M1-6): Activity on screen reads again
     * what is past its stale time, through TanStack's focus and online events only. Answers
     * publish wherever they land, and are saved as rows. Returns what stops listening.
     */
    listen(focus: typeof focusManager, online: typeof onlineManager) {
      const again = () => {
        if (view && onScreen() && session.checked(view.groupId))
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
          if (!isActivity(key)) return;
          if (event.action.type === 'success' && !event.action.manual) {
            saveAnswer(query);
            if (query.state.data) answers.add(query.state.data);
          }
          if (!view || key[3] !== view.groupId) return;
          if (client.getQueryCache().get(query.queryHash) !== query) return;
          const before = session.snapshot();
          if (project(before) !== before) session.publish({});
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
