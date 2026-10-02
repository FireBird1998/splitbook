/**
 * #108 pilot: TanStack Query owns the Group Activity timeline (fetching, cached state,
 * staleness and invalidation). The controller supplies a network-only validated page read
 * and an explicit persistence adapter, and projects the observed result into its snapshot.
 * Nothing else in the controller reads, caches or invalidates Activity pages. Event
 * details, which read the Group and the linked Expense, stay with the controller.
 */
import {
  environmentManager,
  focusManager,
  InfiniteQueryObserver,
  QueryClient,
  type InfiniteData,
  type InfiniteQueryObserverResult,
  type Query,
} from '@tanstack/query-core';
import type { ActivityEvent } from './activity';

// The app is always a client. Without `window` (tests, Node scripts) TanStack would assume a
// server and change its timers and defaults, so behaviour would differ from the device.
environmentManager.setIsServer(() => false);

export interface ActivityPage {
  /** The validated response as received: what the persistence adapter stores. */
  value: unknown;
  events: ActivityEvent[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  /** Controller-clock time this page was read from the network, or saved. */
  refreshedAt: number;
  /** A saved copy from this device, never this session's network read. */
  restored: boolean;
}
type Pages = InfiniteData<ActivityPage, number>;
type Key = readonly ['activity', string, string];
export type ActivityReadResult = InfiniteQueryObserverResult<Pages, Error>;
/**
 * `reuse`: a timeline read within the freshness window is shown again, otherwise read.
 * `keep`: any timeline already read is shown as it is; only a missing one is read.
 * `force`: the first page is read again now, replacing the timeline when it arrives.
 */
export type ActivityShowMode = 'reuse' | 'keep' | 'force';

export interface ActivityReadDependencies {
  /** One validated network read of a page. Never a saved copy. */
  fetchPage(groupId: string, page: number): Promise<ActivityPage>;
  /** Saves one page read from the network, with the time it was read. */
  save(accountId: string, groupId: string, page: ActivityPage): void;
  /** This account's saved pages for the Group, validated, each with its original time. */
  restore(accountId: string, groupId: string): Promise<ActivityPage[] | null>;
  /** The controller's clock; TanStack's own timestamps use the real one. */
  now(): number;
  /** How long a network read is shown again without another request. */
  freshness: number;
  /** The observed timeline changed. */
  onChange(): void;
}

/**
 * Android's foreground state drives refetching. Call once, with the native AppState: the
 * controller's own foreground refresh leaves Activity to this.
 */
export function watchAppFocus(
  subscribe: (listener: (active: boolean) => void) => () => void,
): () => void {
  focusManager.setEventListener((setFocused) => subscribe((active) => setFocused(active)));
  return () => focusManager.setEventListener(() => undefined);
}

const ignore = () => undefined;

export function createActivityReads(dependencies: ActivityReadDependencies) {
  /** Fresh only within the freshness window of network reads, on the controller's clock. */
  const fresh = (data: Pages | undefined) => {
    if (!data?.pages.length || data.pages.some((page) => page.restored)) return false;
    const age = dependencies.now() - Math.min(...data.pages.map((page) => page.refreshedAt));
    return age >= 0 && age < dependencies.freshness;
  };
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // The member retries with a pull or Retry.
        retry: false,
        // There is no native connectivity listener in this build, so a read is always
        // attempted; a network failure shows the saved copy rather than pausing.
        networkMode: 'always',
        refetchOnReconnect: false,
        refetchOnWindowFocus: true,
        // Pages carry their own provenance; sharing old objects would blur it.
        structuralSharing: false,
        // Invalidated queries and saved copies are always stale.
        staleTime: (query) => (fresh(query.state.data as Pages | undefined) ? Infinity : 0),
      },
    },
  });
  client.mount();
  const options = (accountId: string, groupId: string) => ({
    queryKey: ['activity', accountId, groupId] as Key,
    queryFn: ({ pageParam }: { pageParam: number }) => dependencies.fetchPage(groupId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: ActivityPage) =>
      last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
  });
  const ofGroup = (groupId: string) => (query: Query) =>
    query.queryKey[0] === 'activity' && query.queryKey[2] === groupId;

  // Only network reads are saved, each page once, and only while its query is still cached.
  const saved = new WeakSet<ActivityPage>();
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    if (client.getQueryCache().get(event.query.queryHash) !== event.query) return;
    const [, accountId, groupId] = event.query.queryKey as unknown as Key;
    for (const page of (event.query.state.data as Pages).pages)
      if (!page.restored && !saved.has(page)) {
        saved.add(page);
        dependencies.save(accountId, groupId, page);
      }
  });

  let observer: InfiniteQueryObserver<ActivityPage, Error, Pages, Key, number> | null = null;
  let stopObserving: (() => void) | null = null;
  let shown: { accountId: string; groupId: string } | null = null;
  const showing = (accountId: string, groupId: string) =>
    shown?.accountId === accountId && shown.groupId === groupId;
  const changed = (accountId: string, groupId: string) => {
    if (showing(accountId, groupId)) dependencies.onChange();
  };

  /** Shows the saved copy while a first read is in flight, or after it failed. */
  const restore = async (accountId: string, groupId: string) => {
    const key = options(accountId, groupId).queryKey;
    if (client.getQueryData(key)) return;
    const pages = await dependencies.restore(accountId, groupId).catch(() => null);
    // A network read that landed first wins, and a removed query stays removed.
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    if (!pages?.length || !query || query.state.data !== undefined) return;
    client.setQueryData(
      key,
      { pages, pageParams: pages.map((page) => page.pagination.page) },
      { updatedAt: pages[0]!.refreshedAt },
    );
  };

  const hide = () => {
    stopObserving?.();
    stopObserving = null;
    shown = null;
  };
  /** Sign-out and account change: everything goes, and late reads find nothing to fill. */
  const clear = () => {
    hide();
    observer = null;
    void client.cancelQueries();
    client.clear();
  };

  return {
    /** Observes this Group's timeline and resolves once any read it needs settles. */
    async show(accountId: string, groupId: string, mode: ActivityShowMode) {
      if (shown && !showing(accountId, groupId)) hide();
      const next = options(accountId, groupId);
      const observed = { ...next, refetchOnMount: mode !== 'keep' };
      const current = (observer ??= new InfiniteQueryObserver(client, observed));
      current.setOptions(observed);
      shown = { accountId, groupId };
      // Subscribing reads a missing or (except `keep`) stale timeline.
      stopObserving ??= current.subscribe(() => changed(accountId, groupId));
      const query = client.getQueryCache().find({ queryKey: next.queryKey, exact: true });
      // Joins the read subscribing started, so a timeline is never read twice at once.
      const reading = (
        mode === 'force'
          ? client.fetchInfiniteQuery({ ...next, staleTime: 0, pages: 1 })
          : mode === 'reuse' || query?.state.data === undefined
            ? client.fetchInfiniteQuery(next)
            : Promise.resolve()
      ).catch(ignore);
      await restore(accountId, groupId);
      changed(accountId, groupId);
      await reading;
      changed(accountId, groupId);
    },
    /** Stops observing: a hidden timeline is not refetched on focus. Its data stays cached. */
    hide,
    async loadMore() {
      if (!observer || !shown) return;
      const { accountId, groupId } = shown;
      await observer.fetchNextPage().catch(ignore);
      changed(accountId, groupId);
    },
    /**
     * A ledger change: reads in flight are cancelled, so they are neither shown nor saved,
     * and every cached timeline of the Group reads again when next shown (now, if shown).
     */
    invalidate(groupId: string) {
      const filters = { predicate: ofGroup(groupId) };
      void client.cancelQueries(filters);
      void client.invalidateQueries({ ...filters, refetchType: 'none' });
      if (observer && shown?.groupId === groupId) void observer.refetch().catch(ignore);
    },
    /** An explicit refresh of the Group: its cached timelines read again when next shown. */
    expire(groupId: string) {
      void client.invalidateQueries({ predicate: ofGroup(groupId), refetchType: 'none' });
    },
    /** Denial or a Group no longer listed: nothing read for it may be shown or reused. */
    remove(groupId: string) {
      if (shown?.groupId === groupId) hide();
      void client.cancelQueries({ predicate: ofGroup(groupId) });
      client.removeQueries({ predicate: ofGroup(groupId) });
    },
    /** Keeps only these Groups' timelines. */
    retain(groupIds: ReadonlySet<string>) {
      const unlisted = (query: Query) =>
        query.queryKey[0] === 'activity' && !groupIds.has(query.queryKey[2] as string);
      if (shown && !groupIds.has(shown.groupId)) hide();
      void client.cancelQueries({ predicate: unlisted });
      client.removeQueries({ predicate: unlisted });
    },
    clear,
    /** The observed timeline, if it is this Group's. */
    current(groupId: string): ActivityReadResult | null {
      return observer && shown?.groupId === groupId ? observer.getCurrentResult() : null;
    },
    dispose() {
      clear();
      client.unmount();
    },
  };
}
export type ActivityReads = ReturnType<typeof createActivityReads>;
