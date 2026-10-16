import { useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import {
  tagActionResultSchema,
  tagSnapshotSchema,
  tagIntentSchema,
  isDefinitiveTagRejection,
  type TagActionResult,
  type TagIntent,
  type TagSnapshot,
} from '@splitbook/shared/tag-management';
import { apiFetch } from '@/lib/utils/api-fetch';
import { matchWebGroupRead, matchWebGroupContent } from '@/lib/web-query-keys';
import {
  forgetTagAction,
  hasRetainedTagAction,
  readTagActions,
  retainTagAction,
  subscribeTagActionCleanup,
  subscribeTagActionStorage,
  forgetBrowserGroupTagActions,
  type RetainedTagAction,
  type TagActionScope,
} from '@/lib/tag-actions';

/** The manager owns immutable submitted commands independently of its editable form. */
export function useTagManager(scope: TagActionScope) {
  const { accountId, groupId } = scope;
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<TagSnapshot | null>(null);
  const [editor, setEditor] = useState<TagIntent | null>(null);
  const [pending, setPending] = useState<RetainedTagAction[]>([]);
  const [receipt, setReceipt] = useState<Extract<TagActionResult, { state: 'applied' }> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [originalName, setOriginalName] = useState('');
  const [discard, setDiscard] = useState<'manager' | 'editor' | null>(null);
  const [online, setOnline] = useState(true);
  const [storageReady, setStorageReady] = useState(false);
  const [verified, setVerified] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const generation = useRef(0);
  const active = useRef(true);
  const lost = useRef(false);
  const running = useRef(false);
  const path = `/api/groups/${scope.groupId}/tag-actions`;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    const owner = { accountId, groupId };
    const offline = () => setOnline(navigator.onLine !== false);
    offline();
    window.addEventListener('online', offline);
    window.addEventListener('offline', offline);
    const unsubscribe = subscribeTagActionCleanup(owner, () => {
      lost.current = true;
      generation.current += 1;
      setUnavailable(true);
      setSnapshot(null);
      setReceipt(null);
      setPending([]);
      setEditor(null);
      setMessage('This Group or account is no longer available.');
      setBusy(false);
      running.current = false;
      setDiscard(null);
    });
    const unsubscribeStorage = subscribeTagActionStorage(owner, () => {
      generation.current += 1;
      setBusy(false);
      running.current = false;
      setVerified(false);
      setReceipt(null);
      try {
        setPending(readTagActions(owner));
      } catch {
        setStorageReady(false);
      }
      setMessage('Tag recovery changed in another tab. Refresh Tags before continuing.');
    });
    return () => {
      unsubscribe();
      unsubscribeStorage();
      window.removeEventListener('online', offline);
      window.removeEventListener('offline', offline);
    };
  }, [accountId, groupId]);
  const current = (ticket: number) => active.current && ticket === generation.current;
  const show = async () => {
    if (lost.current || running.current) return;
    running.current = true;
    const ticket = ++generation.current;
    setOpen(true);
    setBusy(true);
    setVerified(false);
    try {
      setPending(readTagActions(scope));
      setStorageReady(true);
      const response = await apiFetch(path);
      if (response.status === 403) {
        if (current(ticket)) forgetBrowserGroupTagActions(accountId, groupId);
        return;
      }
      if (!response.ok) throw new Error('Tags could not be loaded.');
      const next = tagSnapshotSchema.parse((await response.json()).data);
      if (current(ticket)) {
        setSnapshot(next);
        setVerified(true);
        setMessage('');
      }
    } catch {
      if (current(ticket)) setMessage('Tags could not be loaded. Please try again.');
    } finally {
      if (current(ticket)) {
        setBusy(false);
        running.current = false;
      }
    }
  };
  const send = async (attempt: RetainedTagAction, check: boolean) => {
    if (running.current || lost.current) return;
    if (navigator.onLine === false) {
      setMessage('Connect to change Tags or check an earlier action.');
      return;
    }
    if (!check && !snapshot?.canManage) return;
    if (!check) {
      try {
        if (!hasRetainedTagAction(scope, attempt)) throw new Error('Recovery changed');
      } catch {
        setVerified(false);
        setMessage(
          'The original action could not be read. Refresh Tags before continuing. No change was sent.',
        );
        return;
      }
    }
    running.current = true;
    const ticket = ++generation.current;
    setBusy(true);
    setMessage('');
    // Navigation may unmount this manager while the write is still in flight.
    // Its reads still need refreshing, but account/Group cleanup must cancel
    // that refresh even after the view's own cleanup subscription has gone.
    let mayRefresh = !check;
    const stopWatchingCleanup = subscribeTagActionCleanup(scope, () => {
      mayRefresh = false;
    });
    try {
      if (!check)
        void mutate(matchWebGroupContent(scope.groupId), undefined, { revalidate: false });
      const response = await apiFetch(
        check ? `${path}/${attempt.command.requestId}` : path,
        check
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: attempt.body,
            },
      );
      const payload = await response.json();
      if (!current(ticket)) return;
      if (!response.ok) {
        const latest = tagSnapshotSchema.safeParse(payload.snapshot);
        if (latest.success) setSnapshot(latest.data);
        if (response.status === 403 && payload.code === 'TAG_ADMIN_REQUIRED') {
          setSnapshot((old) => (old ? { ...old, canManage: false } : null));
          setMessage(
            'Only admins can change Tags. You can still check an earlier action and read this Group.',
          );
          // An old action may have succeeded before admin access was lost.
          return;
        } else if (response.status === 403) {
          forgetBrowserGroupTagActions(scope.accountId, scope.groupId);
          // A read denial also clears this Group from the existing SWR read lifecycle.
          void apiFetch(`/api/groups/${scope.groupId}`).catch(() => undefined);
          return;
        } else
          setMessage(
            typeof payload.error === 'string' ? payload.error : 'The action could not be applied.',
          );
        // These are definitive no-effect responses, not a guess from matching Tag state.
        const rejected = isDefinitiveTagRejection(response.status, payload.code);
        if (!check && rejected) {
          forgetTagAction(scope, attempt.command.requestId);
          setPending(readTagActions(scope));
          setEditor(attempt.command.intent);
          setConflict(payload.code === 'TAG_CHANGED');
          setDuplicate(payload.code === 'TAG_EXISTS');
        }
        return;
      }
      const result = tagActionResultSchema.parse(payload.data);
      if (result.requestId !== attempt.command.requestId) throw new Error('Wrong action receipt');
      if (
        result.state === 'applied' &&
        JSON.stringify(result.receipt.intent) !== JSON.stringify(attempt.command.intent)
      )
        throw new Error('Wrong action intent');
      if (!current(ticket)) return;
      setSnapshot(result.snapshot);
      setVerified(true);
      if (result.state === 'applied') {
        forgetTagAction(scope, attempt.command.requestId);
        setPending(readTagActions(scope));
        setReceipt(result);
        setEditor(null);
      } else setMessage('This action has not been applied. Retry sends the original action only.');
    } catch {
      if (current(ticket))
        setMessage('The result is unconfirmed. Check the action or retry its original request.');
    } finally {
      // A lost reply may still have changed Tag names in Expenses and pickers.
      stopWatchingCleanup();
      if (mayRefresh && !lost.current) void mutate(matchWebGroupRead(scope.groupId));
      if (current(ticket)) {
        setBusy(false);
        running.current = false;
      }
    }
  };
  const submit = async () => {
    if (
      !editor ||
      running.current ||
      pending.length ||
      conflict ||
      !snapshot?.canManage ||
      !verified ||
      lost.current ||
      !storageReady
    )
      return;
    if (navigator.onLine === false) {
      setMessage('Connect to change Tags or check an earlier action.');
      return;
    }
    const parsed = tagIntentSchema.safeParse(editor);
    if (!parsed.success) {
      setMessage('Enter a Tag name with 1–50 characters.');
      return;
    }
    const command = { requestId: crypto.randomUUID(), intent: parsed.data };
    let body: string;
    try {
      const earlier = readTagActions(scope);
      if (earlier.length) {
        setPending(earlier);
        return;
      }
      body = retainTagAction(scope, command);
      setPending(readTagActions(scope));
    } catch {
      setMessage('This browser could not retain the action for recovery. No change was sent.');
      return;
    }
    await send({ command, body }, false);
  };
  const review = () => {
    if (!editor || !('tagId' in editor)) return;
    const tag = snapshot?.tags.find((tag) => tag.id === editor.tagId && !tag.isDeleted);
    if (!tag) return;
    setEditor({ ...editor, expectedRevision: tag.revision });
    setConflict(false);
    setMessage('Current Tag reviewed. Apply change to submit your edit.');
  };
  const close = () => {
    generation.current += 1;
    setOpen(false);
    setBusy(false);
    running.current = false;
    setEditor(null);
    setConflict(false);
    setReceipt(null);
    setMessage('');
  };
  const dirty = editor && 'name' in editor && editor.name !== originalName && pending.length === 0;
  const beginEdit = (intent: TagIntent) => {
    if (busy || pending.length || !snapshot?.canManage) return;
    setEditor(intent);
    setOriginalName('name' in intent ? intent.name : '');
    setMessage('');
    setConflict(false);
    setDuplicate(false);
  };
  const finishClose = (target: 'manager' | 'editor') => {
    if (target === 'manager') close();
    else {
      setEditor(null);
      setConflict(false);
      setDuplicate(false);
      setMessage('');
    }
    setDiscard(null);
  };
  const requestClose = (target: 'manager' | 'editor') => {
    if (dirty) setDiscard(target);
    else finishClose(target);
  };
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  return {
    open,
    snapshot,
    editor,
    pending,
    receipt,
    busy,
    message,
    conflict,
    duplicate,
    show,
    submit,
    setEditor,
    review,
    beginEdit,
    requestClose,
    discard,
    online,
    storageReady,
    verified,
    unavailable,
    keepEditing: () => setDiscard(null),
    discardText: () => discard && finishClose(discard),
    check: (attempt: RetainedTagAction) => send(attempt, true),
    retry: (attempt: RetainedTagAction) => send(attempt, false),
  };
}
