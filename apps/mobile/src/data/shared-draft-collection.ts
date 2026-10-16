import { buildToReview } from '@splitbook/shared/to-review';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { expenseDraftsKey } from '@splitbook/shared/query-keys';
import { QueryObserver, type QueryClient } from '@tanstack/query-core';
import type {
  DraftReview,
  DraftSaveOutcome,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import type { draftCollectionClient } from '@splitbook/shared/draft-collection-client';
import type { ExpenseContext } from './expense-draft';

export interface SharedDraftCollectionState {
  groupId: string | null;
  context: ExpenseContext | null;
  rows: PersistedExpenseDraft[];
  selected: string[];
  reviews: DraftReview[];
  ack: string[];
  outcomes: DraftSaveOutcome[];
  outcomeNames: Record<string, string>;
  pending: boolean;
  busy: boolean;
  message: string;
  confirmation: ReturnType<typeof buildToReview>['ready'] | null;
  resultsVisible: boolean;
}
export const emptySharedDraftCollection = (): SharedDraftCollectionState => ({
  groupId: null,
  context: null,
  rows: [],
  selected: [],
  reviews: [],
  ack: [],
  outcomes: [],
  outcomeNames: {},
  pending: false,
  busy: false,
  message: '',
  confirmation: null,
  resultsVisible: false,
});
/** Reads one Group's items again where its collection is open (Refresh items). */
export const refetchDraftCollection = (
  queryClient: QueryClient,
  account: { environment: string; accountId: string },
  groupId: string,
) =>
  queryClient.refetchQueries({
    queryKey: expenseDraftsKey(account, groupId),
    exact: true,
    type: 'active',
  });
type Client = ReturnType<typeof draftCollectionClient> & { context(): Promise<ExpenseContext> };
/** Controller-owned online collection. Only reads enter Query; retained writes remain explicit. */
export function sharedDraftCollection({
  client,
  queryClient,
  groupId,
  environment,
  accountId,
  read,
  publish,
  current,
  online = () => true,
  now = Date.now,
  changed = async () => {},
}: {
  client: Client;
  queryClient: QueryClient;
  groupId: string;
  environment: string;
  accountId: string;
  read(): SharedDraftCollectionState;
  publish(value: SharedDraftCollectionState): void;
  current(): boolean;
  online?(): boolean;
  now?(): number;
  changed?(): Promise<void>;
}) {
  let stop: (() => void) | undefined;
  let mounted = false;
  const update = (patch: Partial<SharedDraftCollectionState>) => {
    if (mounted && current()) publish({ ...read(), ...patch });
  };
  const observer = new QueryObserver(queryClient, {
    queryKey: expenseDraftsKey({ environment, accountId }, groupId),
    enabled: online(),
    queryFn: async () => {
      if (!online()) throw new Error('Connect to load To review.');
      const [rows, context] = await Promise.all([client.list(), client.context()]);
      return { rows, context };
    },
    staleTime: 30_000,
    refetchOnMount: 'always',
    gcTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
  const refresh = async () => {
    if (!online()) return;
    const result = await observer.refetch();
    if (result.error) throw result.error;
    update({ pending: !!(await client.pending()) });
    await changed();
  };
  const run = async (work: () => Promise<void>) => {
    if (!mounted || !current() || read().busy) return;
    if (!online()) {
      update({ message: 'Connect to use the items in your account.' });
      return;
    }
    update({ busy: true, message: '' });
    try {
      await work();
    } catch (error) {
      update({
        message:
          error instanceof Error ? error.message : 'Could not confirm this action. Check again.',
      });
    } finally {
      try {
        update({ pending: !!(await client.pending()) });
      } catch {
        update({
          pending: true,
          message: 'Could not check the previous action. Reopen To review before making changes.',
        });
      }
      update({ busy: false });
    }
  };
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  return {
    open() {
      mounted = true;
      publish({
        ...(read().groupId === groupId ? read() : emptySharedDraftCollection()),
        groupId,
        rows: [],
        context: null,
        busy: false,
        pending: true,
      });
      stop = observer.subscribe((result) => {
        if (!mounted || !current()) return;
        if (result.error) {
          const status = 'status' in result.error ? result.error.status : undefined;
          update({
            ...([403, 404].includes(Number(status))
              ? { ...emptySharedDraftCollection(), groupId, pending: read().pending }
              : { rows: [], context: null }),
            message: result.error.message,
          });
        } else if (result.data) update(result.data);
      });
      void client
        .pending()
        .then((value) => {
          update({ pending: !!value });
          if (value && !read().outcomes.length) {
            const attempt = JSON.parse(value);
            if (attempt.path?.endsWith('/save')) {
              const items = JSON.parse(attempt.body).drafts as { id: string }[];
              update({
                resultsVisible: true,
                outcomes: items.map(({ id }) => ({
                  id,
                  status: 'unresolved',
                  message: "We didn't hear back, so it may already be saved",
                })),
              });
            }
          }
        })
        .catch(() =>
          update({
            pending: true,
            message: 'Could not check the previous action. Reopen To review before making changes.',
          }),
        );
      return () => {
        mounted = false;
        stop?.();
        observer.destroy();
      };
    },
    connectivityChanged() {
      observer.setOptions({ ...observer.options, enabled: online() });
    },
    refresh: () => run(refresh),
    select(id: string) {
      if (!read().busy) update({ selected: toggle(read().selected, id), reviews: [] });
    },
    acknowledge(id: string) {
      if (!read().busy) update({ ack: toggle(read().ack, id) });
    },
    discard: (draft: PersistedExpenseDraft) =>
      run(async () => {
        await client.discard(draft);
        update({ reviews: [], selected: read().selected.filter((id) => id !== draft.id) });
        await refresh();
      }),
    review: () =>
      run(async () => {
        update({ reviews: await client.review(read().selected), ack: [], outcomes: [] });
      }),
    reviewReady: (items: ToReviewItem[]) =>
      run(async () => {
        if (read().pending || !items.length) return;
        update({ confirmation: null, reviews: [], outcomes: [], resultsVisible: false });
        const reviews = await client.review(items.map((item) => item.draft.id));
        const ready = buildToReview(
          {
            total: reviews.length,
            groups: [
              {
                groupId,
                groupName: read().context?.group.name ?? '',
                count: reviews.length,
                items: reviews,
              },
            ],
          },
          [],
          new Date(now()),
        ).ready;
        if (ready.count !== items.length) {
          update({ message: 'Some items changed. Check their details before saving.' });
          await refresh();
          return;
        }
        update({ reviews, ack: [], confirmation: ready });
      }),
    cancelReview() {
      if (!read().busy) update({ confirmation: null, reviews: [] });
    },
    closeResults() {
      if (!read().busy) update({ resultsVisible: false });
    },
    save: () =>
      run(async () => {
        const { reviews, ack } = read();
        if (read().pending || !reviews.length) return;
        update({
          outcomeNames: Object.fromEntries(
            reviews.map((row) => [
              row.draft.id,
              row.draft.values?.description || 'Incomplete Draft',
            ]),
          ),
        });
        try {
          update({ outcomes: await client.save(reviews, ack) });
        } catch (error) {
          const pending = !!(await client.pending());
          update({
            outcomes: reviews.map(({ draft }) => ({
              id: draft.id,
              status: pending ? 'unresolved' : 'failed',
              message: pending
                ? "We didn't hear back, so it may already be saved"
                : error instanceof Error
                  ? error.message
                  : 'Could not save this item.',
            })),
          });
        }
        update({ reviews: [], selected: [], confirmation: null, resultsVisible: true });
        await refresh();
      }),
    retry: () =>
      run(async () => {
        const result = await client.retry();
        if (result?.kind === 'save')
          update({
            outcomes: result.outcomes,
            reviews: [],
            selected: [],
            confirmation: null,
            resultsVisible: true,
          });
        else if (result?.kind === 'create' && result.localDraftRetained)
          update({
            message: 'Your original Draft was uploaded. Newer entries are still on this device.',
          });
        await refresh();
      }),
  };
}
