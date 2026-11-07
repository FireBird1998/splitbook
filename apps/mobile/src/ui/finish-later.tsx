import { useContext } from 'react';
import type { MobileController } from '../data/mobile-controller';
import { finishLaterOffline } from '../data/to-review';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';
import {
  ACTIVE_DRAFTS_PER_MEMBER,
  DRAFT_GROUP_LIMIT_MESSAGE,
} from '@splitbook/shared/validators/expense-draft';
import { View } from 'react-native';
import { BottomSheet, CompactButton, CompactText, useShortWindow } from './compact';
import { SaveBarRow } from './expense-form';
import { useConnected } from './use-connected';

/** A small subscriber keeps status and account counts outside the form's render budget. */
export function FinishLater({ controller }: { controller: MobileController }) {
  const state = useMobileSnapshot(
    controller,
    (snapshot) => ({
      editor: snapshot.expense,
      // Offline as Finish later decides it (`keepExpenseAsSharedDraft`): the app's offline state
      // and the connection, not To review's read, which isn't read again while the form is open
      // and still said offline after Try again verified the Group online (#927).
      offline: snapshot.offline.active,
      count:
        snapshot.toReview.read.groups.find((group) => group.groupId === snapshot.expense.groupId)
          ?.count ?? 0,
    }),
    sameSelection,
  );
  const connected = useConnected();
  const short = useShortWindow();
  const row = useContext(SaveBarRow);
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
  const limit = full && (
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
  );
  const button = (
    <CompactButton
      label={editor.finishLaterPending ? 'Check again' : 'Finish later'}
      variant="tonal"
      block
      disabled={busy || !!full}
      onPress={finish}
    />
  );
  // A short window drops what it does, which the close sheet and To review also say (#646);
  // offline, what happens instead still shows.
  const note = offline
    ? finishLaterOffline
    : short
      ? null
      : 'Keeps it in To review. Only you can see it.';
  const caption = note ? (
    <CompactText
      variant="caption"
      tone="secondary"
      style={{ textAlign: 'center', ...(row ? { width: '100%' } : {}) }}
    >
      {note}
    </CompactText>
  ) : null;
  const prompt = editor.closePrompt && (
    <BottomSheet
      visible={!!editor.closePrompt}
      title="Finish this expense later?"
      // Keep editing is the sheet's own header action, once: as in every other sheet.
      doneLabel="Keep editing"
      onDone={controller.cancelExpenseClose}
      footer={
        <>
          <CompactButton label="Finish later" block disabled={busy || !!full} onPress={finish} />
          <CompactButton
            label="Delete"
            variant="text"
            destructive
            block
            disabled={busy || editor.finishLaterPending}
            onPress={() => void controller.deleteExpenseAndClose()}
          />
        </>
      }
    >
      <CompactText>
        Keep it for later, or delete these entries. Nothing in the Group changes.
      </CompactText>
      {full && <CompactText tone="warning">{DRAFT_GROUP_LIMIT_MESSAGE}</CompactText>}
    </BottomSheet>
  );
  return row ? (
    // Beside Save, at the start of its row: a limit or a note takes a whole line above it.
    <>
      {limit && <View style={{ width: '100%', gap: 4 }}>{limit}</View>}
      {caption}
      {button}
      {prompt}
    </>
  ) : (
    // In the Save bar, under Save: a full-width button with what it does under it.
    <View style={{ gap: 4 }}>
      {limit}
      {button}
      {caption}
      {prompt}
    </View>
  );
}
