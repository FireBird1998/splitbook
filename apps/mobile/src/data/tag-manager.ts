import {
  tagSnapshotSchema,
  isDefinitiveTagRejection,
  type ManagedTag,
  type TagActionResult,
  type TagSnapshot,
} from '@splitbook/shared/tag-management';
import type { tagManagement, MobileTagIntent, TagRecovery } from './tag-management';
import { RequestError, Superseded } from './transport';

export interface TagManagerState {
  groupId: string | null;
  snapshot: TagSnapshot | null;
  recovery: TagRecovery | null;
  result: TagActionResult | null;
  edit: MobileTagIntent | null;
  originalName: string;
  duplicate: ManagedTag | null;
  reviewRequired: boolean;
  busy: boolean;
  message: string;
  /**
   * A change the member just made on this screen, confirmed: its recovery copy is already gone,
   * so nothing waits for them to dismiss it. An earlier action, found or checked, stays in
   * `recovery` until they do.
   */
  done: Extract<TagActionResult, { state: 'applied' }> | null;
}
/** Said when a sent change got no reply: it may have happened, so the member checks first. */
export const unconfirmedTagMessage =
  'We didn’t hear back, so it may already be done. Check again before trying again.';
/** Said once a refused change's Tag is read again: the member's typing is kept. */
export const reviewedTagMessage =
  'Updated to the latest. Your name is kept; save it when you’re ready.';
/** Said once a refused Archive or Restore is read again: there was nothing typed to keep. */
export const reviewedTagChangeMessage = 'Updated to the latest. Try again when you’re ready.';
/** Said when a check finds the change hasn't happened: trying again is what makes it. */
export const notAppliedTagMessage =
  'It hasn’t happened yet. Checking changed nothing; Try again to make the change.';
/** Said when reading the Tags failed: a read changes nothing, so nothing is left to check. */
export const refreshFailedTagMessage = 'Couldn’t refresh the Tags. Pull down to try again.';

/** A read of the Tags that failed, told apart from a change whose reply was lost. */
class TagReadFailed extends Error {
  constructor(readonly reason: unknown) {
    super(refreshFailedTagMessage);
  }
}
export const emptyTagManager = (): TagManagerState => ({
  groupId: null,
  snapshot: null,
  recovery: null,
  result: null,
  edit: null,
  originalName: '',
  duplicate: null,
  reviewRequired: false,
  busy: false,
  message: '',
  done: null,
});

/** A view of controller-owned reads and durable action recovery; closure drops late UI replies. */
export function tagManager({
  client,
  groupId,
  read,
  publish,
  current,
}: {
  client(): ReturnType<typeof tagManagement> & {
    watch(snapshot: (snapshot: TagSnapshot) => void, error: (error: unknown) => void): () => void;
  };
  groupId: string;
  read(): TagManagerState;
  publish(value: TagManagerState): void;
  current(): boolean;
}) {
  let mounted = false;
  const update = (patch: Partial<TagManagerState>) => {
    if (mounted && current()) publish({ ...read(), ...patch });
  };
  const permitted = () => !!read().snapshot?.canManage && !read().busy;
  const recover = async () => {
    const recovery = await client().recovery();
    update({ recovery });
    return recovery;
  };
  const refresh = async () => {
    let snapshot: TagSnapshot;
    try {
      snapshot = await client().read();
    } catch (error) {
      throw error instanceof Superseded ? error : new TagReadFailed(error);
    }
    update({ snapshot });
  };
  const failure = (error: unknown) => {
    if (error instanceof Superseded) return;
    if (error instanceof TagReadFailed) {
      const reason = error.reason;
      update({
        message:
          reason instanceof RequestError && reason.serverMessage
            ? reason.serverMessage
            : refreshFailedTagMessage,
      });
      return;
    }
    const parsed =
      error instanceof RequestError
        ? tagSnapshotSchema.safeParse(Object(error.details).snapshot)
        : null;
    const edit = read().edit;
    const duplicate =
      parsed?.success && edit && 'name' in edit
        ? (parsed.data.tags.find(
            (tag) =>
              !tag.isDeleted &&
              tag.name.toLowerCase() === edit.name.trim().toLowerCase() &&
              (edit.action === 'create' || tag.id !== edit.tagId),
          ) ?? null)
        : null;
    update({
      ...(parsed?.success ? { snapshot: parsed.data, duplicate } : {}),
      ...(error instanceof RequestError &&
      ['TAG_ADMIN_REQUIRED', 'TAG_PERMISSION_UNCONFIRMED'].includes(error.code ?? '')
        ? { snapshot: read().snapshot ? { ...read().snapshot!, canManage: false } : null }
        : {}),
      reviewRequired:
        (error instanceof RequestError && isDefinitiveTagRejection(error.status, error.code)) ||
        read().reviewRequired,
      message:
        error instanceof RequestError
          ? ['TAG_ADMIN_REQUIRED', 'TAG_PERMISSION_UNCONFIRMED'].includes(error.code ?? '')
            ? error.message
            : (error.serverMessage ?? unconfirmedTagMessage)
          : error instanceof Error && !('issues' in error)
            ? error.message
            : unconfirmedTagMessage,
    });
  };
  const run = async (work: () => Promise<void>) => {
    if (!mounted || !current() || read().busy) return;
    update({ busy: true, message: '' });
    try {
      await work();
    } catch (error) {
      failure(error);
    } finally {
      try {
        await recover();
      } catch (error) {
        failure(error);
      }
      update({ busy: false });
    }
  };
  const showResult = (result: TagActionResult) => {
    update({
      result,
      snapshot: result.snapshot,
      ...(result.state === 'applied' ? { edit: null, reviewRequired: false, duplicate: null } : {}),
      message: result.state === 'not-applied' ? notAppliedTagMessage : '',
    });
  };
  /**
   * A change made here and confirmed: its recovery copy goes, and a short note says so. A reply
   * that comes after the screen closed keeps the copy, so the next visit shows the outcome.
   */
  const finish = async (result: TagActionResult) => {
    showResult(result);
    if (result.state !== 'applied' || !mounted || !current()) return;
    await client().acknowledge();
    update({ recovery: null, result: null, done: result });
  };
  const setEdit = (edit: MobileTagIntent) => {
    if (!permitted() || read().recovery) return;
    update({
      edit,
      originalName: 'name' in edit ? edit.name : '',
      duplicate: null,
      reviewRequired: false,
      result: null,
      message: '',
      done: null,
    });
  };
  const submit = () =>
    run(async () => {
      const { edit, snapshot, reviewRequired } = read();
      if (!edit || !snapshot?.canManage || reviewRequired || read().recovery) return;
      if ('name' in edit) {
        if (!edit.name.trim() || edit.name.trim().length > 50)
          throw new Error('Enter a Tag name with 1–50 characters.');
        const duplicate = snapshot.tags.find(
          (tag) =>
            !tag.isDeleted &&
            tag.name.toLowerCase() === edit.name.trim().toLowerCase() &&
            (edit.action === 'create' || tag.id !== edit.tagId),
        );
        if (duplicate) {
          update({
            duplicate,
            message: duplicate.isArchived
              ? 'This name belongs to an Archived Tag. Restore that Tag to keep its history.'
              : 'An active Tag already uses this name. Choose another name.',
          });
          return;
        }
      }
      await finish(await client().submit(edit));
      await refresh();
    });
  return {
    open() {
      mounted = true;
      publish({ ...emptyTagManager(), groupId });
      let stop: (() => void) | undefined;
      void run(async () => {
        stop = client().watch(
          (snapshot) => update({ snapshot }),
          (error) => failure(error instanceof Superseded ? error : new TagReadFailed(error)),
        );
        const recovery = await recover();
        if (recovery?.confirmed) update({ result: recovery.confirmed });
        if (recovery?.rejected && recovery.command.intent.action !== 'delete')
          update({
            edit: recovery.command.intent,
            originalName: '',
            reviewRequired: true,
            message: recovery.rejected.message,
          });
        await refresh();
      });
      return () => {
        mounted = false;
        stop?.();
      };
    },
    refresh: () => run(refresh),
    newTag: () => setEdit({ action: 'create', name: '' }),
    /** An archived Tag back in use: nothing to confirm or type, so it goes straight away. */
    restore(tag: ManagedTag) {
      if (tag.isDeleted || !tag.isArchived || !permitted() || read().recovery) return;
      setEdit({ action: 'restore', tagId: tag.id, expectedRevision: tag.revision });
      return submit();
    },
    dismissDone: () => update({ done: null }),
    edit(tag: ManagedTag, action: 'rename' | 'archive' | 'restore') {
      if (tag.isDeleted) return;
      setEdit(
        action === 'rename'
          ? { action, tagId: tag.id, expectedRevision: tag.revision, name: tag.name }
          : { action, tagId: tag.id, expectedRevision: tag.revision },
      );
    },
    enter(name: string) {
      const edit = read().edit;
      if (!read().busy && edit && 'name' in edit && (!read().recovery || read().recovery?.rejected))
        update({ edit: { ...edit, name }, duplicate: null });
    },
    dirty() {
      const edit = read().edit;
      return !!(
        edit &&
        'name' in edit &&
        edit.name !== read().originalName &&
        (!read().recovery || read().recovery?.rejected)
      );
    },
    cancelEdit() {
      if (!read().busy && !read().recovery)
        update({ edit: null, duplicate: null, reviewRequired: false, message: '' });
    },
    submit,
    check: () =>
      run(async () => {
        showResult(await client().check());
        await refresh();
      }),
    retry: () =>
      run(async () => {
        showResult(await client().retry());
        await refresh();
      }),
    acknowledge: () =>
      run(async () => {
        await client().acknowledge();
        update({
          recovery: null,
          result: null,
          edit: null,
          reviewRequired: false,
          duplicate: null,
        });
        await refresh();
      }),
    reviewLatest: () =>
      run(async () => {
        await refresh();
        const edit = read().edit;
        if (!edit || !read().snapshot?.canManage) return;
        if (edit.action !== 'create') {
          const tag = read().snapshot!.tags.find((tag) => tag.id === edit.tagId && !tag.isDeleted);
          if (!tag)
            throw new Error(
              'name' in edit
                ? 'This Tag is no longer available. Your entered name is kept.'
                : 'This Tag is no longer available.',
            );
          update({ edit: { ...edit, expectedRevision: tag.revision } });
        }
        await client().acknowledge();
        update({
          recovery: null,
          reviewRequired: false,
          message: 'name' in edit ? reviewedTagMessage : reviewedTagChangeMessage,
        });
      }),
    restoreDuplicate: () =>
      run(async () => {
        const tag = read().duplicate;
        if (!tag || !read().snapshot?.canManage || !tag.isArchived || tag.isDeleted) return;
        if (read().recovery) await client().acknowledge();
        await finish(
          await client().submit({
            action: 'restore',
            tagId: tag.id,
            expectedRevision: tag.revision,
          }),
        );
        await refresh();
      }),
  };
}
