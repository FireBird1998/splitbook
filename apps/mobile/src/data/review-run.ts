import { draftEditQueue } from '@splitbook/shared/draft-edit-queue';
import { buildToReview, type ReviewRunOutcome } from '@splitbook/shared/to-review';
import type { ToReviewItem, ToReviewRead } from '@splitbook/shared/to-review-read';
import type { GroupCategory } from '@splitbook/shared/types';
import type {
  DraftReview,
  ExpenseDraftValues,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import type { MobileController } from './mobile-controller';
import type { ExpenseContext } from './expense-draft';
import type { ExpenseRecord } from './expense-record';
import type { MobileTimer } from './types';

/**
 * A pause in typing this long saves the Draft (#1289). Thumbs leave longer gaps than a desktop
 * keyboard, and every flush point saves at once, so nothing waits on this but the quiet save.
 */
const TYPING_PAUSE_MS = 1000;

export interface ReviewRunState {
  /** Each item with its Group, and the Group's currency (#512) and kind (#596) the read names. */
  items: {
    groupId: string;
    groupName: string;
    currency?: string;
    category?: GroupCategory;
    item: ToReviewItem;
  }[];
  index: number;
  outcomes: ReviewRunOutcome[];
  context: ExpenseContext | null;
  busy: boolean;
  editing: boolean;
  unkept: ExpenseDraftValues | null;
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
  /** Ends the pause in typing. Defaults to the platform's own `setTimeout`. */
  timer?: MobileTimer;
}) {
  const timer: MobileTimer =
    options.timer ??
    ((run, ms) => {
      const handle = setTimeout(run, ms);
      return () => clearTimeout(handle);
    });
  let edits: ReturnType<typeof draftEditQueue<ExpenseDraftValues>> | null = null;
  let writing: Promise<void> | undefined;
  /** A typed change's save is sending its writes; a change typed now joins them. */
  let flushing = false;
  /** Typed as a save ended, while it read the pending action: the next save's entries (#1287). */
  let next: ExpenseDraftValues | null = null;
  /**
   * Typed and on screen, not yet handed to a save (#1289): it is sent after a pause in typing, or
   * at once at a flush point. It lives in memory only, so it is gone with the run, on sign-out too.
   */
  let typed: ExpenseDraftValues | null = null;
  let endPause = () => {};
  /** A refused save reads the latest version: what is typed meanwhile joins what it couldn't keep. */
  let recovering = false;
  const takeTyped = () => {
    endPause();
    const values = typed;
    typed = null;
    return values;
  };
  let presentIds: ReadonlySet<string> | null = null;
  const update = (patch: Partial<ReviewRunState>) => {
    const state = options.read();
    if (options.current() && state) options.publish({ ...state, ...patch });
  };
  const item = () => {
    const state = options.read();
    return state?.items[state.index];
  };
  const sameDuplicates = (a: ToReviewItem, b: ToReviewItem) =>
    JSON.stringify(a.duplicates) === JSON.stringify(b.duplicates);
  let matchRead = 0;
  const matchingExpenses = async (latest: ToReviewItem) => {
    const selected = item();
    if (!selected || !options.current() || !options.online()) return;
    const sequence = ++matchRead;
    update({ matches: [] });
    try {
      const matches = await Promise.all(
        latest.duplicates
          .filter((d) => d.kind === 'expense')
          .map((d) => options.client(selected.groupId).expense(d.id)),
      );
      if (options.current() && sequence === matchRead && item()?.item.draft.id === latest.draft.id)
        update({ matches });
    } catch {
      if (options.current() && sequence === matchRead)
        update({
          message: 'Could not check the matching expense. Check latest details before saving.',
        });
    }
  };
  const receive = (read: ToReviewRead, ready: boolean) => {
    if (!options.current()) return;
    // Only a completed read establishes absence, even while an edit/save blocks field adoption.
    if (ready)
      presentIds = new Set(
        read.groups.flatMap((group) => group.items.map((item) => item.draft.id)),
      );
    const state = options.read(),
      selected = item();
    // Unsent typing is never rewritten by a newer version: its save meets that version (#1289).
    if (!state || !selected || state.busy || state.pending || state.unkept || typed) return;
    const latest = read.groups
      .find((g) => g.groupId === selected.groupId)
      ?.items.find((i) => i.draft.id === selected.item.draft.id);
    if (
      latest &&
      (latest.draft.revision > selected.item.draft.revision ||
        !sameDuplicates(selected.item, latest))
    ) {
      update({
        items: state.items.map((row, index) =>
          index === state.index ? { ...row, item: latest } : row,
        ),
        ...(latest.draft.revision > selected.item.draft.revision
          ? { changed: { before: selected.item.draft, after: latest.draft } }
          : {}),
        acknowledged: false,
        allocation: null,
      });
      void matchingExpenses(latest);
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
    await matchingExpenses(latest);
  };
  /**
   * One action at a time, after what is typed is saved. A typed change's save (`editing`) sets
   * busy and editing in one update
   * and clears both in one update, after the pending-action read: no render shows busy without
   * editing, which locks the Draft's fields and closes Android's keyboard (#1287).
   */
  const run = async (work: () => Promise<void>, editing = false) => {
    // Every action is a flush point (#1289): Save as Expense, Skip, Delete and the next item
    // start from what is on screen, kept, never from a version without the member's typing.
    if (!editing) await settle();
    if (!options.current() || !options.read() || options.read()!.busy || !options.online()) return;
    update({ busy: true, message: null, ...(editing ? { editing: true } : {}) });
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
        update({ busy: false, ...(editing ? { editing: false } : {}) });
      }
    }
  };
  const advance = async (status: ReviewRunOutcome['status']) => {
    const state = options.read(),
      selected = item();
    if (!state || !selected || !options.current()) return;
    let next = state.index + 1;
    // Only upcoming items are passed over. Finishing elsewhere is not an outcome in this run.
    while (
      next < state.items.length &&
      presentIds &&
      !presentIds.has(state.items[next].item.draft.id)
    )
      next++;
    update({
      index: next,
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
  /** `overTyping`: a refused save shows the newer version even while typing waits (#1289). */
  const refresh = async (overTyping = false) => {
    await options.refresh();
    const selected = item();
    if (!selected || !options.current() || !options.online()) return;
    const reviews = await options.client(selected.groupId).review([selected.item.draft.id]);
    if (!options.current()) return;
    const latest = reviews[0];
    if (latest && !edits?.pending && (overTyping || !typed)) {
      const state = options.read()!;
      update({
        items: state.items.map((row, i) => (i === state.index ? { ...row, item: latest } : row)),
        acknowledged: false,
        allocation: latest.allocation ?? null,
        ...(latest.draft.revision !== selected.item.draft.revision
          ? { changed: { before: selected.item.draft, after: latest.draft } }
          : {}),
      });
      await matchingExpenses(latest);
    }
  };
  /**
   * A change's save: the screen shows it at once. A save under way takes it in its writes; one
   * typed as a save ends is held for the next save (#1287).
   */
  const send = (values: ExpenseDraftValues): Promise<void> | undefined => {
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
    update({
      items: state.items.map((row, i) =>
        i === state.index
          ? { ...row, item: { ...row.item, draft: { ...row.item.draft, values } } }
          : row,
      ),
      acknowledged: false,
      unkept: null,
    });
    if (state.editing && !flushing) {
      // The save's writes are done and it is reading the pending action: the next save keeps
      // this change as soon as it ends (#1287).
      next = values;
      return writing;
    }
    // Newer than any change held for the next save.
    next = null;
    if (!state.editing) {
      edits = draftEditQueue<ExpenseDraftValues>({
        current: options.current,
        canWrite: options.online,
        replace: (version, next) => options.client(selected.groupId).replace(version, next),
        kept: (version, pending) => {
          if (pending) return;
          const state = options.read()!;
          update({
            items: state.items.map((row, i) =>
              i === state.index
                ? {
                    ...row,
                    // What is typed since stays on screen over the version kept (#1289).
                    item: { ...row.item, draft: typed ? { ...version, values: typed } : version },
                  }
                : row,
            ),
          });
        },
        refresh,
        refreshAfter: 'drain',
      });
    }
    const queue = edits!;
    queue.change(values);
    if (state.editing) return writing;
    const confirmed = selected.item.draft;
    writing = run(async () => {
      flushing = true;
      try {
        let result = await queue.flush(confirmed);
        // A member can type after queue settlement but before this adapter resumes.
        while (result.kind === 'kept' && queue.pending && options.current()) {
          result = await queue.flush(result.draft);
        }
        if (!options.current()) return;
        if (result.kind === 'interrupted') {
          // Typed since, or kept offline while it was under way, is newer than what it held (#1289).
          const input = takeTyped() ?? options.read()?.unkept ?? result.input;
          const state = options.read()!;
          update({
            unkept: input,
            items: state.items.map((row, i) =>
              i === state.index
                ? { ...row, item: { ...row.item, draft: { ...result.draft, values: input } } }
                : row,
            ),
            message:
              'Your latest changes have not been kept. Connect and choose Keep my changes to try again.',
          });
        } else if (result.kind === 'failed') {
          const entries =
            takeTyped() ??
            options.read()?.items[options.read()!.index]?.item.draft.values ??
            result.input;
          queue.clear();
          // Typing while the latest version is read waits, and joins what wasn't kept (#1289).
          recovering = true;
          try {
            await refresh(true);
          } catch {
            /* Keep the unsent correction visible when reads also fail. */
          } finally {
            recovering = false;
          }
          const latestEntries = takeTyped() ?? options.read()?.unkept ?? entries;
          update({
            unkept: latestEntries,
            message:
              'Your latest changes have not been kept. Check the latest details, then choose Keep my changes to try again.',
          });
        }
      } finally {
        flushing = false;
        queue.clear();
      }
    }, true).then((): Promise<void> | undefined => {
      const later = next;
      next = null;
      if (!later) return;
      const saving = send(later);
      // Not saved now (offline, say): kept on screen for Keep my changes, never dropped.
      if (!saving) update({ unkept: later });
      return saving;
    });
    return writing;
  };
  /**
   * What is typed goes to a save now: at the end of a pause in typing, and at every flush point
   * (#1289). It returns the typed save under way, if there is one.
   */
  const flush = (): Promise<void> | undefined => {
    // A refused save is reading the latest version: what is typed waits for it, kept after.
    if (recovering) {
      endPause();
      return writing;
    }
    const values = takeTyped();
    if (!values) return options.read()?.editing ? writing : undefined;
    // A save sending its writes takes it, offline too: what it can't send it keeps for Keep my
    // changes.
    if (flushing && edits) {
      edits.change(values);
      return writing;
    }
    const saving = send(values);
    // Not saved now (offline, say): kept on screen for Keep my changes, never dropped.
    if (!saving) update({ unkept: values });
    return saving;
  };
  /** What is typed is sent, and the typed save under way ends, with what is typed meanwhile. */
  const settle = async () => {
    for (;;) {
      const saving = flush();
      if (!saving || !options.current()) return;
      await saving;
    }
  };
  return {
    receive,
    finishEditing: settle,
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
        if (!options.read()?.pending && !options.read()?.unkept) await advance('skipped');
      }),
    /**
     * A key typed in a field (#1289): shown at once, sent after a pause in typing. The field owns
     * its text meanwhile; nothing from a save or a read rewrites it.
     */
    type(values: ExpenseDraftValues) {
      const state = options.read();
      if (
        !item() ||
        !state ||
        !options.current() ||
        state.pending ||
        (state.busy && !state.editing)
      )
        return;
      const online = options.online();
      update({
        items: state.items.map((row, i) =>
          i === state.index
            ? { ...row, item: { ...row.item, draft: { ...row.item.draft, values } } }
            : row,
        ),
        acknowledged: false,
        // Typed as the connection drops, before the field locks: kept for Keep my changes.
        unkept: online ? null : values,
      });
      if (!online) return void takeTyped();
      typed = values;
      endPause();
      endPause = timer(() => void flush(), TYPING_PAUSE_MS);
    },
    /** A choice, or Keep my changes: saved at once, with what is typed, which these values hold. */
    change(values: ExpenseDraftValues): Promise<void> | undefined {
      // A refused save is reading the latest version: the choice waits with what is typed.
      if (recovering) {
        this.type(values);
        return writing;
      }
      const saving = send(values);
      if (saving) takeTyped();
      return saving;
    },
    flush,
    /**
     * Closing offline (#1289): what is typed, and what the save under way still holds to send,
     * is kept for Keep my changes now, so the screen asks before leaving it.
     */
    keepUnsent() {
      const state = options.read();
      const unsent = takeTyped() !== null || (flushing && !!edits?.pending) || next !== null;
      if (unsent && state) update({ unkept: state.items[state.index]?.item.draft.values ?? null });
    },
    retryChange() {
      const unkept = options.read()?.unkept;
      if (unkept) return this.change(unkept);
    },
    save: () =>
      run(async () => {
        const selected = item(),
          state = options.read();
        if (!selected || !state || state.pending || state.unkept) return;
        const client = options.client(selected.groupId);
        const reviews = await client.review([selected.item.draft.id]);
        if (!options.current()) return;
        const latest = reviews[0];
        if (
          latest.draft.revision !== selected.item.draft.revision ||
          !sameDuplicates(selected.item, latest)
        ) {
          update({
            items: state.items.map((row, i) =>
              i === state.index ? { ...row, item: latest } : row,
            ),
            ...(latest.draft.revision !== selected.item.draft.revision
              ? { changed: { before: selected.item.draft, after: latest.draft } }
              : {}),
            acknowledged: false,
          });
          await matchingExpenses(latest);
          return;
        }
        const model = buildToReview(
          {
            total: 1,
            groups: [
              {
                groupId: selected.groupId,
                groupName: selected.groupName,
                currency: selected.currency,
                category: selected.category,
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
          (latest.duplicates.length && !state.acknowledged) ||
          latest.duplicates.some(
            (d) => d.kind === 'expense' && !state.matches.some((expense) => expense._id === d.id),
          )
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
            update({ pending: true, message: 'We didn’t hear back, so it may already be saved' });
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
              ? 'We didn’t hear back, so it may already be saved'
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
        if (
          !selected ||
          !options.read()?.deletePrompt ||
          options.read()?.pending ||
          options.read()?.unkept
        )
          return;
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
