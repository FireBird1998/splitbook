import {
  hashKey,
  InfiniteQueryObserver,
  QueryObserver,
  type focusManager,
  type InfiniteData,
  type onlineManager,
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
import {
  MAX_PAGES,
  createSavedReadEngine,
  parseOnce,
  rowPaths,
  sharePages,
  STALE,
  type Envelope,
  type PageEnvelope,
} from './saved-read-engine';
import { RequestError, Superseded } from './transport';
import type { AccountStorageLease, MobileSnapshot, Route } from './types';

type Pages = InfiniteData<PageEnvelope, number>;
type Editor = MobileSnapshot['expense'];

/** A page holds 20 changes; the history keeps at most 5 pages, 100 changes, and slides (M1-3). */
const PAGE_SIZE = 20;
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

const recordOf = parseOnce((value, scope) => {
  const [groupId, expenseId] = scope.split(':');
  return parseExpenseRecord(value, groupId, expenseId);
});
const pageOf = parseOnce((value, scope) => {
  const [groupId, expenseId, page] = scope.split(':');
  return parseActivityPage(value, groupId, Number(page), expenseId);
});
const contextOf = parseOnce((value) => parseExpenseContext(value));

/** `shown` again when nothing in `next` differs from it, so an unchanged read publishes nothing. */
const same = <T extends object>(shown: T, next: T): T =>
  (Object.keys(next) as (keyof T)[]).every((field) => shown[field] === next[field]) ? shown : next;
const failure = (state: QueryState<unknown, Error>) =>
  state.status !== 'error' || state.error instanceof Superseded ? null : state.error;
const unreachable = (error: unknown) =>
  error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';

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
  /** This open's re-reads under way, which the internet's return waits for (#681). */
  rereads: Set<Promise<void>>;
  /** How many returns of the internet this open has heard (#681). */
  recoveries: number;
  /** One is being handled: another heard meanwhile is handled once its reads end. */
  recovering: boolean;
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
  const { client } = session;
  /** How many pages each fetch of the changes has read so far, by its promise. */
  const pagesRead = new WeakMap<object, number>();
  /**
   * The open each query's data was answered in, by a read from the server or this device's copy
   * when the server couldn't be reached; data restored to show while it is read, or read in an
   * earlier open, is what this device already knew.
   */
  const answered = new WeakMap<object, View>();
  let view: View | null = null;
  let observers: {
    group?: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>;
    record?: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>;
    history?: InfiniteQueryObserver<PageEnvelope, Error, Pages, QueryKey, number>;
  } = {};
  let pending = false;
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
  const engine = createSavedReadEngine(session, {
    path: (key, page) => (page === undefined ? queryKeyPath(key) : pagePath(key, page)),
    readable,
    ownsKey: isOwn,
    rowScope: {
      groupId: (key) => key[3] as string,
      remove: removeRecordRows,
      pathGroup: (path) => {
        const id = /^\/api\/groups\/([a-f\d]{24})\//i.exec(path)?.[1];
        return id && ownRow(path, id) ? id : null;
      },
      distrust: (key) => [`ledger:${key[3]}`],
    },
    refusal: 'forbidden-only',
    preview: 'same-run-unanswered',
    automaticRefetch: false,
    cancelOnRemove: true,
    staleWhenOffline: true,
    recover: () => recover(),
  });
  // Preview projection is the view's: one record or the first history page.
  const restore = (key: QueryKey, owner: number) =>
    engine.restore(
      key,
      owner,
      isHistory(key)
        ? { page: 1, project: (copy) => ({ pages: [{ ...copy, page: 1 }], pageParams: [1] }) }
        : {},
    );

  const readRecord = ({ queryKey }: QueryFunctionContext) => {
    const key = queryKey as QueryKey;
    return engine.read({
      key,
      accept: (value) => checkIdentity(value, key[3] as string, expenseOf(key)),
    });
  };
  /**
   * A page of the changes. When a later page of a read can't be read, the history ends there
   * (`failed`), keeping the pages read before it; offline, the page's saved copy answers for it.
   */
  const readPage = (context: QueryFunctionContext<QueryKey, unknown>) => {
    const key = context.queryKey,
      scope = `${key[3]}:${expenseOf(key)}`,
      page = context.pageParam as number,
      query = held(key),
      fetch = query?.promise ?? {};
    const index = pagesRead.get(fetch) ?? 0;
    pagesRead.set(fetch, index + 1);
    const more = Boolean(query?.state.fetchMeta?.fetchMore);
    return engine.read<PageEnvelope>({
      key,
      page,
      accept: (value) => void pageOf(value, `${scope}:${page}`),
      project: (answer) => ({ ...answer, page }),
      failure: (error) => {
        if (
          index === 0 ||
          more ||
          engine.refuses(error) ||
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
      },
    });
  };
  const shared = engine.shared;
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

  const readNow = engine.readNow;

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
   * then the record and its changes, whatever is stale (M1-4), except for a record that shows
   * nothing (#694); on Try again, all of them, after the session check (#192). One shown
   * read-only takes the version read; an edit or a deletion under review keeps its own (M6-1). A
   * refusal, or the Expense gone, withdraws what shows.
   */
  const readAgain = async (kind: 'foreground' | 'reconnect' | 'retry') => {
    const opened = view,
      owner = session.generation(),
      fresh = kind === 'retry';
    // On the screen of this open; once its Group refused the member, only Try again reads it.
    const here = (lost = kind === 'retry') =>
      session.current(owner) && view === opened && onScreen(lost) !== null;
    if (!opened || !here() || onScreen(true)!.expense.status === 'saving') return;
    // A record that shows nothing has nothing to read again: one that couldn't open offline opens
    // again instead (the controller, #694), and one Splitbook refused, found gone or failed stays
    // until Try again. A new form whose Group couldn't be checked still reads its Group.
    if (kind === 'reconnect' && opened.expenseId && !onScreen(true)!.expense.draft) return;
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
      if (engine.refuses(error, step === 'group' ? 'forbidden-or-missing' : 'forbidden-only'))
        session.refused(opened.groupId, error);
      else if (error.status === 404 && opened.expenseId) {
        session.gone(recordPaths(opened.groupId, opened.expenseId));
        await api.drop(opened.groupId, opened.expenseId, owner);
      }
    } finally {
      unmark(false);
    }
  };
  /** The screen reads again (`readAgain`), as one of this open's re-reads under way. */
  const again = (kind: 'foreground' | 'reconnect' | 'retry') => {
    const opened = view,
      reading = readAgain(kind);
    if (opened) {
      opened.rereads.add(reading);
      const done = () => opened.rereads.delete(reading);
      reading.then(done, done);
    }
    return reading;
  };
  /**
   * Waits until this open reads nothing: neither a re-read nor any query it shows. Bounded, as
   * Activity's `settle` is.
   */
  const untilReadsEnd = async (opened: View) => {
    for (let round = 0; round < 1000 && view === opened; round += 1) {
      const fetching = api
        .shownKeys(session.snapshot())
        .map((key) => held(key))
        .filter((query) => query?.state.fetchStatus === 'fetching')
        .map((query) => query!.promise);
      const reading = [...opened.rereads, ...fetching];
      if (!reading.length) return;
      await Promise.allSettled(reading);
    }
  };
  /**
   * The internet returned while the device stayed connected, so the online manager didn't change
   * (#681, as #678 for a Group's view). A record that shows this phone's copy, or a read that
   * failed offline, reads again once, as on reconnecting: the offline banner clears when that read
   * lands. A failure Splitbook answered stays until Try again. A read under way may still end
   * offline, so the record first waits for its reads to end.
   */
  const recover = async () => {
    const opened = view,
      owner = session.generation();
    if (!opened || !onScreen()) return;
    opened.recoveries += 1;
    if (opened.recovering) return;
    opened.recovering = true;
    try {
      for (let handled = 0; handled !== opened.recoveries; ) {
        handled = opened.recoveries;
        await untilReadsEnd(opened);
        if (!session.current(owner) || view !== opened || !onScreen() || !session.offline()) return;
        await again('reconnect');
      }
    } finally {
      opened.recovering = false;
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
      engine.rebind(bind);
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
        rereads: new Set(),
        recoveries: 0,
        recovering: false,
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
    /** The internet returned on the connection the device kept (#681): Home's NetInfo says so. */
    recover: engine.recover,
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
      engine.drop([
        paths[0],
        ...(held<Pages>(historyKey(groupId, expenseId))?.state.data?.pageParams ?? []).map((page) =>
          pagePath(historyKey(groupId, expenseId), page),
        ),
      ]);
      await session.missingLedger(groupId, owner);
    },
    /** Removes a Group's record and history rows, inside a lease write: a change or a loss. */
    forget: engine.forget,
    /** Keeps only the listed Groups' saved copies. */
    retain: engine.retain,
    /**
     * Returning to the foreground and reconnecting (M1-4, M1-6): TanStack's focus and online
     * events reach the Expense screen here, as they reach a Group's view. Answers publish
     * wherever they land, and are saved as rows. Returns what stops listening.
     */
    listen(focus: typeof focusManager, online: typeof onlineManager) {
      const stops = [
        engine.listen(),
        client.getQueryCache().subscribe((event) => {
          // Invalidation changes preview eligibility, not the content a response projects.
          if (event.type !== 'updated' || event.action.type === 'invalidate') return;
          const { query } = event,
            key = query.queryKey as QueryKey;
          if (!isOwn(key)) return;
          const own = !!view && key[3] === view.groupId && expenseOf(key) === view.expenseId;
          if (event.action.type === 'success' && !event.action.manual) {
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
    idle: engine.idle,
    /** The session ended (M10-2): nothing waiting is written, nothing is observed. */
    reset() {
      unbind();
      engine.reset();
      view = null;
      foreground = Promise.resolve();
    },
  };
  return api;
}
