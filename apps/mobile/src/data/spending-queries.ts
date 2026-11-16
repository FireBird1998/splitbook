import {
  hashKey,
  QueryObserver,
  type QueryObserverOptions,
  type QueryState,
} from '@tanstack/query-core';
import { spendingByDayPath } from '@splitbook/shared/api-paths';
import { queryKeyPath, spendingByDayKey, type QueryKey } from '@splitbook/shared/query-keys';
import { monthKeyInZone } from '@splitbook/shared/zoned-calendar';
import type { FindableRecordStore } from './account-record-storage';
import { queryOwner } from './query-owner';
import {
  createSavedReadEngine,
  parseOnce,
  rowPaths,
  type Envelope,
  type SavedReadPorts,
} from './saved-read-engine';
import {
  parseSpendingByDayResponse,
  type SpendingByDayRead,
} from '@splitbook/shared/spending-by-day-read';
import { RequestError, Superseded } from './transport';
import type { MobileSnapshot, SpendingMonthState, SpendingState } from './types';

/** Splitbook can't be reached, and this phone keeps no copy of the Month: the board's words. */
export const spendingNotOnPhone = 'Your spending isn’t on this phone yet. Connect to load it.';
const spendingFailed = 'Couldn’t load your spending. Please try again.';
const wrongMonth = 'The server returned spending for another Month. Please refresh.';
/** Every Month's path starts so, whatever its Month and zone: the read's own path. */
const monthPrefix = `${spendingByDayPath({ month: '', timeZone: '' })}?`;
/** A Month of Spending by day's key, among the `home` scope's. */
const isMonthKey = (key: readonly unknown[]) =>
  key[0] === 'home' && String(key[key.length - 1]).startsWith(monthPrefix);
/**
 * Removes every saved Month of this account from the persister's rows: a cleanup at the next start
 * removes them with Home's, whose scope they share.
 */
export async function removeMonthRows(rows: FindableRecordStore, accountId: string) {
  for (const path of await rowPaths(rows, accountId))
    if (path.startsWith(monthPrefix)) await rows.remove(accountId, path);
}
/** The Month a key asks for. */
const askedMonth = (key: QueryKey) =>
  new URLSearchParams(queryKeyPath(key).slice(monthPrefix.length)).get('month');

/** What the Spending by day read needs from the session that owns it: the controller. */
export interface SpendingSession extends SavedReadPorts {
  /** The API the app reads from: every key holds it, with the account. */
  environment: string;
  rows?: FindableRecordStore;
  /** The phone's switch is on. */
  enabled(): boolean;
  /** Home shows in a signed-in session. */
  shows(): boolean;
  /** The phone's zone as it is now: it decides which Month is current. */
  timeZone(): string;
  snapshot(): MobileSnapshot;
}

type Read = QueryState<Envelope, Error>;
const parsed = parseOnce(parseSpendingByDayResponse);
/** The reply's Month, read once per answer. */
const replyOf = (value: unknown): SpendingByDayRead => parsed(value, '');
/** The reply, read, when it is for the Month its key asks for; a throw otherwise. */
const replyFor = (key: QueryKey, value: unknown) => {
  const reply = replyOf(value);
  if (reply.month !== askedMonth(key)) throw new RequestError(wrongMonth);
  return reply;
};
/** `shown` again when nothing in `next` differs from it, so an unchanged read publishes nothing. */
const same = <T extends object>(shown: T | null, next: T): T =>
  shown && (Object.keys(next) as (keyof T)[]).every((field) => shown[field] === next[field])
    ? shown
    : next;
const loading = (month: string): SpendingMonthState => ({
  month,
  status: 'loading',
  data: null,
  refreshedAt: null,
  restored: false,
  unsaved: false,
  message: null,
});

/**
 * One Month as its query holds it. Figures on screen stay, with their time and whether they are
 * this phone's copy, while they are read again and beside a failure; a saved copy shows until the
 * read lands, never as fresh.
 */
function projectMonth(month: string, read: Read, shown: SpendingMonthState | null) {
  const was = shown?.month === month ? shown : loading(month);
  const answer = read.data;
  const figures = answer ? replyOf(answer.value) : null;
  if (read.fetchStatus === 'fetching')
    return same(shown, {
      ...was,
      status: 'loading',
      message: null,
      ...(figures && was.data === null
        ? {
            data: figures,
            refreshedAt: answer!.refreshedAt,
            restored: answer!.source === 'saved',
            unsaved: false,
          }
        : {}),
    });
  if (read.status === 'success' && figures)
    return same(shown, {
      month,
      status: 'ready',
      data: figures,
      refreshedAt: answer!.refreshedAt,
      restored: answer!.source === 'saved',
      unsaved: false,
      message: null,
    });
  const error = read.status === 'error' && !(read.error instanceof Superseded) ? read.error : null;
  if (!error) return same(shown, was);
  const notOnPhone = error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';
  return same(shown, {
    ...was,
    status: 'error',
    unsaved: notOnPhone && was.data === null,
    message: notOnPhone
      ? spendingNotOnPhone
      : error instanceof RequestError && (error.serverMessage || error.message === wrongMonth)
        ? error.message
        : spendingFailed,
  });
}

/**
 * Spending by day's saved monthly read (#1274, ADR 0006). While the phone's switch is on and Home
 * shows, this Month's query is observed: it reads what it lacks or what is past its stale time, and
 * focus and reconnect reach it. Its copy is a persister row, in the wire JSON, written on the
 * saved-copy queue and restored with its own time, never fresh. Its key is in the `home` scope,
 * so a write that reaches Home's figures makes it read again.
 */
export function createSpendingQueries(session: SpendingSession) {
  const { client, rows } = session;
  const engine = createSavedReadEngine(session, {
    path: (key) => queryKeyPath(key),
    readable: (key, value) => {
      try {
        replyFor(key, value);
        return true;
      } catch {
        return false;
      }
    },
    ownsKey: isMonthKey,
    // A copy this phone couldn't remove is never shown again, with Home's.
    rowScope: { kind: 'account', distrust: () => ['home'] },
    refusal: 'forbidden-only',
    preview: 'fetching-unanswered',
    automaticRefetch: 'inherit',
    cancelOnRemove: false,
    staleWhenOffline: false,
    freshnessSource: 'unless-saved',
  });
  /** The rows saved here this session: removable even by a store that can't list its rows. */
  const saved = new Set<string>();
  let observer: QueryObserver<Envelope, Error, Envelope, Envelope, QueryKey> | null = null,
    stop: () => void = () => undefined,
    /** The key observed: its account, Month and zone. */
    observed: QueryKey | null = null,
    pending = false;

  /** This Month on the phone's clock and in its zone. */
  const currentMonth = () => monthKeyInZone(session.now(), session.timeZone());
  const keyOf = (accountId: string, month: string) =>
    spendingByDayKey(
      { environment: session.environment, accountId },
      { month, timeZone: session.timeZone() },
    );
  const read = async (key: QueryKey): Promise<Envelope> => {
    const owner = session.generation(),
      owns = queryOwner(client, key);
    const answer = await engine.read({
      key,
      // This phone's copy shows while the Month is first read.
      preview: client.getQueryState(key)?.data === undefined,
      accept: (value) => void replyFor(key, value),
    });
    if (answer.source === 'network') {
      saved.add(queryKeyPath(key));
      engine.save(key, { owner, owns }, answer);
    }
    return answer;
  };
  const optionsFor = (
    queryKey: QueryKey,
  ): QueryObserverOptions<Envelope, Error, Envelope, Envelope, QueryKey> => ({
    ...engine.shared,
    queryKey,
    queryFn: ({ queryKey }) => read(queryKey),
  });
  const options = (month: string) => optionsFor(keyOf(session.account().accountId, month));

  const unbind = () => {
    stop();
    stop = () => undefined;
    observer = null;
    observed = null;
  };
  /** Observed while the switch is on and Home shows; unobserved, a read in flight goes on. */
  const bind = () => {
    pending = false;
    if (!session.enabled() || !session.shows()) return unbind();
    // The whole key: a new zone within the same Month is another read (#1274 review).
    const key = keyOf(session.account().accountId, currentMonth());
    if (observer && observed && hashKey(observed) === hashKey(key)) return;
    unbind();
    observed = key;
    const next = new QueryObserver(client, optionsFor(key));
    observer = next;
    stop = next.subscribe(() => undefined);
  };
  /** The observer takes its query again once a scope's queries were replaced, and reads anew. */
  const rebind = () => {
    if (!observer || !observed) return;
    const next = optionsFor(observed);
    engine.rebind(() => observer!.setOptions(next));
  };

  /** Removes every saved Month of this account, inside a lease write. */
  const forget = async (accountId: string) => {
    if (!rows) return;
    const paths = [...(await rowPaths(rows, accountId, saved))].filter((path) =>
      path.startsWith(monthPrefix),
    );
    engine.drop(paths);
    await engine.forgetRows(accountId, paths);
  };
  /**
   * Removes every saved Month of this account on the account queue: a lost Group's Expenses may be
   * in one, or the switch was turned off. One that can't be removed is never shown again.
   */
  const forgetSaved = async () => {
    const lease = session.lease(),
      owner = session.generation();
    if (!lease || !rows) return;
    try {
      await lease.write(() => forget(lease.accountId));
    } catch (error) {
      if (session.current(owner) && !(error instanceof Superseded))
        session.distrust(lease.accountId, ['home']);
    }
  };

  /** Spending by day as its query holds it, projected into `next`. */
  const project = (next: MobileSnapshot): MobileSnapshot => {
    const enabled = session.enabled(),
      user = next.auth.status === 'authenticated' ? next.auth.user : null;
    let spending: SpendingState;
    if (!enabled || !user) spending = same(next.spending, { enabled, current: null });
    else {
      const month = currentMonth(),
        read = client.getQueryCache().get<Envelope, Error>(hashKey(keyOf(user.id, month)))?.state;
      const shown = next.spending.current;
      const current = read
        ? projectMonth(month, read, shown)
        : shown?.month === month
          ? shown
          : loading(month);
      spending = same(next.spending, { enabled, current });
    }
    return spending === next.spending ? next : { ...next, spending };
  };

  return {
    project,
    bind,
    /** After the publish that showed Home, and what runs in the same turn. */
    bindLater() {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        if (pending) bind();
      });
    },
    rebind,
    /**
     * Reads this Month again now while the switch is on, with Home's figures: a pull, Retry, or a
     * write's follow-up. A failure shows on the Month; nothing is read while the switch is off.
     */
    async refresh() {
      if (!session.enabled() || session.snapshot().auth.status !== 'authenticated') return;
      await client
        .fetchQuery({ ...options(currentMonth()), staleTime: -Infinity })
        .catch(() => undefined);
    },
    /**
     * The switch was turned off: nothing is observed or kept. Its queries go, and with them what
     * was on screen, and every saved Month goes from this phone.
     */
    async off() {
      unbind();
      const predicate = ({ queryKey }: { queryKey: readonly unknown[] }) => isMonthKey(queryKey);
      await client.cancelQueries({ predicate });
      client.removeQueries({ predicate });
      // Turned on again meanwhile: what it observed was just removed, so it observes this Month
      // afresh, and reads it (#1274 review).
      if (observer) {
        unbind();
        bind();
      }
      await forgetSaved();
    },
    forget,
    forgetSaved,
    /** Answers that land publish what they change, wherever the member is. */
    listen() {
      return client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type === 'invalidate') return;
        if (!isMonthKey(event.query.queryKey)) return;
        const shown = session.snapshot();
        if (project(shown) !== shown) session.publish({});
      });
    },
    /** Settles once no saved copy is being written. */
    idle: engine.idle,
    /** The session ended: nothing waiting is written, nothing is observed. */
    reset() {
      unbind();
      engine.reset();
      saved.clear();
    },
  };
}
