import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  type ExpenseHistoryEvent,
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
  StatusText,
  TopBar,
  useLargeText,
  type BadgeTone,
  type Reveal,
} from './compact';
import { WhoOwesWhat, sharesDifferNote } from './expense-form';
import { RefreshStatus } from './financial-views';
import type { MobileExpense } from '../data/types';
import { savingNeedsConnection } from './offline-notice';
import { refreshedLabel } from './refresh-feedback';
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
/** The badge's tone for the member's position: what they owe is negative, what they lent positive. */
const positionTone = (position: ExpenseRecordPosition): BadgeTone =>
  position.kind === 'owe' ? 'negative' : position.kind === 'lent' ? 'positive' : 'neutral';

/**
 * When what's shown was verified, in the body, never the top bar (#332): "Saved h:mm" for this
 * device's saved copy, the badge every saved view shows offline; "Updated h:mm" for a read in
 * this session.
 */
function ReadTime({
  refreshedAt,
  saved,
  offline,
}: {
  refreshedAt: number;
  saved: boolean;
  offline: boolean;
}) {
  const time = refreshedLabel(refreshedAt);
  if (saved && offline) return <Badge label={`Saved ${time}`} />;
  return <StatusText tone="muted">{`${saved ? 'Saved' : 'Updated'} ${time}`}</StatusText>;
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
  onLoadNewerHistory,
  onRetryHistory,
  reveal = null,
  outlined = false,
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
  /** Reads the changes before the window, once it has slid past the newest (#220). */
  onLoadNewerHistory?: () => void;
  /** Reads the Expense's changes again after they couldn't be read. */
  onRetryHistory?: () => void;
  /** The record fades in where its skeleton was, when it opened over one. */
  reveal?: Reveal | null;
  /**
   * Its skeleton showed the list row's summary: the summary card stays as it was, and only the
   * rest fades in (#220).
   */
  outlined?: boolean;
}) {
  const theme = useTheme();
  const large = useLargeText();
  const [options, setOptions] = useState(false);
  const scroll = useRef<ScrollView>(null);
  // Where the record was scrolled to, from where scrolling stopped as well as while it scrolls: a
  // throttled scroll event can miss the end of a drag or a fling (#219).
  const scrollY = useRef(0);
  // Where it was when the window of changes moved, before Android clamps the offset to a
  // shorter record: the shift that keeps the change on screen starts from there (#220).
  const firstPage = state.history.firstPage ?? 1;
  const shownFirstPage = useRef(firstPage);
  const slideFrom = useRef<number | null>(null);
  if (shownFirstPage.current !== firstPage) {
    slideFrom.current = scrollY.current;
    shownFirstPage.current = firstPage;
  }
  /** The changes above the one on screen moved by `dy`: the view follows, so it stays put. */
  const shift = (dy: number) => {
    const from = slideFrom.current ?? scrollY.current;
    slideFrom.current = null;
    scrollY.current = Math.max(0, from + dy);
    scroll.current?.scrollTo({ y: scrollY.current, animated: false });
  };
  const record = state.draft!.original!;
  const { context } = state;
  // The same list while the Group's details stay the same: History's rows are kept, not redrawn.
  const members = useMemo(() => context?.group.members.map(({ user }) => user) ?? [], [context]);
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
  /**
   * A current member's first name, unless someone else here shares it. Before the Group's details
   * are known, as for a saved copy shown at once, everyone counts as current, as the list row's
   * outline names them, so the badge's words don't change when the record is read.
   */
  const shortName = (id: string) => {
    const full = name(id);
    const first = full.split(' ')[0];
    const shared = people.some((other) => other !== id && name(other).split(' ')[0] === first);
    return (!context || members.some((member) => member.id === id)) && !shared ? first : full;
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
          tone: positionTone(position),
        };
  const tag =
    context?.tags.find((item) => item.id === record.tagId)?.name ??
    (record.tag || 'Historical Tag');
  const date = recordDay(record.date);
  const category = record.category !== 'other' ? getCategory(record.category)?.label : undefined;
  const editable = canEditExpense(record);
  // The Group's draft holds Edit and Delete; the record itself stays readable.
  const held = state.groupDraft ? 'Finish or discard the draft in this Group first.' : undefined;
  // What is said above the record: the Group's draft, a message, and when the record shown was
  // read, if it wasn't in this open.
  const readTime =
    state.known && !offline && (state.known.saved || !state.known.refreshing) ? (
      <ReadTime refreshedAt={state.known.refreshedAt} saved={state.known.saved} offline={offline} />
    ) : null;
  const lead =
    state.groupDraft || (state.message && state.status !== 'delete-review') || readTime ? (
      <>
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
        {readTime}
      </>
    ) : null;
  // The record's summary: what a list row already showed of it.
  const summary = (
    <Card padded>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile icon={categoryIcons[record.category] ?? 'receipt-outline'} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <CompactText variant="heading" accessibilityRole="header">
            {record.description}
          </CompactText>
          <CompactText variant="small" tone="secondary" accessibilityLabel={`${date}, Tag ${tag}`}>
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
          This Expense includes a member whose account is no longer available. It can be deleted,
          but not edited.
        </CompactText>
      ) : null}
    </Card>
  );
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
        // Only that it is being read again, on one line that shrinks: when it was read is in the
        // body, so the title and Group keep their room (#332, #220).
        status={
          !offline && (state.known?.refreshing || state.refreshing) ? (
            <RefreshStatus visible />
          ) : undefined
        }
        actions={
          <>
            {!record.isDeleted ? (
              <CompactButton
                label="Edit"
                accessibilityLabel="Edit expense"
                // At large text its word says it alone, so the title and Group keep their room.
                icon={large ? undefined : 'pencil-outline'}
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
        ref={scroll}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          scrollY.current = nativeEvent.contentOffset.y;
        }}
        onScrollEndDrag={({ nativeEvent }) => {
          scrollY.current = nativeEvent.contentOffset.y;
        }}
        onMomentumScrollEnd={({ nativeEvent }) => {
          scrollY.current = nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
      >
        {notice}
        {lead ? (
          <FadeIn reveal={reveal} style={{ gap: 12 }}>
            {lead}
          </FadeIn>
        ) : null}
        {/* What the list row already showed stays as it was; the rest fades in. */}
        {outlined ? summary : null}
        <FadeIn reveal={reveal} style={{ gap: 12 }}>
          {outlined ? null : summary}
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
            offline={offline}
            busy={!!state.refreshing}
            onLoadOlder={onLoadOlderHistory}
            onLoadNewer={onLoadNewerHistory}
            onRetry={onRetryHistory}
            onShift={shift}
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
  /**
   * The member's position, as the record's badge words and colours it, so it doesn't change when
   * the record lands (#220); null when it has none.
   */
  badge: { label: string; tone: BadgeTone } | null;
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
  badge: { label: 'You lent Sam ₹1,200.00', tone: 'positive' },
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
  const everyone = [...expense.paidBy, ...expense.splitBetween].map(({ user }) => user);
  const counterparty = everyone.find(
    ({ id }) => id !== null && id === position?.counterpartyId,
  )?.name;
  // Their first name, unless someone else here shares it, as the record names them.
  const first = counterparty?.split(' ')[0];
  const shared = everyone.some(
    ({ id, name }) => id !== position?.counterpartyId && name.split(' ')[0] === first,
  );
  const money = (minor: number) =>
    formatCurrency(toMajorAmount(minor, expense.currency), expense.currency);
  return {
    description: expense.description,
    meta: `${recordDay(expense.date)} · ${expense.tag || 'Historical Tag'}`,
    amount: money(expense.amountMinor),
    badge:
      position === null
        ? null
        : {
            label: positionLabel(
              position,
              counterparty ? `${shared ? counterparty : first} ` : '',
              money(position.amountMinor),
            ),
            tone: positionTone(position),
          },
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
 * so the record takes its place without moving: its summary card, Who owes what with its people
 * and any rounding note, a Category row, and History with its times and the line that loads the
 * rest. `outline` comes from the list row it opened from: what it already says of the Expense
 * shows at once (the loading-state audit, #220), and the rest breathes until the record is read.
 * Without one, a typical record stands in, unseen under breathing blocks. Announced as busy
 * under `label`.
 */
export function ExpenseRecordSkeleton({
  label,
  outline,
}: {
  label: string;
  outline?: RecordOutline | null;
}) {
  const record = outline ?? typicalRecord;
  /** A list row's text shows as it is; a typical record's breathes in its place. */
  const known = (text: ReactNode, align?: 'center') =>
    outline ? (
      text
    ) : (
      <SkeletonOf bar align={align}>
        {text}
      </SkeletonOf>
    );
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
            {known(<CompactText variant="heading">{record.description}</CompactText>)}
            {known(
              <CompactText variant="small" tone="secondary">
                {record.meta}
              </CompactText>,
            )}
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
          {known(<Money size="form">{record.amount}</Money>, 'center')}
          {record.badge ? (
            outline ? (
              <Badge label={record.badge.label} tone={record.badge.tone} />
            ) : (
              <SkeletonOf rounded={999} align="center">
                <Badge label={record.badge.label} tone={record.badge.tone} />
              </SkeletonOf>
            )
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
                      <CompactText variant="caption">{label}</CompactText>
                      {amount === null ? (
                        <CompactText>–</CompactText>
                      ) : (
                        <Money size="table" numberOfLines={0}>
                          {amount}
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
              <CompactText variant="caption">{sharesDifferNote}</CompactText>
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
 * changed. Older changes load on request; past 5 pages the window slides, and Load newer above it
 * brings the newest back (#220). The changes shown stay, marked as refreshing, while they are
 * read again, and the change on screen keeps its place when the window moves.
 */
function RecordHistory({
  record,
  history,
  currentUserId,
  name,
  people,
  tags,
  offline = false,
  busy = false,
  onLoadOlder,
  onLoadNewer,
  onRetry,
  onShift,
}: {
  record: ExpenseRecord;
  history: ExpenseHistoryState;
  currentUserId?: string;
  name: (id: string) => string;
  people: { id: string; name: string }[];
  tags?: { id: string; name: string }[];
  offline?: boolean;
  /** Try again is reading the record again: Load older and Load newer wait, in place. */
  busy?: boolean;
  onLoadOlder?: () => void;
  onLoadNewer?: () => void;
  onRetry?: () => void;
  /** Scroll the record by `dy`: the changes above the one on screen moved by as much. */
  onShift?: (dy: number) => void;
}) {
  const theme = useTheme();
  // Read, or being read again with the changes it had: those stay shown (M1-3).
  const read =
    history.expenseId === record._id && (history.status === 'ready' || history.events.length > 0);
  const refreshing = read && history.status === 'loading';
  // Described again only when the changes, the record or the names change: a slide or a refresh
  // that keeps them redraws no row (#220).
  const events = useMemo(
    () =>
      read ? describeExpenseEvents(history.events, record, { currentUserId, people, tags }) : [],
    [read, history.events, record, currentUserId, people, tags],
  );
  const more =
    read && !!history.pagination && history.pagination.page < history.pagination.totalPages;
  const newer = read && (history.firstPage ?? 1) > 1;
  // When the window moves, changes above the one on screen go or come: Load older past 5 pages
  // drops the newest page, and Load newer brings it back above. The view moves by as much as a
  // change shown on both sides of the move moved, so the change on screen keeps its place.
  const places = useRef({ list: 0, rows: new Map<string, number>() });
  const anchor = useRef<{
    id: string;
    at: number;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const firstPage = history.firstPage ?? 1;
  const shownFirst = useRef(firstPage);
  /** The changes as last shown: the window's move keeps the first of them still listed. */
  const shownEvents = useRef(history.events);
  const top = (id: string) => {
    const row = places.current.rows.get(id);
    return row === undefined ? null : places.current.list + row;
  };
  useLayoutEffect(() => {
    const moved = firstPage !== shownFirst.current;
    shownFirst.current = firstPage;
    if (anchor.current?.timer) clearTimeout(anchor.current.timer);
    if (!moved) return;
    // The first change shown before the move that is still listed: the newest one left after a
    // slide, or the one that was first before Load newer.
    const listedNow = new Set(history.events.map(({ _id }) => _id));
    const id = shownEvents.current.find(({ _id }) => listedNow.has(_id))?._id;
    // Laid out before the move: where it was.
    const at = id ? top(id) : null;
    anchor.current = id && at !== null ? { id, at } : null;
  }, [firstPage]);
  useLayoutEffect(() => {
    shownEvents.current = history.events;
  });
  /** A layout changed: once the move's layouts have all arrived, the view follows its change. */
  const place = (change: { list: number } | { row: string; y: number }) => {
    if ('list' in change) places.current.list = change.list;
    else places.current.rows.set(change.row, change.y);
    const held = anchor.current;
    if (!held || held.timer) return;
    // A layout's events arrive together: the shift waits for all of them.
    held.timer = setTimeout(() => {
      if (anchor.current === held) anchor.current = null;
      const at = top(held.id);
      if (at !== null && at !== held.at) onShift?.(at - held.at);
    }, 0);
  };
  // The same for every render, so a row that didn't change isn't drawn again (#220).
  const placing = useRef(place);
  placing.current = place;
  const placeRow = useCallback((row: string, y: number) => placing.current({ row, y }), []);
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
  /**
   * Load older, below the changes, or Load newer, above them: loading, failed, or offered. Both
   * stay in place, disabled, while the changes shown are read again, so the record never gets
   * shorter under the member. Load newer loads in its own place, busy, so the changes below it
   * don't move before its page lands (#220). A page read again that fails ends the changes
   * before it, so only Load newer's failure keeps every change shown.
   */
  const pageControl = (
    which: 'older' | 'newer',
    status: 'idle' | 'loading' | 'error',
    onPress: () => void,
  ) =>
    status === 'loading' && which === 'older' ? (
      progress('Loading older changes…')
    ) : (
      <>
        {status === 'error' ? (
          <CompactText variant="small" tone="negative" accessibilityRole="alert">
            {which === 'newer'
              ? 'Couldn’t load newer changes. The changes shown are still here.'
              : 'Couldn’t load older changes.'}
          </CompactText>
        ) : null}
        <CompactButton
          label={status === 'error' ? `Try loading ${which} changes` : `Load ${which} changes`}
          busy={status === 'loading' ? `Loading ${which} changes…` : undefined}
          variant="tonal"
          block
          disabled={refreshing || busy}
          onPress={onPress}
        />
      </>
    );
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader
        title="History"
        trailing={
          // While the changes shown are read again, only that; once their read failed, offline,
          // or from this device's copy, the oldest page's time (#220).
          !events.length ? undefined : refreshing ? (
            <RefreshStatus visible />
          ) : (offline || history.status === 'error' || history.restored) &&
            history.refreshedAt != null ? (
            <ReadTime
              refreshedAt={history.refreshedAt}
              saved={!!history.restored}
              offline={offline}
            />
          ) : undefined
        }
      />
      {newer && onLoadNewer
        ? pageControl('newer', history.newerStatus ?? 'idle', onLoadNewer)
        : null}
      {/* Where the changes lie, for the one kept on screen when the window moves (#220). */}
      <View onLayout={({ nativeEvent }) => place({ list: nativeEvent.layout.y })}>
        <Card>
          {events.map((event, index) => (
            <ChangeRow key={event.key} event={event} divider={index > 0} onPlace={placeRow} />
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
                name={creatorName ?? undefined}
                actor={
                  creatorName ? (creatorId === currentUserId ? 'You' : creatorName) : undefined
                }
                title={creatorName ? 'added this Expense' : 'Added'}
                time={record.createdAt}
              />
            </>
          ) : null}
        </Card>
      </View>
      {history.status === 'loading' && !refreshing ? (
        progress('Loading this Expense’s changes…')
      ) : history.status === 'error' ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 4,
          }}
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
      ) : more && onLoadOlder ? (
        pageControl('older', history.moreStatus, onLoadOlder)
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

/** Two descriptions of a change that say the same: its row isn't drawn again. */
const sameChange = (a: ExpenseHistoryEvent, b: ExpenseHistoryEvent) =>
  a === b ||
  (a.key === b.key &&
    a.name === b.name &&
    a.actor === b.actor &&
    a.action === b.action &&
    a.implied === b.implied &&
    a.at === b.at &&
    JSON.stringify(a.changes) === JSON.stringify(b.changes));
/**
 * One change in History, with where it lies for the change kept on screen when the window moves.
 * A slide or a refresh describes every change again; one that reads the same isn't drawn again.
 */
const ChangeRow = memo(
  function ChangeRow({
    event,
    divider,
    onPlace,
  }: {
    event: ExpenseHistoryEvent;
    divider: boolean;
    onPlace: (row: string, y: number) => void;
  }) {
    return (
      <View onLayout={({ nativeEvent }) => onPlace(event.key, nativeEvent.layout.y)}>
        {divider ? <Divider inset={58} /> : null}
        <HistoryRow
          icon="create-outline"
          name={event.name}
          actor={event.actor}
          title={event.action}
          changes={event.changes}
          implied={event.implied}
          time={event.at}
        />
      </View>
    );
  },
  (a, b) => a.divider === b.divider && a.onPlace === b.onPlace && sameChange(a.event, b.event),
);

/**
 * "{actor} {title}" with what changed and its time; a row without an actor leads with an icon.
 * One change shares the time's line, as in "₹2,680.00 → ₹2,860.00 · 29 Sep, 21:10".
 */
function HistoryRow({
  name,
  actor,
  icon,
  title,
  changes = [],
  implied = false,
  time,
}: {
  /** Who acted, for their avatar; `actor` is how the row names them ("You"). */
  name?: string;
  actor?: string;
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
        actor ? `${actor} ${title}` : title,
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
        <CompactAvatar name={name ?? actor} />
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
              <Text style={{ fontFamily: fonts.semibold }}>{actor}</Text> {title}
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
