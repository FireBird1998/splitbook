import {
  CancelledError,
  hashKey,
  InfiniteQueryObserver,
  QueryObserver,
  type focusManager,
  type InfiniteData,
  type onlineManager,
  type Query,
  type QueryClient,
  type QueryFunctionContext,
  type QueryObserverOptions,
  type QueryState,
} from '@tanstack/query-core';
import { activityPagePath } from '@splitbook/shared/api-paths';
import {
  expenseHistoryKey,
  expenseRecordKey,
  queryKeyPath,
  type QueryAccount,
  type QueryKey,
} from '@splitbook/shared/query-keys';
import { z } from 'zod';
import type { FindableRecordStore } from './account-record-storage';
import { emptyExpenseHistory, parseActivityPage, type ExpenseHistoryState } from './activity';
import { draftFromExpense, parseExpenseContext, previewExpense } from './expense-draft';
import { parseExpenseRecord, type ExpenseRecord } from './expense-record';
import { MAX_PAGES, rowPaths, sharePages, STALE, type PageEnvelope } from './group-queries';
import { createSavedCopyQueue, notSaved, type Envelope } from './home-queries';
import { cachedRead } from './offline-cache';
import { keepInvalidated, queryOwner } from './query-owner';
import { RequestError, Superseded } from './transport';
import type { AccountStorageLease, MobileSnapshot, Route } from './types';

type Pages = InfiniteData<PageEnvelope, number>;
type Editor = MobileSnapshot['expense'];

/** A page holds 20 changes; the history keeps at most 5 pages, 100 changes, and slides (M1-3). */
const PAGE_SIZE = 20;
const notSavedHere = 'Could not save this view for offline use. Online data is still available.';
const historyUnsaved = 'This Expense’s changes aren’t saved on this device. Connect to see them.';
const historyFailed = 'Couldn’t load this Expense’s changes.';

/** The record answer's identity: whoever shows it parses its own shape (the record, Activity). */
const identity = z.object({
  status: z.literal(200),
  data: z.object({ _id: z.string(), group: z.string() }),
});
const checkIdentity = (value: unknown, groupId: string, expenseId: string) => {
  const { data } = identity.parse(value);
  if (data._id !== expenseId || data.group !== groupId) throw new Error('Unexpected Expense');
};

/** One parse per answer: structural sharing keeps an unchanged answer, and what shows, the same. */
const once = <T>(parse: (value: unknown, scope: string) => T) => {
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
const recordOf = once((value, scope) => {
  const [groupId, expenseId] = scope.split(':');
  return parseExpenseRecord(value, groupId, expenseId);
});
const pageOf = once((value, scope) => {
  const [groupId, expenseId, page] = scope.split(':');
  return parseActivityPage(value, groupId, Number(page), expenseId);
});
const contextOf = once((value) => parseExpenseContext(value));

/** `shown` again when nothing in `next` differs from it, so an unchanged read publishes nothing. */
const same = <T extends object>(shown: T, next: T): T =>
  (Object.keys(next) as (keyof T)[]).every((field) => shown[field] === next[field]) ? shown : next;
const failure = (state: QueryState<unknown, Error>) =>
  state.status !== 'error' || state.error instanceof Superseded ? null : state.error;
const unreachable = (error: unknown) =>
  error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';
/** A read under the Group refused: the Group's denial, which the transport has already purged. */
const denied = (error: unknown) => error instanceof RequestError && error.status === 403;

/** The record's row, or one page of its changes, under `/api/groups/:groupId`. */
const ownRow = (path: string, groupId: string) =>
  new RegExp(`^/api/groups/${groupId}/(expenses/[a-f\\d]{24}$|activity\\?expenseId=)`, 'i').test(
    path,
  );
/** Removes every saved copy of a Group's records and their changes from the persister's rows. */
export async function removeRecordRows(
  rows: FindableRecordStore | undefined,
  accountId: string,
  groupId: string,
  known: Iterable<string> = [],
) {
  if (!rows) return;
  for (const path of await rowPaths(rows, accountId, known))
    if (ownRow(path, groupId)) await rows.remove(accountId, path);
}

/** What an Expense record's screen needs from the session that owns it: the controller. */
export interface ExpenseSession {
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
  distrusted(key: QueryKey, early: boolean): number;
  savable(key: QueryKey): boolean;
  freshness: number;
  offline(): boolean;
  read(path: string, owner: number, signal?: AbortSignal): Promise<unknown>;
  answered(path: string, saved?: number | null): void;
  now(): number;
  /** The Group's query, which the Group's own view reads too (#219): one key per resource. */
  group: {
    options(groupId: string): QueryObserverOptions<Envelope, Error, Envelope, Envelope, QueryKey>;
    read(
      groupId: string,
      owner: number,
      options: { fresh: boolean; wanted: () => boolean },
    ): Promise<unknown>;
  };
  /** These saved copies couldn't be removed: never shown again, and deleted at the next start. */
  distrust(accountId: string, scopes: string[]): void;
  /** The session check that comes before the Group is read again on the foreground. */
  checkSession(owner: number): Promise<void>;
  /** Current Group context reaches the existing editor without replacing ordinary entries. */
  contextChecked(context: ReturnType<typeof parseExpenseContext>): Promise<void> | void;
  contextFailed(error: unknown): void;
  /** The Group refused the member on a read this screen made: what it shows goes. */
  refused(groupId: string, error: RequestError): void;
  /** The Expense shown is gone, as its own read said: nothing saved of it, at these paths, shows. */
  gone(paths: string[]): void;
  /** A missing Expense also makes its Group's saved ledger figures and pages obsolete. */
  missingLedger(groupId: string, owner: number): Promise<void>;
}

/** A read of a query: whether its request answered, and when it ends (as for a Group's view). */
type Run = {
  answered: boolean;
  reading: Promise<unknown>;
  abort?: AbortController;
  before?: Promise<unknown>;
  ended?: boolean;
};
/** This open of an Expense, until the member opens another. */
interface View {
  groupId: string;
  /** The saved Expense this open shows, once it wants one; null for a draft or a new Expense. */
  expenseId: string | null;
  /** This open's check of the Group passed: what is read for the record shows. */
  checked: boolean;
  /** The Group refused the member during this open: nothing more is read or shown. */
  lost: boolean;
  /** The record shows as read in this open: its changes are read, and follow it. */
  history: boolean;
  /** How many Try agains are reading this open's record again: while any is, it says so. */
  retrying: number;
}
type Read = {
  fresh?: boolean;
  wanted?: () => boolean;
  /** Called as the changes start being read, after a Load older or newer on its way lands. */
  starting?: () => void;
};

/**
 * An Expense record and its history on declarative queries (ADR 0006, M1-1; #220): the record's
 * Group (the query a Group's view reads, #219), the record, and its changes as one query of up to
 * 5 pages that slides past them (M1-3, M7-2). While the record shows, the three are observed; the
 * snapshot's record and changes are projected from them in today's shape, and a draft or an
 * unconfirmed save always comes first (M6-1). What is read from the server shows only once this
 * open's check of the Group passes; what this device already knew (a saved copy, an earlier
 * read) shows at once. Saved copies are the persister's rows: the record's, and one per page of
 * its changes, in the wire JSON (M3-1), written on a saved-copy queue (M3-2) and restored with
 * their own time, never fresh (AMEND-2). The foreground reads the Group again, through TanStack's
 * focus event only (M1-6); reconnecting reads what is stale (M1-4).
 */
export function createExpenseQueries(session: ExpenseSession) {
  const { client, rows } = session;
  const queue = createSavedCopyQueue();
  const runs = new Map<string, Run>();
  /** Each fetch's start, by its promise: whose session, and which query owns it. */
  const starts = new WeakMap<object, { owner: number; owns(): boolean }>();
  /** How many pages each fetch of the changes has read so far, by its promise. */
  const pagesRead = new WeakMap<object, number>();
  /**
   * The open each query's data was answered in, by a read from the server or this device's copy
   * when the server couldn't be reached; data restored to show while it is read, or read in an
   * earlier open, is what this device already knew.
   */
  const answered = new WeakMap<object, View>();
  /** How often `forget` removed each Group's rows: a row being written meanwhile goes too. */
  const forgotten = new Map<string, number>();
  /** The rows this session saved or restored: removable even by a store that can't list rows. */
  const known = new Set<string>();
  const reading = new WeakMap<object, Set<AbortController>>();
  let view: View | null = null;
  let observers: {
    group?: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>;
    record?: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>;
    history?: InfiniteQueryObserver<PageEnvelope, Error, Pages, QueryKey, number>;
  } = {};
  let pending = false;
  let rebinding = false;
  /** The foreground's read of the Group, which a foreground refresh waits for. */
  let foreground: Promise<void> = Promise.resolve();

  const held = <T>(key: QueryKey) => client.getQueryCache().get<T, Error>(hashKey(key));
  const stateOf = <T>(key: QueryKey | null) => {
    const query = key && held<T>(key);
    return query &&
      (query.state.data !== undefined ||
        query.state.fetchStatus === 'fetching' ||
        query.state.status === 'error')
      ? query.state
      : undefined;
  };
  const recordKey = (groupId: string, expenseId: string) =>
    expenseRecordKey(session.account(), groupId, expenseId);
  /** Every page of one Expense's changes: its Group's Activity, filtered to it. */
  const historyKey = (groupId: string, expenseId: string) =>
    expenseHistoryKey(session.account(), groupId, expenseId, PAGE_SIZE);
  /** A page of them, with the page before the size, as Android has always sent it. */
  const pagePath = (key: QueryKey, page: number) =>
    activityPagePath(key[3] as string, { expenseId: expenseOf(key), page, limit: PAGE_SIZE });
  const isHistory = (key: QueryKey) => queryKeyPath(key).includes('/activity?expenseId=');
  const expenseOf = (key: QueryKey) =>
    isHistory(key)
      ? new URL(queryKeyPath(key), 'http://local').searchParams.get('expenseId')!
      : queryKeyPath(key).split('/').pop()!;
  const isOwn = (key: QueryKey) =>
    key[0] === 'ledger' && key.length === 5 && ownRow(queryKeyPath(key), key[3] as string);

  /** A saved copy shows only if its own read's check passes on it. */
  const readable = (key: QueryKey, value: unknown, page = 1) => {
    try {
      const groupId = key[3] as string,
        expenseId = expenseOf(key);
      if (isHistory(key)) pageOf(value, `${groupId}:${expenseId}:${page}`);
      else checkIdentity(value, groupId, expenseId);
      return true;
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

  /**
   * Saves an answer as its row on the saved-copy queue, where a newer answer replaces it: the
   * record, or one page of its changes (`page`). The session, the account, the read's query owner and
   * whether its Group is kept here are checked at write time.
   */
  const saveRow = (
    key: QueryKey,
    { owner, owns }: { owner: number; owns(): boolean },
    { refreshedAt, value }: { refreshedAt: number; value: unknown },
    page?: number,
  ) => {
    const lease = session.lease(),
      path = page === undefined ? queryKeyPath(key) : pagePath(key, page);
    if (!lease || !rows) return;
    queue.push(path, async () => {
      if (!session.current(owner) || !session.owns(lease.accountId)) return;
      if (!owns() || !session.savable(key)) return;
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
   * While the record is first read, the row this device saved shows, with its own time (the
   * first page, for its changes). Never one a change, a denial or a failed removal made
   * obsolete, one it can't read, and never once a read of it answered.
   */
  const restore = async (key: QueryKey, owner: number) => {
    const lease = session.lease(),
      owns = queryOwner(client, key),
      started = runs.get(hashKey(key));
    if (!lease || !rows) return;
    const history = isHistory(key);
    const row = await savedRow(lease, history ? pagePath(key, 1) : queryKeyPath(key)).catch(
      () => null,
    );
    const latest = runs.get(hashKey(key));
    if (
      !row ||
      (latest && (latest !== started || latest.answered)) ||
      !session.current(owner) ||
      !owns() ||
      held(key)?.state.data !== undefined ||
      row.refreshedAt <= session.distrusted(key, true) ||
      !readable(key, row.value)
    )
      return;
    const copy = savedCopy(row);
    const data = history ? { pages: [{ ...copy, page: 1 }], pageParams: [1] } : copy;
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
      const running = reading.get(query) ?? new Set<AbortController>();
      reading.set(query, running.add(run.abort));
    }
    if (query?.promise && !starts.has(query.promise))
      starts.set(query.promise, {
        owner: session.generation(),
        owns: queryOwner(client, key),
      });
    return query;
  };
  /**
   * One read of `path`: sends it, or when SplitBook can't be reached, answers with the row saved
   * here for that path and its own time, offline (M4-5). Only its query's removal cancels it,
   * never leaving the record: an answer still current is kept and saved wherever it lands.
   */
  const fetchOne = async (
    key: QueryKey,
    path: string,
    run: Run,
    accept: (value: unknown) => void,
    page?: number,
  ): Promise<Envelope> => {
    if (run.before) await run.before.catch(() => undefined);
    const owner = session.generation(),
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
      // Overtaken by a change, a denial or a Groups list: it is read again, not shown.
      if (obsolete()) throw new Superseded();
      const saved =
        row && row.refreshedAt > session.distrusted(key, false) && readable(key, row.value, page)
          ? row
          : null;
      keepInvalidated(client, key);
      session.answered(path, saved?.refreshedAt ?? null);
      if (!saved)
        throw new RequestError(notSaved, 0, 'OFFLINE_UNAVAILABLE', false, null, 'network');
      return savedCopy(saved);
    }
    if (obsolete()) throw new Superseded();
    accept(value);
    session.answered(path);
    return { source: 'network', refreshedAt: Date.now(), value };
  };

  const readRecord = ({ queryKey }: QueryFunctionContext) => {
    const key = queryKey as QueryKey,
      run: Run = { answered: false, reading: Promise.resolve() };
    track(key, run);
    run.reading = fetchOne(key, queryKeyPath(key), run, (value) =>
      checkIdentity(value, key[3] as string, expenseOf(key)),
    );
    return run.reading as Promise<Envelope>;
  };
  /**
   * A page of the changes. When a later page of a read can't be read, the history ends there
   * (`failed`), keeping the pages read before it; offline, the page's saved copy answers for it.
   */
  const readPage = (context: QueryFunctionContext<QueryKey, unknown>) => {
    const key = context.queryKey,
      scope = `${key[3]}:${expenseOf(key)}`,
      page = context.pageParam as number,
      run: Run = { answered: false, reading: Promise.resolve() };
    const query = track(key, run);
    const fetch = query?.promise ?? {};
    const index = pagesRead.get(fetch) ?? 0;
    pagesRead.set(fetch, index + 1);
    const more = Boolean(query?.state.fetchMeta?.fetchMore);
    run.reading = (async (): Promise<PageEnvelope> => {
      try {
        const answer = await fetchOne(
          key,
          pagePath(key, page),
          run,
          (value) => void pageOf(value, `${scope}:${page}`),
          page,
        );
        return { ...answer, page };
      } catch (error) {
        if (
          index === 0 ||
          more ||
          denied(error) ||
          error instanceof Superseded ||
          (error instanceof RequestError && error.kind === 'cancelled')
        )
          throw error;
        return {
          source: 'failed',
          page,
          refreshedAt: Date.now(),
          value: null,
          message: historyFailed,
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
  // Nothing reads on its own: the screen's commands, the foreground and a reconnect read in order.
  const shared = {
    staleTime,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  } as const;
  const recordOptions = (groupId: string, expenseId: string, enabled = true, fresh = false) => ({
    ...shared,
    queryKey: recordKey(groupId, expenseId),
    queryFn: readRecord,
    enabled,
    ...(fresh ? { staleTime: STALE } : {}),
  });
  const historyOptions = (groupId: string, expenseId: string, enabled = true, fresh = false) => {
    const scope = `${groupId}:${expenseId}`;
    return {
      ...shared,
      queryKey: historyKey(groupId, expenseId),
      queryFn: readPage,
      initialPageParam: 1,
      getNextPageParam: (last: PageEnvelope) => {
        if (last.source === 'failed') return undefined;
        const { pagination } = pageOf(last.value, `${scope}:${last.page}`);
        return pagination.page < pagination.totalPages ? pagination.page + 1 : undefined;
      },
      getPreviousPageParam: (_first: PageEnvelope, _all: PageEnvelope[], param: number) =>
        param > 1 ? param - 1 : undefined,
      maxPages: MAX_PAGES,
      structuralSharing: sharePages,
      enabled,
      ...(fresh ? { staleTime: STALE } : {}),
    };
  };

  /**
   * The Expense screen of this open, and whether its editor holds the record it opened. `lost`:
   * also once the Group refused the member, as what shows is withdrawn.
   */
  const onScreen = (lost = false) => {
    const at = session.route(),
      { auth, expense } = session.snapshot();
    if (!view || (view.lost && !lost) || auth.status !== 'authenticated') return null;
    if (at.screen !== 'expense' || at.groupId !== view.groupId || expense.groupId !== view.groupId)
      return null;
    const holds = view.expenseId !== null && expense.draft?.original?._id === view.expenseId;
    return { expense, holds };
  };
  /** The record shows, read-only or behind its delete confirmation. */
  const recordShown = () => {
    const shown = onScreen();
    return !!shown?.holds && ['detail', 'delete-review'].includes(shown.expense.status);
  };

  /**
   * Observed while the record shows, and not once its Group refused the member. An observer
   * reads only what its query lacks, such as a query a denial or a Groups list removed: the record
   * once this open's check of the Group passed, and its changes once it shows as read.
   */
  const bind = () => {
    pending = false;
    if (!view || !recordShown()) return unbind();
    const { groupId, expenseId } = view as View & { expenseId: string };
    const groupNext = session.group.options(groupId);
    if (observers.group) observers.group.setOptions(groupNext);
    else {
      observers.group = new QueryObserver(client, groupNext);
      observers.group.subscribe(() => undefined);
    }
    // Enabled from the start, so this open's check never sets off another read of the record.
    const recordNext = recordOptions(groupId, expenseId);
    if (observers.record) observers.record.setOptions(recordNext);
    else {
      observers.record = new QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>(
        client,
        recordNext,
      );
      observers.record.subscribe(() => undefined);
    }
    const historyNext = historyOptions(groupId, expenseId, view.history);
    if (observers.history) observers.history.setOptions(historyNext);
    else {
      observers.history = new InfiniteQueryObserver<PageEnvelope, Error, Pages, QueryKey, number>(
        client,
        historyNext,
      );
      observers.history.subscribe(() => undefined);
    }
  };
  const unbind = () => {
    observers.group?.destroy();
    observers.record?.destroy();
    observers.history?.destroy();
    observers = {};
  };
  const bindLater = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      if (pending) bind();
    });
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
  };

  /**
   * The record as its query holds it, while the member reads it, never over a draft (M6-1). Until
   * this open's check of the Group passes, it shows as the open left it: what this device knew.
   */
  const projectRecord = (editor: Editor, opened: View & { expenseId: string }): Editor => {
    if (editor.status !== 'detail' || !opened.checked) return editor;
    const query = held<Envelope>(recordKey(opened.groupId, opened.expenseId)),
      data = query?.state.data;
    if (!query || !data) return editor;
    let record: ExpenseRecord | null = null;
    try {
      record = recordOf(data.value, `${opened.groupId}:${opened.expenseId}`);
    } catch {
      record = null;
    }
    // Shown from what this device knew, not read in this open: it says when it was verified,
    // whether it is being read again, and whether it is this device's saved copy.
    const was = editor.known,
      known =
        record && answered.get(data) !== opened
          ? {
              refreshedAt: data.refreshedAt,
              refreshing: query.state.fetchStatus === 'fetching',
              saved: data.source === 'saved',
            }
          : null;
    let next =
      was === known ||
      (was &&
        known &&
        was.refreshedAt === known.refreshedAt &&
        was.refreshing === known.refreshing &&
        was.saved === known.saved)
        ? editor
        : { ...editor, known };
    if (record && record !== editor.draft?.original) {
      const draft = draftFromExpense(record);
      next = { ...next, draft, preview: previewExpense(draft) };
    }
    return next;
  };
  /** The record's changes, from their query, in the snapshot's shape (#215). */
  const projectHistory = (
    shown: ExpenseHistoryState,
    opened: View & { expenseId: string },
  ): ExpenseHistoryState => {
    const { groupId, expenseId } = opened,
      key = historyKey(groupId, expenseId),
      state = stateOf<Pages>(key);
    if (!state) return shown;
    const data = state.data;
    let base: ExpenseHistoryState =
      shown.expenseId === expenseId ? shown : { ...emptyExpenseHistory(), expenseId };
    const read = (data?.pages ?? []).filter((page) => page.source !== 'failed');
    const failed = data?.pages.find((page) => page.source === 'failed');
    if (read.length) {
      const parsed = read.map((page) => pageOf(page.value, `${groupId}:${expenseId}:${page.page}`));
      // A change read on two pages, as changes are added above it, is listed once; the changes
      // shown stay the same list when nothing in them changed.
      const events = [
        ...new Map(
          parsed.flatMap((page) => page.events).map((event) => [event._id, event]),
        ).values(),
      ];
      const kept =
        events.length === base.events.length &&
        events.every((event, index) => event === base.events[index]);
      base = {
        ...base,
        expenseId,
        events: kept ? base.events : events,
        pagination: parsed[parsed.length - 1].pagination,
        firstPage: read[0].page,
        // Never fresher than its oldest page (#215).
        refreshedAt: Math.min(...read.map((page) => page.refreshedAt)),
        restored: read.some((page) => page.source === 'saved'),
        moreStatus: failed ? 'error' : 'idle',
      };
    }
    const direction = state.fetchMeta?.fetchMore?.direction;
    if (state.fetchStatus === 'fetching') {
      if (direction === 'forward') return same(shown, { ...base, moreStatus: 'loading' });
      if (direction === 'backward') return same(shown, { ...base, newerStatus: 'loading' });
      return same(shown, {
        ...base,
        status: 'loading',
        message: null,
        moreStatus: base.moreStatus === 'error' ? 'idle' : base.moreStatus,
        newerStatus: 'idle',
      });
    }
    // Not read in this open yet: what shows waits for the changes to be read.
    if (!opened.checked || !opened.history)
      return same(shown, { ...base, status: 'loading', message: null });
    const error = failure(state);
    if (state.status === 'error' && !error) return shown;
    if (error && direction === 'forward')
      return same(shown, { ...base, status: 'ready', moreStatus: 'error' });
    if (error && direction === 'backward')
      return same(shown, { ...base, status: 'ready', newerStatus: 'error' });
    if (error)
      return same(shown, {
        ...base,
        status: 'error',
        message: unreachable(error) ? historyUnsaved : historyFailed,
      });
    // Restored, or read in an earlier open: it shows while this open reads it.
    if (data && answered.get(data) !== opened)
      return same(shown, { ...base, status: 'loading', message: null });
    return same(shown, { ...base, status: 'ready', message: null, newerStatus: 'idle' });
  };
  /** The record and its changes, projected into `next` while the member is on them. */
  const project = (next: MobileSnapshot): MobileSnapshot => {
    const opened = view as (View & { expenseId: string }) | null;
    if (
      !opened ||
      opened.lost ||
      !opened.expenseId ||
      next.auth.status !== 'authenticated' ||
      next.screen !== 'expense' ||
      next.expense.groupId !== opened.groupId ||
      next.expense.draft?.original?._id !== opened.expenseId ||
      !['detail', 'delete-review', 'editing'].includes(next.expense.status)
    )
      return next;
    let expense = projectRecord(next.expense, opened);
    const history = projectHistory(expense.history, opened);
    if (history !== expense.history) expense = { ...expense, history };
    const refreshing = opened.retrying > 0;
    if (!!expense.refreshing !== refreshing) expense = { ...expense, refreshing };
    return expense === next.expense ? next : { ...next, expense };
  };
  /** A fetch that answered from the server: saved as its row(s) while still current. */
  const saveAnswer = (query: Query) => {
    if (client.getQueryCache().get(query.queryHash) !== query) return;
    const start = query.promise && starts.get(query.promise);
    const data = query.state.data as Envelope | Pages | undefined;
    if (!start || !data) return;
    const key = query.queryKey as QueryKey;
    if ('pages' in data) {
      for (const page of data.pages)
        if (page.source === 'network') saveRow(key, start, page, page.page);
    } else if (data.source === 'network') saveRow(key, start, data);
  };

  /** The Group's details for the form and the record: taken from each read of it. */
  const adoptContext = async (value: unknown, opened: View) => {
    const { expense } = session.snapshot();
    if (view !== opened || expense.groupId !== opened.groupId || expense.status === 'saving')
      return;
    const context = contextOf(value, '');
    if (expense.context !== context || expense.contextCheck) await session.contextChecked(context);
  };
  /**
   * The screen reads again: on the foreground by itself, the Group past its stale time, after the
   * session check every screen over a Group makes (M1-6); on reconnecting by itself, the Group,
   * then the record and its changes, whatever is stale (M1-4); on Try again, all of them, after
   * the session check (#192). One shown read-only takes the version read; an edit or a deletion
   * under review keeps its own (M6-1). A refusal, or the Expense gone, withdraws what shows.
   */
  const again = async (kind: 'foreground' | 'reconnect' | 'retry') => {
    const opened = view,
      owner = session.generation(),
      fresh = kind === 'retry';
    // On the screen of this open; once its Group refused the member, only Try again reads it.
    const here = (lost = kind === 'retry') =>
      session.current(owner) && view === opened && onScreen(lost) !== null;
    if (!opened || !here() || onScreen(true)!.expense.status === 'saving') return;
    // Try again on the record shown says so from the start, and its page controls wait, until
    // its changes are read again, which say so themselves (the device check of #220).
    let marked = kind === 'retry' && recordShown();
    if (marked) mark(opened, +1);
    /** The record's part is done: its mark goes, `quietly` with the next thing published. */
    const unmark = (quietly: boolean) => {
      if (marked) mark(opened, -1, quietly);
      marked = false;
    };
    let step: 'session' | 'group' | 'record' = 'session';
    try {
      if (kind !== 'reconnect') await session.checkSession(owner);
      if (!here()) return;
      step = 'group';
      const wanted = () => here();
      await adoptContext(
        await session.group.read(opened.groupId, owner, { fresh, wanted }),
        opened,
      );
      const { expense } = onScreen() ?? {},
        expenseId = expense?.draft?.original?._id;
      if (kind === 'foreground' || !here(false) || !expenseId) return;
      if (!['detail', 'delete-review', 'editing'].includes(expense!.status)) return;
      step = 'record';
      api.want(expenseId);
      await api.record(owner, { fresh, wanted });
      if (!here(false)) return;
      // Its changes being read again say so on their own, from the publish that starts them.
      await api.history(owner, { fresh, wanted, starting: () => unmark(true) });
    } catch (error) {
      if (here(true)) session.contextFailed(error);
      // The refusal has already withdrawn the record's queries: what shows goes too.
      if (step === 'session' || !here(true) || !(error instanceof RequestError)) return;
      if (error.status === 403 || (step === 'group' && error.status === 404))
        session.refused(opened.groupId, error);
      else if (error.status === 404 && opened.expenseId) {
        session.gone(recordPaths(opened.groupId, opened.expenseId));
        await api.drop(opened.groupId, opened.expenseId, owner);
      }
    } finally {
      unmark(false);
    }
  };
  /** A Try again of this open starts or ends: its record says so while it shows. */
  const mark = (opened: View, by: 1 | -1, quietly = false) => {
    opened.retrying = Math.max(0, opened.retrying + by);
    const before = session.snapshot();
    if (!quietly && view === opened && project(before) !== before) session.publish({});
  };
  /** Where an Expense's record and its pages of changes are read and saved. */
  const recordPaths = (groupId: string, expenseId: string) => [
    queryKeyPath(recordKey(groupId, expenseId)),
    `/api/groups/${groupId}/activity?expenseId=${expenseId}&`,
  ];

  const api = {
    project,
    shownKeys(next: MobileSnapshot): QueryKey[] {
      const { groupId, requestedExpenseId, draft } = next.expense;
      if (next.screen !== 'expense' || !groupId) return [];
      const keys = [session.group.options(groupId).queryKey!];
      const id = requestedExpenseId ?? draft?.original?._id;
      if (id) keys.push(recordKey(groupId, id), historyKey(groupId, id));
      return keys;
    },
    bindLater,
    /**
     * The observers take their queries again: removing a query never tells them (module-4 brief
     * F5), so they move to the new ones, which read what they lack.
     */
    rebind() {
      if (!observers.group) return;
      rebinding = true;
      try {
        bind();
      } finally {
        rebinding = false;
      }
    },
    /** The member opens an Expense in this Group: a new open, which checks the Group again. */
    open(groupId: string) {
      view = {
        groupId,
        expenseId: null,
        checked: false,
        lost: false,
        history: false,
        retrying: 0,
      };
    },
    /**
     * This open shows this saved Expense. Its changes are read from their newest page: pages
     * beyond it, from an earlier open, go from memory (#215).
     */
    want(expenseId: string) {
      if (!view || view.expenseId === expenseId) return;
      view.expenseId = expenseId;
      const key = historyKey(view.groupId, expenseId),
        query = held<Pages>(key),
        pages = query?.state.data;
      // A read an earlier open began, such as its Load older, isn't this open's: it goes.
      if (query?.state.fetchStatus === 'fetching')
        return void client.removeQueries({ queryKey: key, exact: true });
      if (!query || !pages || pages.pages.length < 2) return;
      if (pages.pageParams[0] === 1)
        client.setQueryData<Pages>(
          key,
          { pages: pages.pages.slice(0, 1), pageParams: [1] },
          { updatedAt: query.state.dataUpdatedAt },
        );
      else client.removeQueries({ queryKey: key, exact: true });
    },
    /**
     * What this device already knows of the record, an earlier read or its saved copy, shows at
     * once while the record is read again (the loading-state audit, #220), with its first page
     * of changes. Whether it shows.
     */
    async known(owner: number, groupDraft: Editor['groupDraft']) {
      const opened = view;
      if (!opened?.expenseId) return false;
      const key = recordKey(opened.groupId, opened.expenseId),
        history = historyKey(opened.groupId, opened.expenseId);
      await Promise.all([
        held(key)?.state.data === undefined ? restore(key, owner) : null,
        held(history)?.state.data === undefined ? restore(history, owner) : null,
      ]).catch(() => undefined);
      const data = held<Envelope>(key)?.state.data,
        editor = onScreen()?.expense;
      if (view !== opened || !data || answered.get(data) === opened || editor?.status !== 'loading')
        return false;
      try {
        const draft = draftFromExpense(
          recordOf(data.value, `${opened.groupId}:${opened.expenseId}`),
        );
        const preview = previewExpense(draft);
        const known = {
          refreshedAt: data.refreshedAt,
          refreshing: true,
          saved: data.source === 'saved',
        };
        session.publish({
          expense: { ...editor, draft, preview, status: 'detail', groupDraft, known },
        });
        return true;
      } catch {
        return false;
      }
    },
    /** This open's check of the Group passed: what is read for the record can show. */
    check() {
      if (!view) return;
      view.checked = true;
      bindLater();
    },
    /** Reads the Group for this open, joining a read in flight; `fresh` reads it again. */
    group(owner: number, { fresh = true, wanted = () => true }: Read = {}) {
      const opened = view!;
      return session.group.read(opened.groupId, owner, { fresh, wanted });
    },
    /** Reads the record this open shows (`fresh`: again now), parsed as the record shows it. */
    async record(owner: number, { fresh = false, wanted = () => true }: Read = {}) {
      const opened = view as View & { expenseId: string };
      // Once its Group refused the member, nothing of this open is read again.
      const still = () => wanted() && view === opened && !opened.lost;
      const answer = await readNow<Envelope>(
        recordOptions(opened.groupId, opened.expenseId, true, fresh),
        owner,
        still,
      );
      return recordOf(answer.value, `${opened.groupId}:${opened.expenseId}`);
    },
    /**
     * Reads a saved Expense's record for another screen (an Activity event's detail): the same
     * query, joining a read in flight, and saved the same way. The caller parses its own shape.
     */
    async recordOf(groupId: string, expenseId: string, owner: number, wanted: () => boolean) {
      return (await readNow<Envelope>(recordOptions(groupId, expenseId, true, true), owner, wanted))
        .value;
    },
    /**
     * Reads the record's changes: every page loaded, from the window's first, up to 5 (M1-3), or
     * the newest page when none is. Once the record shows as read, they follow it.
     */
    async history(
      owner: number,
      { fresh = false, wanted = () => true, starting = () => undefined }: Read = {},
    ) {
      const opened = view;
      if (!opened?.expenseId || opened.lost) return;
      opened.history = true;
      bindLater();
      const still = () => wanted() && view === opened && !opened.lost;
      // A read again would join a Load older or newer still on its way: that page lands first,
      // then every page loaded is read again.
      const loading = held<Pages>(historyKey(opened.groupId, opened.expenseId));
      if (
        fresh &&
        loading?.state.fetchStatus === 'fetching' &&
        loading.state.fetchMeta?.fetchMore
      ) {
        await loading.promise?.catch(() => undefined);
        if (!still()) throw new Superseded();
      }
      starting();
      await readNow<Pages>(
        historyOptions(opened.groupId, opened.expenseId, true, fresh),
        owner,
        still,
      ).catch((error: unknown) => {
        // Shown on the history, beside the record; a refusal has withdrawn both already.
        if (error instanceof Superseded) throw error;
      });
    },
    /**
     * Load older: the next older page. Past 5 pages the window slides and the newest page drops;
     * a page that couldn't be read before is read again, in its place.
     */
    async loadOlder() {
      const opened = view;
      if (!opened?.expenseId || !recordShown()) return;
      const key = historyKey(opened.groupId, opened.expenseId),
        state = stateOf<Pages>(key);
      if (!state?.data || state.fetchStatus === 'fetching' || !opened.history) return;
      const { pages, pageParams } = state.data;
      const last = pages[pages.length - 1];
      if (last.source === 'failed')
        client.setQueryData<Pages>(
          key,
          { pages: pages.slice(0, -1), pageParams: pageParams.slice(0, -1) },
          { updatedAt: held(key)?.state.dataUpdatedAt },
        );
      else {
        const { pagination } = pageOf(
          last.value,
          `${opened.groupId}:${opened.expenseId}:${last.page}`,
        );
        if (pagination.page >= pagination.totalPages) return;
      }
      bind();
      await observers.history?.fetchNextPage({ cancelRefetch: false });
    },
    /** Load newer: the page before the window, which drops the window's oldest page. */
    async loadNewer() {
      const opened = view;
      if (!opened?.expenseId || !recordShown()) return;
      const state = stateOf<Pages>(historyKey(opened.groupId, opened.expenseId));
      if (
        !state?.data ||
        state.fetchStatus === 'fetching' ||
        !opened.history ||
        (state.data.pageParams[0] ?? 1) <= 1
      )
        return;
      bind();
      await observers.history?.fetchPreviousPage({ cancelRefetch: false });
    },
    /** Settles once the foreground's read of the screen has. */
    settle: () => foreground,
    /** Try again: the session, the Group, then the record and its changes, read again now. */
    retry: () => again('retry'),
    /**
     * Try again on the record's changes, also while it is edited: every page loaded is read
     * again, from the window's first, and the changes shown stay until they land (M1-3).
     */
    async retryHistory() {
      const opened = view,
        { expense } = onScreen() ?? {},
        expenseId = expense?.draft?.original?._id;
      if (!expenseId || !['detail', 'delete-review', 'editing'].includes(expense!.status)) return;
      api.want(expenseId);
      const wanted = () => view === opened;
      await api.history(session.generation(), { fresh: true, wanted }).catch(() => undefined);
    },
    /**
     * The member lost this Group: the record's screen reads and observes nothing more, so a
     * removed query's observer can't read it back, and a late answer lands nowhere.
     */
    lose(groupId: string) {
      if (view?.groupId !== groupId) return;
      view.lost = true;
      view.checked = false;
      unbind();
    },
    /**
     * The record's own read found the Expense gone, once its Group was checked: its queries and
     * rows go, with any still waiting to be written, so nothing of it shows again, at once or after
     * a restart. A row that can't be removed is no longer trusted (#323).
     */
    async drop(groupId: string, expenseId: string, owner: number) {
      const paths = recordPaths(groupId, expenseId);
      queue.drop(paths[0]);
      for (const page of held<Pages>(historyKey(groupId, expenseId))?.state.data?.pageParams ?? [])
        queue.drop(pagePath(historyKey(groupId, expenseId), page));
      await session.missingLedger(groupId, owner);
    },
    /** Removes a Group's record and history rows, inside a lease write: a change or a loss. */
    async forget(accountId: string, groupId: string) {
      if (!rows) return;
      forgotten.set(groupId, (forgotten.get(groupId) ?? 0) + 1);
      await removeRecordRows(rows, accountId, groupId, known);
    },
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
     * Returning to the foreground and reconnecting (M1-4, M1-6): TanStack's focus and online
     * events reach the Expense screen here, as they reach a Group's view. Answers publish
     * wherever they land, and are saved as rows. Returns what stops listening.
     */
    listen(focus: typeof focusManager, online: typeof onlineManager) {
      const stops = [
        client.getQueryCache().subscribe((event) => {
          // A removed query's requests are obsolete: they are cancelled, never offline (#214).
          if (event.type === 'removed') {
            reading.get(event.query)?.forEach((abort) => abort.abort());
            return;
          }
          // Invalidation changes preview eligibility, not the content a response projects.
          if (event.type !== 'updated' || event.action.type === 'invalidate') return;
          const { query } = event,
            key = query.queryKey as QueryKey;
          if (!isOwn(key)) return;
          const own = !!view && key[3] === view.groupId && expenseOf(key) === view.expenseId;
          if (event.action.type === 'success' && !event.action.manual) {
            saveAnswer(query);
            if (own && query.state.data) answered.set(query.state.data as object, view!);
          }
          if (!own) return;
          if (client.getQueryCache().get(query.queryHash) !== query) return;
          const before = session.snapshot();
          if (project(before) !== before) session.publish({});
        }),
        focus.subscribe((focused) => {
          if (focused) foreground = again('foreground');
        }),
        online.subscribe((connected) => {
          if (connected) void again('reconnect');
        }),
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
      foreground = Promise.resolve();
    },
  };
  return api;
}
