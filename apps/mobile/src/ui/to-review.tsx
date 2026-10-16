import { ReviewRunOverlay } from './review-run';
import { useEffect, useMemo } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatCurrency } from '@splitbook/shared/currency';
import { formatDate } from '@splitbook/shared/date';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import {
  memberProblems,
  summarizeReviewRun,
  type ReviewItemModel,
} from '@splitbook/shared/to-review';
import type { ExpenseDraftValues } from '@splitbook/shared/validators/expense-draft';
import type { MobileController } from '../data/mobile-controller';
import { BottomSheet, Card, CompactText, Money } from './compact';
import { Copy } from './primitives';
import { fonts, useTheme } from './theme';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';

const offlineMessage =
  "You're offline. What Claude prepared and what you set aside show up when you're back online";
const unconfirmedMessage = "We didn't hear back, so it may already be saved";

/** Review actions wrap at large text sizes; their touch target has no fixed height. */
function Button({
  label,
  accessibilityLabel = label,
  secondary = false,
  disabled = false,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  secondary?: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        padding: 12,
        borderRadius: 12,
        backgroundColor: secondary ? theme.brand.bg : theme.brand.main,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      <CompactText
        style={{
          textAlign: 'center',
          fontFamily: fonts.semibold,
          color: secondary ? theme.brand.main : theme.brand.contrastText,
        }}
      >
        {label}
      </CompactText>
    </Pressable>
  );
}

/** Backend errors are translated at the presentation boundary, never used as decisions. */
function memberMessage(message: string) {
  return message
    .replace(/drafts?\b/gi, (word) => (word.toLowerCase() === 'drafts' ? 'items' : 'item'))
    .replace(/revisions?\b/gi, 'version')
    .replace(/requests?\b/gi, 'change')
    .replace(/collections?\b/gi, 'items');
}
function amountLabel(values?: ExpenseDraftValues) {
  if (!values?.amount || !values.currency) return 'Amount needed';
  try {
    return formatCurrency(
      toMajorAmount(parseAmountMinor(values.amount, values.currency), values.currency),
      values.currency,
    );
  } catch {
    return 'Amount needed';
  }
}
function sourceLabel(item: ReviewItemModel) {
  if (item.id.startsWith('save:')) return 'Save awaiting confirmation';
  if (item.deviceItem) return 'Unfinished · only on this phone';
  const source = item.accountItem?.draft.preparedBy;
  return source?.kind === 'assistant' ? `Prepared by ${source.name}` : 'Set aside by you';
}
function ItemDetails({ item }: { item: ReviewItemModel }) {
  const values = item.accountItem?.draft.values ?? item.deviceItem?.values;
  // An item in your account says what it needs once, in its Needs line, so a missing fact leaves
  // its place empty here rather than saying it again (#435).
  const needs = !!item.accountItem;
  const date =
    values?.date && Number.isFinite(new Date(values.date).getTime())
      ? formatDate(values.date)
      : needs
        ? null
        : 'Date needed';
  const amount = amountLabel(values);
  return (
    <View style={{ gap: 4 }}>
      <CompactText weight="semibold">
        {values?.description || (needs ? 'Expense to review' : 'Description needed')}
      </CompactText>
      {!(needs && amount === 'Amount needed') && <Money numberOfLines={0}>{amount}</Money>}
      <CompactText variant="caption" tone="secondary">
        {sourceLabel(item)}
        {date ? ` · ${date}` : ''}
      </CompactText>
      {item.state !== 'on-this-phone' && (
        <CompactText variant="caption" tone={item.state === 'ready' ? 'positive' : 'warning'}>
          {item.label}
        </CompactText>
      )}
    </View>
  );
}
function useReviewSnapshot(controller: MobileController) {
  return useMobileSnapshot(
    controller,
    (snapshot) => ({
      toReview: snapshot.toReview,
      drafts: snapshot.drafts,
      offline: snapshot.offline.active || snapshot.toReview.offline,
      auth: snapshot.auth,
      detail: snapshot.detail,
    }),
    sameSelection,
  );
}
function PhoneItem({
  item,
  controller,
  disabled = false,
}: {
  item: ReviewItemModel;
  controller: MobileController;
  disabled?: boolean;
}) {
  const draft = controller.getSnapshot().drafts.find((entry) => entry.groupId === item.groupId);
  const retainedSave = item.id.startsWith('save:');
  return (
    <View style={{ gap: 8 }}>
      {retainedSave ? (
        <CompactText weight="semibold">
          {item.deviceItem?.values.description || 'Save awaiting confirmation'}
        </CompactText>
      ) : (
        <ItemDetails item={item} />
      )}
      <CompactText variant="caption" tone="secondary">
        {item.deviceItem?.groupName}
      </CompactText>
      {(retainedSave || draft?.unconfirmed) && (
        <CompactText tone="warning">{unconfirmedMessage}</CompactText>
      )}
      <Button
        label={retainedSave ? 'Check again' : 'Continue'}
        accessibilityLabel={
          retainedSave
            ? 'Check again'
            : `Continue ${item.deviceItem?.values.description || 'unfinished expense'}`
        }
        secondary
        disabled={disabled || (!retainedSave && !draft)}
        onPress={() => {
          if (retainedSave) {
            void controller.openToReview(item.groupId);
            return;
          }
          if (!draft) return;
          controller.closeToReview();
          void controller.openExpense(draft.groupId, draft.expenseId ?? undefined);
        }}
      />
    </View>
  );
}

export function ToReviewHomeCard({
  controller,
  disabled = false,
}: {
  controller: MobileController;
  disabled?: boolean;
}) {
  const state = useReviewSnapshot(controller);
  const theme = useTheme();
  const model = controller.toReviewModel();
  if (
    !state.offline &&
    state.toReview.status === 'ready' &&
    model.counts.total === 0 &&
    !state.toReview.recoveryMessage
  )
    return null;
  return (
    <Card padded>
      <View style={{ gap: 12 }}>
        <CompactText accessibilityRole="header" variant="title">
          To review · {model.counts.total}
        </CompactText>
        <CompactText variant="caption" tone="secondary">
          Only you see these
        </CompactText>
        {state.toReview.recoveryMessage && (
          <>
            <Copy accessibilityRole="alert">{memberMessage(state.toReview.recoveryMessage)}</Copy>
            <Button
              label="Check this phone again"
              secondary
              disabled={disabled}
              onPress={() => void controller.refreshToReview()}
            />
          </>
        )}
        {state.offline ? (
          <Copy>{offlineMessage}</Copy>
        ) : state.toReview.status === 'idle' || state.toReview.status === 'loading' ? (
          <Copy accessibilityLiveRegion="polite">Checking what’s waiting…</Copy>
        ) : state.toReview.status === 'error' ? (
          <>
            <Copy>{memberMessage(state.toReview.message ?? 'Couldn’t check what’s waiting.')}</Copy>
            <Button
              label="Try again"
              secondary
              disabled={disabled}
              onPress={() => void controller.refreshToReview()}
            />
          </>
        ) : null}
        {!state.offline &&
          model.groups.map((group) => (
            <Pressable
              key={group.groupId}
              accessibilityRole="button"
              accessibilityLabel={`${group.groupName}, ${group.counts.total} to review`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => void controller.openToReview(group.groupId)}
              style={{
                minHeight: 48,
                paddingVertical: 10,
                gap: 6,
                borderBottomWidth: 1,
                borderColor: theme.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <CompactText weight="semibold" style={{ flex: 1 }}>
                  {group.groupName}
                </CompactText>
                <View
                  style={{
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 2,
                    backgroundColor: theme.brand.bg,
                  }}
                >
                  <CompactText tone="brand">{group.counts.total}</CompactText>
                </View>
              </View>
              {!!group.sourceSummary && (
                <CompactText variant="caption" tone="secondary">
                  {group.sourceSummary}
                </CompactText>
              )}
            </Pressable>
          ))}
        {model.items
          .filter((item) => item.deviceItem)
          .sort(
            (a, b) =>
              Number(
                b.id.startsWith('save:') ||
                  !!state.drafts.find((draft) => draft.groupId === b.groupId)?.unconfirmed,
              ) -
              Number(
                a.id.startsWith('save:') ||
                  !!state.drafts.find((draft) => draft.groupId === a.groupId)?.unconfirmed,
              ),
          )
          .map((item) => (
            <PhoneItem key={item.id} item={item} controller={controller} disabled={disabled} />
          ))}
        {model.items.some((item) => item.accountItem) && !state.offline && (
          <Button
            label={`Review ${model.items.filter((item) => item.accountItem).length}, one at a time`}
            disabled={disabled}
            onPress={() => void controller.startReviewRun()}
          />
        )}
      </View>
    </Card>
  );
}

export function ToReviewGroupBanner({
  controller,
  groupId,
}: {
  controller: MobileController;
  groupId: string;
}) {
  const state = useReviewSnapshot(controller);
  const model = controller.toReviewModel(groupId);
  const group = model.groups[0];
  if (!group) return null;
  return (
    <Card padded>
      <View style={{ gap: 8 }}>
        <CompactText accessibilityRole="header" weight="semibold">
          {group.counts.total} to review
        </CompactText>
        {!!group.bannerSummary && <CompactText tone="secondary">{group.bannerSummary}</CompactText>}
        {state.offline && <CompactText tone="secondary">On this phone</CompactText>}
        <Button label="Review" secondary onPress={() => void controller.openToReview(groupId)} />
      </View>
    </Card>
  );
}

/** Mounted by the existing Home and Group shells; deep links select the same controller state. */
export function ToReviewOverlay({ controller }: { controller: MobileController }) {
  const state = useReviewSnapshot(controller);
  if (state.toReview.run) return <ReviewRunOverlay controller={controller} />;
  return state.toReview.groupId && state.auth.user ? (
    <ToReviewList
      key={`${state.auth.user.id}:${state.toReview.groupId}`}
      controller={controller}
      groupId={state.toReview.groupId}
    />
  ) : null;
}

export function ToReviewList({
  controller,
  groupId,
}: {
  controller: MobileController;
  groupId: string;
}) {
  const theme = useTheme();
  const state = useReviewSnapshot(controller);
  const collection = useMobileSnapshot(controller, (snapshot) => snapshot.sharedDraftCollection);
  const client = useMemo(
    () => controller.draftCollection(groupId),
    [controller, groupId, state.auth.user?.id],
  );
  useEffect(() => client.open(), [client]);
  useEffect(() => client.connectivityChanged(), [client, state.offline]);
  const model = controller.toReviewModel(groupId);
  const own = model.groups[0];
  const unavailable = state.detail.id === groupId && state.detail.status === 'denied';
  const groupName =
    own?.groupName ?? (state.detail.id === groupId ? state.detail.data?.name : null) ?? 'Group';
  const disabled = collection.busy || collection.pending || state.offline || unavailable;
  // An item opens in the guided review, with Add expense's fields and pickers (#435).
  const openItem = (item: ReviewItemModel) => {
    if (item.accountItem) void controller.startReviewRun(groupId, item.accountItem.draft.id);
  };
  // Problems ask about the signed-in member as "you" (#434).
  const names = Object.fromEntries(
    (collection.context?.group.members ?? []).map((member) => [
      member.user.id,
      member.user.id === state.auth.user?.id ? 'you' : member.user.name,
    ]),
  );
  const sections = [
    ['ready', 'Ready'],
    ['duplicate', 'Check before saving'],
    ['needs-details', 'Needs details'],
    ['on-this-phone', 'On this phone'],
  ] as const;
  const results = summarizeReviewRun(collection.outcomes);
  const close = () => {
    if (!collection.busy) controller.closeToReview();
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
        >
          <CompactText accessibilityRole="header" variant="title">
            To review
          </CompactText>
          <CompactText weight="semibold">{groupName}</CompactText>
          <Button label="Close To review" secondary disabled={collection.busy} onPress={close} />
          <Copy>Only you see these. Balances stay the same until you save.</Copy>
          {unavailable ? (
            <Copy accessibilityRole="alert">
              This Group isn’t available. You may no longer be a member of this Group.
            </Copy>
          ) : (
            <>
              {state.offline && <Copy>{offlineMessage}</Copy>}
              {state.toReview.recoveryMessage && (
                <>
                  <Copy accessibilityRole="alert">
                    {memberMessage(state.toReview.recoveryMessage)}
                  </Copy>
                  <Button
                    label="Check this phone again"
                    secondary
                    disabled={collection.busy}
                    onPress={() => void controller.refreshToReview()}
                  />
                </>
              )}
              {!!collection.message && (
                <Copy accessibilityRole="alert">{memberMessage(collection.message)}</Copy>
              )}
              {collection.pending && (
                <View style={{ gap: 8 }}>
                  <Copy>{unconfirmedMessage}</Copy>
                  <Button
                    label="Check again"
                    disabled={collection.busy || state.offline}
                    onPress={() => void client.retry()}
                  />
                </View>
              )}
              {state.toReview.status === 'loading' && !state.offline && (
                <Copy accessibilityLiveRegion="polite">Checking what’s waiting…</Copy>
              )}
              {state.toReview.status === 'error' && !state.offline && (
                <Copy accessibilityRole="alert">
                  {memberMessage(state.toReview.message ?? 'Couldn’t load your items. Try again.')}
                </Copy>
              )}
              <CompactText tone="secondary">
                {model.counts.ready} ready · {model.counts.needsDetails} needs details ·{' '}
                {model.counts.onThisPhone} on this phone
              </CompactText>
              <Button
                label={model.ready.label}
                disabled={disabled || model.ready.count === 0}
                onPress={() => void client.reviewReady(model.ready.items)}
              />
              <Button
                label="Review one at a time"
                secondary
                disabled={disabled || !model.items.some((item) => item.accountItem)}
                onPress={() => void controller.startReviewRun(groupId)}
              />
              <Button
                label="Refresh items"
                secondary
                disabled={collection.busy || state.offline}
                onPress={() => void controller.refreshToReview()}
              />
              {model.counts.total === 0 && state.toReview.status === 'ready' && !state.offline && (
                <Copy accessibilityRole="header">All caught up</Copy>
              )}
              {sections.map(([kind, label]) => {
                const items = model.items.filter((item) => item.state === kind);
                if (!items.length) return null;
                return (
                  <View key={kind} style={{ gap: 10 }}>
                    <CompactText accessibilityRole="header" weight="semibold">
                      {label}
                    </CompactText>
                    {items.map((item) => (
                      <Card key={item.id} padded>
                        <View style={{ gap: 10 }}>
                          {item.deviceItem ? (
                            <PhoneItem
                              item={item}
                              controller={controller}
                              disabled={collection.busy}
                            />
                          ) : (
                            <>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Review ${item.accountItem?.draft.values?.description || 'expense details'}`}
                                accessibilityState={{ disabled }}
                                disabled={disabled}
                                style={{ minHeight: 48, paddingVertical: 4 }}
                                onPress={() => openItem(item)}
                              >
                                <ItemDetails item={item} />
                              </Pressable>
                              {memberProblems(item, names).map((problem) => (
                                <CompactText key={problem} tone="warning">
                                  {problem}
                                </CompactText>
                              ))}
                              {item.accountItem?.duplicates.map((duplicate, index) => (
                                <CompactText key={index} tone="warning">
                                  May match {duplicate.description}
                                </CompactText>
                              ))}
                              <Button
                                label="Delete"
                                secondary
                                disabled={disabled}
                                onPress={() =>
                                  Alert.alert(
                                    'Delete this item?',
                                    'This can’t be undone. Nothing in the Group changes.',
                                    [
                                      { text: 'Keep item', style: 'cancel' },
                                      {
                                        text: 'Delete',
                                        style: 'destructive',
                                        onPress: () => {
                                          if (item.accountItem)
                                            void client.discard(item.accountItem.draft);
                                        },
                                      },
                                    ],
                                  )
                                }
                              />
                            </>
                          )}
                        </View>
                      </Card>
                    ))}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
        <BottomSheet
          visible={!!collection.confirmation}
          title="Save ready expenses?"
          subtitle={groupName}
          onDone={() => client.cancelReview()}
          doneLabel="Cancel"
          dismissible={!collection.busy}
        >
          <View style={{ gap: 12 }}>
            {collection.confirmation?.items.map((item) => (
              <View key={item.draft.id} style={{ gap: 4 }}>
                <Copy>{item.draft.values?.description || 'Expense'}</Copy>
                <Money numberOfLines={0}>{amountLabel(item.draft.values)}</Money>
                <CompactText tone="secondary">
                  {item.draft.preparedBy.kind === 'assistant'
                    ? `Prepared by ${item.draft.preparedBy.name}`
                    : 'Set aside by you'}
                </CompactText>
                {item.draft.values?.date && <Copy>{formatDate(item.draft.values.date)}</Copy>}
                {collection.reviews.find((review) => review.draft.id === item.draft.id)
                  ?.allocation &&
                  (() => {
                    const allocation = collection.reviews.find(
                      (review) => review.draft.id === item.draft.id,
                    )!.allocation!;
                    // The signed-in member is "You", as on Add expense (#434).
                    const isYou = (id: string) => id === state.auth.user?.id;
                    const name = (id: string) =>
                      isYou(id)
                        ? 'You'
                        : (collection.context?.group.members.find((member) => member.user.id === id)
                            ?.user.name ?? 'Group member');
                    return (
                      <View style={{ gap: 4 }}>
                        {allocation.paidBy.map((row) => (
                          <Copy key={`paid:${row.user}`}>
                            {name(row.user)} paid {formatCurrency(row.amount, allocation.currency)}
                          </Copy>
                        ))}
                        {allocation.splitBetween.map((row) => (
                          <Copy key={`shared:${row.user}`}>
                            {name(row.user)} {isYou(row.user) ? 'share' : 'shares'}{' '}
                            {formatCurrency(row.amount, allocation.currency)}
                          </Copy>
                        ))}
                      </View>
                    );
                  })()}
              </View>
            ))}
            <Copy accessibilityRole="header">Total</Copy>
            {collection.confirmation?.totals.map((total) => (
              <Money key={total.currency} numberOfLines={0}>
                {total.formatted}
              </Money>
            ))}
            <Copy>Balances there will change for everyone</Copy>
            <Button
              label={`Confirm ${collection.confirmation?.label.toLowerCase() ?? 'save'}`}
              disabled={disabled}
              onPress={() => void client.save()}
            />
          </View>
        </BottomSheet>
        <BottomSheet
          visible={collection.resultsVisible}
          title="After saving"
          subtitle={results.label || 'Check each item below'}
          onDone={() => client.closeResults()}
          dismissible={!collection.busy}
        >
          <View style={{ gap: 12 }}>
            {collection.outcomes.map((outcome) => (
              <View key={outcome.id} style={{ gap: 4 }}>
                <Copy>{collection.outcomeNames[outcome.id] || 'Expense'}</Copy>
                <CompactText tone={outcome.status === 'saved' ? 'positive' : 'warning'}>
                  {outcome.status === 'saved'
                    ? 'Saved'
                    : outcome.status === 'unresolved'
                      ? unconfirmedMessage
                      : /changed|revision|version|stale|conflict/i.test(outcome.message)
                        ? 'Changed since you checked'
                        : `Couldn’t save: ${memberMessage(outcome.message)}`}
                </CompactText>
              </View>
            ))}
            {(collection.pending ||
              collection.outcomes.some((outcome) => outcome.status === 'unresolved')) && (
              <Button
                label="Check again"
                disabled={collection.busy || state.offline}
                onPress={() => void client.retry()}
              />
            )}
          </View>
        </BottomSheet>
      </SafeAreaView>
    </Modal>
  );
}
