import {
  CancelledError,
  hashKey,
  QueryObserver,
  type focusManager,
  type onlineManager,
  type QueryClient,
  type QueryFunctionContext,
  type QueryObserverOptions,
  type QueryState,
} from '@tanstack/query-core';
import {
  groupsKey,
  homeBalancesKey,
  queryKeyPath,
  type QueryAccount,
  type QueryKey,
} from '@splitbook/shared/query-keys';
import type { AccountGroupRecordStore } from './account-record-storage';
import { parseStoredExpenseDraft } from './expense-draft';
import { parseGroups } from './dto';
import { parseHomeBalances } from './financial-dto';
import { cachedRead } from './offline-cache';
import { RequestError, Superseded } from './transport';
import type {
  AccountStorageLease,
  ExpenseDraftSummary,
  HomeFinancialState,
  MobileGroup,
  MobileSnapshot,
  NetworkState,
} from './types';

/**
 * A display read as the query cache holds it (ADR 0006, AMEND-2): the server's JSON as received,
 * parsed only when used, and when it was verified. `saved` marks a copy restored from this
 * device, which is never fresh.
 */
export type Envelope = { source: 'network' | 'saved'; refreshedAt: number; value: unknown };
type Read = QueryState<Envelope, Error>;
/** Home's queries' paths: the Groups list, then Home's figures. */
export const listPath = '/api/groups',
  homePath = '/api/user/balances';
/** The server can't be reached, and this device has no saved copy of the view. */
export const notSaved = 'This view was not saved on this device. Connect to load it.';
const notSavedHere = 'Could not save this view for offline use. Online data is still available.';

export function emptyHome(): HomeFinancialState {
  return {
    status: 'idle',
    data: null,
    byGroup: {},
    message: null,
    refreshedAt: null,
    stale: false,
  };
}

/**
 * Home's Expense drafts in this account's listed Groups. A draft with a submission or change
 * pending may already be recorded, so it's first; an unreadable one is left to its Group's form.
 */
export function draftSummaries(
  records: { groupId: string; value: unknown }[],
  accountId: string,
  groups: MobileGroup[],
): ExpenseDraftSummary[] {
  const position = (groupId: string) => groups.findIndex((group) => group.id === groupId);
  return records
    .flatMap(({ groupId, value }) => {
      const group = groups.find((item) => item.id === groupId);
      if (!group) return [];
      try {
        const { draft, attempt, mutation } = parseStoredExpenseDraft(value, accountId, groupId);
        return [
          {
            groupId,
            groupName: group.name,
            expenseId: draft.original?._id ?? null,
            description: draft.description,
            amount: draft.amount,
            currency: draft.currency,
            unconfirmed: attempt !== null || mutation !== null,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort(
      (a, b) =>
        Number(b.unconfirmed) - Number(a.unconfirmed) || position(a.groupId) - position(b.groupId),
    );
}

/** One parse per answer: structural sharing keeps an unchanged answer, and its rows, the same. */
const memo = <T>(parse: (value: unknown) => T) => {
  const parsed = new WeakMap<object, T>();
  return (value: unknown) => {
    const known = parsed.get(value as object);
    if (known) return known;
    const fresh = parse(value);
    parsed.set(value as object, fresh);
    return fresh;
  };
};
const listOf = memo(parseGroups);
const figuresOf = memo(parseHomeBalances);

/** `shown` again when nothing in `next` differs from it, so an unchanged read publishes nothing. */
const same = <T extends object>(shown: T, next: T): T =>
  (Object.keys(next) as (keyof T)[]).every((field) => shown[field] === next[field]) ? shown : next;

/** A refusal or failure: its message, unless it's no answer at all (the read was superseded). */
const failure = (read: Read) =>
  read.status !== 'error' || read.error instanceof Superseded ? null : read.error;

/**
 * Home's Groups list as its query holds it (ADR 0006, M1-1), in the shape Home has always
 * shown: what is on screen stays, marked loading, while it is read, and stays beside a failure.
 */
export function projectGroups(read: Read, shown: MobileSnapshot['groups']) {
  const data = read.data && listOf(read.data.value);
  if (read.fetchStatus === 'fetching')
    return same(shown, {
      status: 'loading',
      data: data ?? shown.data,
      message: null,
      loaded: shown.loaded || !!data,
    });
  if (read.status === 'success' && data)
    return same(shown, { status: 'ready', data, message: null, loaded: true });
  const error = failure(read);
  if (!error) return shown;
  const denied = error instanceof RequestError && error.status === 403;
  return same(shown, {
    status: denied ? 'denied' : 'error',
    data: denied ? [] : shown.data,
    message:
      error instanceof RequestError
        ? error.message
        : 'The server returned invalid group data. Please refresh.',
    loaded: shown.loaded,
  });
}

/**
 * Home's figures as their query holds them, in the shape Home has always shown. Figures on
 * screen keep their time while they are read again; a saved copy shows until the read lands.
 */
export function projectHome(read: Read, shown: HomeFinancialState): HomeFinancialState {
  const figures = read.data && figuresOf(read.data.value);
  if (read.fetchStatus === 'fetching')
    return same(shown, {
      ...shown,
      status: 'loading',
      message: null,
      ...(figures && shown.data === null
        ? { data: figures.buckets, byGroup: figures.byGroup, refreshedAt: read.data!.refreshedAt }
        : {}),
    });
  if (read.status === 'success' && figures)
    return same(shown, {
      status: 'ready',
      data: figures.buckets,
      byGroup: figures.byGroup,
      message: null,
      refreshedAt: read.data!.refreshedAt,
      stale: false,
    });
  const error = failure(read);
  if (!error) return shown;
  const denied = error instanceof RequestError && error.status === 403;
  return {
    ...(denied ? emptyHome() : shown),
    status: denied ? 'denied' : 'error',
    message:
      error instanceof RequestError
        ? error.message
        : 'Could not load your balances. Please try again.',
  };
}

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

/** What Home's queries need from the session that owns them: the controller. */
export interface HomeSession {
  client: QueryClient;
  /** The API the app reads from: every key holds it, with the account. */
  environment: string;
  /** The persister's rows (M3-1); without them nothing is saved or restored. */
  rows?: AccountGroupRecordStore;
  /** This device's Expense drafts, which Home lists. */
  drafts?: AccountGroupRecordStore;
  /** The signed-in account in this environment; throws `Superseded` when there is none. */
  account(): QueryAccount;
  generation(): number;
  current(owner: number): boolean;
  snapshot(): MobileSnapshot;
  publish(next: Partial<MobileSnapshot>): void;
  /** Home shows in a signed-in session. */
  shows(): boolean;
  lease(): AccountStorageLease | null;
  /** The account lease's own checks, at write time: still this account, with no clean-up. */
  owns(accountId: string): boolean;
  versionOf(key: QueryKey): number;
  /**
   * A saved copy of `key` stands in for a read only when verified after this: a removal this
   * device couldn't make, and when only shown early, a change or denial too.
   */
  distrusted(key: QueryKey, early: boolean): number;
  /** Sends the read, checking the session first while offline. */
  read(path: string, owner: number): Promise<unknown>;
  /** Where a read's answer came from: the server, or this device's copy from then (or none). */
  answered(path: string, saved?: number | null): void;
  /** A Groups list from the server holds `listed`, and leaves out `lost`: they go from memory. */
  listed(listed: Set<string>, lost: Set<string>): void;
  /** The older saved-copy store keeps only these Groups' copies (inside a lease write). */
  retain(accountId: string, listed: string[]): Promise<void> | undefined;
  /** This account's saved copies in these scopes couldn't be removed: never shown again. */
  distrust(accountId: string, scopes: string[]): void;
  /** Reads in these scopes are obsolete, and their saved copies before now are never shown. */
  invalidate(...scopes: string[]): void;
  now(): number;
}

/** Each of Home's reads: whether its request answered, and when it ends. */
type HomeRead = { answered: boolean; ended?: boolean; reading: Promise<Envelope> };
/** Checks an answer, and returns what it sets off, which runs only if it is still current. */
type Accept = (value: unknown, owner: number) => (() => Promise<void>) | void;

/** Which `listen` wired NetInfo to TanStack's online manager: only it unwires it. */
const wired = new WeakMap<object, object>();

/**
 * Home's two queries (ADR 0006, M1-1): the Groups list and Home's figures. The current screen
 * decides whether they are active: while Home shows they are observed, so they read what they
 * lack or what is past its stale time, and focus and reconnect reach them (M1-4, M1-6). Their
 * saved copies are the persister's rows: one per query, in the wire JSON (M3-1), written on the
 * saved-copy queue (M3-2) and restored with their own time, never fresh (AMEND-2).
 */
export function createHomeQueries(session: HomeSession) {
  const { client, rows } = session;
  const queue = createSavedCopyQueue();
  /** Runs inside `quietly`: its reads' starts publish nothing, the publish after it shows them. */
  let quiet = 0;
  const reads = new Map<string, HomeRead>();
  let observers: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey>[] = [],
    stop: (() => void)[] = [],
    pending = false,
    rebinding = false,
    /** Home's figures wait for a Groups list read first, as on a sign-in or a restore. */
    figuresWait = false;

  const keys = () => [groupsKey(session.account()), homeBalancesKey(session.account())] as const;
  const memberOfAll = (groups: MobileGroup[]) =>
    groups.every((group) =>
      group.members.some((member) => member.user.id === session.snapshot().auth.user?.id),
    );
  const held = (key: QueryKey) => client.getQueryCache().get<Envelope, Error>(hashKey(key))?.state;
  /** A saved copy shows only if its decoder reads it, and a Groups list lists the member. */
  const readable = (key: QueryKey, value: unknown) => {
    try {
      return key[0] === 'groups' ? memberOfAll(listOf(value)) : Boolean(figuresOf(value));
    } catch {
      return false;
    }
  };
  /** How often `forget` removed each row: one being written meanwhile goes once it lands. */
  const forgotten = new Map<string, number>();
  /** The persister's row for `path`, read on the account queue, checked like every saved copy. */
  const savedRow = async (lease: AccountStorageLease, path: string) =>
    cachedRead(
      await lease.write(() => rows!.load(lease.accountId, path)),
      lease.accountId,
      path,
      session.now(),
    );
  /** The Groups this device's saved list lists, inside a lease write: null if it can't be read. */
  const savedIds = async (accountId: string) => {
    try {
      const row = await rows?.load(accountId, listPath),
        read = cachedRead(row, accountId, listPath, session.now());
      return read ? listOf(read.value).map(({ id }) => id) : [];
    } catch {
      return null;
    }
  };
  /**
   * Saves an answer as its row on the saved-copy queue, where a newer answer replaces it. The
   * session, the account and the read's version are checked at write time, so nothing lands
   * after sign-out, an account change or a change that made it obsolete.
   */
  const saveRow = (
    key: QueryKey,
    owner: number,
    version: number,
    { refreshedAt, value }: Envelope,
  ) => {
    const lease = session.lease(),
      path = queryKeyPath(key);
    if (!lease || !rows) return;
    queue.push(path, async () => {
      if (!session.current(owner) || !session.owns(lease.accountId)) return;
      if (version !== session.versionOf(key)) return;
      const { accountId } = lease,
        removed = forgotten.get(path),
        row = { version: 1, accountId, path, groupId: null, refreshedAt, value };
      await rows.save(accountId, path, row).catch(() => {
        const { offline } = session.snapshot();
        if (session.current(owner))
          session.publish({ offline: { ...offline, message: notSavedHere } });
      });
      // Removed while it was being written: it goes too, since `forget` never waits for it.
      if (forgotten.get(path) !== removed)
        await rows.remove(accountId, path).catch(() => session.distrust(accountId, [key[0]]));
    });
  };
  /**
   * While a query is first read, the row this device saved for it shows, with its own time. Never
   * one a change, a denial or a failed removal made obsolete, one it can't read, and never once
   * the read answered.
   */
  const restoreRow = async (key: QueryKey, owner: number, read: HomeRead) => {
    const lease = session.lease(),
      version = session.versionOf(key);
    if (!lease || !rows) return;
    const row = await savedRow(lease, queryKeyPath(key)).catch(() => null);
    const state = held(key);
    // Its load waits on the account queue, where an answer's trim may already be waiting too.
    if (
      !row ||
      read.answered ||
      !session.current(owner) ||
      version !== session.versionOf(key) ||
      state?.fetchStatus !== 'fetching' ||
      state.data !== undefined ||
      row.refreshedAt <= session.distrusted(key, true) ||
      !readable(key, row.value)
    )
      return;
    client.setQueryData(key, { source: 'saved', refreshedAt: row.refreshedAt, value: row.value });
  };

  /**
   * One read of a query. An answer still current is checked by `accept`, then what it sets off
   * runs, and it is saved as its row; when SplitBook can't be reached, the row saved here answers
   * with its own time, offline (M4-5). It takes no signal, so leaving Home never cancels it: its
   * answer shows wherever it lands (#190).
   */
  const readHome = async (
    key: QueryKey,
    accept: Accept,
    shown: () => boolean,
    read: HomeRead,
    before?: Promise<unknown>,
  ): Promise<Envelope> => {
    if (before) await before.catch(() => undefined);
    const path = queryKeyPath(key),
      owner = session.generation(),
      version = session.versionOf(key),
      lease = session.lease();
    const obsolete = () => !session.current(owner) || version !== session.versionOf(key);
    if (!shown()) void restoreRow(key, owner, read).catch(() => undefined);
    let value: unknown;
    try {
      value = await session.read(path, owner);
      read.answered = true;
    } catch (error) {
      read.answered = true;
      if (!(error instanceof RequestError) || !error.networkFailure || !lease || !rows) throw error;
      const row = obsolete() ? null : await savedRow(lease, path).catch(() => null);
      // Overtaken by a change, a denial or a Groups list: it was read again, not shown.
      if (obsolete()) throw new Superseded();
      const saved =
        row && row.refreshedAt > session.distrusted(key, false) && readable(key, row.value)
          ? row
          : null;
      session.answered(path, saved?.refreshedAt ?? null);
      if (!saved)
        throw new RequestError(notSaved, 0, 'OFFLINE_UNAVAILABLE', false, null, 'network');
      return { source: 'saved', refreshedAt: saved.refreshedAt, value: saved.value };
    }
    // An answer a change, a denial or a newer Groups list overtook sets off nothing.
    if (obsolete()) throw new Superseded();
    await accept(value, owner)?.();
    const verified: Envelope = { source: 'network', refreshedAt: Date.now(), value };
    if (obsolete()) throw new Superseded();
    session.answered(path);
    saveRow(key, owner, version, verified);
    return verified;
  };
  const queryFn =
    (accept: Accept, shown: () => boolean) =>
    ({ queryKey }: QueryFunctionContext): Promise<Envelope> => {
      const key = queryKey as QueryKey,
        path = queryKeyPath(key),
        previous = reads.get(path),
        read: HomeRead = { answered: false, reading: Promise.resolve(null!) };
      // A read that replaces one a change cancelled waits for that one's request to end, as does a
      // Groups list read for an earlier list still trimming saved copies, so trims land in order.
      const wait = !previous?.ended && (rebinding || (path === listPath && previous?.answered));
      read.reading = readHome(key, accept, shown, read, wait ? previous?.reading : undefined);
      void read.reading.finally(() => (read.ended = true)).catch(() => undefined);
      reads.set(path, read);
      return read.reading;
    };
  /**
   * A Groups list from the server. One in which a Group doesn't list the member is refused, as
   * malformed. The Groups it leaves out lose their reads and saved copies, in both stores, and
   * the saved list and Home's figures with them, so no older list shows them even when this one
   * can't be saved; a removal that fails leaves those copies untrusted, and never signs the
   * member out (#212, #323).
   */
  const acceptList: Accept = (value, owner) => {
    const groups = listOf(value);
    if (!memberOfAll(groups))
      throw new RequestError('The server returned invalid group membership. Please refresh.');
    return () => trim(groups, owner);
  };
  const trim = async (groups: MobileGroup[], owner: number) => {
    const { snapshot } = session,
      listed = new Set(groups.map((group) => group.id)),
      lost = new Set<string>();
    const reading = client.getQueryCache().findAll({
      predicate: ({ state }) => state.data !== undefined || state.fetchStatus === 'fetching',
    });
    for (const id of [
      ...snapshot().groups.data.map((group) => group.id),
      ...reading.flatMap(({ queryKey }) => (queryKey.length === 5 ? [queryKey[3] as string] : [])),
    ])
      if (!listed.has(id)) lost.add(id);
    session.listed(listed, lost);
    // With no list known yet, this device may hold Groups the trim drops, and Home's saved
    // figures with them: figures still being read are read again after it.
    if (!snapshot().groups.loaded && held(keys()[1])?.fetchStatus === 'fetching')
      session.invalidate('home');
    const lease = session.lease();
    if (!lease) return;
    let unchecked = false;
    try {
      await lease.write(async () => {
        // The saved list may list a Group lost while it wasn't on screen: lost too (#323). One
        // this device can't read goes as well, since it may.
        const saved = await savedIds(lease.accountId);
        for (const id of saved ?? []) if (!listed.has(id)) lost.add(id);
        unchecked = !saved;
        await session.retain(lease.accountId, [...listed]);
        if (!lost.size && saved) return;
        // An older list still waiting to be saved would list them again: this list moves no
        // version, so nothing else refuses it.
        queue.drop(listPath);
        await forget(lease.accountId);
      });
    } catch (error) {
      if (!session.current(owner) || error instanceof Superseded) throw new Superseded();
      session.distrust(lease.accountId, [
        ...[...lost].flatMap((id) => [`group:${id}`, `ledger:${id}`, `balances:${id}`]),
        ...(lost.size || unchecked ? ['groups'] : []),
        'home',
      ]);
    }
  };
  const options = (): QueryObserverOptions<Envelope, Error, Envelope, Envelope, QueryKey>[] => [
    {
      queryKey: keys()[0],
      queryFn: queryFn(acceptList, () => session.snapshot().groups.data.length > 0),
      // Showing Home again reads the list only when it has none; focus, reconnect and a pull do.
      refetchOnMount: false,
    },
    {
      queryKey: keys()[1],
      queryFn: queryFn(
        (value) => void figuresOf(value),
        () => session.snapshot().home.data !== null,
      ),
      enabled: !figuresWait,
    },
  ];

  /** Observed while Home shows; unobserved, a read in flight goes on (#190). */
  const bind = () => {
    pending = false;
    if (!session.shows()) return unbind();
    if (observers.length) return;
    observers = options().map((option) => new QueryObserver(client, option));
    stop = observers.map((observer) => observer.subscribe(() => undefined));
  };
  const unbind = () => {
    stop.forEach((end) => end());
    stop = [];
    observers = [];
  };
  /**
   * The observers take their queries again: removing a query never tells them (module-4 brief
   * F5), so they move to the new ones, which read again; or Home's figures no longer wait.
   */
  const rebind = () => {
    if (!observers.length) return;
    const next = options();
    rebinding = true;
    try {
      observers.forEach((observer, index) => observer.setOptions(next[index]));
    } finally {
      rebinding = false;
    }
  };
  /** A read the cache cancelled ends first, with what its answer set off: a session, a refusal. */
  const ended = (index: 0 | 1) => reads.get([listPath, homePath][index])?.reading.catch(() => null);
  /** Waits for a read in flight, and for any read that replaces it. */
  const settle = async (index: 0 | 1, owner: number) => {
    for (;;) {
      const read = session.current(owner)
        ? client.getQueryCache().get(hashKey(keys()[index]))
        : null;
      if (read?.state.fetchStatus !== 'fetching') return;
      await read.promise?.catch(() => undefined);
      await ended(index);
    }
  };
  /** Reads a query now, joining a read in flight; one a change cancels is read again. */
  const readNow = async (index: 0 | 1, owner: number): Promise<void> => {
    while (session.current(owner)) {
      const reading = client.fetchQuery({ ...options()[index], staleTime: 0 }),
        read = reads.get([listPath, homePath][index]);
      try {
        await reading;
        return;
      } catch (error) {
        if (!(error instanceof CancelledError)) return;
        // Cancelled before it answered, it's sent again; after, Home reads it again if it shows.
        const answered = read?.answered;
        await read?.reading.catch(() => null);
        if (answered) return settle(index, owner);
      }
    }
  };
  /**
   * Removes these rows (both, unless named), inside a lease write: a lost Group, a shorter Groups
   * list or a write (M2-2). It never waits for the saved-copy queue, so a confirmed change never
   * waits on a saved copy: one being written goes once it lands (`saveRow`), and any still waiting
   * is refused, since what made these obsolete has already moved their version (or, for a list
   * that lost a Group, `trim` dropped it).
   */
  const forget = async (accountId: string, paths = [listPath, homePath]) => {
    if (!rows) return;
    for (const path of paths) forgotten.set(path, (forgotten.get(path) ?? 0) + 1);
    for (const path of paths) await rows.remove(accountId, path);
  };
  /** Home's Expense drafts (`draftSummaries`), read from this device whenever Home settles. */
  const listDrafts = async () => {
    const lease = session.lease(),
      list = session.drafts?.list;
    if (!lease || !list) return;
    const owner = session.generation();
    try {
      const records = await lease.write(() => list(lease.accountId));
      if (!session.current(owner)) return;
      session.publish({
        drafts: draftSummaries(records, lease.accountId, session.snapshot().groups.data),
      });
    } catch {
      // Home keeps the drafts it lists; each one is still in its Group.
    }
  };
  /** The Groups list and Home's figures, projected from their queries into `next`. */
  const project = (next: MobileSnapshot): MobileSnapshot => {
    const user = next.auth.status === 'authenticated' ? next.auth.user : null;
    if (!user) return next;
    const at = { environment: session.environment, accountId: user.id };
    const list = held(groupsKey(at)),
      figures = held(homeBalancesKey(at));
    const groups = list ? projectGroups(list, next.groups) : next.groups;
    const home = figures ? projectHome(figures, next.home) : next.home;
    return groups === next.groups && home === next.home ? next : { ...next, groups, home };
  };
  /** Home's figures no longer wait for the Groups list: they read now if they need to. */
  const release = () => {
    if (!figuresWait) return;
    figuresWait = false;
    rebind();
  };

  return {
    project,
    /** Runs `run` without publishing its reads' starts: the publish that follows shows them. */
    quietly(run: () => unknown) {
      quiet += 1;
      try {
        run();
      } finally {
        quiet -= 1;
      }
    },
    bind,
    /** After the publish that showed Home, and what runs in the same turn (a denial's purge). */
    bindLater() {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        if (pending) bind();
      });
    },
    rebind,
    readNow,
    /**
     * Home once its reads have settled, and this device's drafts are listed. The Groups list
     * comes first when `list` waits for it, as for a session's first list; `fresh` reads both
     * now, as a pull or Retry does.
     */
    async settle(
      owner: number,
      { fresh = false, list = fresh || figuresWait }: { fresh?: boolean; list?: boolean } = {},
    ) {
      if (session.snapshot().auth.status !== 'authenticated') return;
      bind();
      if (list) await (fresh ? readNow(0, owner) : settle(0, owner));
      if (!session.current(owner)) return;
      release();
      await Promise.all([listDrafts(), fresh ? readNow(1, owner) : settle(1, owner)]);
    },
    /** Home's figures wait for the next Groups list read. */
    hold: () => void (figuresWait = true),
    /**
     * Reads the Groups list now, and its figures after it, and `show`s Home: the read starts
     * first, so the publish that shows Home shows the list loading (Check Groups, joining).
     */
    async listFirst(owner: number, show: () => void) {
      figuresWait = true;
      let reading!: Promise<void>;
      this.quietly(() => (reading = readNow(0, owner)));
      show();
      await reading;
    },
    /** Back on Home: its figures are read when they are past their stale time. */
    back(show: () => void) {
      release();
      show();
      return this.settle(session.generation(), { list: true });
    },
    /** Retry on Home's figures: read again now, with this device's drafts. */
    async refresh() {
      if (session.snapshot().auth.status !== 'authenticated') return;
      await Promise.all([listDrafts(), readNow(1, session.generation())]);
    },
    /** Home's figures are being read. */
    figuresReading: () => held(keys()[1])?.fetchStatus === 'fetching',
    forget,
    listDrafts,
    /**
     * Cold start: `accountId`'s saved Home, from the persister's rows, with this device's drafts
     * (`drafts`), every part at once and outside the account queue, so nothing waits on the network
     * or on another account write. Null without a readable saved list that lists the account.
     * A row this device couldn't remove is never shown.
     */
    async preview(accountId: string, drafts: Promise<{ groupId: string; value: unknown }[]>) {
      if (!rows) return null;
      const at = { environment: session.environment, accountId };
      const saved = async <T>(key: QueryKey, parse: (value: unknown) => T) => {
        const path = queryKeyPath(key),
          read = cachedRead(await rows.load(accountId, path), accountId, path, session.now());
        return read && read.refreshedAt > session.distrusted(key, false)
          ? { value: parse(read.value), refreshedAt: read.refreshedAt }
          : null;
      };
      const [list, figures, records] = await Promise.all([
        saved(groupsKey(at), parseGroups),
        saved(homeBalancesKey(at), parseHomeBalances).catch(() => null),
        drafts.catch(() => []),
      ]);
      if (!list?.value.every(({ members }) => members.some(({ user }) => user.id === accountId)))
        return null;
      const { buckets: data = null, byGroup = {} } = figures?.value ?? {};
      return {
        groups: { status: 'loading' as const, data: list.value, message: null, loaded: true },
        home: figures
          ? {
              ...emptyHome(),
              status: 'loading' as const,
              data,
              byGroup,
              refreshedAt: figures.refreshedAt,
            }
          : emptyHome(),
        drafts: draftSummaries(records, accountId, list.value),
      };
    },
    /**
     * Returning to the foreground and reconnecting are TanStack's focus and online events (M1-4,
     * M1-6): they reach only the queries a screen observes, and those past their stale time read
     * again. NetInfo only says when the device reconnects; a failed read still decides "offline".
     * Returns what stops listening.
     */
    listen(focus: typeof focusManager, online: typeof onlineManager, netInfo?: NetworkState) {
      const stops = [
        // Their reads publish their answer wherever the member is (#190).
        client.getQueryCache().subscribe(({ type, query }) => {
          const [scope] = query.queryKey;
          if (quiet || type !== 'updated' || (scope !== 'groups' && scope !== 'home')) return;
          if (project(session.snapshot()) !== session.snapshot()) session.publish({});
        }),
        focus.subscribe((focused) => focused && client.getQueryCache().onFocus()),
        online.subscribe((connected) => connected && client.getQueryCache().onOnline()),
      ];
      const own = {};
      if (netInfo) {
        wired.set(online, own);
        online.setEventListener((setOnline) =>
          netInfo.addEventListener(({ isConnected }) => setOnline(isConnected !== false)),
        );
      }
      return () => {
        stops.forEach((stopListening) => stopListening());
        // Only its own: a newer controller's NetInfo stays wired.
        if (wired.get(online) !== own) return;
        wired.delete(online);
        online.setEventListener(() => undefined);
      };
    },
    /** Settles once no saved copy is being written. */
    idle: () => queue.idle(),
    /** The session ended (M10-2): nothing waiting is written, nothing is observed or awaited. */
    reset() {
      unbind();
      queue.cancel();
      reads.clear();
      figuresWait = false;
    },
  };
}
