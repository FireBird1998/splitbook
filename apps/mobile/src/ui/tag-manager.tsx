import { useEffect, useMemo } from 'react';
import { Alert, KeyboardAvoidingView, Modal, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import { tagArchiveExplanation, type TagIntent } from '@splitbook/shared/tag-management';
import type { MobileController } from '../data/mobile-controller';
import { Button, Copy } from './primitives';
import { CompactText, Divider } from './compact';
import { useStartWhileUnfocused } from './start-while-unfocused';
import { fonts, useTheme } from './theme';

const actionText = (intent: TagIntent) => {
  switch (intent.action) {
    case 'create':
      return `Create “${intent.name}”`;
    case 'rename':
      return `Rename to “${intent.name}”`;
    case 'archive':
      return 'Archive Tag';
    case 'restore':
      return 'Restore Tag';
    case 'delete':
      return 'Delete Tag';
  }
};
/**
 * The Tag's name: at its start while the member isn't in the box, so a long name isn't cut off
 * at large text; the cursor is theirs once focused. Its own component, so a closed edit drops
 * its focus state.
 */
function TagNameBox({
  name,
  editable,
  onChangeText,
}: {
  name: string;
  editable: boolean;
  onChangeText: (name: string) => void;
}) {
  const theme = useTheme();
  const start = useStartWhileUnfocused();
  return (
    <TextInput
      accessibilityLabel="Tag name"
      value={name}
      maxLength={50}
      editable={editable}
      onChangeText={onChangeText}
      selection={start.selection}
      onFocus={start.onFocus}
      onBlur={start.onBlur}
      autoCapitalize="sentences"
      returnKeyType="done"
      style={{
        color: theme.text,
        fontFamily: fonts.regular,
        fontSize: 16,
        minHeight: 48,
        padding: 12,
        borderWidth: 1,
        borderColor: theme.borderStrong,
        borderRadius: 12,
      }}
    />
  );
}
export function TagManager({
  controller,
  groupId,
  accountId,
  onClose,
  offline,
  recoveryOnly = false,
}: {
  controller: MobileController;
  groupId: string;
  accountId: string;
  offline: boolean;
  recoveryOnly?: boolean;
  onClose(): void;
}) {
  const theme = useTheme();
  const manager = useMemo(() => controller.manageTags(groupId), [controller, groupId, accountId]);
  const state = useSyncExternalStoreWithSelector(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
    (snapshot) => snapshot.tagManager,
  );
  useEffect(() => manager.open(), [manager]);
  const close = () => {
    if (manager.dirty())
      Alert.alert(
        'Discard Tag name?',
        'Your changed, unsubmitted name will be discarded. Submitted action recovery is kept.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard name', style: 'destructive', onPress: onClose },
        ],
      );
    else onClose();
  };
  const { snapshot, recovery, result, edit, duplicate, busy, reviewRequired, message } = state;
  const locked = busy || offline || recoveryOnly || !snapshot?.canManage;
  const unresolved = recovery && !recovery.confirmed && !recovery.rejected;
  const currentTag =
    result?.state === 'applied'
      ? snapshot?.tags.find((tag) => tag.id === result.receipt.tagId)
      : null;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
          >
            <CompactText variant="title" accessibilityRole="header">
              {recoveryOnly ? 'Tag action recovery' : 'Manage Tags'}
            </CompactText>
            <Copy>
              {recoveryOnly
                ? 'Check an earlier action without changing this Group’s Tags.'
                : 'Tags belong to this Group. Changes need a connection.'}
            </Copy>
            <Button
              label={recoveryOnly ? 'Close Tag action recovery' : 'Close Manage Tags'}
              secondary
              onPress={close}
            />
            {offline && (
              <Copy accessibilityRole="alert">
                You’re offline. Connect to manage Tags. Reconnecting never submits an action.
              </Copy>
            )}
            {!!message && <Copy accessibilityRole="alert">{message}</Copy>}
            {snapshot && !snapshot.canManage && (
              <Copy accessibilityRole="alert">
                Only Group admins can manage Tags. You can still use this Group.
              </Copy>
            )}
            {recoveryOnly && !busy && !recovery && (
              <Copy>No Tag action is kept for recovery on this device.</Copy>
            )}
            {!snapshot && <Copy>{busy ? 'Loading Tags…' : 'Tags could not be loaded.'}</Copy>}
            <Button
              label="Refresh Tags"
              secondary
              disabled={busy || offline}
              onPress={() => void manager.refresh()}
            />
            {recovery && (
              <View style={{ gap: 12 }}>
                <CompactText weight="semibold" accessibilityRole="header">
                  {unresolved
                    ? 'Unconfirmed Tag action'
                    : recovery.rejected
                      ? 'Tag action was not applied'
                      : 'Confirmed earlier action'}
                </CompactText>
                <Copy>{actionText(recovery.command.intent)}</Copy>
                {unresolved && (
                  <>
                    <Copy>
                      The reply was not confirmed. Closing this screen keeps the original action for
                      recovery.
                    </Copy>
                    <Button
                      label="Check action"
                      disabled={busy || offline}
                      secondary
                      onPress={() => void manager.check()}
                    />
                    <Button
                      label="Retry original action"
                      disabled={locked}
                      onPress={() => void manager.retry()}
                    />
                  </>
                )}
                {result?.state === 'applied' && (
                  <>
                    <Copy>
                      Confirmed earlier action: {actionText(result.receipt.intent)}. This receipt
                      identifies the submitted action.
                    </Copy>
                    <Copy>
                      Current Tag:{' '}
                      {currentTag
                        ? `${currentTag.name} · ${currentTag.isDeleted ? 'Deleted' : currentTag.isArchived ? 'Archived' : 'Active'}`
                        : 'No longer available'}
                      . Another admin may have changed it since.
                    </Copy>
                  </>
                )}
                {recovery.confirmed && (
                  <Button
                    label={recoveryOnly ? 'Dismiss confirmed action' : 'Continue managing Tags'}
                    disabled={busy}
                    onPress={() => void manager.acknowledge()}
                  />
                )}
                {recovery.rejected && (
                  <Button
                    label="Dismiss rejected action"
                    secondary
                    disabled={busy}
                    onPress={() => void manager.acknowledge()}
                  />
                )}
              </View>
            )}
            {!recoveryOnly && edit && !unresolved && !recovery?.confirmed && (
              <View style={{ gap: 12 }}>
                <CompactText weight="semibold" accessibilityRole="header">
                  {edit.action === 'create'
                    ? 'New Tag'
                    : edit.action === 'rename'
                      ? 'Rename Tag'
                      : edit.action === 'archive'
                        ? 'Archive Tag?'
                        : 'Restore Tag?'}
                </CompactText>
                {'name' in edit && (
                  <TagNameBox
                    name={edit.name}
                    editable={!busy && !offline && !!snapshot?.canManage}
                    onChangeText={manager.enter}
                  />
                )}
                {edit.action !== 'create' && (
                  <Copy>
                    Current saved Tag:{' '}
                    {snapshot?.tags.find((tag) => tag.id === edit.tagId)?.name ?? 'Unavailable'} ·{' '}
                    {snapshot?.tags.find((tag) => tag.id === edit.tagId)?.isArchived
                      ? 'Archived'
                      : 'Active'}
                  </Copy>
                )}
                {edit.action === 'archive' && <Copy>{tagArchiveExplanation}</Copy>}
                {reviewRequired && (
                  <>
                    <Copy>
                      The saved state changed or the action was rejected. Your name is kept. Review
                      the latest state before submitting a new action.
                    </Copy>
                    <Button
                      label="Review latest Tag state"
                      disabled={locked}
                      onPress={() => void manager.reviewLatest()}
                    />
                  </>
                )}
                {duplicate?.isArchived && (
                  <Button
                    label={`Restore ${duplicate.name}`}
                    disabled={locked}
                    onPress={() => void manager.restoreDuplicate()}
                  />
                )}
                <Button
                  label={
                    edit.action === 'create'
                      ? 'Create Tag'
                      : edit.action === 'rename'
                        ? 'Save Tag name'
                        : edit.action === 'archive'
                          ? 'Confirm archive Tag'
                          : 'Confirm restore Tag'
                  }
                  disabled={locked || reviewRequired || !!recovery}
                  onPress={() => void manager.submit()}
                />
                {!recovery && (
                  <Button
                    label="Cancel Tag edit"
                    secondary
                    disabled={busy}
                    onPress={() => {
                      if (manager.dirty())
                        Alert.alert(
                          'Discard Tag name?',
                          'Your changed, unsubmitted name will be discarded.',
                          [
                            { text: 'Keep editing', style: 'cancel' },
                            {
                              text: 'Discard name',
                              style: 'destructive',
                              onPress: manager.cancelEdit,
                            },
                          ],
                        );
                      else manager.cancelEdit();
                    }}
                  />
                )}
              </View>
            )}
            {!recoveryOnly && !edit && !recovery && (
              <Button label="New Tag" disabled={locked} onPress={manager.newTag} />
            )}
            {(['Active', 'Archived'] as const).map((section) => (
              <View key={section} style={{ gap: 12 }}>
                <Divider />
                <CompactText weight="semibold" accessibilityRole="header">
                  {section} Tags
                </CompactText>
                {snapshot?.tags
                  .filter((tag) => !tag.isDeleted && tag.isArchived === (section === 'Archived'))
                  .map((tag) => (
                    <View
                      key={tag.id}
                      style={{
                        gap: 8,
                        padding: 12,
                        backgroundColor: theme.surface,
                        borderRadius: 12,
                      }}
                    >
                      <Copy>{tag.name}</Copy>
                      <CompactText tone="secondary">{section}</CompactText>
                      {!recoveryOnly && !edit && !recovery && snapshot.canManage && (
                        <>
                          <Button
                            label={`Rename ${tag.name}`}
                            secondary
                            disabled={locked}
                            onPress={() => manager.edit(tag, 'rename')}
                          />
                          <Button
                            label={`${tag.isArchived ? 'Restore' : 'Archive'} ${tag.name}`}
                            secondary
                            disabled={locked}
                            onPress={() =>
                              manager.edit(tag, tag.isArchived ? 'restore' : 'archive')
                            }
                          />
                        </>
                      )}
                    </View>
                  ))}
                {snapshot &&
                  !snapshot.tags.some(
                    (tag) => !tag.isDeleted && tag.isArchived === (section === 'Archived'),
                  ) && (
                    <Copy>
                      {section === 'Active'
                        ? 'No active Tags. Create or restore a Tag to use on new Expenses.'
                        : 'No archived Tags.'}
                    </Copy>
                  )}
              </View>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
