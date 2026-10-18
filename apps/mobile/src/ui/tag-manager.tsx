import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  Modal,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import type { ManagedTag, TagIntent, TagSnapshot } from '@splitbook/shared/tag-management';
import type { MobileController } from '../data/mobile-controller';
import { reviewedTagMessage, unconfirmedTagMessage } from '../data/tag-manager';
import { Icon, type IconName } from './primitives';
import {
  Banner,
  BottomSheet,
  Card,
  CompactButton,
  CompactText,
  Divider,
  IconTile,
  LinearProgress,
  ListRow,
  SectionHeader,
  Snackbar,
  TopBar,
  progressHeight,
} from './compact';
import { useStartWhileUnfocused } from './start-while-unfocused';
import { fonts, useTheme } from './theme';

/** What archiving does, a line each, so the member can see it at a glance before they confirm. */
export const archiveEffects: { icon: IconName; text: string }[] = [
  { icon: 'receipt-outline', text: 'Saved Expenses keep it, with their history.' },
  { icon: 'bookmark-outline', text: 'Drafts using it need another Tag before they’re saved.' },
  {
    icon: 'repeat-outline',
    text: 'Recurring Expenses using it pause until they get an active Tag.',
  },
];
/** How long a sheet takes to slide in, so the keyboard comes up for its name box. */
const sheetSettles = 600;
/** How long a change's short confirmation stays. */
export const doneShownFor = 4000;

const nameOf = (snapshot: TagSnapshot | null, tagId: string) =>
  snapshot?.tags.find((tag) => tag.id === tagId)?.name;

/** "Renaming Rent to House rent": a change sent, whose outcome isn't known. */
function changing(intent: TagIntent, snapshot: TagSnapshot | null) {
  const name = 'tagId' in intent ? nameOf(snapshot, intent.tagId) : undefined;
  switch (intent.action) {
    case 'create':
      return `Creating ${intent.name}`;
    case 'rename':
      return name && name !== intent.name
        ? `Renaming ${name} to ${intent.name}`
        : `Renaming to ${intent.name}`;
    case 'archive':
      return `Archiving ${name ?? 'a Tag'}`;
    case 'restore':
      return `Restoring ${name ?? 'a Tag'}`;
    case 'delete':
      return `Deleting ${name ?? 'a Tag'}`;
  }
}
/** "Rent archived": a change that went through, named as the server has it now. */
function changed(intent: TagIntent, snapshot: TagSnapshot | null) {
  const name = 'tagId' in intent ? (nameOf(snapshot, intent.tagId) ?? 'The Tag') : '';
  switch (intent.action) {
    case 'create':
      return `${intent.name} created`;
    case 'rename':
      return `Renamed to ${intent.name}`;
    case 'archive':
      return `${name} archived`;
    case 'restore':
      return `${name} restored`;
    case 'delete':
      return `${name} deleted`;
  }
}

/**
 * The Tag's name: at its start while the member isn't in the box, so a long name isn't cut off
 * at large text; the cursor is theirs once focused. Its own component, so a closed edit drops
 * its focus state.
 */
function TagNameBox({
  name,
  editable,
  invalid,
  inputRef,
  onChangeText,
  onSubmit,
}: {
  name: string;
  editable: boolean;
  invalid: boolean;
  inputRef: Ref<TextInput>;
  onChangeText: (name: string) => void;
  /** The keyboard's Done: saves when the name can be saved. */
  onSubmit: () => void;
}) {
  const theme = useTheme();
  const start = useStartWhileUnfocused();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={inputRef}
      accessibilityLabel="Tag name"
      value={name}
      maxLength={50}
      editable={editable}
      onChangeText={onChangeText}
      selection={start.selection}
      onFocus={() => {
        setFocused(true);
        start.onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        start.onBlur();
      }}
      placeholder="For example, Groceries"
      placeholderTextColor={theme.textMuted}
      autoCapitalize="sentences"
      returnKeyType="done"
      onSubmitEditing={onSubmit}
      submitBehavior="blurAndSubmit"
      style={{
        color: theme.text,
        fontFamily: fonts.regular,
        fontSize: 16,
        minHeight: 52,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: theme.surface,
        borderWidth: invalid || focused ? 2 : 1,
        borderColor: invalid
          ? theme.negative.main
          : focused
            ? theme.brand.main
            : theme.borderStrong,
        borderRadius: 12,
      }}
    />
  );
}

/** A note under the name box: what the name does, or why it can't be used, and its length. */
function NameNote({ error, hint, length }: { error?: string; hint: string; length: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      {error ? (
        <View
          accessibilityRole="alert"
          style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}
        >
          <Icon name="alert-circle-outline" size={16} color={theme.status.negative} />
          <CompactText variant="small" style={{ flex: 1, color: theme.status.negative }}>
            {error}
          </CompactText>
        </View>
      ) : (
        <CompactText variant="caption" tone="secondary" style={{ flex: 1 }}>
          {hint}
        </CompactText>
      )}
      <CompactText variant="caption" tone="muted" accessibilityLabel={`${length} of 50 characters`}>
        {length}/50
      </CompactText>
    </View>
  );
}

/**
 * A Group's Tags: one row each, Active then Archived. An admin taps a row for its options, and
 * renames, creates or archives in a sheet; restoring needs no second step. A change that goes
 * through shows a short confirmation. A change whose reply was lost, or an earlier one found on
 * this device, stays in a banner until the member checks or dismisses it (#584's recovery).
 */
export function TagManager({
  controller,
  groupId,
  groupName,
  accountId,
  onClose,
  offline,
  recoveryOnly = false,
}: {
  controller: MobileController;
  groupId: string;
  groupName: string;
  accountId: string;
  offline: boolean;
  /** A member who isn't an admin: they see the Tags and can check an earlier action. */
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
  const { snapshot, recovery, edit, duplicate, busy, reviewRequired, message, done } = state;
  /** The Tag whose options sheet is open. */
  const [selected, setSelected] = useState<string | null>(null);
  const [pulled, setPulled] = useState(false);
  const nameBox = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  /** Each listed Tag's row, to bring back into view and to the screen reader after a change. */
  const rows = useRef(new Map<string, View | null>());
  /** The Tag a sheet was opened from, to return to when it closes. */
  const openedFrom = useRef<string | null>(null);
  /** The member just opened a name to type: a kept one, found on opening, waits for a tap. */
  const typing = useRef(false);

  const unresolved = !!recovery && !recovery.confirmed && !recovery.rejected;
  const canChange = !offline && !recoveryOnly && !!snapshot?.canManage && !recovery;
  const tags = snapshot?.tags.filter((tag) => !tag.isDeleted) ?? [];
  const active = tags.filter((tag) => !tag.isArchived);
  const archived = tags.filter((tag) => tag.isArchived);
  const selectedTag = selected ? (tags.find((tag) => tag.id === selected) ?? null) : null;
  // An edit shows in its sheet until its outcome is known: a lost reply moves to the banner.
  const editing = !recoveryOnly && edit && !unresolved && !recovery?.confirmed ? edit : null;
  const editedTag = editing && 'tagId' in editing ? tags.find((t) => t.id === editing.tagId) : null;

  const discard = (then: () => void) => {
    if (manager.dirty())
      Alert.alert('Discard this name?', 'Your new name isn’t saved.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: then },
      ]);
    else then();
  };
  const close = () => discard(onClose);
  // A refused change kept from an earlier visit goes with its edit: there's nothing left to send.
  const cancelEdit = () =>
    recovery?.rejected ? void manager.acknowledge() : discard(manager.cancelEdit);

  /** Bring a Tag's row into view and to the screen reader. */
  const reveal = (tagId: string | null) => {
    const row = tagId ? rows.current.get(tagId) : null;
    const container = content.current;
    if (!row || !container) return;
    if (typeof row.measureLayout === 'function')
      row.measureLayout(
        container,
        (_x, y, _w, height) => {
          scroll.current?.scrollTo({ y: Math.max(0, y + height / 2 - 240), animated: true });
        },
        () => undefined,
      );
    AccessibilityInfo.sendAccessibilityEvent(row, 'focus');
  };
  // A finished change: back to its Tag (a new one included), and the note clears itself.
  useLayoutEffect(() => {
    if (!done) return;
    reveal(done.receipt.tagId);
    openedFrom.current = null;
  }, [done]);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(manager.dismissDone, doneShownFor);
    return () => clearTimeout(timer);
  }, [done, manager]);
  // A sheet closed without a change: back to the Tag it was opened from.
  useLayoutEffect(() => {
    if (editing || selected || busy || done || !openedFrom.current) return;
    reveal(openedFrom.current);
    openedFrom.current = null;
  }, [editing, selected, busy, done]);
  // The name box takes the keyboard once its sheet is up.
  const nameEditing = editing && 'name' in editing ? `${editing.action}` : null;
  useEffect(() => {
    if (!nameEditing || !typing.current) return;
    typing.current = false;
    const focus = () => nameBox.current?.focus();
    // Android raises the keyboard only for a box focused once its sheet's window has the focus:
    // after the sheet has slid in. Coming from a Tag's options, whose sheet is still leaving,
    // the first focus can go unheard, so a box still without its keyboard asks once more.
    const first = setTimeout(focus, sheetSettles);
    const again = setTimeout(() => {
      if (Keyboard.isVisible()) return;
      nameBox.current?.blur();
      focus();
    }, 2 * sheetSettles);
    return () => {
      clearTimeout(first);
      clearTimeout(again);
    };
  }, [nameEditing]);

  const options = (tag: ManagedTag) => {
    openedFrom.current = tag.id;
    setSelected(tag.id);
  };
  const row = (tag: ManagedTag, index: number) => (
    <View
      key={tag.id}
      ref={(view) => {
        rows.current.set(tag.id, view);
      }}
    >
      {index > 0 && <Divider inset={66} />}
      <ListRow
        leading={<IconTile icon="pricetag-outline" tone={tag.isArchived ? 'neutral' : 'brand'} />}
        title={tag.name}
        meta={tag.isArchived ? 'Not offered on new Expenses' : undefined}
        highlighted={done?.receipt.tagId === tag.id}
        trailing={
          canChange ? (
            <Icon name="ellipsis-vertical" size={20} color={theme.textMuted} />
          ) : undefined
        }
        onPress={canChange ? () => options(tag) : undefined}
        accessibilityLabel={
          canChange
            ? `${tag.name}, ${tag.isArchived ? 'archived. Opens Restore' : 'active. Opens Rename and Archive'}`
            : `${tag.name}, ${tag.isArchived ? 'archived' : 'active'}`
        }
      />
    </View>
  );

  // A name typed that another Tag already has: said as it's typed, not after sending.
  const typed = editing && 'name' in editing ? editing.name.trim() : '';
  const clash =
    editing && 'name' in editing && typed
      ? (tags.find(
          (tag) =>
            tag.name.toLowerCase() === typed.toLowerCase() &&
            (editing.action === 'create' || tag.id !== editing.tagId),
        ) ?? null)
      : null;
  const taken = clash ?? (duplicate && !duplicate.isDeleted ? duplicate : null);
  const nameError = taken
    ? taken.isArchived
      ? `${taken.name} is archived. Restore it to keep its Expenses together.`
      : 'An active Tag already uses this name.'
    : undefined;
  // A sheet's own message: a refusal to review, or what went wrong sending it.
  const sheetMessage =
    message && !taken && !(unresolved && message === unconfirmedTagMessage) ? message : '';
  const sheetBanner = reviewRequired ? (
    <Banner tone="warning" title="Not saved" message={message || 'This Tag changed.'}>
      <CompactButton
        label="See the latest"
        variant="text"
        dense
        disabled={busy || offline}
        onPress={() => void manager.reviewLatest()}
      />
    </Banner>
  ) : sheetMessage ? (
    <Banner tone={sheetMessage === reviewedTagMessage ? 'info' : 'error'} message={sheetMessage} />
  ) : null;
  const sending = busy && !!editing;
  // One sheet at a time; each draws its content only while it shows.
  const naming = !!editing && 'name' in editing;
  // Restoring needs no second step; a refused or unsent one comes back here to retry.
  const confirming =
    !!editing &&
    (editing.action === 'archive' ||
      (editing.action === 'restore' && (reviewRequired || !!sheetMessage)));
  const canSave =
    canChange &&
    !busy &&
    !reviewRequired &&
    !!typed &&
    !taken &&
    !(editing?.action === 'rename' && typed === editedTag?.name);

  // The screen's own message, when no sheet is showing it.
  const screenMessage =
    !editing && message && !(unresolved && message === unconfirmedTagMessage) && !unresolved
      ? message
      : '';
  const confirmed = recovery?.confirmed?.state === 'applied' ? recovery.confirmed : null;
  const confirmedNow = confirmed ? nameOf(confirmed.snapshot, confirmed.receipt.tagId) : undefined;
  const confirmedIntent = confirmed?.receipt.intent;
  const since =
    confirmed && confirmedIntent
      ? !confirmed.snapshot.tags.some((t) => t.id === confirmed.receipt.tagId && !t.isDeleted)
        ? ' It has since been removed.'
        : 'name' in confirmedIntent && confirmedNow && confirmedNow !== confirmedIntent.name
          ? ` It’s now called ${confirmedNow}.`
          : ''
      : '';

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <TopBar
          title="Tags"
          subtitle={snapshot ? `${groupName} · ${active.length} active` : groupName}
          leading={{ kind: 'close', label: 'Close Tags', onPress: close }}
        />
        <View style={{ height: progressHeight }}>
          {busy && snapshot ? <LinearProgress label="Updating Tags" /> : null}
        </View>
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
          refreshControl={
            <RefreshControl
              refreshing={pulled}
              onRefresh={() => {
                if (busy || offline) return;
                setPulled(true);
                void manager.refresh().finally(() => setPulled(false));
              }}
              tintColor={theme.brand.main}
              colors={[theme.brand.main]}
            />
          }
        >
          <View ref={content} style={{ gap: 12 }}>
            <CompactText variant="small" tone="secondary" style={{ paddingHorizontal: 2 }}>
              Everyone in {groupName} picks from these when adding an Expense.
            </CompactText>
            {offline && (
              <Banner
                tone="offline"
                message="You’re offline. You can see the Tags; changing them needs a connection."
              />
            )}
            {snapshot && !snapshot.canManage && !screenMessage && (
              <Banner
                tone="info"
                standing
                message="Only Group admins can change Tags. You can use any active Tag on your Expenses."
              />
            )}
            {unresolved && (
              <Banner
                tone="warning"
                title={`${changing(recovery.command.intent, snapshot)} isn’t confirmed`}
                message={
                  message && message !== unconfirmedTagMessage
                    ? message
                    : 'We didn’t hear back, so it may already be done. Checking changes nothing, and trying again can’t do it twice.'
                }
              >
                <CompactButton
                  label="Check again"
                  variant="text"
                  dense
                  disabled={busy || offline}
                  onPress={() => void manager.check()}
                />
                <CompactButton
                  label="Try again"
                  variant="text"
                  dense
                  disabled={busy || offline || recoveryOnly || !snapshot?.canManage}
                  onPress={() => void manager.retry()}
                />
              </Banner>
            )}
            {confirmed && confirmedIntent && (
              <Banner
                tone="info"
                standing
                title="Your change went through"
                message={`${changed(confirmedIntent, confirmed.snapshot)}.${since}`}
              >
                <CompactButton
                  label="OK"
                  variant="text"
                  dense
                  disabled={busy}
                  onPress={() => void manager.acknowledge()}
                />
              </Banner>
            )}
            {recovery?.rejected && !editing && (
              <Banner
                tone="error"
                title={`${changing(recovery.command.intent, snapshot)} didn’t happen`}
                message={recovery.rejected.message}
              >
                <CompactButton
                  label="OK"
                  variant="text"
                  dense
                  disabled={busy}
                  onPress={() => void manager.acknowledge()}
                />
              </Banner>
            )}
            {!!screenMessage && <Banner tone="error" message={screenMessage} />}
            {!snapshot && !busy && (
              <Banner tone="error" message="The Tags couldn’t be loaded.">
                <CompactButton
                  label="Try again"
                  variant="text"
                  dense
                  disabled={offline}
                  onPress={() => void manager.refresh()}
                />
              </Banner>
            )}

            <View style={{ gap: 6 }}>
              <SectionHeader
                title={snapshot ? `Active · ${active.length}` : 'Active'}
                trailing={
                  canChange ? (
                    <CompactButton
                      label="New Tag"
                      icon="add"
                      variant="text"
                      dense
                      disabled={busy}
                      onPress={() => {
                        openedFrom.current = null;
                        typing.current = true;
                        manager.newTag();
                      }}
                    />
                  ) : undefined
                }
              />
              <Card
                loading={!snapshot && busy ? 'Loading Tags' : undefined}
                skeleton={{ rows: 4, dividers: true }}
              >
                {active.length ? (
                  active.map(row)
                ) : snapshot ? (
                  <View style={{ padding: 14 }}>
                    <CompactText tone="secondary">
                      No active Tags. Create or restore one to use on new Expenses.
                    </CompactText>
                  </View>
                ) : null}
              </Card>
            </View>
            {archived.length > 0 && (
              <View style={{ gap: 6 }}>
                <SectionHeader title={`Archived · ${archived.length}`} />
                <Card>{archived.map(row)}</Card>
              </View>
            )}
          </View>
        </ScrollView>
        {done && <Snackbar message={changed(done.receipt.intent, done.snapshot)} bottom={24} />}

        <BottomSheet
          visible={!!selectedTag && !editing}
          title={selectedTag?.name ?? ''}
          subtitle={selectedTag?.isArchived ? 'Archived Tag' : 'Active Tag'}
          doneLabel="Close"
          dismissLabel={`Close ${selectedTag?.name ?? 'the Tag'}`}
          onDone={() => setSelected(null)}
        >
          {selectedTag ? (
            <Card>
              {selectedTag.isArchived ? (
                <ListRow
                  leading={<IconTile icon="arrow-undo-outline" />}
                  title="Restore"
                  meta="Offer it on new Expenses again"
                  metaLines={3}
                  onPress={() => {
                    setSelected(null);
                    void manager.restore(selectedTag);
                  }}
                />
              ) : (
                <>
                  <ListRow
                    leading={<IconTile icon="create-outline" />}
                    title="Rename"
                    meta="Saved Expenses show the new name"
                    metaLines={3}
                    onPress={() => {
                      setSelected(null);
                      typing.current = true;
                      manager.edit(selectedTag, 'rename');
                    }}
                  />
                  <Divider inset={66} />
                  {active.length > 1 ? (
                    <ListRow
                      leading={<IconTile icon="archive-outline" />}
                      title="Archive"
                      meta="Stop offering it. Saved Expenses keep it."
                      metaLines={3}
                      onPress={() => {
                        setSelected(null);
                        manager.edit(selectedTag, 'archive');
                      }}
                    />
                  ) : (
                    <ListRow
                      leading={<IconTile icon="archive-outline" tone="neutral" />}
                      title="Archive"
                      meta="A Group needs one active Tag. Create another first."
                      metaLines={3}
                      accessibilityLabel="Archive, unavailable. A Group needs one active Tag. Create another first."
                    />
                  )}
                </>
              )}
            </Card>
          ) : null}
        </BottomSheet>

        <BottomSheet
          visible={naming}
          title={editing?.action === 'create' ? 'New Tag' : 'Rename Tag'}
          subtitle={editedTag ? `Currently ${editedTag.name}` : undefined}
          doneLabel="Cancel"
          dismissLabel="Close without saving"
          dismissible={!sending}
          onDone={cancelEdit}
          footer={
            !naming ? null : taken?.isArchived ? (
              <CompactButton
                label={`Restore ${taken.name}`}
                block
                busy={sending ? 'Restoring…' : undefined}
                disabled={!canChange && !reviewRequired}
                onPress={() => void (clash ? manager.restore(taken) : manager.restoreDuplicate())}
              />
            ) : (
              <CompactButton
                label={editing?.action === 'create' ? 'Create Tag' : 'Save name'}
                block
                busy={sending ? 'Saving…' : undefined}
                disabled={!canSave && !sending}
                onPress={() => void manager.submit()}
              />
            )
          }
        >
          {naming ? sheetBanner : null}
          {editing && 'name' in editing ? (
            <View style={{ gap: 6 }}>
              <CompactText variant="caption" tone="secondary" weight="medium">
                Name
              </CompactText>
              <TagNameBox
                inputRef={nameBox}
                name={editing.name}
                editable={!busy && !offline && !!snapshot?.canManage}
                invalid={!!nameError}
                onChangeText={manager.enter}
                onSubmit={() => {
                  if (canSave) void manager.submit();
                }}
              />
              <NameNote
                error={nameError}
                hint={
                  editing.action === 'create'
                    ? 'Members can pick it on new Expenses'
                    : 'Saved Expenses show the new name'
                }
                length={editing.name.length}
              />
            </View>
          ) : null}
        </BottomSheet>

        <BottomSheet
          visible={confirming}
          title={
            editing?.action === 'restore'
              ? `Restore ${editedTag?.name ?? 'Tag'}?`
              : `Archive ${editedTag?.name ?? 'Tag'}?`
          }
          doneLabel="Cancel"
          dismissLabel="Close without changing it"
          dismissible={!sending}
          onDone={cancelEdit}
          footer={
            confirming && (
              <CompactButton
                label={editing?.action === 'restore' ? 'Restore Tag' : 'Archive Tag'}
                block
                busy={
                  sending
                    ? editing?.action === 'restore'
                      ? 'Restoring…'
                      : 'Archiving…'
                    : undefined
                }
                disabled={!canChange || reviewRequired}
                onPress={() => void manager.submit()}
              />
            )
          }
        >
          {confirming ? sheetBanner : null}
          {!confirming ? null : editing?.action === 'archive' ? (
            <>
              {archiveEffects.map((effect) => (
                <View
                  key={effect.icon}
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      backgroundColor: theme.surfaceMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={effect.icon} size={18} color={theme.textSecondary} />
                  </View>
                  <CompactText style={{ flex: 1, paddingTop: 5 }}>{effect.text}</CompactText>
                </View>
              ))}
              <CompactText variant="small" tone="secondary">
                You can restore it from Archived at any time.
              </CompactText>
            </>
          ) : (
            <CompactText>Members can pick it on new Expenses again.</CompactText>
          )}
        </BottomSheet>
      </SafeAreaView>
    </Modal>
  );
}
