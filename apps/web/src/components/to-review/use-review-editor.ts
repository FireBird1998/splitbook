'use client';
import { useEffect, useRef, useState } from 'react';
import { describeDraftChange } from '@splitbook/shared/to-review';
import { draftEntries, draftValues } from '@splitbook/shared/persistent-draft-editor';
import type { PersistedExpenseDraft } from '@splitbook/shared/validators/expense-draft';
import type { WebReviewClient } from './review-client';

/** Serializes kept edits. A save/navigation must flush typing before using the shown version. */
export function useReviewEditor(
  initial: PersistedExpenseDraft,
  client: WebReviewClient,
  refresh: () => Promise<void>,
  names: Readonly<Record<string, string>>,
) {
  const [draft, setDraft] = useState(initial);
  const [entries, setEntries] = useState(() => draftEntries(initial.values));
  const [status, setStatus] = useState<'kept' | 'changed' | 'keeping' | 'failed'>('kept');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const current = useRef(initial);
  const input = useRef(entries);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const live = useRef(true);
  const deferred = useRef<PersistedExpenseDraft | null>(null);
  const namesRef = useRef(names);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  function adopt(next: PersistedExpenseDraft, announce: boolean) {
    if (!live.current) return;
    if (announce) setNote(describeDraftChange(current.current, next, namesRef.current));
    current.current = next;
    input.current = draftEntries(next.values);
    dirty.current = false;
    setDraft(next);
    setEntries(input.current);
    setStatus('kept');
    setError('');
  }
  // The cross-Group read owns freshness. An external change replaces unsent text with a visible note.
  useEffect(() => {
    if (initial.revision <= current.current.revision) return;
    // A poll can see this tab's committed write before its reply arrives. Preserve typing
    // made after that submission until the reply tells us whether this version is ours.
    if (inFlight.current) {
      if (!deferred.current || initial.revision > deferred.current.revision)
        deferred.current = initial;
    } else adopt(initial, true);
  }, [initial]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  async function reloadChanged() {
    const latest = (await client.list()).find((row) => row.id === current.current.id);
    if (!latest) throw new Error('This item is no longer in To review.');
    adopt(latest, true);
    await refresh();
  }
  async function flush(): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    if (inFlight.current) {
      if (!(await inFlight.current)) return false;
      return dirty.current ? flush() : true;
    }
    if (!dirty.current) return true;
    const before = current.current;
    const submitted = input.current;
    setStatus('keeping');
    setError('');
    const work = (async () => {
      try {
        const kept = await client.replace(before, draftValues(submitted));
        if (current.current.revision > kept.revision) return false;
        current.current = kept;
        const observed = deferred.current;
        deferred.current = null;
        if (observed && observed.revision > kept.revision) {
          adopt(observed, true);
          return false;
        }
        if (live.current) setDraft(kept);
        dirty.current = input.current !== submitted;
        if (live.current) setStatus(dirty.current ? 'changed' : 'kept');
        await refresh();
        return true;
      } catch (cause) {
        deferred.current = null;
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
        return false;
      }
    })();
    inFlight.current = work;
    const ok = await work;
    inFlight.current = null;
    // refresh() may deliver an external version while this operation is still settling.
    const observed = deferred.current;
    deferred.current = null;
    if (observed && observed.revision > current.current.revision) {
      adopt(observed, true);
      return false;
    }
    if (ok && dirty.current) return flush();
    return ok;
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current && !inFlight.current) return;
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
        (!dirty.current && !inFlight.current)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void flush().then((kept) => {
        if (kept) window.location.assign(link.href);
      });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', navigate, true);
    };
  });
  function change(changes: Record<string, string>) {
    input.current = { ...input.current, ...changes };
    dirty.current = true;
    setEntries(input.current);
    setStatus('changed');
    setError('');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, 500);
  }
  return {
    draft,
    entries,
    status,
    note,
    error,
    change,
    flush,
    reloadChanged,
    latest: () => current.current,
  };
}
