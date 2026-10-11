import { expenseDraftsKey } from '@splitbook/shared/query-keys';
import { QueryObserver, type QueryClient } from '@tanstack/query-core';
import { draftValues, type DraftEntries } from '@splitbook/shared/persistent-draft-editor';
import { draftEntries } from '@splitbook/shared/persistent-draft-editor';
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
  editing: PersistedExpenseDraft | 'new' | null;
  entries: DraftEntries;
  choice: string | null;
  pending: boolean;
  busy: boolean;
  message: string;
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
  editing: null,
  entries: {},
  choice: null,
  pending: false,
  busy: false,
  message: '',
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
}: {
  client: Client;
  queryClient: QueryClient;
  groupId: string;
  environment: string;
  accountId: string;
  read(): SharedDraftCollectionState;
  publish(value: SharedDraftCollectionState): void;
  current(): boolean;
}) {
  let stop: (() => void) | undefined;
  let mounted = false;
  const update = (patch: Partial<SharedDraftCollectionState>) => {
    if (mounted && current()) publish({ ...read(), ...patch });
  };
  const observer = new QueryObserver(queryClient, {
    queryKey: expenseDraftsKey({ environment, accountId }, groupId),
    queryFn: async () => {
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
    const result = await observer.refetch();
    if (result.error) throw result.error;
    update({ pending: !!(await client.pending()) });
  };
  const run = async (work: () => Promise<void>) => {
    if (!mounted || !current() || read().busy) return;
    update({ busy: true, message: '' });
    try {
      await work();
    } catch (error) {
      update({
        message:
          error instanceof Error ? error.message : 'Request not confirmed. Reload before retrying.',
      });
    } finally {
      try {
        update({ pending: !!(await client.pending()) });
      } catch {
        update({
          pending: true,
          message: 'Could not read the retained request. Reload before making changes.',
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
        .then((value) => update({ pending: !!value }))
        .catch(() =>
          update({
            pending: true,
            message: 'Could not read the retained request. Reload before making changes.',
          }),
        );
      return () => {
        mounted = false;
        stop?.();
        observer.destroy();
      };
    },
    refresh: () => run(refresh),
    newDraft() {
      if (!read().busy) update({ editing: 'new', entries: {}, choice: null });
    },
    edit(draft: PersistedExpenseDraft) {
      if (!read().busy)
        update({ editing: draft, entries: draftEntries(draft.values), choice: null });
    },
    closeEditor() {
      if (!read().busy) update({ editing: null, choice: null });
    },
    choose(key: string | null) {
      if (!read().busy) update({ choice: key });
    },
    enter(key: string, value: string) {
      if (!read().busy) update({ entries: { ...read().entries, [key]: value }, choice: null });
    },
    select(id: string) {
      if (!read().busy) update({ selected: toggle(read().selected, id), reviews: [] });
    },
    acknowledge(id: string) {
      if (!read().busy) update({ ack: toggle(read().ack, id) });
    },
    loadLatest: () =>
      run(async () => {
        const editing = read().editing;
        if (!editing || editing === 'new') return;
        await refresh();
        const fresh = read().rows.find((row) => row.id === editing.id);
        if (!fresh) throw new Error('Draft no longer available');
        update({ editing: fresh, entries: draftEntries(fresh.values) });
      }),
    keep: () =>
      run(async () => {
        const { editing, entries } = read();
        if (!editing) return;
        if (editing === 'new') await client.create(draftValues(entries));
        else await client.replace(editing, draftValues(entries));
        update({ editing: null, reviews: [] });
        await refresh();
      }),
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
    save: () =>
      run(async () => {
        const { reviews, ack } = read();
        update({
          outcomeNames: Object.fromEntries(
            reviews.map((row) => [
              row.draft.id,
              row.draft.values?.description || 'Incomplete Draft',
            ]),
          ),
        });
        update({ outcomes: await client.save(reviews, ack), reviews: [], selected: [] });
        await refresh();
      }),
    retry: () =>
      run(async () => {
        const result = await client.retry();
        if (result?.kind === 'save')
          update({ outcomes: result.outcomes, reviews: [], selected: [] });
        await refresh();
      }),
  };
}
