'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { draftEditQueue } from '@splitbook/shared/draft-edit-queue';
import { describeDraftChange } from '@splitbook/shared/to-review';
import {
  entryForExpenseDraft,
  draftForExpenseEntry,
  fieldDraftEntryPolicy,
} from '@splitbook/shared/expense-entry-draft';
import type { IncompleteExpenseEntry } from '@splitbook/shared/expense-entry';
import type { PersistedExpenseDraft } from '@splitbook/shared/validators/expense-draft';
import type { WebReviewClient } from './review-client';

type EntryEdit = {
  entry: IncompleteExpenseEntry;
  from: NonNullable<PersistedExpenseDraft['values']>;
  changed: Partial<Record<keyof IncompleteExpenseEntry, boolean>>;
};
const editing = (draft: PersistedExpenseDraft): EntryEdit => ({
  entry: entryForExpenseDraft(draft.values, fieldDraftEntryPolicy),
  from: draft.values ?? {},
  changed: {},
});
const valuesFor = (edit: EntryEdit) =>
  draftForExpenseEntry(edit.entry, fieldDraftEntryPolicy, edit);

/** The Draft left To review elsewhere, so typing for it is obsolete and is never sent. */
class RemovedElsewhere extends Error {}
const removedElsewhere = (cause: unknown) =>
  cause instanceof RemovedElsewhere || (cause as { status?: number } | null)?.status === 404;

/** Drafts whose typing couldn't be kept after their editor closed; said when one opens again. */
const UNKEPT_NOTE =
  'Your last change to this item wasn’t kept. Check it and make the change again.';
const unkeptDraftIds = new Set<string>();
/** Drafts with an editor open now, which shows their latest state itself. */
const openDraftIds = new Set<string>();

/** Serializes kept edits. A save/navigation must flush typing before using the shown version. */
export function useReviewEditor(
  initial: PersistedExpenseDraft,
  client: WebReviewClient,
  refresh: () => Promise<void>,
  names: Readonly<Record<string, string>>,
  /** The Group's currency, for the note about a newer version. */
  currency?: string,
) {
  const [draft, setDraft] = useState(initial);
  const [entryEdit, setEntryEdit] = useState(() => editing(initial));
  const [status, setStatus] = useState<'kept' | 'changed' | 'keeping' | 'failed'>('kept');
  const [note, setNote] = useState(() => (unkeptDraftIds.has(initial.id) ? UNKEPT_NOTE : ''));
  const [error, setError] = useState('');
  const current = useRef(initial);
  const input = useRef(entryEdit);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  /**
   * Closed without a member flush (such as Back) while typing was unsent: keep sending it, as
   * Close would (#500). It is the member's own typing, sent once as its autosave would have been,
   * not a write resumed later.
   */
  const leaving = useRef(false);
  const namesRef = useRef(names);
  const currencyRef = useRef(currency);
  const adapter = useRef({ client, refresh });
  useEffect(() => {
    adapter.current = { client, refresh };
  }, [client, refresh]);
  const editQueue = useRef<ReturnType<typeof draftEditQueue<EntryEdit>> | null>(null);
  useEffect(() => {
    namesRef.current = names;
    currencyRef.current = currency;
  }, [names, currency]);
  const adopt = useCallback((next: PersistedExpenseDraft, announce: boolean) => {
    if (!live.current) return;
    if (announce)
      setNote(describeDraftChange(current.current, next, namesRef.current, currencyRef.current));
    current.current = next;
    input.current = editing(next);
    editQueue.current?.clear();
    setDraft(next);
    setEntryEdit(input.current);
    setStatus('kept');
    setError('');
  }, []);
  const reloadChanged = useCallback(async () => {
    const latest = (await adapter.current.client.list()).find(
      (row) => row.id === current.current.id,
    );
    if (!latest) throw new Error('This item is no longer in To review.');
    adopt(latest, true);
    await adapter.current.refresh();
  }, [adopt]);
  // Construct on first use in an effect or member action, never by reading refs in render.
  const edits = useCallback(() => {
    editQueue.current ??= draftEditQueue<EntryEdit>({
      current: () => live.current || leaving.current,
      canWrite: () => live.current || leaving.current,
      replace: async (before, submitted) => {
        // After the editor closes, nothing is sent for a Draft removed elsewhere (#500).
        if (
          !live.current &&
          !(await adapter.current.client.list()).some(({ id }) => id === before.id)
        )
          throw new RemovedElsewhere();
        return adapter.current.client.replace(before, valuesFor(submitted));
      },
      kept: (kept, pending) => {
        current.current = kept;
        if (live.current) {
          setDraft(kept);
          setStatus(pending ? 'changed' : 'kept');
        }
      },
      refresh: () => adapter.current.refresh(),
      refreshAfter: 'write',
      recover: async ({ cause }) => {
        if (!live.current) return current.current;
        if ((cause as { status?: number }).status === 409) {
          try {
            await reloadChanged();
          } catch {
            if (live.current) {
              setStatus('failed');
              setError('Could not load the changed item. Try again before continuing.');
            }
          }
        } else if (live.current) {
          setStatus('failed');
          setError(
            'This change is not kept yet. Check your connection and try again before leaving.',
          );
        }
        return current.current;
      },
    });
    return editQueue.current;
  }, [reloadChanged]);
  // The cross-Group read owns freshness. An external change replaces unsent text with a visible note.
  useEffect(() => {
    if (initial.revision <= current.current.revision) return;
    // A poll can see this tab's committed write before its reply arrives. Preserve typing
    // made after that submission until the reply tells us whether this version is ours.
    if (!edits().receive(initial)) adopt(initial, true);
  }, [initial, edits, adopt]);
  useEffect(() => {
    const id = current.current.id;
    live.current = true;
    leaving.current = false;
    openDraftIds.add(id);
    unkeptDraftIds.delete(id);
    return () => {
      live.current = false;
      openDraftIds.delete(id);
      if (timer.current) clearTimeout(timer.current);
      const queue = edits();
      if (!queue.pending && !queue.writing) return;
      leaving.current = true;
      void queue.flush(current.current).then((result) => {
        if (result.kind === 'kept') unkeptDraftIds.delete(id);
        else if (
          !openDraftIds.has(id) &&
          !(result.kind === 'failed' && removedElsewhere(result.cause))
        )
          unkeptDraftIds.add(id);
      });
    };
  }, [edits]);
  async function flush(): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    if (!edits().pending && !edits().writing) return true;
    if (!edits().writing) {
      setStatus('keeping');
      setError('');
    }
    const result = await edits().flush(current.current);
    if (result.kind === 'changed') {
      // A poll may already have adopted a newer revision after the queue settled.
      if (current.current.revision < result.draft.revision) {
        if (current.current.revision < result.before.revision) current.current = result.before;
        adopt(result.draft, true);
      }
      return false;
    }
    // Typing can arrive after queue settlement but before this consumer resumes.
    if (result.kind === 'kept' && (edits().pending || edits().writing)) return flush();
    return result.kind === 'kept';
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!edits().pending && !edits().writing) return;
      event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0 ||
        (!edits().pending && !edits().writing)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void flush().then((kept) => {
        if (kept) window.location.assign(link.href);
      });
    };
    // A reload or closed tab can't wait for the autosave; send the typing as the page goes (#500).
    const pageHide = () => {
      if (!edits().pending || edits().writing) return;
      if (timer.current) clearTimeout(timer.current);
      adapter.current.client.replaceAsPageGoes(current.current, valuesFor(input.current));
      edits().clear();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
      document.removeEventListener('click', navigate, true);
    };
  });
  function change(changes: Partial<IncompleteExpenseEntry>) {
    input.current = {
      ...input.current,
      entry: { ...input.current.entry, ...changes },
      changed: {
        ...input.current.changed,
        ...Object.fromEntries(Object.keys(changes).map((key) => [key, true])),
      },
    };
    edits().change(input.current);
    setEntryEdit(input.current);
    setStatus('changed');
    setError('');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, 500);
  }
  return {
    draft,
    entry: entryEdit.entry,
    original: entryEdit.from,
    changes: entryEdit.changed,
    status,
    note,
    error,
    change,
    flush,
    reloadChanged,
    latest: () => current.current,
  };
}
