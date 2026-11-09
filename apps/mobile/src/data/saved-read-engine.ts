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
export interface SavedReadView {
  path(key: QueryKey, page?: number): string;
  readable(key: QueryKey, value: unknown, page?: number): boolean;
  ownsKey(key: QueryKey): boolean;
  rowScope: {
    groupId(key: QueryKey): string;
    remove(
      rows: FindableRecordStore,
      accountId: string,
      groupId: string,
      known: Iterable<string>,
    ): Promise<void>;
    pathGroup(path: string): string | null;
    distrust(key: QueryKey): string[];
  };
  refusal: RefusalRule;
  preview: 'same-run-unanswered';
  automaticRefetch: boolean;
  cancelOnRemove: boolean;
  staleWhenOffline: boolean;
  recover(): Promise<void>;
}
interface Run {
  answered: boolean;
  reading: Promise<unknown>;
  abort?: AbortController;
  before?: Promise<unknown>;
  ended?: boolean;
}
interface RowRead<T> {
  key: QueryKey;
  page?: number;
  accept(value: unknown): void | Promise<void>;
  project?(answer: Envelope): T;
  failure?(error: unknown): T;
}

/** Owns a view's saved rows and query ownership; no run or queue escapes to callers. */
export function createSavedReadEngine(session: SavedReadPorts, view: SavedReadView) {
  const { client, rows } = session;
  const queue = createSavedCopyQueue(),
    runs = new Map<string, Run>();
  const starts = new WeakMap<object, { owner: number; owns(): boolean }>();
  const reading = new WeakMap<object, Set<AbortController>>();
  const forgotten = new Map<string, number>(),
    known = new Set<string>();
  let rebinding = false;
  const held = (key: QueryKey) => client.getQueryCache().get<unknown, Error>(hashKey(key));
  const removals = (key: QueryKey) => forgotten.get(view.rowScope.groupId(key)) ?? 0;
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
      if (removals(key) !== before)
        await rows
          .remove(accountId, path)
          .catch(() => session.distrust(accountId, view.rowScope.distrust(key)));
    });
  };
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
      run.answered = true;
    } catch (error) {
      run.answered = true;
      if (!(error instanceof RequestError) || !error.networkFailure || !lease || !rows) throw error;
      const row = obsolete() ? null : await savedRow(lease, path).catch(() => null);
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
    if (obsolete()) throw new Superseded();
    session.answered(path);
    return { source: 'network', refreshedAt: Date.now(), value };
  };
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
  return {
    read<T = Envelope>(request: RowRead<T>): Promise<T> {
      const run: Run = { answered: false, reading: Promise.resolve() };
      track(request.key, run);
      const answer = fetchOne(request, run);
      run.reading =
        request.project || request.failure
          ? answer.then(
              (value) => (request.project ? request.project(value) : value),
              (error) => {
                if (request.failure) return request.failure(error);
                throw error;
              },
            )
          : answer;
      return run.reading as Promise<T>;
    },
    listen() {
      return client.getQueryCache().subscribe((event) => {
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
    async restore(
      key: QueryKey,
      owner: number,
      preview: { page?: number; project?(copy: Envelope): unknown } = {},
    ) {
      const lease = session.lease(),
        owns = queryOwner(client, key),
        started = runs.get(hashKey(key));
      if (!lease || !rows) return;
      const row = await savedRow(lease, view.path(key, preview.page)).catch(() => null),
        latest = runs.get(hashKey(key));
      if (
        !row ||
        (view.preview === 'same-run-unanswered' &&
          latest &&
          (latest !== started || latest.answered)) ||
        !session.current(owner) ||
        !owns() ||
        held(key)?.state.data !== undefined ||
        row.refreshedAt <= session.distrusted(key, true) ||
        !view.readable(key, row.value, preview.page)
      )
        return;
      const data = copy(row);
      known.add(row.path);
      client.setQueryData(key, preview.project ? preview.project(data) : data);
    },
    shared: {
      staleTime,
      retryOnMount: view.automaticRefetch,
      refetchOnMount: view.automaticRefetch,
      refetchOnWindowFocus: view.automaticRefetch,
      refetchOnReconnect: view.automaticRefetch,
    },
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
    rebind(bind: () => void) {
      rebinding = true;
      try {
        bind();
      } finally {
        rebinding = false;
      }
    },
    async forget(accountId: string, groupId: string) {
      if (!rows) return;
      forgotten.set(groupId, (forgotten.get(groupId) ?? 0) + 1);
      await view.rowScope.remove(rows, accountId, groupId, known);
    },
    async retain(accountId: string, listed: string[]) {
      if (!rows) return;
      const keep = new Set(listed);
      for (const path of await rowPaths(rows, accountId, known)) {
        const id = view.rowScope.pathGroup(path);
        if (!id || keep.has(id)) continue;
        forgotten.set(id, (forgotten.get(id) ?? 0) + 1);
        await rows.remove(accountId, path);
      }
    },
    drop(paths: Iterable<string>) {
      for (const path of paths) queue.drop(path);
    },
    refuses(error: unknown, rule: RefusalRule = view.refusal): boolean {
      return (
        error instanceof RequestError &&
        (error.status === 403 || (rule === 'forbidden-or-missing' && error.status === 404))
      );
    },
    recover: view.recover,
    reset() {
      queue.cancel();
      runs.clear();
    },
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
