import { ReviewRunOverlay } from './review-run';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatCurrency, formatCurrencyAsEntered } from '@splitbook/shared/currency';
import {
  memberProblems,
  summarizeReviewRun,
  type ReviewItemModel,
} from '@splitbook/shared/to-review';
import {
  applyQuickFix,
  bulkPayerItems,
  toReviewQuickFixes,
  type ItemQuickFixes,
  type QuickFixFact,
} from '@splitbook/shared/to-review-quick-fixes';
import type {
  ExpenseDraftValues,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import type { MobileController } from '../data/mobile-controller';
import {
  Badge,
  Banner,
  BottomSheet,
  Card,
  CompactButton,
  CompactText,
  Divider,
  IconButton,
  IconTile,
  ListRow,
  Money,
  SectionHeader,
  Snackbar,
  SummaryStats,
  TopBar,
  denseHitSlop,
  touch,
  useLargeText,
  useTap,
} from './compact';
import { useDismissAfter } from './group-snackbar';
import { groupIcon } from './group-icon';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';
import { expenseLocalDate } from '@splitbook/shared/expense-day';
import { recentDay } from './day-format';
import { ChangeCurrencySheet, UnlistedCurrencySheet, type UnlistedItem } from './review-currency';

const offlineMessage =
  'You’re offline. What Claude prepared and what you set aside show up when you’re back online';
const unconfirmedMessage = 'We didn’t hear back, so it may already be saved';
/** A list row's leading tile and its gap, so dividers and follow-on lines start under the text. */
const rowInset = 66;

/** Backend errors are translated at the presentation boundary, never used as decisions. */
function memberMessage(message: string) {
  return message
    .replace(/drafts?\b/gi, (word) => (word.toLowerCase() === 'drafts' ? 'items' : 'item'))
    .replace(/revisions?\b/gi, 'version')
    .replace(/requests?\b/gi, 'change')
    .replace(/collections?\b/gi, 'items');
}
/** An item without a currency is in its Group's (#512); without either, the amount still shows. */
function amountLabel(values?: ExpenseDraftValues, groupCurrency?: string) {
  if (!values?.amount) return 'Amount needed';
  const currency = values.currency || groupCurrency;
  if (!currency) return values.amount.toLocaleString('en', { maximumFractionDigits: 20 });
  // As entered, never rounded: the Needs line says when it has too many decimals (#537).
  return formatCurrencyAsEntered(values.amount, currency);
}
/** What the currency fix needs of an item (#733): its name, where it's from, and its amount. */
function unlistedItem(item: ReviewItemModel, currency: string): UnlistedItem {
  const values = item.accountItem?.draft.values;
  const date =
    values?.date && Number.isFinite(new Date(values.date).getTime())
      ? recentDay(expenseLocalDate(values.date))
      : null;
  return {
    description: values?.description || 'Expense to review',
    detail: [sourceLabel(item), date].filter(Boolean).join(' · '),
    amount: values?.amount,
    currency,
  };
}
function sourceLabel(item: ReviewItemModel) {
  if (item.id.startsWith('save:')) return 'Save awaiting confirmation';
  if (item.deviceItem) return 'Unfinished · only on this phone';
  const source = item.accountItem?.draft.preparedBy;
  return source?.kind === 'assistant' ? `Prepared by ${source.name}` : 'Set aside by you';
}

/** The currency of an item its Group doesn't list (#733), or null. */
const unlistedCurrency = (item: ReviewItemModel) =>
  item.needs.some((need) => need.reason === 'currency-not-listed')
    ? (item.accountItem?.draft.values?.currency ?? null)
    : null;

/**
 * Where an item came from, at the start of its row: the assistant's initials, a bookmark for
 * one the member set aside, a phone for one only on this phone.
 */
function SourceTile({ item }: { item: ReviewItemModel }) {
  const theme = useTheme();
  const source = item.accountItem?.draft.preparedBy;
  if (source?.kind === 'assistant')
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: theme.text,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CompactText weight="semibold" maxFontSizeMultiplier={1.3} style={{ color: theme.bg }}>
          {source.name.slice(0, 2)}
        </CompactText>
      </View>
    );
  if (item.id.startsWith('save:')) return <IconTile icon="alert-circle-outline" tone="warning" />;
  if (item.deviceItem) return <IconTile icon="phone-portrait-outline" tone="neutral" />;
  return <IconTile icon="bookmark-outline" />;
}

/** `label` replaces the Needs line when chips already ask for some facts (#439); null hides it. */
function ItemRow({
  item,
  label = item.label,
  currency,
  groupName,
  trailing,
  onPress,
  accessibilityLabel,
  disabled = false,
  badge,
}: {
  item: ReviewItemModel;
  label?: string | null;
  /** Beside where it came from, such as "Currency not listed" (#733). */
  badge?: string;
  /** The Group's currency. */
  currency?: string;
  /** Said under an item only on this phone, where the list spans Groups. */
  groupName?: string;
  /** In place of the amount, such as "Continue". */
  trailing?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  // At large text the amount goes under the title, on a line of its own: beside it, a narrow
  // column would break the number in two (₹1,4 / 80.00).
  const large = useLargeText();
  // A drag that starts on the row never opens it (#665).
  const tap = useTap();
  const values = item.accountItem?.draft.values ?? item.deviceItem?.values;
  // An item in your account says what it needs once, in its Needs line, so a missing fact leaves
  // its place empty here rather than saying it again (#435). A save still waiting for its reply
  // isn't asked for anything: it shows what it has.
  const retained = item.id.startsWith('save:');
  const needs = !!item.accountItem || retained;
  const date =
    values?.date && Number.isFinite(new Date(values.date).getTime())
      ? recentDay(expenseLocalDate(values.date))
      : needs
        ? null
        : 'Date needed';
  const amount = amountLabel(values, currency);
  const shownAmount = needs && !values?.amount ? null : amount;
  const content = (
    <>
      <SourceTile item={item} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <CompactText weight="semibold" numberOfLines={2}>
          {values?.description ||
            (retained
              ? 'Save awaiting confirmation'
              : needs
                ? 'Expense to review'
                : 'Description needed')}
        </CompactText>
        {large && shownAmount ? <Money>{shownAmount}</Money> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <CompactText variant="caption" tone="secondary">
            {sourceLabel(item)}
            {date ? ` · ${date}` : ''}
            {groupName ? ` · ${groupName}` : ''}
          </CompactText>
          {badge ? <Badge label={badge} tone="warning" /> : null}
        </View>
        {item.state !== 'on-this-phone' && label && (
          <CompactText variant="caption" tone={item.state === 'ready' ? 'positive' : 'warning'}>
            {label}
          </CompactText>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 1 }}>
        {!large && shownAmount ? <Money>{shownAmount}</Money> : null}
        {trailing ? (
          <CompactText variant="small" weight="semibold" tone="brand">
            {trailing}
          </CompactText>
        ) : null}
      </View>
    </>
  );
  const row = {
    minHeight: 60,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  };
  if (!onPress) return <View style={row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      {...tap.on(onPress)}
      style={({ pressed }) => [
        row,
        pressed && !tap.dragged && { backgroundColor: theme.surfaceMuted },
        disabled && { opacity: 0.5 },
      ]}
    >
      {content}
    </Pressable>
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
/** An unfinished Expense only on this phone, or a save still waiting for its reply. */
function PhoneItem({
  item,
  controller,
  disabled = false,
  showGroup = false,
}: {
  item: ReviewItemModel;
  controller: MobileController;
  disabled?: boolean;
  /** Home lists items from every Group, so each says which. */
  showGroup?: boolean;
}) {
  const draft = controller.getSnapshot().drafts.find((entry) => entry.groupId === item.groupId);
  const retainedSave = item.id.startsWith('save:');
  const unconfirmed = retainedSave || !!draft?.unconfirmed;
  return (
    <View>
      <ItemRow
        item={item}
        groupName={showGroup ? item.deviceItem?.groupName : undefined}
        trailing={retainedSave ? 'Check again' : 'Continue'}
        accessibilityLabel={
          retainedSave
            ? 'Check again'
            : `Continue ${item.deviceItem?.values.description || 'unfinished expense'}`
        }
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
      {unconfirmed && (
        <CompactText
          variant="caption"
          tone="warning"
          style={{ paddingLeft: rowInset, paddingRight: 14, paddingBottom: 8 }}
        >
          {unconfirmedMessage}
        </CompactText>
      )}
    </View>
  );
}

/**
 * Home's To review card: one row per Group with a count, then anything only on this phone, then
 * the run across every Group. Outlined in the brand colour: it's the one thing waiting for you.
 */
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
    state.toReview.status !== 'error' &&
    model.counts.total === 0 &&
    !state.toReview.recoveryMessage
  )
    return null;
  const phoneItems = model.items
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
    );
  const accountCount = model.items.filter((item) => item.accountItem).length;
  const groups = state.offline ? [] : model.groups;
  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: theme.brand.main,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          minHeight: 32,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingTop: 10,
          paddingHorizontal: 14,
        }}
      >
        <CompactText variant="overline" tone="brand" accessibilityRole="header">
          To review · {model.counts.total}
        </CompactText>
        <CompactText variant="caption" tone="secondary">
          Only you see these
        </CompactText>
      </View>
      {(state.toReview.recoveryMessage ||
        state.offline ||
        state.toReview.status === 'error' ||
        state.toReview.status === 'idle' ||
        state.toReview.status === 'loading') && (
        <View style={{ gap: 8, paddingHorizontal: 14, paddingTop: 8 }}>
          {state.toReview.recoveryMessage && (
            <Banner tone="warning" message={memberMessage(state.toReview.recoveryMessage)}>
              <CompactButton
                label="Check this phone again"
                variant="text"
                dense
                disabled={disabled}
                onPress={() => void controller.refreshToReview()}
              />
            </Banner>
          )}
          {state.offline ? (
            <Banner tone="offline" message={`${offlineMessage}.`} />
          ) : state.toReview.status === 'idle' || state.toReview.status === 'loading' ? (
            <CompactText variant="small" tone="secondary" accessibilityLiveRegion="polite">
              Checking what’s waiting…
            </CompactText>
          ) : state.toReview.status === 'error' ? (
            <Banner
              tone="error"
              message={memberMessage(state.toReview.message ?? 'Couldn’t check what’s waiting.')}
            >
              <CompactButton
                label="Try again"
                variant="text"
                dense
                disabled={disabled}
                onPress={() => void controller.refreshToReview()}
              />
            </Banner>
          ) : null}
        </View>
      )}
      <View style={{ paddingTop: 4 }}>
        {groups.map((group, index) => (
          <View key={group.groupId}>
            {index > 0 && <Divider inset={rowInset} />}
            <ListRow
              leading={<IconTile icon={groupIcon(group.category)} />}
              title={group.groupName}
              meta={group.sourceSummary || undefined}
              trailing={
                <View
                  style={{
                    minWidth: 28,
                    height: 28,
                    borderRadius: 14,
                    paddingHorizontal: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.brand.main,
                  }}
                >
                  <CompactText
                    variant="small"
                    weight="semibold"
                    maxFontSizeMultiplier={1.3}
                    style={{ color: theme.brand.contrastText }}
                  >
                    {group.counts.total}
                  </CompactText>
                </View>
              }
              accessibilityLabel={`${group.groupName}, ${group.counts.total} to review`}
              disabled={disabled}
              onPress={() => void controller.openToReview(group.groupId)}
            />
          </View>
        ))}
        {phoneItems.map((item, index) => (
          <View key={item.id}>
            {(groups.length > 0 || index > 0) && <Divider inset={rowInset} />}
            <PhoneItem item={item} controller={controller} disabled={disabled} showGroup />
          </View>
        ))}
      </View>
      {accountCount > 0 && !state.offline ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: 14 }}>
          <CompactButton
            label={`Review ${accountCount}, one at a time`}
            block
            disabled={disabled}
            onPress={() => void controller.startReviewRun()}
          />
        </View>
      ) : (
        <View style={{ height: 8 }} />
      )}
    </View>
  );
}

/** A Group's To review bar, above its Expenses: what's waiting, in one row that opens the list. */
export function ToReviewGroupBanner({
  controller,
  groupId,
}: {
  controller: MobileController;
  groupId: string;
}) {
  const state = useReviewSnapshot(controller);
  const theme = useTheme();
  // A drag that starts on the bar never opens the list (#684).
  const tap = useTap();
  const model = controller.toReviewModel(groupId);
  const group = model.groups[0];
  if (!group) return null;
  const summary = [group.bannerSummary, state.offline ? 'On this phone' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.counts.total} to review in ${group.groupName}${summary ? `: ${summary}` : ''}. Review`}
      {...tap.on(() => void controller.openToReview(groupId))}
      style={({ pressed }) => ({
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        paddingLeft: 12,
        paddingRight: 8,
        borderRadius: 14,
        backgroundColor: theme.brand.bg,
        opacity: pressed && !tap.dragged ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: theme.brand.main,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="file-tray-outline" size={20} color={theme.brand.contrastText} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <CompactText weight="semibold" accessibilityRole="header">
          {group.counts.total} to review
        </CompactText>
        {summary ? (
          <CompactText variant="caption" tone="secondary" numberOfLines={2}>
            {summary}
          </CompactText>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 4 }}>
        <CompactText variant="small" weight="semibold" tone="brand">
          Review
        </CompactText>
        <Icon name="chevron-forward" size={18} color={theme.brand.main} />
      </View>
    </Pressable>
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

/** A one-tap choice: fills in one fact; the suggested one is marked, never chosen (#439). */
function QuickChip({
  label,
  accessibilityLabel = label,
  suggested = false,
  more = false,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  suggested?: boolean;
  more?: boolean;
  disabled: boolean;
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
      hitSlop={denseHitSlop}
      style={({ pressed }) => ({
        minHeight: touch.dense,
        paddingHorizontal: 14,
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: more ? 'dashed' : 'solid',
        borderColor: suggested ? theme.brand.main : theme.borderStrong,
        backgroundColor: suggested ? theme.brand.bg : more ? 'transparent' : theme.surface,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      <CompactText
        variant="small"
        style={{
          fontFamily: suggested ? fonts.semibold : fonts.medium,
          color: suggested ? theme.brand.main : more ? theme.textSecondary : theme.text,
        }}
      >
        {label}
      </CompactText>
    </Pressable>
  );
}

/** An item in your account: its row opens it; quick fixes, Save or Fix the rest, and ⋮ follow. */
function AccountRow({
  item,
  currency,
  quick,
  names,
  disabled,
  onOpen,
  onFill,
  onMore,
  onSave,
  onMenu,
}: {
  item: ReviewItemModel;
  /** The Group's currency. */
  currency?: string;
  quick: ItemQuickFixes | null;
  names: Record<string, string>;
  disabled: boolean;
  onOpen(): void;
  onFill(fact: QuickFixFact, option: string): void;
  onMore(fact: QuickFixFact): void;
  onSave(): void;
  onMenu(): void;
}) {
  const title = item.accountItem?.draft.values?.description || 'Expense to review';
  const fixes = quick?.fixes ?? [];
  const still = quick?.stillNeeds ?? [];
  // Chips ask for their facts; the Needs line names only the rest, so each fact is said once.
  const label = fixes.length
    ? still.length
      ? `Still needs ${still.join(', ')}`
      : null
    : item.label;
  const problems = memberProblems(item, names);
  const duplicates = item.accountItem?.duplicates ?? [];
  return (
    <View>
      <ItemRow
        item={item}
        label={label}
        currency={currency}
        accessibilityLabel={`Review ${item.accountItem?.draft.values?.description || 'expense details'}`}
        disabled={disabled}
        onPress={onOpen}
        badge={unlistedCurrency(item) ? 'Currency not listed' : undefined}
      />
      <View style={{ paddingLeft: rowInset, paddingRight: 8, paddingBottom: 8, gap: 8 }}>
        {quick?.summary ? (
          <CompactText variant="caption" tone="secondary">
            {quick.summary}
          </CompactText>
        ) : null}
        {fixes.map((fix) => (
          <View
            key={fix.fact}
            accessibilityLabel={`${fix.fact === 'paidBy' ? 'Who paid for' : 'Tag for'} ${title}`}
            style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
          >
            <CompactText variant="small" weight="semibold" style={{ width: '100%' }}>
              {fix.question}
            </CompactText>
            {fix.visible.map((option) => (
              <QuickChip
                key={option.id}
                label={option.label}
                accessibilityLabel={option.suggested ? `${option.label}, suggested` : option.label}
                suggested={option.suggested}
                disabled={disabled}
                onPress={() => onFill(fix.fact, option.id)}
              />
            ))}
            {fix.hasMore && (
              <QuickChip
                label="More…"
                accessibilityLabel={`More ${fix.fact === 'paidBy' ? 'people' : 'Tags'} for ${title}`}
                more
                disabled={disabled}
                onPress={() => onMore(fix.fact)}
              />
            )}
          </View>
        ))}
        {problems.map((problem) => (
          <CompactText key={problem} variant="caption" tone="warning">
            {problem}
          </CompactText>
        ))}
        {duplicates.map((duplicate, index) => (
          <CompactText key={index} variant="caption" tone="warning">
            May match {duplicate.description}
          </CompactText>
        ))}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {item.state === 'ready' && (
            <CompactButton
              label="Save"
              accessibilityLabel={`Save ${title}`}
              variant="tonal"
              dense
              disabled={disabled}
              onPress={onSave}
            />
          )}
          {item.state === 'needs-details' && fixes.length > 0 && still.length > 0 && (
            <CompactButton
              label="Fix the rest"
              accessibilityLabel={`Fix the rest of ${title}`}
              variant="tonal"
              dense
              disabled={disabled}
              onPress={onOpen}
            />
          )}
          <IconButton
            icon="ellipsis-vertical"
            label={`More for ${title}`}
            disabled={disabled}
            onPress={onMenu}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * The bulk payer result where the member is: at the foot of the screen, since the list re-sorts
 * as items move to Ready. Undo stays for Android's accessibility timeout, as on the web (#439).
 */
function PayerNotice({
  notice,
  onUndo,
  onDismiss,
}: {
  notice: { text: string; undo: boolean };
  onUndo(): void;
  onDismiss(): void;
}) {
  useDismissAfter(notice, 8_000, onDismiss);
  return (
    <Snackbar
      message={notice.text}
      bottom={16}
      action={notice.undo ? { label: 'Undo', onPress: onUndo } : undefined}
    />
  );
}

/** A line in a confirm or results sheet: what it is, and its amount at the end. */
function SheetLine({ title, detail, amount }: { title: string; detail?: string; amount?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <CompactText weight="semibold" numberOfLines={2}>
          {title}
        </CompactText>
        {detail ? (
          <CompactText variant="caption" tone="secondary">
            {detail}
          </CompactText>
        ) : null}
      </View>
      {amount ? <Money numberOfLines={0}>{amount}</Money> : null}
    </View>
  );
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
  // A drag that starts on a Who paid? or tag option never picks it (#665).
  const optionTap = useTap();
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
  // An item in a currency the Group doesn't list opens its fix (#733); any other, the guided
  // review, with Add expense's fields and pickers (#435).
  const [fixing, setFixing] = useState<{
    id: string;
    changing: boolean;
    /** The item as it was opened: offline, the list holds no account items to read it from. */
    item: UnlistedItem;
    draft: PersistedExpenseDraft;
  } | null>(null);
  const currencyAdd = useMobileSnapshot(controller, (snapshot) => snapshot.currencyAdd);
  const openItem = (item: ReviewItemModel) => {
    const currency = unlistedCurrency(item);
    if (currency && item.accountItem)
      setFixing({
        id: item.id,
        changing: false,
        item: unlistedItem(item, currency),
        draft: item.accountItem.draft,
      });
    else if (item.accountItem) void controller.startReviewRun(groupId, item.accountItem.draft.id);
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
  // Quick fixes use the Group context this collection already reads: members and active Tags.
  const viewerId = state.auth.user?.id ?? '';
  const context = collection.context;
  const quickContext = context
    ? {
        viewerId,
        members: context.group.members.map((member) => ({
          id: member.user.id,
          name: member.user.name,
        })),
        tags: context.tags
          .filter((tag) => !tag.isArchived && !tag.isDeleted)
          .map((tag) => ({ id: tag.id, name: tag.name })),
      }
    : null;
  const quickFor = (item: ReviewItemModel) =>
    quickContext && item.accountItem ? toReviewQuickFixes(item, quickContext) : null;
  const fill = (item: ReviewItemModel, fact: QuickFixFact, option: string) => {
    const draft = item.accountItem?.draft;
    if (draft) void client.fill(draft, applyQuickFix(draft.values ?? {}, fact, option));
  };
  const [more, setMore] = useState<{ item: ReviewItemModel; fact: QuickFixFact } | null>(null);
  const moreFix = more ? quickFor(more.item)?.fixes.find((fix) => fix.fact === more.fact) : null;
  // An item's ⋮ options, then its delete confirmation: sheets, as the rest of the app has.
  const [pulled, setPulled] = useState(false);
  const [menu, setMenu] = useState<{ item: ReviewItemModel; confirm: boolean } | null>(null);
  const menuTitle = menu?.item.accountItem?.draft.values?.description || 'Expense to review';
  const payers = quickContext ? bulkPayerItems(model.items) : [];
  const close = () => {
    if (!collection.busy) controller.closeToReview();
  };
  const loaded = model.counts.total === 0 && state.toReview.status === 'ready' && !state.offline;
  // The item being fixed, as the latest read has it: fixed, or gone once read online, it closes.
  const fixingNow = fixing ? model.items.find((item) => item.id === fixing.id) : undefined;
  const settled =
    !!fixing &&
    (fixingNow
      ? !unlistedCurrency(fixingNow)
      : !state.offline && state.toReview.status === 'ready');
  useEffect(() => {
    if (settled) setFixing(null);
  }, [settled]);
  const fixingGroup = collection.context?.group ?? {
    name: groupName,
    defaultCurrency: own?.currency ?? '',
    alternateCurrencies:
      state.toReview.read.groups.find((read) => read.groupId === groupId)?.alternateCurrencies ??
      [],
  };
  const fixingDraft = fixingNow?.accountItem?.draft ?? fixing?.draft;
  const name = (id: string) =>
    id === state.auth.user?.id
      ? 'You'
      : (collection.context?.group.members.find((member) => member.user.id === id)?.user.name ??
        'Group member');
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <TopBar
          title="To review"
          subtitle={`${groupName} · ${
            model.counts.total === 0
              ? 'nothing waiting'
              : `${model.counts.total} ${model.counts.total === 1 ? 'item' : 'items'}`
          }`}
          prominent={false}
          leading={{
            kind: 'back',
            label: 'Close To review',
            onPress: close,
            disabled: collection.busy,
          }}
          actions={
            <IconButton
              icon="refresh-outline"
              label="Refresh items"
              disabled={collection.busy || state.offline}
              onPress={() => void controller.refreshToReview()}
            />
          }
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={pulled}
              onRefresh={() => {
                if (collection.busy || state.offline) return;
                setPulled(true);
                void controller.refreshToReview().finally(() => setPulled(false));
              }}
              tintColor={theme.brand.main}
              colors={[theme.brand.main]}
            />
          }
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 4,
            gap: 12,
            // Room for the payer notice, so it never covers the last item.
            paddingBottom: collection.notice ? 112 : 32,
          }}
        >
          {unavailable ? (
            <Banner
              tone="error"
              message="This Group isn’t available. You may no longer be a member of this Group."
            />
          ) : (
            <>
              {/* What went wrong or waits stays said above the list, or above its empty state:
                  an item changed elsewhere can empty the list as it explains why. */}
              {!loaded && (
                <CompactText variant="small" tone="secondary" style={{ paddingHorizontal: 2 }}>
                  Only you see these. Balances stay the same until you save.
                </CompactText>
              )}
              {state.offline && <Banner tone="offline" message={`${offlineMessage}.`} />}
              {state.toReview.recoveryMessage && (
                <Banner tone="warning" message={memberMessage(state.toReview.recoveryMessage)}>
                  <CompactButton
                    label="Check this phone again"
                    variant="text"
                    dense
                    disabled={collection.busy}
                    onPress={() => void controller.refreshToReview()}
                  />
                </Banner>
              )}
              {!!collection.message && (
                <Banner tone="error" message={memberMessage(collection.message)} />
              )}
              {collection.pending && (
                <Banner tone="warning" standing message={unconfirmedMessage}>
                  <CompactButton
                    label="Check again"
                    variant="text"
                    dense
                    disabled={collection.busy || state.offline}
                    onPress={() => void client.retry()}
                  />
                </Banner>
              )}
              {state.toReview.status === 'loading' && !state.offline && (
                <CompactText
                  variant="small"
                  tone="secondary"
                  accessibilityLiveRegion="polite"
                  style={{ paddingHorizontal: 2 }}
                >
                  Checking what’s waiting…
                </CompactText>
              )}
              {state.toReview.status === 'error' && !state.offline && (
                <Banner
                  tone="error"
                  message={memberMessage(
                    state.toReview.message ?? 'Couldn’t load your items. Try again.',
                  )}
                />
              )}
              {loaded ? (
                <View
                  style={{ alignItems: 'center', gap: 10, paddingTop: 72, paddingHorizontal: 12 }}
                >
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 20,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.positive.bg,
                    }}
                  >
                    <Icon name="checkmark" size={30} color={theme.status.positive} />
                  </View>
                  <CompactText variant="title" accessibilityRole="header">
                    All caught up
                  </CompactText>
                  <CompactText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
                    Nothing is waiting in {groupName}. When Claude prepares expenses, or you choose
                    Finish later, they appear here.
                  </CompactText>
                  <CompactButton label="Back to Expenses" variant="tonal" onPress={close} />
                </View>
              ) : (
                <>
                  <Card>
                    <SummaryStats
                      stats={[
                        {
                          value: String(model.counts.ready),
                          label: 'ready to save',
                          tone: 'positive',
                        },
                        {
                          value: String(model.counts.needsDetails),
                          label: 'needs details',
                          tone: 'warning',
                        },
                        {
                          value: String(model.counts.onThisPhone),
                          label: 'on this phone',
                          tone: 'secondary',
                        },
                      ]}
                    />
                    <View style={{ gap: 8, paddingHorizontal: 14, paddingBottom: 14 }}>
                      <CompactButton
                        label={model.ready.label}
                        block
                        disabled={disabled || model.ready.count === 0}
                        onPress={() => void client.reviewReady(model.ready.items, own?.currency)}
                      />
                      <CompactButton
                        label="Review one at a time"
                        variant="tonal"
                        block
                        disabled={disabled || !model.items.some((item) => item.accountItem)}
                        onPress={() => void controller.startReviewRun(groupId)}
                      />
                    </View>
                  </Card>
                  {sections.map(([kind, label]) => {
                    const items = model.items.filter((item) => item.state === kind);
                    if (!items.length) return null;
                    return (
                      <View key={kind} style={{ gap: 6 }}>
                        <SectionHeader title={`${label} · ${items.length}`} />
                        {kind === 'needs-details' && payers.length >= 2 && (
                          <Banner
                            tone="info"
                            title="Who paid?"
                            message={`${payers.length} items still need a payer.`}
                          >
                            <CompactButton
                              label={`You for all ${payers.length}`}
                              variant="text"
                              dense
                              disabled={disabled}
                              onPress={() =>
                                void client.payAll(
                                  payers.flatMap((item) =>
                                    item.accountItem ? [item.accountItem.draft] : [],
                                  ),
                                  viewerId,
                                )
                              }
                            />
                          </Banner>
                        )}
                        <Card>
                          {items.map((item, index) => (
                            <View key={item.id}>
                              {index > 0 && <Divider inset={rowInset} />}
                              {item.deviceItem ? (
                                <PhoneItem
                                  item={item}
                                  controller={controller}
                                  disabled={collection.busy}
                                />
                              ) : (
                                <AccountRow
                                  item={item}
                                  currency={own?.currency}
                                  quick={quickFor(item)}
                                  names={names}
                                  disabled={disabled}
                                  onOpen={() => openItem(item)}
                                  onFill={(fact, option) => fill(item, fact, option)}
                                  onMore={(fact) => setMore({ item, fact })}
                                  onSave={() => {
                                    if (item.accountItem) void client.saveOne(item.accountItem);
                                  }}
                                  onMenu={() => setMenu({ item, confirm: false })}
                                />
                              )}
                            </View>
                          ))}
                        </Card>
                      </View>
                    );
                  })}
                </>
              )}
            </>
          )}
        </ScrollView>
        {fixing && !settled && fixingDraft ? (
          fixing.changing ? (
            <ChangeCurrencySheet
              item={fixing.item}
              group={fixingGroup}
              disabled={disabled}
              onUse={(currency) =>
                void client.changeCurrency(fixingDraft, currency).then(() => setFixing(null))
              }
              onClose={() => setFixing({ ...fixing, changing: false })}
            />
          ) : (
            <UnlistedCurrencySheet
              item={fixing.item}
              group={fixingGroup}
              offline={state.offline}
              disabled={collection.busy || collection.pending || unavailable}
              adding={
                currencyAdd.groupId === groupId
                  ? currencyAdd
                  : { groupId, status: 'idle', message: null }
              }
              onAdd={() => void controller.addGroupCurrency(fixing.item.currency)}
              onChange={() => setFixing({ ...fixing, changing: true })}
              onClose={() => setFixing(null)}
            />
          )
        ) : null}
        {collection.notice && (
          <PayerNotice
            notice={collection.notice}
            onUndo={() => void client.undoPayAll()}
            onDismiss={() => client.dismissNotice()}
          />
        )}
        {moreFix && (
          <BottomSheet
            visible
            title={more?.fact === 'paidBy' ? 'Who paid?' : 'The tag'}
            subtitle={more?.item.accountItem?.draft.values?.description || 'Expense to review'}
            onDone={() => setMore(null)}
            doneLabel="Close"
          >
            <View accessibilityRole="radiogroup" style={{ gap: 4 }}>
              {moreFix?.options.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="radio"
                  accessibilityLabel={
                    option.suggested ? `${option.label}, suggested` : option.label
                  }
                  accessibilityState={{ checked: false, disabled }}
                  disabled={disabled}
                  {...optionTap.on(() => {
                    if (more) fill(more.item, more.fact, option.id);
                    setMore(null);
                  })}
                  style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                >
                  <CompactText
                    weight={option.suggested ? 'semibold' : undefined}
                    style={{ flex: 1 }}
                  >
                    {option.label}
                  </CompactText>
                  {option.suggested && (
                    <CompactText variant="caption" tone="secondary">
                      Suggested
                    </CompactText>
                  )}
                </Pressable>
              ))}
              <CompactText variant="small" tone="secondary">
                Choosing keeps it on this item. Nothing is saved as an expense.
              </CompactText>
            </View>
          </BottomSheet>
        )}
        {menu && (
          <BottomSheet
            visible
            title={menu.confirm ? 'Delete this item?' : menuTitle}
            subtitle={menu.confirm ? undefined : sourceLabel(menu.item)}
            onDone={() => setMenu(null)}
            doneLabel={menu.confirm ? 'Keep item' : 'Close'}
            dismissLabel={menu.confirm ? 'Keep item' : `Close ${menuTitle}`}
            dismissible={!collection.busy}
            footer={
              menu.confirm ? (
                <CompactButton
                  label="Delete"
                  accessibilityLabel={`Delete ${menuTitle}`}
                  destructive
                  block
                  disabled={disabled}
                  onPress={() => {
                    const draft = menu.item.accountItem?.draft;
                    setMenu(null);
                    if (draft) void client.discard(draft);
                  }}
                />
              ) : undefined
            }
          >
            {menu.confirm ? (
              <>
                <SheetLine
                  title={menuTitle}
                  amount={amountLabel(menu.item.accountItem?.draft.values, own?.currency)}
                />
                <CompactText>
                  It was never saved, so nothing in {groupName} changes. You can’t undo this.
                </CompactText>
              </>
            ) : (
              <Card>
                <ListRow
                  leading={<IconTile icon="open-outline" />}
                  title="Open"
                  meta="Review it with every detail"
                  onPress={() => {
                    const item = menu.item;
                    setMenu(null);
                    openItem(item);
                  }}
                />
                <Divider inset={rowInset} />
                <ListRow
                  leading={<IconTile icon="trash-outline" tone="warning" />}
                  title="Delete"
                  meta="Remove it from To review"
                  onPress={() => setMenu({ item: menu.item, confirm: true })}
                />
              </Card>
            )}
          </BottomSheet>
        )}
        <BottomSheet
          visible={!!collection.confirmation}
          title={
            collection.confirmation
              ? `Save ${collection.confirmation.items.length} ${collection.confirmation.items.length === 1 ? 'expense' : 'expenses'}?`
              : 'Save ready expenses?'
          }
          subtitle={groupName}
          onDone={() => client.cancelReview()}
          doneLabel="Cancel"
          dismissible={!collection.busy}
          footer={
            collection.confirmation ? (
              <CompactButton
                label={`Confirm ${collection.confirmation.label.toLowerCase()}`}
                block
                disabled={disabled}
                onPress={() => void client.save()}
              />
            ) : undefined
          }
        >
          {collection.confirmation ? (
            <View>
              {collection.confirmation.items.map((item, index) => {
                const allocation = collection.reviews.find(
                  (review) => review.draft.id === item.draft.id,
                )?.allocation;
                const detail = [
                  item.draft.values?.date
                    ? recentDay(expenseLocalDate(item.draft.values.date))
                    : null,
                  item.draft.preparedBy.kind === 'assistant'
                    ? `Prepared by ${item.draft.preparedBy.name}`
                    : 'Set aside by you',
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <View key={item.draft.id}>
                    {index > 0 && <Divider inset={0} />}
                    <SheetLine
                      title={item.draft.values?.description || 'Expense'}
                      detail={detail}
                      amount={amountLabel(item.draft.values, own?.currency)}
                    />
                    {allocation && (
                      // The signed-in member is "You", as on Add expense (#434).
                      <View style={{ gap: 2, paddingBottom: 8 }}>
                        {allocation.paidBy.map((row) => (
                          <CompactText key={`paid:${row.user}`} variant="caption" tone="secondary">
                            {name(row.user)} paid {formatCurrency(row.amount, allocation.currency)}
                          </CompactText>
                        ))}
                        {allocation.splitBetween.map((row) => (
                          <CompactText
                            key={`shared:${row.user}`}
                            variant="caption"
                            tone="secondary"
                          >
                            {name(row.user)} {row.user === state.auth.user?.id ? 'share' : 'shares'}{' '}
                            {formatCurrency(row.amount, allocation.currency)}
                          </CompactText>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 12,
                  borderTopWidth: 1,
                  borderTopColor: theme.borderStrong,
                  marginTop: 4,
                  paddingTop: 10,
                }}
              >
                <CompactText weight="semibold" accessibilityRole="header">
                  Total
                </CompactText>
                <View style={{ alignItems: 'flex-end' }}>
                  {collection.confirmation.totals.map((total) => (
                    <Money key={total.currency} numberOfLines={0}>
                      {total.formatted}
                    </Money>
                  ))}
                </View>
              </View>
              <CompactText variant="small" tone="secondary" style={{ paddingTop: 12 }}>
                Balances there will change for everyone
              </CompactText>
            </View>
          ) : null}
        </BottomSheet>
        <BottomSheet
          visible={collection.resultsVisible}
          title="After saving"
          subtitle={results.label || 'Check each item below'}
          onDone={() => client.closeResults()}
          dismissible={!collection.busy}
          footer={
            collection.pending ||
            collection.outcomes.some((outcome) => outcome.status === 'unresolved') ? (
              <CompactButton
                label="Check again"
                block
                disabled={collection.busy || state.offline}
                onPress={() => void client.retry()}
              />
            ) : undefined
          }
        >
          <View>
            {collection.outcomes.map((outcome, index) => {
              const outcomeName = collection.outcomeNames[outcome.id] || 'Expense';
              const saved = outcome.status === 'saved';
              return (
                <View key={outcome.id}>
                  {index > 0 && <Divider inset={40} />}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: 12,
                      paddingVertical: 10,
                    }}
                  >
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: saved ? theme.positive.bg : theme.warning.bg,
                      }}
                    >
                      <Icon
                        name={saved ? 'checkmark' : 'alert-outline'}
                        size={16}
                        color={saved ? theme.status.positive : theme.status.warning}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                      <CompactText weight="semibold">{outcomeName}</CompactText>
                      <CompactText variant="small" tone={saved ? 'positive' : 'warning'}>
                        {saved
                          ? 'Saved'
                          : outcome.status === 'unresolved'
                            ? unconfirmedMessage
                            : /changed|revision|version|stale|conflict/i.test(outcome.message)
                              ? 'Changed since you checked'
                              : `Couldn’t save: ${memberMessage(outcome.message)}`}
                      </CompactText>
                    </View>
                    {/* A saved item opens as the Expense it became, as on the web (#439). */}
                    {saved && (
                      <CompactButton
                        label="View"
                        accessibilityLabel={`View ${outcomeName}`}
                        variant="tonal"
                        dense
                        disabled={collection.busy}
                        onPress={() => {
                          client.closeResults();
                          controller.closeToReview();
                          void controller.openExpense(groupId, outcome.expenseId);
                        }}
                      />
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </BottomSheet>
      </SafeAreaView>
    </Modal>
  );
}
