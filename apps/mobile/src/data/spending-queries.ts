import {
  hashKey,
  QueryObserver,
  type QueryObserverOptions,
  type QueryState,
} from '@tanstack/query-core';
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
import { parseSpendingByDay } from './spending-by-day-read';
import { RequestError, Superseded } from './transport';
import type { MobileSnapshot, SpendingMonthState, SpendingState } from './types';

/** Splitbook can't be reached, and this phone keeps no copy of the Month: the board's words. */
export const spendingNotOnPhone = 'Your spending isn’t on this phone yet. Connect to load it.';
const spendingFailed = 'Couldn’t load your spending. Please try again.';
/** Every Month's row path starts so: the rows this view owns among the account's. */
const monthPaths = '/api/user/spending/days?';

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
const parsed = parseOnce(parseSpendingByDay);
const monthOf = (value: unknown) => parsed(value, '');
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
  const figures = answer ? monthOf(answer.value) : null;
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
  const unkept = error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';
  return same(shown, {
    ...was,
    status: 'error',
    unsaved: unkept && was.data === null,
    message: unkept
      ? spendingNotOnPhone
      : error instanceof RequestError && error.serverMessage
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
    readable: (_key, value) => {
      try {
        monthOf(value);
        return true;
      } catch {
        return false;
      }
    },
    ownsKey: (key) => key[0] === 'home' && queryKeyPath(key).startsWith(monthPaths),
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
    observed: string | null = null,
    pending = false;

  /** This Month on the phone's clock and in its zone. */
  const month = () => monthKeyInZone(session.now(), session.timeZone());
  const keyOf = (accountId: string, of: string) =>
    spendingByDayKey(
      { environment: session.environment, accountId },
      { month: of, timeZone: session.timeZone() },
    );
  const read = async (key: QueryKey): Promise<Envelope> => {
    const owner = session.generation(),
      owns = queryOwner(client, key);
    const answer = await engine.read({
      key,
      // This phone's copy shows while the Month is first read.
      preview: client.getQueryState(key)?.data === undefined,
      accept: (value) => void monthOf(value),
    });
    if (answer.source === 'network') {
      saved.add(queryKeyPath(key));
      engine.save(key, { owner, owns }, answer);
    }
    return answer;
  };
  const options = (
    of: string,
  ): QueryObserverOptions<Envelope, Error, Envelope, Envelope, QueryKey> => ({
    ...engine.shared,
    queryKey: keyOf(session.account().accountId, of),
    queryFn: ({ queryKey }) => read(queryKey),
  });

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
    const of = month();
    if (observer && observed === of) return;
    unbind();
    observed = of;
    const next = new QueryObserver(client, options(of));
    observer = next;
    stop = next.subscribe(() => undefined);
  };
  /** The observer takes its query again once a scope's queries were replaced, and reads anew. */
  const rebind = () => {
    if (!observer || !observed) return;
    const next = options(observed);
    engine.rebind(() => observer!.setOptions(next));
  };

  /** Every saved Month of this account, inside a lease write: the switch was turned off, or a lost Group. */
  const forget = async (accountId: string) => {
    if (!rows) return;
    const paths = [...(await rowPaths(rows, accountId, saved))].filter((path) =>
      path.startsWith(monthPaths),
    );
    engine.drop(paths);
    await engine.forgetRows(accountId, paths);
  };

  /** Spending by day as its query holds it, projected into `next`. */
  const project = (next: MobileSnapshot): MobileSnapshot => {
    const enabled = session.enabled(),
      user = next.auth.status === 'authenticated' ? next.auth.user : null;
    let spending: SpendingState;
    if (!enabled || !user) spending = same(next.spending, { enabled, current: null });
    else {
      const of = month(),
        read = client.getQueryCache().get<Envelope, Error>(hashKey(keyOf(user.id, of)))?.state;
      const shown = next.spending.current;
      const current = read
        ? projectMonth(of, read, shown)
        : shown?.month === of
          ? shown
          : loading(of);
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
      await client.fetchQuery({ ...options(month()), staleTime: -Infinity }).catch(() => undefined);
    },
    /**
     * The switch was turned off: nothing is observed or kept. Its queries go, and with them what
     * was on screen, and every saved Month goes from this phone.
     */
    async off() {
      unbind();
      const predicate = ({ queryKey }: { queryKey: readonly unknown[] }) =>
        queryKey[0] === 'home' && String(queryKey[queryKey.length - 1]).startsWith(monthPaths);
      await client.cancelQueries({ predicate });
      client.removeQueries({ predicate });
      const lease = session.lease();
      if (!lease || !rows) return;
      const owner = session.generation();
      try {
        await lease.write(() => forget(lease.accountId));
      } catch (error) {
        if (session.current(owner) && !(error instanceof Superseded))
          session.distrust(lease.accountId, ['home']);
      }
    },
    forget,
    /** Answers that land publish what they change, wherever the member is. */
    listen() {
      return client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type === 'invalidate') return;
        const { queryKey } = event.query;
        if (!String(queryKey[queryKey.length - 1]).startsWith(monthPaths)) return;
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
