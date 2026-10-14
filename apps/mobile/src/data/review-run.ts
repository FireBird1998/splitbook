import { buildToReview, type ReviewRunOutcome } from '@splitbook/shared/to-review';
import type { ToReviewItem, ToReviewRead } from '@splitbook/shared/to-review-read';
import type {
  DraftReview,
  ExpenseDraftValues,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import type { MobileController } from './mobile-controller';
import type { ExpenseContext } from './expense-draft';
import type { ExpenseRecord } from './expense-record';

export interface ReviewRunState {
  items: { groupId: string; groupName: string; item: ToReviewItem }[];
  index: number;
  outcomes: ReviewRunOutcome[];
  context: ExpenseContext | null;
  busy: boolean;
  editing: boolean;
  pending: boolean;
  acknowledged: boolean;
  deletePrompt: boolean;
  message: string | null;
  changed: { before: PersistedExpenseDraft; after: PersistedExpenseDraft } | null;
  matches: ExpenseRecord[];
  allocation: DraftReview['allocation'] | null;
}
type Client = ReturnType<MobileController['sharedDrafts']>;

/** One immutable run selection, with explicit writes and the shared client's replay identity. */
export function createReviewRun(options: {
  read(): ReviewRunState | null;
  publish(state: ReviewRunState): void;
  current(): boolean;
  online(): boolean;
  client(groupId: string): Client;
  refresh(): Promise<void>;
}) {
  let queued: ExpenseDraftValues | null = null;
  let writing: Promise<void> | undefined;
  const update = (patch: Partial<ReviewRunState>) => {
    const state = options.read();
    if (options.current() && state) options.publish({ ...state, ...patch });
  };
  const item = () => {
    const state = options.read();
    return state?.items[state.index];
  };
  const receive = (read: ToReviewRead) => {
    const state = options.read(),
      selected = item();
    if (!state || !selected || state.busy || state.pending) return;
    const latest = read.groups
      .find((g) => g.groupId === selected.groupId)
      ?.items.find((i) => i.draft.id === selected.item.draft.id);
    if (latest && latest.draft.revision > selected.item.draft.revision) {
      update({
        items: state.items.map((row, index) =>
          index === state.index ? { ...row, item: latest } : row,
        ),
        changed: { before: selected.item.draft, after: latest.draft },
        acknowledged: false,
        allocation: null,
      });
    }
  };
  const load = async () => {
    const selected = item();
    if (!selected || !options.online()) return;
    const client = options.client(selected.groupId);
    const [context, pending, reviews] = await Promise.all([
      client.context(),
      client.pending(),
      client.review([selected.item.draft.id]),
    ]);
    if (!options.current() || item() !== selected) return;
    const state = options.read()!;
    const latest = reviews[0];
    update({
      context,
      pending: !!pending,
      allocation: latest.allocation ?? null,
      items: state.items.map((row, i) => (i === state.index ? { ...row, item: latest } : row)),
      ...(latest.draft.revision !== selected.item.draft.revision
        ? { changed: { before: selected.item.draft, after: latest.draft }, acknowledged: false }
        : {}),
    });
    const matches = await Promise.all(
      selected.item.duplicates.filter((d) => d.kind === 'expense').map((d) => client.expense(d.id)),
    );
    if (options.current() && item()?.item.draft.id === selected.item.draft.id) update({ matches });
  };
  const run = async (work: () => Promise<void>) => {
    if (!options.current() || !options.read() || options.read()!.busy || !options.online()) return;
    update({ busy: true, message: null });
    try {
      await work();
    } catch {
      update({ message: 'Could not confirm this action. Check again.' });
    } finally {
      if (options.current()) {
        const selected = item();
        if (selected) {
          try {
            update({ pending: !!(await options.client(selected.groupId).pending()) });
          } catch {
            update({
              pending: true,
              message: 'Could not check the earlier action. Close and reopen To review.',
            });
          }
        }
        update({ busy: false });
      }
    }
  };
  const advance = async (status: ReviewRunOutcome['status']) => {
    const state = options.read(),
      selected = item();
    if (!state || !selected || !options.current()) return;
    update({
      index: state.index + 1,
      outcomes: [...state.outcomes, { id: selected.item.draft.id, status }],
      context: null,
      matches: [],
      allocation: null,
      changed: null,
      acknowledged: false,
      deletePrompt: false,
      pending: false,
      message: null,
    });
    await load();
  };
  const refresh = async () => {
    await options.refresh();
    const selected = item();
    if (!selected || !options.current() || !options.online()) return;
    const reviews = await options.client(selected.groupId).review([selected.item.draft.id]);
    if (!options.current()) return;
    const latest = reviews[0];
    if (latest) {
      const state = options.read()!;
      update({
        items: state.items.map((row, i) => (i === state.index ? { ...row, item: latest } : row)),
        acknowledged: false,
        allocation: latest.allocation ?? null,
        ...(latest.draft.revision !== selected.item.draft.revision
          ? { changed: { before: selected.item.draft, after: latest.draft } }
          : {}),
      });
    }
  };
  return {
    receive,
    finishEditing: () => writing,
    start: () => run(load),
    refresh: () =>
      run(async () => {
        await refresh();
        await load();
      }),
    acknowledge() {
      if (!options.read()?.busy && !options.read()?.pending && options.online())
        update({ acknowledged: !options.read()?.acknowledged });
    },
    deletePrompt(value: boolean) {
      if (!options.read()?.busy && !options.read()?.pending && options.online())
        update({ deletePrompt: value });
    },
    skip: () =>
      run(async () => {
        if (!options.read()?.pending) await advance('skipped');
      }),
    change(values: ExpenseDraftValues) {
      const selected = item(),
        state = options.read();
      if (
        !selected ||
        !state ||
        !options.current() ||
        !options.online() ||
        state.pending ||
        (state.busy && !state.editing)
      )
        return;
      queued = values;
      update({
        items: state.items.map((row, i) =>
          i === state.index
            ? { ...row, item: { ...row.item, draft: { ...row.item.draft, values } } }
            : row,
        ),
        acknowledged: false,
      });
      if (state.editing) return writing;
      const confirmed = selected.item.draft;
      writing = run(async () => {
        update({ editing: true });
        let version = confirmed;
        try {
          while (queued && options.current() && options.online()) {
            const next = queued;
            queued = null;
            version = await options.client(selected.groupId).replace(version, next);
            if (!options.current()) return;
            if (!queued) {
              const state = options.read()!;
              update({
                items: state.items.map((row, i) =>
                  i === state.index ? { ...row, item: { ...row.item, draft: version } } : row,
                ),
              });
            }
          }
          queued = null;
          await refresh();
        } catch {
          queued = null;
          await refresh();
          update({
            message: 'Your change was not confirmed. Check the latest details before trying again.',
          });
        } finally {
          update({ editing: false });
        }
      });
      return writing;
    },
    save: () =>
      run(async () => {
        const selected = item(),
          state = options.read();
        if (!selected || !state || state.pending) return;
        const client = options.client(selected.groupId);
        const reviews = await client.review([selected.item.draft.id]);
        if (!options.current()) return;
        const latest = reviews[0];
        if (latest.draft.revision !== selected.item.draft.revision) {
          update({
            items: state.items.map((row, i) =>
              i === state.index ? { ...row, item: latest } : row,
            ),
            changed: { before: selected.item.draft, after: latest.draft },
            acknowledged: false,
          });
          return;
        }
        const model = buildToReview(
          {
            total: 1,
            groups: [
              {
                groupId: selected.groupId,
                groupName: selected.groupName,
                count: 1,
                items: reviews,
              },
            ],
          },
          [],
          new Date(),
        );
        if (
          model.items[0].state === 'needs-details' ||
          (latest.duplicates.length && !state.acknowledged)
        ) {
          update({
            items: state.items.map((row, i) =>
              i === state.index ? { ...row, item: latest } : row,
            ),
            message: 'Check the details before saving.',
          });
          return;
        }
        try {
          const outcomes = await client.save(reviews, state.acknowledged ? [latest.draft.id] : []);
          if (!options.current()) return;
          if (outcomes[0].status === 'saved') {
            await advance('saved');
            await options.refresh();
          } else if (outcomes[0].status === 'unresolved')
            update({ pending: true, message: "We didn't hear back, so it may already be saved" });
          else {
            await refresh();
            update({
              message: 'Could not save this item. Check its details or leave it for later.',
            });
          }
        } catch {
          if (!options.current()) return;
          const pending = !!(await client.pending());
          update({
            pending,
            message: pending
              ? "We didn't hear back, so it may already be saved"
              : 'Could not save this item. Check its details or leave it for later.',
          });
        }
      }),
    retry: () =>
      run(async () => {
        const selected = item();
        if (!selected || !options.read()?.pending) return;
        const result = await options.client(selected.groupId).retry();
        if (!options.current()) return;
        if (
          result?.kind === 'save' &&
          result.outcomes.find((o) => o.id === selected.item.draft.id)?.status === 'saved'
        ) {
          await advance('saved');
          await options.refresh();
        } else update({ message: 'Could not confirm saving. Check again or close review.' });
      }),
    delete: () =>
      run(async () => {
        const selected = item();
        if (!selected || !options.read()?.deletePrompt || options.read()?.pending) return;
        try {
          await options.client(selected.groupId).discard(selected.item.draft);
        } catch {
          await refresh();
          update({
            deletePrompt: false,
            message: 'Could not delete this item. Check the latest details.',
          });
          return;
        }
        if (!options.current()) return;
        await advance('deleted');
        await options.refresh();
      }),
  };
}
