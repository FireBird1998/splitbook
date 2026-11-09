import {
  hashKey,
  InfiniteQueryObserver,
  type focusManager,
  type InfiniteData,
  type onlineManager,
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
import {
  rowPaths,
  STALE,
  createSavedReadEngine,
  parseOnce,
  uniqueRows,
  notSaved,
  type Envelope,
  type PageEnvelope,
} from './saved-read-engine';
import { savedGroupShown } from './group-queries';
import { queryOwner } from './query-owner';
import { RequestError, Superseded } from './transport';
import type { AccountStorageLease, MobileSnapshot, Route, ScrollAnchor } from './types';

type Pages = InfiniteData<PageEnvelope, number>;
type Target = ActivityState['target'];

/** A page holds 20 events; Activity keeps at most 5 pages, 100 events, and slides (M1-3, M7-2). */
const PAGE_SIZE = 20;
/** A failed refresh keeps the events shown, and says what that means (unchanged from main). */
const refreshFailed =
  'Could not refresh Activity. Previously loaded events may be stale. A missing event does not mean the ledger change failed.';
/**
 * What stays on screen when Splitbook can't be reached and this phone keeps no copy to show
 * instead: removed by a change, withheld (#323) or never saved (#222, as #219 and #332 say it).
 */
const notKept =
  'Couldn’t refresh this Group’s activity, and this phone no longer keeps a copy of it. A missing event does not mean the ledger change failed.';
const olderFailed = 'Couldn’t load older activity.';
/** Nothing shown, and a failure Splitbook answered that says nothing itself. */
const loadFailed = 'Could not load Activity. Please try again.';

/** One parse per answer: structural sharing keeps an unchanged page, and its events, the same. */
const parsedPage = parseOnce((value, scope) => {
  const [groupId, page] = scope.split(':');
  return parseActivityPage(value, groupId, Number(page));
});
const pageOf = (value: unknown, groupId: string, page: number) =>
  parsedPage(value, `${groupId}:${page}`);
const none: Target = { status: 'none' },
  checking: Target = { status: 'loading' },
  unavailable: Target = { status: 'unavailable' },
  failed: Target = { status: 'error' };

/** An event's Expense as the record's answer says it is now: one parse per answer. */
const targetFrom = parseOnce((value, scope): Target => {
  const [groupId, expenseId] = scope.split(':');
  try {
    return parseActivityExpense((value as Envelope).value, groupId, expenseId);
  } catch {
    return failed;
  }
});

/** `shown` again when nothing in `next` differs from it, so an unchanged read publishes nothing. */
const same = <T extends object>(shown: T, next: T): T =>
  (Object.keys(next) as (keyof T)[]).every((field) => shown[field] === next[field]) ? shown : next;
const failure = (state: QueryState<unknown, Error>) =>
  state.status !== 'error' || state.error instanceof Superseded ? null : state.error;
/** The server couldn't be reached, and this device has no saved copy of the page. */
const unreachable = (error: unknown) =>
  error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';
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
  /** A missing Expense makes its Group's saved ledger views obsolete, while access remains. */
  missingLedger(groupId: string, owner: number): Promise<void>;
}

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
  /**
   * The internet returned while this open's reads ran (#681): once they end, it reads again if
   * they ended offline.
   */
  recovering: boolean;
  detail: Detail | null;
  /**
   * Read beside its Group, before the Group's check passed (owner decision, 2026-10-06). Should
   * the Group turn out to be a Household, whose read can add a due recurring Expense and its
   * event, nothing of it shows until a read after the Group's lands (#180 Risk 8).
   */
  beside: boolean;
  /**
   * This device's copy shown at once in this open (M3-1), and the query that owned it then: it
   * stays while what this open read can't show yet, so the list never empties to a placeholder.
   */
  preview: { data: Pages; owns(): boolean } | null;
  /** Restores only before any read answered since this open, even if its query was replaced. */
  restore(owner: number): Promise<Pages | null>;
  /** This device's copy being read for this open, once: from the open, so a switch shows it. */
  restoring: Promise<void> | null;
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
  const { client } = session;
  /** Data restored from this device to show while the Group is first read: never verified here. */
  const previews = new WeakSet<object>();
  /**
   * Data a read answered: from the server, or this device's copy once Splitbook couldn't be
   * reached. A restored copy the read answered the same keeps its object (structural sharing),
   * and is then no longer only a preview.
   */
  const answers = new WeakSet<object>();
  /** Restored to show while the Group is first read, and not answered by a read since. */
  const previewed = (data: unknown) =>
    !!data && previews.has(data as object) && !answers.has(data as object);
  /** The returns whose pages a read has shown again. */
  const shownRereads = new WeakSet<object>();
  /** Reads still running, which `settle` waits for. */
  const running = new Set<Promise<unknown>>();
  let view: View | null = null;
  let observer: InfiniteQueryObserver<PageEnvelope, Error, Pages, QueryKey, number> | undefined;
  let pending = false;

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
  const readable = (key: QueryKey, value: unknown, page = 1) => {
    try {
      return Boolean(pageOf(value, key[3] as string, page));
    } catch {
      return false;
    }
  };
  const engine = createSavedReadEngine(session, {
    path: (key, page = 1) => pagePath(key, page),
    readable,
    ownsKey: isActivity,
    rowScope: {
      groupId: (key) => key[3] as string,
      remove: removeActivityRows,
      pathGroup: (path) => {
        const id = /^\/api\/groups\/([a-f\d]{24})\//i.exec(path)?.[1];
        return id && ownRow(path, id) ? id : null;
      },
      distrust: (key) => [`ledger:${key[3]}`],
    },
    refusal: 'forbidden-or-missing',
    preview: 'unanswered-since-open',
    automaticRefetch: false,
    cancelOnRemove: true,
    staleWhenOffline: true,
  });

  /** The Group's read in this open says it is a Household. */
  const household = (groupId: string) => {
    const { detail } = session.snapshot();
    return detail.id === groupId && detail.data?.category === 'home';
  };
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
   * While Activity is first read, its newest page saved on this device shows, with its own time:
   * at once, even while a read beside the Group is under way (M3-1). Never one a change, a denial
   * or a failed removal made obsolete, one it can't read, and never once a read of it answered
   * since this open began. The engine captures that guard now; when to restore stays here.
   */
  const previewAtOpen = (key: QueryKey) => {
    const restore = engine.previewAtOpen(key);
    return (owner: number) =>
      restore(owner, {
        page: 1,
        project: (copy): Pages => {
          const data = { pages: [{ ...copy, page: 1 }], pageParams: [1] };
          previews.add(data);
          return data;
        },
      });
  };
  /**
   * This device's copy for this open, read once. The open starts it, so a switch to Activity shows
   * the copy from its first frame, never after its Group's read or a placeholder (device check of
   * 99f96d6, A7); a read waits for it.
   */
  const restoreOnce = (opened: View, owner: number) => {
    const key = activityKey(opened.groupId);
    opened.restoring ??= opened
      .restore(owner)
      .then((data) => {
        if (data && view === opened) opened.preview = { data, owns: queryOwner(client, key) };
        reproject();
      })
      .catch(() => undefined);
    return opened.restoring;
  };
  const paging = engine.paging({
    pagination: (key, value, page) => pageOf(value, key[3] as string, page).pagination,
    failedMessage: () => olderFailed,
    reopen: 'multiple-pages',
  });
  /** A page of Activity keeps its own saved-total coherence rule (#222). */
  const readPage = (context: QueryFunctionContext<QueryKey, unknown>) => {
    const key = context.queryKey,
      groupId = key[3] as string,
      page = context.pageParam as number;
    return paging.read(context, {
      accept: (value) => void pageOf(value, groupId, page),
      validate: (answer, first) => {
        // Offline, an older or newer page shows from this device only while it counted as many
        // events as the window's first page: otherwise events between them would silently go
        // missing, or show twice (#222, as #173's pilot did).
        const reference =
          first && first.source !== 'failed'
            ? pageOf(first.value, groupId, first.page).pagination.total
            : undefined;
        if (
          answer.source === 'saved' &&
          reference !== undefined &&
          pageOf(answer.value, groupId, page).pagination.total !== reference
        ) {
          session.answered(pagePath(key, page), null);
          throw new RequestError(notSaved, 0, 'OFFLINE_UNAVAILABLE', false, null, 'network');
        }
      },
    });
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
    const start = reread?.first ?? 1;
    const first = stateOf<Pages>(key)?.data?.pageParams[0] ?? start;
    const pages = reread ? Math.max(1, reread.pages - first + 1) : undefined;
    return {
      ...engine.shared,
      queryKey: key,
      queryFn: readPage,
      ...paging.options(key, start),
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
    if (
      !view ||
      !onScreen() ||
      !session.checked(view.groupId) ||
      view.detail?.failure === unavailable
    )
      return unbind();
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

  const readNow = engine.readNow;
  /** A refusal answered for this open: the Group's content goes, as the controller drops it. */
  const refuse = (opened: View, error: unknown) => {
    if (!engine.refuses(error) || !(error instanceof RequestError) || view !== opened) return false;
    session.refused(opened.groupId, error);
    return true;
  };
  /**
   * Reads Activity for this open: every page loaded, from the window's first, up to 5 (M1-3), or
   * the newest page when none is. `fresh` reads them again now; otherwise a read verified within
   * the freshness window is reused. `after`: the Group read it follows (a Household's, or a
   * Group not known yet); when that fails, Activity isn't read. A refusal drops the Group. Without
   * one, a Group shown from this phone's copy is read again first, and Activity follows it, whatever
   * it answers: that copy keeps the offline banner until its own read lands (#682).
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
    const { detail } = session.snapshot();
    const groupRead =
      !after && detail.id === opened.groupId && savedGroupShown(detail)
        ? session.readGroup(opened.groupId, owner, { fresh: false, wanted: () => !!still() })
        : null;
    opened.reading += 1;
    const reading = (async (): Promise<boolean> => {
      // What this device saved shows while the Group is first read, with its own time.
      const restoring =
        held(key)?.state.data === undefined || opened.restoring ? restoreOnce(opened, owner) : null;
      /** This read answered with pages read now, which are being saved on this device. */
      let answered = false;
      /** It read after this open's check of the Group passed. */
      let checked = false;
      try {
        reproject();
        if (after) {
          try {
            await after;
          } catch {
            return false;
          }
        } else if (groupRead) await groupRead.catch(() => undefined);
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
        checked = session.checked(opened.groupId);
        if (!checked && !after) opened.beside = true;
        // Read beside a Group that turned out to be a Household: read again, after it.
        const again = opened.beside && checked && household(opened.groupId);
        await readNow(listOptions(key, fresh || again), owner, still);
        answered = held(key)?.state.dataUpdatedAt !== before;
        if (reread) shownRereads.add(reread);
      } catch (error) {
        // Shown on Activity, beside what was read before; a refusal drops the Group.
        if (!refuse(opened, error) && !(error instanceof Superseded) && !(error instanceof Error))
          throw error;
      } finally {
        await restoring;
        opened.reading -= 1;
        // Landed after the Group's check: what it read shows, or its failure with what was read.
        if (checked) opened.beside = false;
        if (session.current(owner)) reproject();
        // The internet returned while they ran: whether to read again waits until all have ended.
        if (!opened.reading && opened.recovering) {
          opened.recovering = false;
          if (view === opened) recover();
        }
      }
      return answered;
    })();
    running.add(reading);
    void reading.finally(() => running.delete(reading)).catch(() => undefined);
    // `saved`: a command that shows Activity is done once what it read is saved on this device,
    // or removed again by a change confirmed meanwhile, as Activity's reads always were. A
    // refresh, whose cue says a read is running, is done when its read lands (#222, review N1).
    return reading.then(async (answered) => {
      if (answered && saved) await engine.idle();
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
        await engine.settle(query.queryKey as QueryKey);
        continue;
      }
      if (running.size) {
        await Promise.allSettled([...running]);
        continue;
      }
      return;
    }
  };

  /** Activity on screen reads again what is past its stale time, as a reconnect does (M1-4). */
  const again = () => {
    if (view && onScreen() && session.checked(view.groupId))
      void read(session.generation()).catch(() => undefined);
  };
  /**
   * The internet returned while the device stayed connected, so the online manager didn't change
   * (#681, as #678 for a Group's view). Activity that shows this phone's copy, or a read that
   * failed offline, reads again once, as on a reconnect: the offline banner clears when that read
   * lands. A failure Splitbook answered stays until Retry, a pull or the next open. A read under
   * way, its own or a Load older or newer, may still end offline, so Activity first waits for its
   * reads to end.
   */
  const recover = () => {
    const opened = view,
      owner = session.generation();
    if (!opened) return;
    if (opened.reading) opened.recovering = true;
    // A Load older or newer reads through the observer, not `read`: a read now would join it.
    else if (held(activityKey(opened.groupId))?.state.fetchStatus === 'fetching')
      void settle(owner).then(() => {
        if (view === opened && session.current(owner)) recover();
      });
    else if (shownOffline(opened)) again();
  };
  /**
   * What this open shows is this phone's copy, or a read that failed offline: Activity's pages, or
   * its Group's details (#682). A failure Splitbook answered doesn't count, and nor does a live
   * Activity beside it: the internet's return reads only what is offline.
   */
  const shownOffline = (opened: View) => {
    const { activity, detail } = session.snapshot();
    const state = held(activityKey(opened.groupId))?.state,
      error = state && failure(state);
    return (
      (activity.groupId === opened.groupId && !!activity.restored) ||
      (!!error && unreachable(error)) ||
      (detail.id === opened.groupId && savedGroupShown(detail))
    );
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
    return targetFrom(data, `${opened.groupId}:${detail.expenseId}`);
  };
  /** Activity as its query holds it, in the snapshot's shape. */
  const activityFrom = (
    shown: ActivityState,
    opened: View,
    { household, groupReading }: { household: boolean; groupReading: boolean },
  ): ActivityState => {
    const { groupId } = opened,
      state = stateOf<Pages>(activityKey(groupId)),
      selected = opened.detail?.event ?? null,
      target = targetOf(opened);
    const base: ActivityState = {
      ...emptyActivity(),
      groupId,
      selected,
      origin: selected && selected._id === shown.selected?._id ? shown.origin : null,
      target,
      // No events stays the same list, so it publishes nothing new.
      events: shown.events.length ? [] : shown.events,
    };
    // A missing Expense's historical event stays open; its obsolete list is read on return.
    if (opened.detail?.failure === unavailable) return same(shown, { ...base, status: 'ready' });
    // Nothing read, or what was read went with a change, a denial or a Groups list: no event
    // shows, never one from before this device's own change (#280 item 1).
    // While the Group is read, Activity's own read follows it: loading, never a blank.
    const waiting = opened.reading > 0 || groupReading;
    if (!state) return same(shown, { ...base, status: waiting ? 'loading' : 'idle' });
    const data = state.data;
    // Read beside the Group in this open, before its check passed: shown only once it has.
    const unchecked =
      !session.checked(groupId) &&
      !!data &&
      !previewed(data) &&
      state.dataUpdatedAt >= opened.since;
    // Read beside a Group that turned out to be a Household, and not yet read again after it: it
    // may lack the event of a due recurring Expense its Group's read added (#180 Risk 8).
    const recheck = opened.beside && session.checked(groupId) && household;
    // Until what this open read can show, the copy it showed at once stays, never a placeholder
    // in its place (M3-1); without one, the placeholder holds, as on a Household's first open.
    const preview = opened.preview?.owns() ? opened.preview.data.pages : [];
    const pages = unchecked || recheck ? preview : (data?.pages ?? []);
    const read = pages.filter((page) => page.source !== 'failed');
    const failedPage = pages.find((page) => page.source === 'failed');
    let next: ActivityState = base;
    if (read.length) {
      const parsed = read.map((page) => pageOf(page.value, groupId, page.page));
      // An event read on two pages, as events are added above it, is listed once; the events
      // shown stay the same list when nothing in them changed, so an unchanged read publishes
      // nothing.
      const events = uniqueRows(
        parsed.map((page) => page.events),
        (event) => event._id,
        shown.events,
      );
      next = {
        ...base,
        events,
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
    // Until the read after a Household's Group lands, its placeholder (or copy) holds.
    if (recheck) return same(shown, { ...next, status: 'loading' });
    // Not checked by this open yet: a saved copy shows while the Group is read.
    if (unchecked || !session.checked(groupId) || (previewed(data) && !failure(state)))
      return same(shown, { ...next, status: waiting ? 'loading' : 'idle' });
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
        // Nothing shown, Splitbook out of reach, and no copy here: "isn't saved on this phone".
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
    const activity = activityFrom(next.activity, opened, {
      household: next.detail.data?.category === 'home',
      groupReading: next.detail.status === 'loading',
    });
    return activity === next.activity ? next : { ...next, activity };
  };
  return {
    project,
    shownKeys(next: MobileSnapshot): QueryKey[] {
      if (
        next.screen !== 'group' ||
        next.destination !== 'activity' ||
        !view ||
        view.lost ||
        next.activity.groupId !== view.groupId ||
        next.detail.id !== view.groupId
      )
        return [];
      const keys = [activityKey(view.groupId)];
      const id = next.activity.selected && activityExpenseId(next.activity.selected);
      if (id) keys.push(expenseRecordKey(session.account(), view.groupId, id));
      return keys;
    },
    bindLater,
    /**
     * The observer takes its query again: removing a query never tells it (module-4 brief F5), so
     * it moves to the new one, which reads what it lacks.
     */
    rebind() {
      if (!observer) return;
      engine.rebind(bind);
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
        view = {
          groupId,
          lost: false,
          since: Date.now(),
          reading: 0,
          recovering: false,
          detail: null,
          beside: false,
          preview: null,
          restore: previewAtOpen(activityKey(groupId)),
          restoring: null,
        };
        // A new open takes the newest page, preserving its named one-page rule (#215).
        paging.reopen(activityKey(groupId));
      }
      if (fresh)
        void client.invalidateQueries({
          queryKey: activityKey(groupId),
          exact: true,
          refetchType: 'none',
        });
      // Opened anew with nothing of Activity held: this device's copy is read now, after the
      // Group's own read has started, so it is there when the member switches to Activity.
      const opened = view;
      if (opened && !opened.restoring && held(activityKey(groupId))?.state.data === undefined) {
        const owner = session.generation();
        void Promise.resolve().then(() => {
          if (view === opened && !opened.lost && session.current(owner))
            void restoreOnce(opened, owner);
        });
      }
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
      const result = await paging.older(activityKey(opened.groupId), () => {
        bind();
        return observer;
      });
      if (result === false) return;
      if (result?.error) refuse(opened, result.error);
      await settle(owner);
    },
    /** Load newer: the page before the window, which drops its oldest page. */
    async loadNewer(owner: number) {
      const opened = view;
      if (!opened || !onScreen() || !session.checked(opened.groupId)) return;
      const result = await paging.newer(activityKey(opened.groupId), () => {
        bind();
        return observer;
      });
      if (result === false) return;
      if (result?.error) refuse(opened, result.error);
      await settle(owner);
    },
    /**
     * Opens an event: what was recorded, and, when it names an Expense, that Expense as it is
     * now. The Group's query is read first, checking the member (#219); then the record's (#220).
     */
    async select(
      eventId: string,
      owner: number,
      origin: { scrollY?: number; anchor?: ScrollAnchor } = {},
    ) {
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
      session.publish({
        activity: {
          ...shown,
          selected: event,
          origin:
            origin.scrollY !== undefined && Number.isFinite(origin.scrollY)
              ? {
                  groupId: opened.groupId,
                  scrollY: Math.max(0, origin.scrollY),
                  ...(origin.anchor?.key && Number.isFinite(origin.anchor.offset)
                    ? { anchor: origin.anchor }
                    : {}),
                }
              : null,
        },
      });
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
          engine.refuses(error, recordRead ? 'forbidden-only' : 'forbidden-or-missing')
        )
          return void refuse(opened, error);
        detail.failure =
          error instanceof RequestError && error.status === 404 ? unavailable : failed;
        if (detail.failure === unavailable) await session.missingLedger(groupId, owner);
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
    forget: engine.forget,
    /** Keeps only these Groups' rows: a Groups list from the server left the others out. */
    retain: engine.retain,
    /**
     * Returning to the foreground and reconnecting (M1-4, M1-6): Activity on screen reads again
     * what is past its stale time, through TanStack's focus and online events only. Answers
     * publish wherever they land, and are saved as rows. Returns what stops listening.
     */
    listen(focus: typeof focusManager, online: typeof onlineManager) {
      const stops = [
        engine.listen(),
        client.getQueryCache().subscribe((event) => {
          // Invalidation changes preview eligibility, not the content a response projects.
          if (event.type !== 'updated' || event.action.type === 'invalidate') return;
          const { query } = event,
            key = query.queryKey as QueryKey;
          if (!isActivity(key)) return;
          if (event.action.type === 'success' && !event.action.manual) {
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
    /** The internet returned on the connection the device kept (#681): Home's NetInfo says so. */
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
