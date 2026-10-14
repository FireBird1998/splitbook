import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/query-core';
import type { MobileController } from '../data/mobile-controller';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';
import {
  ACTIVE_DRAFTS_PER_MEMBER,
  DRAFT_GROUP_LIMIT_MESSAGE,
} from '@splitbook/shared/validators/expense-draft';
import { BottomSheet, CompactButton, CompactText } from './compact';

/** A small subscriber keeps status and account counts outside the form's render budget. */
const subscribeOnline = (notify: () => void) => onlineManager.subscribe(notify);
const isOnline = () => onlineManager.isOnline();
export function FinishLater({ controller }: { controller: MobileController }) {
  const state = useMobileSnapshot(
    controller,
    (snapshot) => ({
      editor: snapshot.expense,
      offline: snapshot.offline.active || snapshot.toReview.offline,
      count:
        snapshot.toReview.read.groups.find((group) => group.groupId === snapshot.expense.groupId)
          ?.count ?? 0,
    }),
    sameSelection,
  );
  const connected = useSyncExternalStore(subscribeOnline, isOnline, isOnline);
  const { editor, count } = state;
  const offline = state.offline || !connected;
  const full =
    !offline &&
    !editor.finishLaterPending &&
    (editor.finishLaterLimit || count >= ACTIVE_DRAFTS_PER_MEMBER);
  const busy = editor.status === 'saving' || editor.persistence === 'error';
  const finish = () => {
    void controller.keepExpenseAsSharedDraft();
  };
  return (
    <>
      <CompactText variant="small" tone="secondary">
        {offline
          ? "You're offline, so it stays on this phone. It shows in To review as 'On this phone'."
          : 'Keeps it in To review. Only you can see it.'}
      </CompactText>
      {full && (
        <>
          <CompactText variant="small" tone="warning">
            {DRAFT_GROUP_LIMIT_MESSAGE}
          </CompactText>
          <CompactButton
            label="View To review"
            variant="text"
            disabled={busy}
            onPress={() => {
              void controller.closeExpense(true).then(() => {
                if (controller.getSnapshot().screen !== 'expense')
                  return controller.openToReview(editor.groupId!);
              });
            }}
          />
        </>
      )}
      <CompactButton
        label={editor.finishLaterPending ? 'Check again' : 'Finish later'}
        variant="tonal"
        disabled={busy || !!full}
        onPress={finish}
      />
      {editor.closePrompt && (
        <BottomSheet
          visible={!!editor.closePrompt}
          title="Finish this expense later?"
          doneLabel="Keep editing"
          onDone={controller.cancelExpenseClose}
        >
          <CompactText>
            Keep it for later, or delete these entries. Nothing in the Group changes.
          </CompactText>
          {full && <CompactText tone="warning">{DRAFT_GROUP_LIMIT_MESSAGE}</CompactText>}
          <CompactButton
            label="Finish later"
            variant="tonal"
            disabled={busy || !!full}
            onPress={finish}
          />
          <CompactButton
            label="Delete"
            destructive
            disabled={busy || editor.finishLaterPending}
            onPress={() => void controller.deleteExpenseAndClose()}
          />
          <CompactButton
            label="Keep editing"
            variant="text"
            onPress={controller.cancelExpenseClose}
          />
        </BottomSheet>
      )}
    </>
  );
}
