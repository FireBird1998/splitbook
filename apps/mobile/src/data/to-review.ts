import {
  createExpenseDraftsSchema,
  saveExpenseDraftsSchema,
} from '@splitbook/shared/validators/expense-draft';
import { expenseDraftsPath } from '@splitbook/shared/api-paths';
import {
  QueryObserver,
  type QueryClient,
  type QueryObserverOptions,
  type onlineManager,
} from '@tanstack/query-core';
import { toReviewPath } from '@splitbook/shared/api-paths';
import { toReviewKey } from '@splitbook/shared/query-keys';
import { buildToReview, type DeviceToReviewItem } from '@splitbook/shared/to-review';
import { parseToReviewResponse, type ToReviewRead } from '@splitbook/shared/to-review-read';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import type { MobileSnapshot } from './types';

export interface ToReviewState {
  run: import('./review-run').ReviewRunState | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  read: ToReviewRead;
  message: string | null;
  groupId: string | null;
  recoveries: DeviceToReviewItem[];
  offline: boolean;
  recoveryMessage: string | null;
}
export const emptyToReview = (): ToReviewState => ({
  run: null,
  status: 'idle',
  read: { total: 0, groups: [] },
  message: null,
  groupId: null,
  recoveries: [],
  offline: false,
  recoveryMessage: null,
});

/** Recovery stays in its original store. Synthetic ordering dates preserve the existing
 * unconfirmed-first order; they are never displayed as an Expense's date. */
export function mobileToReview(snapshot: MobileSnapshot, now: number, groupId?: string) {
  const deviceItems: DeviceToReviewItem[] = snapshot.drafts.map((draft, index) => {
    let amount: number | undefined;
    try {
      amount = toMajorAmount(parseAmountMinor(draft.amount, draft.currency), draft.currency);
    } catch {
      /* Incomplete amounts remain editable on this phone. */
    }
    return {
      id: `phone:${draft.groupId}`,
      groupId: draft.groupId,
      groupName: draft.groupName,
      createdAt: new Date(index).toISOString(),
      values: {
        description: draft.description,
        currency: draft.currency,
        amount,
        date: draft.date,
      },
    };
  });
  const read =
    snapshot.offline.active || snapshot.toReview.offline
      ? { total: 0, groups: [] }
      : snapshot.toReview.read;
  const active = new Set(read.groups.flatMap((group) => group.items.map((item) => item.draft.id)));
  deviceItems.unshift(
    ...snapshot.toReview.recoveries.filter((item) => !active.has(item.id.split(':').at(-1)!)),
  );
  const groups = read.groups.filter((group) => !groupId || group.groupId === groupId);
  return buildToReview(
    { total: groups.reduce((total, group) => total + group.count, 0), groups },
    deviceItems.filter((item) => !groupId || item.groupId === groupId),
    new Date(now),
  );
}

/** The read without the Groups `leaves` names, its total counted again. */
const withoutGroups = (read: ToReviewRead, leaves: (groupId: string) => boolean): ToReviewRead => {
  if (!read.groups.some((group) => leaves(group.groupId))) return read;
  const groups = read.groups.filter((group) => !leaves(group.groupId));
  return { total: groups.reduce((total, group) => total + group.count, 0), groups };
};

/** One account-scoped, memory-only read feeds Home, the banner and the list. No queued writes. */
export function createToReviewQueries(options: {
  client: QueryClient;
  online: typeof onlineManager;
  environment: string;
  enabled: boolean;
  snapshot(): MobileSnapshot;
  publish(state: ToReviewState): void;
  read(path: string, signal: AbortSignal): Promise<unknown>;
  recoveries(): Promise<DeviceToReviewItem[]>;
  /** A Group this member has lost: no read, however late, shows its items again. */
  lost(groupId: string): boolean;
}) {
  let observer: QueryObserver<ToReviewRead> | undefined;
  let observerOptions: QueryObserverOptions<ToReviewRead> | undefined;
  let stop: (() => void) | undefined;
  let accountId: string | undefined;
  let online = false;
  let queued = false;
  let disposed = false;
  let recoveryRead = 0;
  let deviceView = '';
  let listed: MobileSnapshot['groups']['data'] | undefined;
  const loadRecoveries = async () => {
    const owner = accountId;
    if (!owner) return;
    const sequence = ++recoveryRead;
    try {
      const recoveries = await options.recoveries();
      if (!disposed && owner === accountId && sequence === recoveryRead)
        options.publish({ ...options.snapshot().toReview, recoveries, recoveryMessage: null });
    } catch {
      if (!disposed && owner === accountId && sequence === recoveryRead)
        options.publish({
          ...options.snapshot().toReview,
          recoveryMessage:
            'Could not check this phone for unfinished saves. Reopen To review before saving again.',
        });
    }
  };
  /**
   * Groups denied to an account, each with the Groups list shown when it was denied: no read,
   * however late, shows its items again until a newer list lists the Group again.
   */
  const denied = new Map<string, MobileSnapshot['groups']['data']>();
  const deniedKey = (accountId: string | undefined, groupId: string) => `${accountId}:${groupId}`;
  const lost = (groupId: string) =>
    options.lost(groupId) || denied.has(deniedKey(options.snapshot().auth.user?.id, groupId));
  const unbind = () => {
    stop?.();
    observer?.destroy();
    stop = undefined;
    observer = undefined;
    observerOptions = undefined;
    accountId = undefined;
  };
  const bind = () => {
    queued = false;
    if (disposed) return;
    const snapshot = options.snapshot();
    for (const [key, list] of denied)
      if (
        list !== snapshot.groups.data &&
        snapshot.groups.data.some((group) => key === deniedKey(snapshot.auth.user?.id, group.id))
      )
        denied.delete(key);
    const next =
      options.enabled &&
      ['groups', 'group'].includes(snapshot.screen) &&
      snapshot.auth.status === 'authenticated'
        ? snapshot.auth.user?.id
        : undefined;
    if (!next) {
      unbind();
      return;
    }
    const available = options.online.isOnline() && !snapshot.offline.active;
    const view = `${snapshot.screen}:${snapshot.detail.id ?? ''}`;
    const refreshDevice = listed !== snapshot.groups.data || view !== deviceView;
    listed = snapshot.groups.data;
    deviceView = view;
    if (observer && refreshDevice) void loadRecoveries();
    if (observer && next === accountId && available === online) return;
    unbind();
    accountId = next;
    online = available;
    const owner = next;
    observerOptions = {
      queryKey: toReviewKey({ environment: options.environment, accountId: owner }),
      queryFn: async ({ signal }) => {
        if (
          options.snapshot().auth.status !== 'authenticated' ||
          options.snapshot().auth.user?.id !== owner
        )
          throw new Error('The account changed.');
        if (!options.online.isOnline() || options.snapshot().offline.active)
          throw new Error('Connect to load To review.');
        return parseToReviewResponse(await options.read(toReviewPath(), signal));
      },
      enabled: available,
      retry: false,
      staleTime: 30_000,
      gcTime: 0,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    };
    observer = new QueryObserver<ToReviewRead>(options.client, observerOptions);
    /** The read this observer last showed. A successor query starts empty: while it reads again,
     * that stays, as it was, instead of an empty "Checking" (#433). */
    let shown: Pick<ToReviewState, 'status' | 'read' | 'message'> | undefined;
    const project = () => {
      if (accountId !== owner || options.snapshot().auth.user?.id !== owner) return;
      const result = observer!.getCurrentResult();
      if (available && result.data === undefined && result.isFetching && shown) {
        options.publish({ ...options.snapshot().toReview, offline: false, ...shown });
        return;
      }
      const read = result.data
        ? withoutGroups(result.data, lost)
        : !available
          ? options.snapshot().toReview.read
          : { total: 0, groups: [] };
      const status = result.isFetching
        ? 'loading'
        : result.isError
          ? 'error'
          : result.data
            ? 'ready'
            : 'idle';
      const message = result.isError ? 'Could not load To review. Try again when connected.' : null;
      // A read that answered is kept through its reads again; an error or nothing read yet isn't,
      // so a retry shows that it's checking.
      if (status === 'ready') shown = { status, read, message };
      else if (status !== 'loading') shown = undefined;
      options.publish({
        ...options.snapshot().toReview,
        offline: !available,
        status,
        read,
        message,
      });
    };
    stop = observer.subscribe(project);
    project();
    void loadRecoveries();
  };
  const bindLater = () => {
    if (!queued && !disposed) {
      queued = true;
      queueMicrotask(bind);
    }
  };
  const stopOnline = options.online.subscribe(bindLater);
  return {
    bindLater,
    /**
     * Home's scope was outdated: its read shares that scope, so its query was replaced. The
     * observer moves to the successor, which reads again, as Home's own reads do (#433).
     */
    rebind() {
      if (observer && observerOptions) observer.setOptions(observerOptions);
    },
    lose(groupId: string) {
      const owner = options.snapshot().auth.user?.id;
      if (!owner) return;
      denied.set(deniedKey(owner, groupId), options.snapshot().groups.data);
      const key = toReviewKey({ environment: options.environment, accountId: owner });
      void options.client.cancelQueries({ queryKey: key, exact: true });
      const state = options.snapshot().toReview;
      const read = withoutGroups(state.read, (id) => id === groupId);
      options.client.setQueryData(key, read);
      options.publish({
        ...options.snapshot().toReview,
        read,
        recoveries: state.recoveries.filter((item) => item.groupId !== groupId),
      });
    },
    /** Reads To review again beside this phone's check, never after it: storage can be busy. */
    async refresh() {
      if (!options.enabled) return;
      const connected = options.online.isOnline() && !options.snapshot().offline.active;
      if (connected) bind();
      await Promise.all([loadRecoveries(), connected ? observer?.refetch() : undefined]);
    },
    stop() {
      disposed = true;
      unbind();
      stopOnline();
    },
  };
}

/** Retained collection attempts must stay reachable even when the server already saved every
 * item and the active read is empty. These are recovery shortcuts, never new save selections. */
export function draftRequestRecoveries(
  records: { groupId: string; value: unknown }[],
  groups: MobileSnapshot['groups']['data'],
): DeviceToReviewItem[] {
  return records.flatMap(({ groupId, value }) => {
    const group = groups.find((group) => group.id === groupId);
    if (!group || typeof value !== 'string') return [];
    let values: { id: string; values: DeviceToReviewItem['values'] }[];
    try {
      const attempt = JSON.parse(value);
      if (attempt.path === `${expenseDraftsPath(groupId)}/save`) {
        values = saveExpenseDraftsSchema
          .parse(JSON.parse(attempt.body))
          .drafts.map(({ id }) => ({ id, values: { description: 'Save awaiting confirmation' } }));
      } else if (attempt.path === expenseDraftsPath(groupId)) {
        values = createExpenseDraftsSchema
          .parse(JSON.parse(attempt.body))
          .drafts.map((values, index) => ({ id: String(index), values }));
      } else return [];
    } catch {
      values = [{ id: 'unreadable', values: { description: 'Action awaiting confirmation' } }];
    }
    return values.map(({ id, values }) => ({
      id: `save:${groupId}:${id}`,
      groupId,
      groupName: group.name,
      createdAt: new Date(-1).toISOString(),
      values,
    }));
  });
}
