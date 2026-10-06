import { Fragment, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { getCategory } from '@splitbook/shared/categories';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { readExpenseMoney } from '@splitbook/shared/expense-money-edit';
import {
  draftFromExpense,
  expenseMoney,
  type ExpenseEditor as Editor,
} from '../data/expense-draft';
import type { ExpenseHistoryState } from '../data/activity';
import {
  describeExpenseEvents,
  describeExpenseHistory,
  type ExpenseHistoryChange,
} from '../data/expense-history';
import { canEditExpense, storedExpenseMoney, type ExpenseRecord } from '../data/expense-record';
import {
  expenseRecordPosition,
  type ExpenseRecordPosition,
} from '@splitbook/shared/expense-position';
import { clockTime } from './activity-format';
import {
  Badge,
  Banner,
  BottomSheet,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  FadeIn,
  IconButton,
  IconTile,
  ListRow,
  Money,
  SectionHeader,
  Skeleton,
  SkeletonOf,
  SkeletonText,
  TopBar,
  unshared,
  useLargeText,
  type BadgeTone,
  type Reveal,
} from './compact';
import { WhoOwesWhat, sharesDifferNote } from './expense-form';
import type { MobileExpense } from '../data/types';
import { savingNeedsConnection } from './offline-notice';
import { Copy, Icon, Label, Panel, type IconName } from './primitives';
import { fonts, useTheme } from './theme';

const categoryIcons: Record<string, IconName> = {
  food: 'restaurant-outline',
  transport: 'car-outline',
  accommodation: 'bed-outline',
  travel: 'airplane-outline',
  entertainment: 'film-outline',
  shopping: 'bag-handle-outline',
  housing: 'home-outline',
  health: 'medkit-outline',
  education: 'school-outline',
};

/** "Tue, Sep 29, 2026", as the record's second line starts. */
const recordDay = (date: string | Date) =>
  new Date(date).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** The record's badge for the member's position: "You lent Sam ₹5.00", "You paid your share". */
function positionLabel(position: ExpenseRecordPosition, other: string, amount: string) {
  if (position.kind === 'owe') return `You owe ${other}${amount}`;
  if (position.kind === 'lent') return `You lent ${other}${amount}`;
  return position.kind === 'even' ? 'You paid your share' : 'You’re not involved';
}

/** "29 Sep, 20:02", with the year when it isn't this year. */
function recordTime(iso: string, now = Date.now()) {
  const date = new Date(iso);
  const day = date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${day}, ${clockTime(iso)}`;
}

/**
 * A saved Expense, read-only: what it was for, the member's position, who owes what, its
 * details and its history. Edit is in the top bar and Delete in ⋮, behind the existing
 * confirmation. While the Group holds another draft, both wait for it.
 */
export function ExpenseRecordScreen({
  state,
  currentUserId,
  notice,
  offline = false,
  onClose,
  onEdit,
  onReviewDelete,
  onDelete,
  onCancelDelete,
  onResume,
  onRefresh,
  onLoadOlderHistory,
  onRetryHistory,
  reveal = null,
}: {
  state: Editor;
  currentUserId?: string;
  notice?: ReactNode;
  /** Deleting needs a connection: the confirmation stays open, with Delete unavailable. */
  offline?: boolean;
  /** Back: returns to the Group destination the record opened from. */
  onClose?: () => void;
  onEdit: () => void;
  onReviewDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  /** Opens the Group's draft that holds Edit and Delete. */
  onResume: () => void;
  onRefresh: () => void;
  onLoadOlderHistory?: () => void;
  /** Reads the Expense's changes again after they couldn't be read. */
  onRetryHistory?: () => void;
  /** The record fades in where its skeleton was, when it opened over one. */
  reveal?: Reveal | null;
}) {
  const theme = useTheme();
  const [options, setOptions] = useState(false);
  const record = state.draft!.original!;
  const { context } = state;
  const members = context?.group.members.map(({ user }) => user) ?? [];
  const name = (id: string) =>
    members.find((member) => member.id === id)?.name ??
    [...record.paidBy, ...record.splitBetween].find((row) => row.user === id)?.name ??
    'Former member';
  const draft = draftFromExpense(record);
  // The stored allocation as saved: its rounding is never recalculated. Parsing already
  // checked it, so this only keeps the record readable if it still can't be read.
  let allocation: ReturnType<typeof expenseMoney> | null;
  try {
    allocation = expenseMoney(draft);
  } catch {
    allocation = null;
  }
  const money = (minor: number) =>
    formatCurrency(toMajorAmount(minor, record.currency), record.currency);
  const people = allocation
    ? [...new Set([...allocation.paidBy, ...allocation.splitBetween].map((row) => row.user))]
    : [];
  /** A current member's first name, unless someone else here shares it. */
  const shortName = (id: string) => {
    const full = name(id);
    const first = full.split(' ')[0];
    const shared = people.some((other) => other !== id && name(other).split(' ')[0] === first);
    return members.some((member) => member.id === id) && !shared ? first : full;
  };
  const position =
    allocation && currentUserId ? expenseRecordPosition(allocation, currentUserId) : null;
  const other = position?.counterpartyId ? `${shortName(position.counterpartyId)} ` : '';
  const badge: { label: string; tone: BadgeTone; icon?: IconName } | null = record.isDeleted
    ? { label: 'Deleted', tone: 'neutral', icon: 'trash-outline' }
    : !position
      ? null
      : {
          label: positionLabel(position, other, money(position.amountMinor)),
          tone:
            position.kind === 'owe'
              ? 'negative'
              : position.kind === 'lent'
                ? 'positive'
                : 'neutral',
        };
  const tag =
    context?.tags.find((item) => item.id === record.tagId)?.name ??
    (record.tag || 'Historical Tag');
  const date = recordDay(record.date);
  const category = record.category !== 'other' ? getCategory(record.category)?.label : undefined;
  const editable = canEditExpense(record);
  // The Group's draft holds Edit and Delete; the record itself stays readable.
  const held = state.groupDraft ? 'Finish or discard the draft in this Group first.' : undefined;
  const editReason =
    held ??
    (editable
      ? undefined
      : 'This Expense includes a member whose account is no longer available, so it can’t be edited.');
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar
        title="Expense"
        subtitle={context?.group.name}
        leading={
          onClose
            ? {
                kind: 'back',
                label:
                  state.returnTo?.destination === 'activity' ? 'Back to Activity' : 'Back to Group',
                onPress: onClose,
              }
            : undefined
        }
        actions={
          <>
            {!record.isDeleted ? (
              <CompactButton
                label="Edit"
                accessibilityLabel="Edit expense"
                icon="pencil-outline"
                variant="text"
                disabled={!!editReason}
                hint={editReason}
                onPress={onEdit}
              />
            ) : null}
            <IconButton
              icon="ellipsis-vertical-outline"
              label="Expense options"
              onPress={() => setOptions(true)}
            />
          </>
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
      >
        {notice}
        <FadeIn reveal={reveal} style={{ gap: 12 }}>
          {state.groupDraft ? (
            <Banner
              tone="info"
              message="This Group has an unfinished draft. Finish or discard it to edit or delete this Expense."
            >
              <CompactButton label="Resume draft" variant="text" dense onPress={onResume} />
            </Banner>
          ) : null}
          {state.message && state.status !== 'delete-review' ? (
            <CompactText variant="small" accessibilityRole="alert">
              {state.message}
            </CompactText>
          ) : null}
          <Card padded>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconTile icon={categoryIcons[record.category] ?? 'receipt-outline'} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <CompactText variant="heading" accessibilityRole="header">
                  {record.description}
                </CompactText>
                <CompactText
                  variant="small"
                  tone="secondary"
                  accessibilityLabel={`${date}, Tag ${tag}`}
                >
                  {date} · {tag}
                </CompactText>
              </View>
            </View>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginTop: 12,
              }}
            >
              {/* Shrinks to fit rather than cutting the amount short. */}
              <Money size="form" adjustsFontSizeToFit>
                {allocation
                  ? money(allocation.amountMinor)
                  : formatCurrency(record.amount, record.currency)}
              </Money>
              {badge ? <Badge label={badge.label} tone={badge.tone} icon={badge.icon} /> : null}
            </View>
            {record.isDeleted ? (
              <CompactText variant="small" tone="secondary" style={{ marginTop: 8 }}>
                This Expense was deleted. It no longer counts in balances.
              </CompactText>
            ) : !editable ? (
              <CompactText variant="small" tone="secondary" style={{ marginTop: 8 }}>
                This Expense includes a member whose account is no longer available. It can be
                deleted, but not edited.
              </CompactText>
            ) : null}
          </Card>
          <WhoOwesWhat
            draft={draft}
            allocation={allocation}
            problem="This allocation can’t be shown."
            name={name}
            currentUserId={currentUserId}
            money={money}
            saved
          />
          {category || record.notes ? (
            <Card>
              {category ? <DetailRow label="Category" value={category} /> : null}
              {category && record.notes ? <Divider /> : null}
              {record.notes ? <DetailRow label="Notes" value={record.notes} /> : null}
            </Card>
          ) : null}
          <RecordHistory
            record={record}
            history={state.history}
            currentUserId={currentUserId}
            name={name}
            people={members}
            tags={context?.tags}
            onLoadOlder={onLoadOlderHistory}
            onRetry={onRetryHistory}
          />
        </FadeIn>
      </ScrollView>
      <BottomSheet
        visible={options}
        title="Expense options"
        dismissLabel="Close Expense options"
        onDone={() => setOptions(false)}
      >
        <Card>
          <ListRow
            leading={<IconTile icon="refresh-outline" />}
            title="Refresh"
            meta="Read the latest saved version"
            onPress={() => {
              setOptions(false);
              onRefresh();
            }}
          />
          {!record.isDeleted ? (
            <>
              <Divider />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete expense"
                accessibilityHint={held ?? 'Removes it from balances; its history is kept'}
                accessibilityState={{ disabled: !!held }}
                disabled={!!held}
                onPress={() => {
                  setOptions(false);
                  onReviewDelete();
                }}
                style={({ pressed }) => ({
                  opacity: held ? 0.45 : 1,
                  backgroundColor: pressed ? theme.surfaceMuted : undefined,
                })}
              >
                <ListRow
                  leading={<IconTile icon="trash-outline" tone="warning" />}
                  title="Delete expense"
                  meta={held ?? 'Removes it from balances; its history is kept'}
                />
              </Pressable>
            </>
          ) : null}
        </Card>
      </BottomSheet>
      <BottomSheet
        visible={state.status === 'delete-review'}
        title="Delete this Expense?"
        doneLabel="Cancel"
        dismissLabel="Cancel, keeping this Expense"
        onDone={onCancelDelete}
      >
        <CompactText>
          {record.description} will no longer count in balances. Its history is kept.
        </CompactText>
        {state.message ? (
          <CompactText variant="small" tone="negative" accessibilityRole="alert">
            {state.message}
          </CompactText>
        ) : null}
        <CompactButton
          label="Delete expense"
          block
          disabled={offline}
          hint={offline ? savingNeedsConnection : undefined}
          onPress={onDelete}
        />
        {offline ? (
          <CompactText variant="small" tone="secondary">
            {savingNeedsConnection}
          </CompactText>
        ) : null}
      </BottomSheet>
    </View>
  );
}

/**
 * What a list row already says about the record it opens, so the record's skeleton takes the
 * record's shape: its texts, where they wrap, and how many rows follow.
 */
export interface RecordOutline {
  description: string;
  /** The second line: "Tue, Sep 29, 2026 · Utilities". */
  meta: string;
  amount: string;
  /** The member's position, as the record's badge words it; null when it has none. */
  badge: string | null;
  /**
   * The people in Who owes what, the member first, with what each paid (null for nothing, shown
   * as "–") and their share, as the record writes them.
   */
  people: { paid: string | null; share: string }[];
  /** An equal split whose shares differ by the smallest unit: its note follows the people. */
  sharesDiffer: boolean;
  /** A Category row follows Who owes what. */
  category: boolean;
  /** History says when it was last changed, as well as when it was added. */
  changed: boolean;
}

/**
 * Where nothing is known, as when an Expense opens from Activity: a typical record, an amount
 * and badge of everyday length, two people and both History times, so the shape is close.
 */
const typicalRecord: RecordOutline = {
  description: 'Weekly groceries',
  meta: 'Tue, Sep 29, 2026 · Groceries',
  amount: '₹2,400.00',
  badge: 'You lent Sam ₹1,200.00',
  people: [
    { paid: '₹2,400.00', share: '₹1,200.00' },
    { paid: null, share: '₹1,200.00' },
  ],
  sharesDiffer: false,
  category: false,
  changed: true,
};

/** The outline of the record a list row opens, from what the row already holds. */
export function recordOutline(expense: MobileExpense, currentUserId?: string): RecordOutline {
  const rows = (list: MobileExpense['paidBy']) =>
    list.map(({ user, amountMinor }) => ({ user: user.id, amountMinor }));
  const paid = new Map(expense.paidBy.map(({ user, amountMinor }) => [user.id, amountMinor]));
  const share = new Map(
    expense.splitBetween.map(({ user, amountMinor }) => [user.id, amountMinor]),
  );
  // As Who owes what orders them: the member first, then everyone else in the split's order.
  const people = [...new Set([...share.keys(), ...paid.keys()])].sort(
    (a, b) => Number(b === currentUserId) - Number(a === currentUserId),
  );
  const shares = [...share.values()];
  const position = currentUserId
    ? expenseRecordPosition(
        {
          paidBy: rows(expense.paidBy),
          splitBetween: rows(expense.splitBetween),
        },
        currentUserId,
      )
    : null;
  const counterparty = [...expense.paidBy, ...expense.splitBetween].find(
    ({ user }) => user.id !== null && user.id === position?.counterpartyId,
  )?.user.name;
  const money = (minor: number) =>
    formatCurrency(toMajorAmount(minor, expense.currency), expense.currency);
  return {
    description: expense.description,
    meta: `${recordDay(expense.date)} · ${expense.tag || 'Historical Tag'}`,
    amount: money(expense.amountMinor),
    badge:
      position === null
        ? null
        : positionLabel(
            position,
            counterparty ? `${counterparty.split(' ')[0]} ` : '',
            money(position.amountMinor),
          ),
    people: people.map((id) => ({
      paid: paid.has(id) ? money(paid.get(id)!) : null,
      share: money(share.get(id) ?? 0),
    })),
    sharesDiffer:
      expense.splitMethod === 'equal' &&
      shares.length > 1 &&
      Math.max(...shares) !== Math.min(...shares),
    category: expense.category !== 'other' && !!getCategory(expense.category)?.label,
    changed: expense.updatedAt.getTime() !== expense.createdAt.getTime(),
  };
}

/**
 * The record's shape while it opens, laid out as the record lays itself out at this text size,
 * so the record takes its place without moving: its summary card with the texts a list row
 * already knows (unseen, under breathing blocks), Who owes what with its people and any
 * rounding note, a Category row, and History with its times and the line that loads the rest.
 * `outline` comes from the list row it opened from; without one, a typical record stands in.
 * Announced as busy under `label`.
 */
export function ExpenseRecordSkeleton({
  label,
  outline,
}: {
  label: string;
  outline?: RecordOutline | null;
}) {
  const record = outline ?? typicalRecord;
  const theme = useTheme();
  const large = useLargeText();
  const { width } = useWindowDimensions();
  // As Who owes what decides: amounts sit under each name at large text or on a narrow screen.
  const stacked = large || width < 360;
  // As Who owes what shows them: three, then Show all, past four people.
  const shown = record.people.length > 4 ? record.people.slice(0, 3) : record.people;
  const history = record.changed ? 2 : 1;
  return (
    <View
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      style={{ gap: 12 }}
    >
      <Card padded>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Skeleton width={40} height={40} rounded={12} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <SkeletonOf bar>
              <CompactText variant="heading">{unshared(record.description)}</CompactText>
            </SkeletonOf>
            <SkeletonOf bar>
              <CompactText variant="small">{unshared(record.meta)}</CompactText>
            </SkeletonOf>
          </View>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 12,
          }}
        >
          <SkeletonOf bar align="center">
            <Money size="form">{unshared(record.amount)}</Money>
          </SkeletonOf>
          {record.badge ? (
            <SkeletonOf rounded={999} align="center">
              <Badge label={unshared(record.badge)} />
            </SkeletonOf>
          ) : null}
        </View>
      </Card>
      <Card>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingHorizontal: 14,
            paddingTop: 12,
          }}
        >
          <Skeleton width="32%" line="overline" />
          <Skeleton width="24%" line="caption" />
        </View>
        {stacked ? (
          <View style={{ height: 6 }} />
        ) : (
          <View
            style={{
              alignItems: 'flex-end',
              paddingHorizontal: 14,
              paddingTop: 6,
            }}
          >
            <Skeleton width={148} line="caption" />
          </View>
        )}
        {shown.map((person, index) => (
          <View
            key={index}
            style={{
              minHeight: 48,
              justifyContent: 'center',
              gap: 2,
              paddingHorizontal: 14,
              paddingVertical: stacked ? 6 : 4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Skeleton width={26} height={26} rounded={9} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Skeleton width="45%" line="body" />
              </View>
              {stacked ? null : <Skeleton width={148} line="table" />}
            </View>
            {stacked ? (
              // Their amounts, under the name, wrap as the record's do: these are its texts.
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  columnGap: 16,
                  rowGap: 2,
                  paddingLeft: 36,
                }}
              >
                {(
                  [
                    ['Paid', person.paid],
                    ['Share', person.share],
                  ] as const
                ).map(([label, amount]) => (
                  <SkeletonOf key={label} bar>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                      <CompactText variant="caption">{unshared(label)}</CompactText>
                      {amount === null ? (
                        <CompactText>{unshared('–')}</CompactText>
                      ) : (
                        <Money size="table" numberOfLines={0}>
                          {unshared(amount)}
                        </Money>
                      )}
                    </View>
                  </SkeletonOf>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        {record.people.length > 4 ? <View style={{ height: 44 }} /> : null}
        {record.sharesDiffer ? (
          <View
            style={{
              marginTop: 4,
              borderTopWidth: 1,
              borderTopColor: theme.border,
              padding: 14,
              gap: 4,
            }}
          >
            <SkeletonOf bar>
              <CompactText variant="caption">{unshared(sharesDifferNote)}</CompactText>
            </SkeletonOf>
          </View>
        ) : (
          <View style={{ height: 8 }} />
        )}
      </Card>
      {record.category ? (
        <Card>
          <View
            style={{
              minHeight: 48,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Skeleton width="28%" line="small" />
            <Skeleton width="32%" line="body" />
          </View>
        </Card>
      ) : null}
      <View style={{ gap: 8 }}>
        <View
          style={{
            minHeight: 32,
            justifyContent: 'center',
            paddingHorizontal: 2,
          }}
        >
          <Skeleton width="18%" line="overline" />
        </View>
        <Card>
          {Array.from({ length: history }, (_, row) => (
            <View key={row}>
              {row > 0 ? <Divider inset={58} /> : null}
              <View
                style={{
                  minHeight: 60,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                }}
              >
                <Skeleton width={32} height={32} rounded={11} />
                <SkeletonText
                  style={{ flex: 1 }}
                  gap={2}
                  lines={[
                    { width: '55%', line: 'body' },
                    { width: '35%', line: 'caption' },
                  ]}
                />
              </View>
            </View>
          ))}
        </Card>
        {/* The line that loads the rest of History, as the record shows it while it does. */}
        <View
          style={{
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Skeleton width="55%" line="body" />
        </View>
      </View>
    </View>
  );
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <CompactText variant="small" tone="secondary">
        {label}
      </CompactText>
      <CompactText style={{ flexShrink: 1, textAlign: 'right' }}>{value}</CompactText>
    </View>
  );
}

/**
 * This Expense's changes, newest first, with who made them and their before and after values.
 * Until they're read, and when they can't be, it says when the Expense was added and last
 * changed; older changes load on request.
 */
function RecordHistory({
  record,
  history,
  currentUserId,
  name,
  people,
  tags,
  onLoadOlder,
  onRetry,
}: {
  record: ExpenseRecord;
  history: ExpenseHistoryState;
  currentUserId?: string;
  name: (id: string) => string;
  people: { id: string; name: string }[];
  tags?: { id: string; name: string }[];
  onLoadOlder?: () => void;
  onRetry?: () => void;
}) {
  const theme = useTheme();
  const read = history.status === 'ready' && history.expenseId === record._id;
  const events = read
    ? describeExpenseEvents(history.events, record, { currentUserId, people, tags })
    : [];
  const more =
    read && !!history.pagination && history.pagination.page < history.pagination.totalPages;
  const creator = record.createdBy;
  const creatorId = typeof creator === 'object' && creator ? creator._id : creator;
  const creatorName =
    typeof creator === 'object' && creator
      ? (creator.name ?? 'Former member')
      : creatorId
        ? name(creatorId)
        : null;
  // The record's own times stand in until its changes are read; the oldest page may also
  // lack the event that added it, for an Expense older than Activity.
  const times = !events.length;
  const added = times || (!more && !history.events.some((event) => event.type === 'expense_added'));
  const progress = (label: string) => (
    <View
      accessibilityLiveRegion="polite"
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
      }}
    >
      <ActivityIndicator color={theme.brand.main} />
      <CompactText tone="secondary">{label}</CompactText>
    </View>
  );
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title="History" />
      <Card>
        {events.map((event, index) => (
          <Fragment key={event.key}>
            {index > 0 ? <Divider inset={58} /> : null}
            <HistoryRow
              icon="create-outline"
              actor={{ name: event.name, label: event.actor }}
              title={event.action}
              changes={event.changes}
              implied={event.implied}
              time={event.at}
            />
          </Fragment>
        ))}
        {times && record.isDeleted ? (
          <>
            <HistoryRow
              icon="trash-outline"
              title="Deleted"
              time={record.deletedAt ?? record.updatedAt}
            />
            <Divider inset={58} />
          </>
        ) : times && record.updatedAt !== record.createdAt ? (
          <>
            <HistoryRow icon="time-outline" title="Last changed" time={record.updatedAt} />
            <Divider inset={58} />
          </>
        ) : null}
        {added ? (
          <>
            {times ? null : <Divider inset={58} />}
            <HistoryRow
              icon="add-outline"
              actor={
                creatorName
                  ? { name: creatorName, label: creatorId === currentUserId ? 'You' : creatorName }
                  : undefined
              }
              title={creatorName ? 'added this Expense' : 'Added'}
              time={record.createdAt}
            />
          </>
        ) : null}
      </Card>
      {history.status === 'loading' ? (
        progress('Loading this Expense’s changes…')
      ) : history.status === 'error' ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 }}
        >
          <CompactText variant="small" tone="secondary" style={{ flexShrink: 1 }}>
            {history.message ?? 'Couldn’t load this Expense’s changes.'}
          </CompactText>
          {onRetry ? (
            <CompactButton
              label="Try again"
              accessibilityLabel="Try loading this Expense’s changes again"
              variant="text"
              dense
              onPress={onRetry}
            />
          ) : null}
        </View>
      ) : more && history.moreStatus === 'loading' ? (
        progress('Loading older changes…')
      ) : more && onLoadOlder ? (
        <>
          {history.moreStatus === 'error' ? (
            <CompactText variant="small" tone="negative" accessibilityRole="alert">
              Couldn’t load older changes. The changes shown are still here.
            </CompactText>
          ) : null}
          <CompactButton
            label={
              history.moreStatus === 'error' ? 'Try loading older changes' : 'Load older changes'
            }
            variant="tonal"
            block
            onPress={onLoadOlder}
          />
        </>
      ) : null}
    </View>
  );
}

const moneyFace = { fontFamily: fonts.mono, fontVariant: ['tabular-nums' as const] };

/** "Amount ₹899.00 → ₹999.00", or only the values when the row's title names the change. */
function ChangeText({
  change,
  implied = false,
}: {
  change: ExpenseHistoryChange;
  implied?: boolean;
}) {
  // Only amounts are in the money face; a word such as "Not included" stays in the text face.
  const before = change.money?.before ? moneyFace : undefined;
  const after = change.money?.after ? moneyFace : undefined;
  return (
    <>
      {implied ? null : `${change.label} `}
      {change.before !== undefined && change.after !== undefined ? (
        <>
          <Text style={before}>{change.before}</Text>
          {' → '}
          <Text style={after}>{change.after}</Text>
        </>
      ) : change.after !== undefined ? (
        <Text style={after}>{change.after}</Text>
      ) : (
        'changed'
      )}
    </>
  );
}

const spokenChange = ({ label, before, after }: ExpenseHistoryChange) =>
  before !== undefined && after !== undefined
    ? `${label} from ${before} to ${after}`
    : after !== undefined
      ? `${label} ${after}`
      : `${label} changed`;

/**
 * "{actor} {title}" with what changed and its time; a row without an actor leads with an icon.
 * One change shares the time's line, as in "₹2,680.00 → ₹2,860.00 · 29 Sep, 21:10".
 */
function HistoryRow({
  actor,
  icon,
  title,
  changes = [],
  implied = false,
  time,
}: {
  actor?: { name: string; label: string };
  icon: IconName;
  title: string;
  changes?: ExpenseHistoryChange[];
  implied?: boolean;
  time: string;
}) {
  const theme = useTheme();
  const when = recordTime(time);
  return (
    <View
      accessible
      accessibilityLabel={[
        actor ? `${actor.label} ${title}` : title,
        ...changes.map(spokenChange),
        when,
      ].join(', ')}
      style={{
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 14,
      }}
    >
      {actor ? (
        <CompactAvatar name={actor.name} />
      ) : (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.surfaceMuted,
          }}
        >
          <Icon name={icon} size={18} color={theme.textSecondary} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <CompactText>
          {actor ? (
            <>
              <Text style={{ fontFamily: fonts.semibold }}>{actor.label}</Text> {title}
            </>
          ) : (
            title
          )}
        </CompactText>
        {changes.length > 1
          ? changes.map((change, index) => (
              <CompactText key={`${change.label}:${index}`} variant="caption" tone="secondary">
                <ChangeText change={change} />
              </CompactText>
            ))
          : null}
        <CompactText variant="caption" tone="secondary">
          {changes.length === 1 ? (
            <>
              <ChangeText change={changes[0]} implied={implied} />
              {' · '}
            </>
          ) : null}
          {when}
        </CompactText>
      </View>
    </View>
  );
}

/** Authoritative saved values, also used beside an unchanged draft during conflict review. */
export function ExpenseRecordView({
  record,
  title = 'Saved Expense',
  people,
  tags,
}: {
  record: ExpenseRecord;
  title?: string;
  /** The Group's current members and Tags, so history can name them. */
  people?: { id: string; name: string }[];
  tags?: { id: string; name: string }[];
}) {
  const theme = useTheme();
  const history = describeExpenseHistory(record, people, tags);
  const money = readExpenseMoney(storedExpenseMoney(record));
  const amount = (value: number) => formatCurrency(value, record.currency);
  const name = (id: string) =>
    [...record.paidBy, ...record.splitBetween].find((row) => row.user === id)?.name ??
    'Former member';
  return (
    <Panel>
      <Label>{title}</Label>
      <Copy
        accessibilityRole="header"
        style={{ fontFamily: fonts.semibold, fontSize: 24, lineHeight: 32 }}
      >
        {record.description}
      </Copy>
      <Copy style={{ fontFamily: fonts.mono }}>
        {amount(money.amount)} · {record.currency}
      </Copy>
      <Copy>
        {new Date(record.date).toLocaleDateString()} · {record.category}
      </Copy>
      <Copy>Tag: {record.tag || 'Historical Tag'}</Copy>
      {record.notes ? <Copy>Notes: {record.notes}</Copy> : null}
      {record.isDeleted ? <Copy accessibilityRole="alert">This Expense is deleted.</Copy> : null}
      <Copy style={{ fontFamily: fonts.semibold }}>Paid by</Copy>
      {money.paidBy.map((row) => (
        <Copy key={row.user}>
          {name(row.user)} · {amount(row.amount)}
        </Copy>
      ))}
      <Copy style={{ fontFamily: fonts.semibold }}>Allocated · {record.splitMethod}</Copy>
      {money.splitBetween.map((row) => (
        <Copy key={row.user}>
          {name(row.user)} · {amount(row.amount)}
          {row.percentage !== undefined ? ` · ${row.percentage}%` : ''}
          {row.shares !== undefined ? ` · ${row.shares} shares` : ''}
        </Copy>
      ))}
      <Copy>
        Created {new Date(record.createdAt).toLocaleString()}
        {record.createdBy
          ? ` by ${typeof record.createdBy === 'object' ? (record.createdBy.name ?? 'Former member') : name(record.createdBy)}`
          : ''}
      </Copy>
      {record.predefinedItem ? <Copy>Item: {record.predefinedItem}</Copy> : null}
      {record.receiptUrl ? <Copy>Receipt: {record.receiptUrl}</Copy> : null}
      {record.recurringExpense ? (
        <Copy>Recurring Expense{record.period ? ` · ${record.period}` : ''}</Copy>
      ) : null}
      {record.deletedAt ? <Copy>Deleted {new Date(record.deletedAt).toLocaleString()}</Copy> : null}
      <Copy>Revision {record.revision}</Copy>
      <Copy>Last updated {new Date(record.updatedAt).toLocaleString()}</Copy>
      <View style={{ gap: 12 }}>
        <Copy accessibilityRole="header" style={{ fontFamily: fonts.semibold }}>
          Edit history
        </Copy>
        {!history.length ? (
          <Copy>No recorded edits.</Copy>
        ) : (
          history.map((entry) => (
            <View key={entry.key} style={{ gap: 4 }}>
              <Copy style={{ fontFamily: fonts.semibold }}>{entry.summary}</Copy>
              {entry.changes.map((change, index) => (
                <Copy
                  key={`${change.label}:${index}`}
                  accessibilityLabel={
                    change.before && change.after
                      ? `${change.label} changed from ${change.before} to ${change.after}`
                      : undefined
                  }
                >
                  {change.label}
                  {change.before && change.after ? (
                    <>
                      {': '}
                      <Copy style={change.money?.before ? { fontFamily: fonts.mono } : undefined}>
                        {change.before}
                      </Copy>
                      {' → '}
                      <Copy style={change.money?.after ? { fontFamily: fonts.mono } : undefined}>
                        {change.after}
                      </Copy>
                    </>
                  ) : change.after ? (
                    `: ${change.after}`
                  ) : (
                    ' changed'
                  )}
                </Copy>
              ))}
              <Copy style={{ color: theme.textSecondary, fontSize: 13 }}>{entry.editedAt}</Copy>
            </View>
          ))
        )}
      </View>
    </Panel>
  );
}
