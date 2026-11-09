import {
  CancelledError,
  hashKey,
  replaceEqualDeep,
  type InfiniteData,
  type QueryClient,
  type Query,
} from '@tanstack/query-core';
import type { QueryAccount, QueryKey } from '@splitbook/shared/query-keys';
import type { AccountStorageLease, MobileSnapshot } from './types';
import { cachedRead } from './offline-cache';
import { keepInvalidated, queryOwner } from './query-owner';
import { RequestError, Superseded } from './transport';
import type { FindableRecordStore } from './account-record-storage';

/**
 * A display read as the query cache holds it (ADR 0006, AMEND-2): the server's JSON as received,
 * parsed only when used, and when it was verified. `saved` marks a copy restored from this
 * device, which is never fresh.
 */
export type Envelope = { source: 'network' | 'saved'; refreshedAt: number; value: unknown };

/** The server can't be reached, and this device has no saved copy of the view. */
export const notSaved = 'This view was not saved on this device. Connect to load it.';
export const notSavedHere =
  'Could not save this view for offline use. Online data is still available.';

/**
 * The saved-copy queue (ADR 0006, M3-2): saved copies are written one at a time, and the latest
 * write for a query wins, so an older one still waiting is dropped. Sign-out, an account change
 * and a 401 cancel what is waiting; the write already running finishes.
 */
export function createSavedCopyQueue() {
  const waiting = new Map<string, () => Promise<void>>();
  let tail = Promise.resolve();
  return {
    push(key: string, write: () => Promise<void>) {
      const queued = waiting.has(key);
      waiting.set(key, write);
      if (queued) return;
      tail = tail.then(async () => {
        const latest = waiting.get(key);
        waiting.delete(key);
        await latest?.().catch(() => undefined);
      });
    },
    cancel: () => waiting.clear(),
    /** A write for `key` still waiting is never made. */
    drop: (key: string) => void waiting.delete(key),
    /** Settles once the write running now, and every one still waiting, has. */
    idle: () => tail,
  };
}

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
export const sharePages = (old: unknown, next: unknown): unknown => {
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

export const MAX_PAGES = 5;
/** A stale time that is stale whatever the clock says, even moved back past a read. */
export const STALE = -Infinity;

/**
 * The paths of the persister's rows for this account: those it lists, so rows saved before this
 * session count too, and those named in `known`, for a store that can't list its rows. Only the
 * keys are read where the store can, so a row that can't be read never stops a removal.
 */
export const rowPaths = async (
  rows: FindableRecordStore,
  accountId: string,
  known: Iterable<string> = [],
) => {
  const paths = new Set(known);
  const listed = rows.keys
    ? await rows.keys(accountId)
    : (await rows.list(accountId)).map(({ groupId }) => groupId);
  for (const path of listed) paths.add(path);
  return paths;
};

/** The controller's existing saved-read ports; rows already carry the account-lease write lane. */
export interface SavedReadPorts {
  client: QueryClient;
  rows?: FindableRecordStore;
  account(): QueryAccount;
  generation(): number;
  current(owner: number): boolean;
  lease(): AccountStorageLease | null;
  owns(accountId: string): boolean;
  distrusted(key: QueryKey, early: boolean): number;
  distrust(accountId: string, scopes: string[]): void;
  savable(key: QueryKey): boolean;
  offline(): boolean;
  freshness: number;
  read(path: string, owner: number, signal?: AbortSignal): Promise<unknown>;
  answered(path: string, saved?: number | null): void;
  now(): number;
  snapshot(): Pick<MobileSnapshot, 'offline'>;
  publish(next: Partial<MobileSnapshot>): void;
}
export type RefusalRule = 'forbidden-only' | 'forbidden-or-missing';
/** View decisions, not persistence machinery. More preview policies join as their views move. */
export interface SavedReadView<Scope extends string = never> {
  path(key: QueryKey, page?: number): string;
  readable(key: QueryKey, value: unknown, page?: number): boolean;
  ownsKey(key: QueryKey): boolean;
  rowScope: {
    groupId(key: QueryKey): string;
    /** Scopes whose removal retires this row; omitted for one scope per Group. */
    scopes?(key: QueryKey): readonly Scope[];
    defaultScope?: Scope;
    remove(
      rows: FindableRecordStore,
      accountId: string,
      groupId: string,
      known: Iterable<string>,
      scope?: Scope,
    ): Promise<void>;
    pathGroup(path: string): string | null;
    distrust(key: QueryKey): string[];
  };
  refusal: RefusalRule;
  preview: 'same-run-unanswered' | 'unanswered-since-open';
  automaticRefetch: boolean;
  cancelOnRemove: boolean;
  staleWhenOffline: boolean;
}
interface Run {
  answered: boolean;
  reading: Promise<unknown>;
  abort?: AbortController;
  before?: Promise<unknown>;
  ended?: boolean;
}
interface Preview<T> {
  page?: number;
  project?(copy: Envelope): T;
}
interface RowRead<T> {
  key: QueryKey;
  page?: number;
  accept(value: unknown): void | Promise<void>;
  project?(answer: Envelope): T;
  failure?(error: unknown): T;
}

/** Owns a view's saved rows and query ownership; no run or queue escapes to callers. */
export function createSavedReadEngine<Scope extends string = never>(
  session: SavedReadPorts,
  view: SavedReadView<Scope>,
) {
  const { client, rows } = session;
  const queue = createSavedCopyQueue(),
    runs = new Map<string, Run>();
  /** Each fetch's start, by its promise: whose session, and which query owns it. */
  const starts = new WeakMap<object, { owner: number; owns(): boolean }>();
  /** Each query's requests under way, which its removal cancels. */
  const reading = new WeakMap<object, Set<AbortController>>();
  /** How often `forget` removed each scope's rows: a row being written meanwhile goes too. */
  const forgotten = new Map<string, number>(),
    /** The rows this session saved or restored: removable even by a store that can't list rows. */
    known = new Set<string>();
  /** How many reads of each query answered: Activity never previews after one since its open. */
  const answeredReads = new Map<string, number>();
  const answerOf = (key: QueryKey) => answeredReads.get(hashKey(key)) ?? 0;
  /** A read answered, from the server or failing: both overtake an earlier preview (#222). */
  const answered = (key: QueryKey, run: Run) => {
    run.answered = true;
    answeredReads.set(hashKey(key), answerOf(key) + 1);
  };
  let rebinding = false;
  const held = (key: QueryKey) => client.getQueryCache().get<unknown, Error>(hashKey(key));
  const scopeKey = (groupId: string, scope?: Scope) =>
    scope === undefined ? groupId : `${groupId}:${scope}`;
  /** Every scope reaching the row counts: a ledger removal leaves the Group's own row alone. */
  const removals = (key: QueryKey) => {
    const groupId = view.rowScope.groupId(key);
    return (view.rowScope.scopes?.(key) ?? [undefined])
      .map((scope) => forgotten.get(scopeKey(groupId, scope)) ?? 0)
      .join(':');
  };
  const removed = (groupId: string, scope = view.rowScope.defaultScope) => {
    const key = scopeKey(groupId, scope);
    forgotten.set(key, (forgotten.get(key) ?? 0) + 1);
  };
  const savedRow = async (lease: AccountStorageLease, path: string) =>
    cachedRead(
      await lease.write(() => rows!.load(lease.accountId, path)),
      lease.accountId,
      path,
      session.now(),
    );
  const copy = (row: { refreshedAt: number; value: unknown }): Envelope => ({
    source: 'saved',
    refreshedAt: row.refreshedAt,
    value: row.value,
  });
  /**
   * Saves an answer as its row on the saved-copy queue, where a newer answer replaces it: one
   * row per query, or one per page (`page`). The session, the account, the read's query owner and
   * whether its Group is kept here are checked at write time.
   */
  const saveRow = (
    key: QueryKey,
    { owner, owns }: { owner: number; owns(): boolean },
    { refreshedAt, value }: { refreshedAt: number; value: unknown },
    page?: number,
  ) => {
    const lease = session.lease(),
      path = view.path(key, page);
    if (!lease || !rows) return;
    queue.push(path, async () => {
      if (!session.current(owner) || !session.owns(lease.accountId)) return;
      if (!owns() || !session.savable(key)) return;
      const { accountId } = lease,
        before = removals(key);
      known.add(path);
      await rows
        .save(accountId, path, {
          version: 1,
          accountId,
          path,
          groupId: view.rowScope.groupId(key),
          refreshedAt,
          value,
        })
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
          .catch(() => session.distrust(accountId, view.rowScope.distrust(key)));
    });
  };
  /** A fetch that answered from the server: saved as its row(s) while still current. */
  const saveAnswer = (query: Query) => {
    if (client.getQueryCache().get(query.queryHash) !== query) return;
    const start = query.promise && starts.get(query.promise),
      data = query.state.data as Envelope | Pages | undefined;
    if (!start || !data) return;
    const key = query.queryKey as QueryKey;
    if ('pages' in data) {
      for (const page of data.pages)
        if (page.source === 'network') saveRow(key, start, page, page.page);
    } else if (data.source === 'network') saveRow(key, start, data);
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
      const running = reading.get(query) ?? new Set<AbortController>();
      reading.set(query, running.add(run.abort));
    }
    if (query?.promise && !starts.has(query.promise))
      starts.set(query.promise, { owner: session.generation(), owns: queryOwner(client, key) });
  };
  /**
   * One read of a row: sends it, or when Splitbook can't be reached, answers with the row saved
   * here for that path and its own time, offline (M4-5). Only its query's removal cancels it,
   * never leaving the screen: an answer still current is kept and saved wherever it lands.
   */
  const fetchOne = async <T>(request: RowRead<T>, run: Run): Promise<Envelope> => {
    const { key, page, accept } = request;
    if (run.before) await run.before.catch(() => undefined);
    const path = view.path(key, page),
      owner = session.generation(),
      owns = queryOwner(client, key),
      lease = session.lease();
    const obsolete = () => !session.current(owner) || !owns();
    let value: unknown;
    try {
      value = await session.read(path, owner, run.abort?.signal);
      answered(key, run);
    } catch (error) {
      answered(key, run);
      if (!(error instanceof RequestError) || !error.networkFailure || !lease || !rows) throw error;
      const row = obsolete() ? null : await savedRow(lease, path).catch(() => null);
      // Overtaken by a change, a denial or a Groups list: it is read again, not shown.
      if (obsolete()) throw new Superseded();
      const saved =
        row &&
        row.refreshedAt > session.distrusted(key, false) &&
        view.readable(key, row.value, page)
          ? row
          : null;
      keepInvalidated(client, key);
      session.answered(path, saved?.refreshedAt ?? null);
      if (!saved)
        throw new RequestError(notSaved, 0, 'OFFLINE_UNAVAILABLE', false, null, 'network');
      return copy(saved);
    }
    if (obsolete()) throw new Superseded();
    const acceptance = accept(value);
    if (acceptance) await acceptance;
    // A view's acceptance may wait (a Group's does): what was overtaken meanwhile isn't shown.
    if (obsolete()) throw new Superseded();
    session.answered(path);
    return { source: 'network', refreshedAt: Date.now(), value };
  };
  /**
   * Fresh for the display freshness window: never a saved copy, never an answer stamped ahead of
   * this device's clock, and never while offline where the view says so.
   */
  const staleTime = (query: { state: { data?: unknown; dataUpdatedAt: number } }) => {
    const data = query.state.data as Envelope | Pages | undefined;
    const network = !data
      ? false
      : 'pages' in data
        ? data.pages.every((page) => page.source === 'network')
        : data.source === 'network';
    return network &&
      (!view.staleWhenOffline || !session.offline()) &&
      query.state.dataUpdatedAt <= Date.now()
      ? session.freshness
      : STALE;
  };
  /**
   * While a query is first read, the row this device saved shows, with its own time. Never one
   * a change, a denial or a failed removal made obsolete, one the view can't read, and never
   * once the view's preview rule says a read has overtaken it.
   */
  const restore = async <T = Envelope>(
    key: QueryKey,
    owner: number,
    preview: Preview<T> = {},
    answers = answerOf(key),
  ): Promise<T | null> => {
    const lease = session.lease(),
      owns = queryOwner(client, key),
      started = runs.get(hashKey(key));
    if (!lease || !rows) return null;
    const row = await savedRow(lease, view.path(key, preview.page)).catch(() => null),
      latest = runs.get(hashKey(key));
    if (
      !row ||
      (view.preview === 'same-run-unanswered' &&
        latest &&
        (latest !== started || latest.answered)) ||
      (view.preview === 'unanswered-since-open' &&
        (latest?.answered || answerOf(key) !== answers)) ||
      !session.current(owner) ||
      !owns() ||
      held(key)?.state.data !== undefined ||
      row.refreshedAt <= session.distrusted(key, true) ||
      !view.readable(key, row.value, preview.page)
    )
      return null;
    const copyOf = copy(row);
    const data = preview.project ? preview.project(copyOf) : (copyOf as T);
    known.add(row.path);
    client.setQueryData(key, data);
    return data;
  };
  return {
    /** A query function's read of one row; `project` and `failure` shape what its query holds. */
    read<T = Envelope>(request: RowRead<T>): Promise<T> {
      const run: Run = { answered: false, reading: Promise.resolve() };
      track(request.key, run);
      const answer = fetchOne(request, run);
      const failure = (error: unknown): T => {
        if (request.failure) return request.failure(error);
        throw error;
      };
      run.reading =
        request.project || request.failure
          ? answer.then((value) => {
              try {
                return request.project ? request.project(value) : value;
              } catch (error) {
                // A view may reject a saved page against its window (#222): its failure policy
                // still shapes the query's answer, just as for a failed row read.
                return failure(error);
              }
            }, failure)
          : answer;
      return run.reading as Promise<T>;
    },
    /** Saves each answer from the server as it lands; subscribe it before a view's own projection. */
    listen() {
      return client.getQueryCache().subscribe((event) => {
        // A removed query's requests are obsolete: they are cancelled, never offline (#214).
        if (event.type === 'removed') {
          if (view.cancelOnRemove) reading.get(event.query)?.forEach((abort) => abort.abort());
          return;
        }
        if (
          event.type === 'updated' &&
          event.action.type === 'success' &&
          !event.action.manual &&
          view.ownsKey(event.query.queryKey as QueryKey)
        )
          saveAnswer(event.query);
      });
    },
    restore<T = Envelope>(key: QueryKey, owner: number, preview: Preview<T> = {}) {
      return restore(key, owner, preview);
    },
    /**
     * Captures when an open began, without exposing answer counts. Its restore still checks
     * ownership and trust at load time, but no preview follows any answer since this open.
     */
    previewAtOpen(key: QueryKey) {
      const answers = answerOf(key);
      return <T = Envelope>(owner: number, preview: Preview<T> = {}) =>
        restore(key, owner, preview, answers);
    },
    // Where `automaticRefetch` is off, nothing reads on its own: the screen's commands, the
    // foreground and a reconnect read in order.
    shared: {
      staleTime,
      retryOnMount: view.automaticRefetch,
      refetchOnMount: view.automaticRefetch,
      refetchOnWindowFocus: view.automaticRefetch,
      refetchOnReconnect: view.automaticRefetch,
    },
    /** Reads a query now, joining a read in flight; one a change cancels is read again. */
    async readNow<T>(
      options: { queryKey: QueryKey },
      owner: number,
      wanted: () => boolean,
    ): Promise<T> {
      const hash = hashKey(options.queryKey);
      for (;;) {
        if (!session.current(owner)) throw new Superseded();
        const fetching = (
          'getNextPageParam' in options
            ? client.fetchInfiniteQuery(options as never)
            : client.fetchQuery(options as never)
        ) as Promise<T>;
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
    },
    /** Waits for a query's underlying acceptance even when TanStack cancelled its fetch (#222). */
    async settle(key: QueryKey) {
      await runs.get(hashKey(key))?.reading.catch(() => undefined);
    },
    /** Observers bound again after a scope's queries were replaced: a new read waits for the old. */
    rebind(bind: () => void) {
      rebinding = true;
      try {
        bind();
      } finally {
        rebinding = false;
      }
    },
    /** Removes a scope's rows, inside a lease write: a change or a loss. */
    async forget(accountId: string, groupId: string, scope = view.rowScope.defaultScope) {
      if (!rows) return;
      removed(groupId, scope);
      await view.rowScope.remove(rows, accountId, groupId, known, scope);
    },
    /** Keeps only these Groups' rows: a Groups list from the server left the others out. */
    async retain(accountId: string, listed: string[]) {
      if (!rows) return;
      const keep = new Set(listed);
      for (const path of await rowPaths(rows, accountId, known)) {
        const id = view.rowScope.pathGroup(path);
        if (!id || keep.has(id)) continue;
        removed(id);
        await rows.remove(accountId, path);
      }
    },
    /** Rows still waiting to be written at these paths are never written. */
    drop(paths: Iterable<string>) {
      for (const path of paths) queue.drop(path);
    },
    /** Whether an answer is the Group refusing the member, by the view's rule or the one named. */
    refuses(error: unknown, rule: RefusalRule = view.refusal): boolean {
      return (
        error instanceof RequestError &&
        (error.status === 403 || (rule === 'forbidden-or-missing' && error.status === 404))
      );
    },
    /** The session ended (M10-2): nothing waiting is written. */
    reset() {
      queue.cancel();
      runs.clear();
    },
    /** Settles once no saved copy is being written. */
    idle: () => queue.idle(),
  };
}

/** One parse per wire answer and view scope, shared by record and page parsers. */
export const parseOnce = <T>(parse: (value: unknown, scope: string) => T) => {
  const parsed = new WeakMap<object, Map<string, T>>();
  return (value: unknown, scope: string) => {
    const byScope = parsed.get(value as object) ?? new Map<string, T>();
    parsed.set(value as object, byScope);
    if (byScope.has(scope)) return byScope.get(scope)!;
    const fresh = parse(value, scope);
    byScope.set(scope, fresh);
    return fresh;
  };
};
