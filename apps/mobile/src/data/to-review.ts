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
  let observed: QueryObserverOptions<ToReviewRead> | undefined;
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
  /** Groups denied to an account this session, until it joins or creates them again. */
  const dropped = new Set<string>();
  const lost = (groupId: string) =>
    options.lost(groupId) || dropped.has(`${options.snapshot().auth.user?.id}:${groupId}`);
  const withoutLost = (read: ToReviewRead): ToReviewRead => {
    if (!read.groups.some((group) => lost(group.groupId))) return read;
    const groups = read.groups.filter((group) => !lost(group.groupId));
    return { total: groups.reduce((total, group) => total + group.count, 0), groups };
  };
  const unbind = () => {
    stop?.();
    observer?.destroy();
    stop = undefined;
    observer = undefined;
    observed = undefined;
    accountId = undefined;
  };
  const bind = () => {
    queued = false;
    if (disposed) return;
    const snapshot = options.snapshot();
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
    observed = {
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
    observer = new QueryObserver<ToReviewRead>(options.client, observed);
    /** What this observer last showed: a successor query re-reading starts empty (#433). */
    let shown: ToReviewRead | undefined;
    const project = () => {
      if (accountId !== owner || options.snapshot().auth.user?.id !== owner) return;
      const result = observer!.getCurrentResult();
      const read =
        (result.data && withoutLost(result.data)) ??
        (!available
          ? options.snapshot().toReview.read
          : result.isFetching && shown
            ? shown
            : { total: 0, groups: [] });
      shown = read;
      options.publish({
        ...options.snapshot().toReview,
        offline: !available,
        status: result.isFetching
          ? 'loading'
          : result.isError
            ? 'error'
            : result.data
              ? 'ready'
              : 'idle',
        read,
        message: result.isError ? 'Could not load To review. Try again when connected.' : null,
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
      if (observer && observed) observer.setOptions(observed);
    },
    lose(groupId: string) {
      const owner = options.snapshot().auth.user?.id;
      if (!owner) return;
      dropped.add(`${owner}:${groupId}`);
      const key = toReviewKey({ environment: options.environment, accountId: owner });
      void options.client.cancelQueries({ queryKey: key, exact: true });
      const withoutGroup = (read: ToReviewRead) => {
        const groups = read.groups.filter((group) => group.groupId !== groupId);
        return { total: groups.reduce((total, group) => total + group.count, 0), groups };
      };
      const state = options.snapshot().toReview;
      const read = withoutGroup(state.read);
      options.client.setQueryData(key, read);
      options.publish({
        ...options.snapshot().toReview,
        read,
        recoveries: state.recoveries.filter((item) => item.groupId !== groupId),
      });
    },
    /** The member joined or created this Group: its items show again. */
    gain(groupId: string) {
      dropped.delete(`${options.snapshot().auth.user?.id}:${groupId}`);
    },
    /** Reads To review again beside this phone's check, never after it: storage can be busy. */
    async refresh() {
      if (!options.enabled) return;
      const online = options.online.isOnline() && !options.snapshot().offline.active;
      if (online) bind();
      await Promise.all([loadRecoveries(), online ? observer?.refetch() : undefined]);
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
