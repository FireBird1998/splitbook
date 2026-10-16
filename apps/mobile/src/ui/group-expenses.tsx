import { sameSelection } from './use-mobile-snapshot';
import { ListDayHeader } from './list-day-header';
import type { RowPlaces } from './return-scroll';
import { GroupLedgerList, type LedgerScrollProps } from './group-ledger-list';
import { ledgerItems } from './ledger-items';
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { currentMonthKey, shiftMonthKey } from '@splitbook/shared/date';
import { mobileExpensePosition } from '../data/expense-position';
import type {
  ExpenseWindowSummary,
  GroupFinancialState,
  KeptDraft,
  MobileExpense,
  MobileGroup,
} from '../data/types';
import {
  Banner,
  Card,
  CompactButton,
  CompactText,
  Divider,
  IconButton,
  IconTile,
  ListRow,
  Money,
  RowAmount,
  Skeleton,
  SkeletonText,
  SummaryStats,
  type SummaryStat,
  useLargeText,
  useReveal,
} from './compact';
import { ReadTime, RetainedNotice } from './financial-views';
import { NotAvailableOffline } from './offline-notice';
import type { IconName } from './primitives';
import { useTheme } from './theme';

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

/** "September 2026", or "All time". */
export function monthLabel(month: string | null) {
  return month
    ? new Date(`${month}-01T12:00:00`).toLocaleDateString('en', { month: 'long', year: 'numeric' })
    : 'All time';
}

const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** "Today · Wed 30 Sep", or "Tue 29 Sep", with the year when it isn't this year. */
export function expenseDayLabel(date: Date, now: number) {
  const today = new Date(now);
  const label = date.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
  return localDayKey(date) === localDayKey(today) ? `Today · ${label}` : label;
}

/** Expenses keep the server's newest-first order, grouped under their local day. */
export function expenseDays(expenses: MobileExpense[], now: number) {
  const days: { key: string; label: string; expenses: MobileExpense[] }[] = [];
  for (const expense of expenses) {
    const key = localDayKey(expense.date);
    const last = days[days.length - 1];
    if (last?.key === key) last.expenses.push(expense);
    else days.push({ key, label: expenseDayLabel(expense.date, now), expenses: [expense] });
  }
  return days;
}

/** "You paid", "Sam Chen paid", or "2 people paid". */
function payers(expense: MobileExpense, currentUserId: string) {
  if (expense.paidBy.length !== 1) return `${expense.paidBy.length} people paid`;
  const [{ user }] = expense.paidBy;
  return user.id === currentUserId ? 'You paid' : `${user.name} paid`;
}

/** A row renders again only when its Expense, or whether it was just saved, changes (#219). */
const ExpenseRow = memo(function ExpenseRow({
  expense,
  currentUserId,
  saved,
  onOpen,
}: {
  expense: MobileExpense;
  currentUserId: string;
  saved: boolean;
  onOpen: (expenseId: string) => void;
}) {
  const position = mobileExpensePosition(expense, currentUserId);
  const total = formatCurrency(expense.amount, expense.currency);
  const paid = payers(expense, currentUserId);
  const effect = position
    ? `you ${position.kind} ${formatCurrency(position.amount, expense.currency)}`
    : undefined;
  return (
    <ListRow
      leading={<IconTile icon={categoryIcons[expense.category] ?? 'receipt-outline'} />}
      title={expense.description}
      meta={[paid, expense.preparedBy && `prepared by ${expense.preparedBy.name}`, expense.tag]
        .filter(Boolean)
        .join(' · ')}
      trailing={
        <RowAmount
          amount={total}
          caption={effect}
          captionTone={position?.kind === 'lent' ? 'positive' : 'negative'}
        />
      }
      highlighted={saved}
      accessibilityLabel={[
        expense.description,
        total,
        paid,
        expense.preparedBy && `prepared by ${expense.preparedBy.name}`,
        expense.tag,
        effect,
        saved ? 'just saved' : undefined,
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={() => onOpen(expense.id)}
    />
  );
});

/**
 * Previous and next Month (next stops at the current one), and All time or This month. While
 * the Group is first read (`opening`), its Month isn't known yet: the bar holds its place, with
 * its label's placeholder and nothing to press (#219).
 */
function MonthBar({
  month,
  current,
  opening = false,
  onSelectMonth,
}: {
  month: string | null;
  /** This Month's key: next stops there. */
  current: string;
  opening?: boolean;
  onSelectMonth: (month: string | null) => void;
}) {
  return (
    <View
      style={{
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingTop: 4,
      }}
    >
      <IconButton
        icon="chevron-back"
        label="Previous month"
        disabled={opening}
        onPress={() => onSelectMonth(shiftMonthKey(month ?? current, -1))}
      />
      {opening ? (
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Skeleton width="45%" line="heading" />
        </View>
      ) : (
        <CompactText
          variant="heading"
          weight="medium"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={{ flex: 1, textAlign: 'center' }}
        >
          {monthLabel(month)}
        </CompactText>
      )}
      <IconButton
        icon="chevron-forward"
        label="Next month"
        disabled={opening || month === null || month >= current}
        onPress={() => onSelectMonth(shiftMonthKey(month ?? current, 1))}
      />
      {month === null && !opening ? (
        <CompactButton label="This month" variant="text" onPress={() => onSelectMonth(current)} />
      ) : (
        <CompactButton
          label="All time"
          variant="text"
          disabled={opening}
          onPress={() => onSelectMonth(null)}
        />
      )}
    </View>
  );
}

/** Spent in the Group's currency, and the member's own share and paid amount. */
function summaryStats(summary: ExpenseWindowSummary, currentUserId: string) {
  const { currency } = summary;
  const spent = summary.totalsByCurrency.find((row) => row.currency === currency);
  const you = summary.byMember.find(({ user }) => user.id === currentUserId);
  const stats: SummaryStat[] = [
    { label: 'Spent', value: formatCurrency(spent?.totalAmount ?? 0, currency) },
    ...(you
      ? [
          { label: 'Your share', value: formatCurrency(you.share, currency) },
          { label: 'You paid', value: formatCurrency(you.paid, currency) },
        ]
      : []),
  ];
  const others = summary.totalsByCurrency
    .filter((row) => row.currency !== currency && row.totalAmount > 0)
    .map((row) => formatCurrency(row.totalAmount, row.currency));
  return { stats, others };
}

/**
 * What the window cost: a Household's Month (or All time) and every other Theme's all time.
 * It describes spending only, never running Balances, so it renders again only when what it
 * says changes, not when Balances land after the Expenses (#219).
 */
const ExpenseSummary = memo(function ExpenseSummary({
  household,
  month,
  summary,
  currentUserId,
  refreshedAt,
  restored,
  updating,
  offline,
  loading,
  opening,
  current,
  onSelectMonth,
}: {
  household: boolean;
  month: string | null;
  summary: ExpenseWindowSummary | null;
  currentUserId: string;
  refreshedAt: number | null;
  /** The figures are this device's saved copy: "Saved", not "Updated". */
  restored: boolean;
  /** A change made them out of date, and they're being read again: "Updating…". */
  updating: boolean;
  offline: boolean;
  loading: boolean;
  /** The Group is first read: its Month isn't known yet. */
  opening: boolean;
  /** This Month's key. */
  current: string;
  onSelectMonth: (month: string | null) => void;
}) {
  const figures = summary ? summaryStats(summary, currentUserId) : null;
  const large = useLargeText();
  const updated = (
    <ReadTime refreshedAt={refreshedAt} restored={restored} updating={updating} offline={offline} />
  );
  const count = summary ? `${summary.count} ${summary.count === 1 ? 'expense' : 'expenses'}` : '';
  const within = !month
    ? ''
    : month === current
      ? ' this month'
      : ` in ${new Date(`${month}-01T12:00:00`).toLocaleDateString('en', { month: 'long' })}`;
  return (
    <Card>
      {household ? (
        <MonthBar month={month} current={current} opening={opening} onSelectMonth={onSelectMonth} />
      ) : (
        <View
          style={{
            minHeight: 32,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            paddingHorizontal: 14,
            paddingTop: 12,
          }}
        >
          <CompactText variant="overline" accessibilityRole="header">
            All time
          </CompactText>
          {updated}
        </View>
      )}
      {figures ? (
        <>
          <SummaryStats stats={figures.stats} />
          {figures.others.length ? (
            <CompactText
              variant="caption"
              tone="secondary"
              style={{ paddingHorizontal: 14, marginTop: -6, paddingBottom: 10 }}
            >
              Also {figures.others.join(' · ')} in other currencies
            </CompactText>
          ) : null}
          <Divider />
          <View
            style={{
              minHeight: 40,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
          >
            <CompactText variant="small" tone="secondary">
              {count}
              {within}
            </CompactText>
            {household ? updated : null}
          </View>
        </>
      ) : loading ? (
        // The figures' shape, in their places, so they fade in without moving anything.
        <>
          <SummaryStats stats={[]} loading />
          {null}
          <Divider />
          <View
            style={{
              minHeight: 40,
              justifyContent: 'center',
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
          >
            {/* At large text a Household's count and its "Updated" time wrap onto two lines. */}
            <SkeletonText
              gap={8}
              lines={[
                { width: '40%', line: 'small' },
                ...(large && household
                  ? [{ width: '30%' as const, line: 'caption' as const }]
                  : []),
              ]}
            />
          </View>
        </>
      ) : (
        <View style={{ height: 8 }} />
      )}
    </Card>
  );
});

/** The kept draft: an ordinary one in info tone; a save that may be recorded in warning tone. */
function KeptDraftNotice({
  kept,
  onResume,
  onDiscard,
}: {
  kept: KeptDraft;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const { draft } = kept;
  const subject = draft?.description || 'This Expense';
  if (kept.unconfirmed)
    return (
      <Banner
        tone="warning"
        title="Save not confirmed"
        message={
          draft?.edit
            ? `Your change to ${subject} may already be saved. Check it first.`
            : `${subject} may already be saved. Check it before adding another.`
        }
        standing
      >
        <CompactButton label="Open to check" variant="tonal" dense onPress={onResume} />
      </Banner>
    );
  return (
    <Banner
      tone="info"
      title={draft?.description ? `Draft: ${draft.description}` : 'Unfinished draft'}
      trailing={
        draft && draft.amount !== null ? (
          <Money>{formatCurrency(draft.amount, draft.currency)}</Money>
        ) : null
      }
      message={
        draft?.edit
          ? 'Your changes are kept on this device. They haven’t been sent to the Group.'
          : 'Kept on this device. It hasn’t been sent to the Group.'
      }
    >
      <CompactButton label="Resume draft" variant="tonal" dense onPress={onResume} />
      {draft ? (
        <CompactButton
          label="Discard"
          accessibilityLabel="Discard draft"
          variant="text"
          dense
          onPress={onDiscard}
        />
      ) : null}
    </Banner>
  );
}

/**
 * The Expenses destination: the window summary (with a Household's Month bar), the Group's
 * kept draft, and its Expenses under day headings, each with what the member lent or owes.
 */
export const GroupExpensesView = memo(
  function GroupExpensesView({
    group,
    currentUserId,
    state,
    kept,
    savedExpenseId,
    offline = false,
    firstRead = false,
    now: legacyNow,
    dayKey,
    onSelectMonth,
    onRefreshExpenses,
    onLoadMore,
    onLoadNewer,
    onShift,
    onRowsLayout,
    onOpenExpense,
    onResumeDraft,
    onDiscardDraft,
    header,
    listScroll,
  }: {
    header?: ReactNode;
    listScroll?: LedgerScrollProps;
    group: MobileGroup;
    currentUserId: string;
    state: GroupFinancialState;
    /** This Group's kept draft, if any. */
    kept: KeptDraft | null;
    /** Highlighted after a save while its confirmation shows. */
    savedExpenseId: string | null;
    /** The app can't reach SplitBook: this device's saved copy shows its badge. */
    offline?: boolean;
    /**
     * The Group is first read, shown as Home lists it: these are its placeholders, in the shape
     * they keep once it answers (#219).
     */
    firstRead?: boolean;
    now?: number;
    dayKey?: string;
    onSelectMonth: (month: string | null) => void;
    onRefreshExpenses: () => void;
    onLoadMore: () => void;
    /** Reads the page before the list's window, once it has slid past its newest page (#219). */
    onLoadNewer: () => void;
    /** Scroll the view by `dy`: the rows above the one on screen changed by as much. */
    onShift?: (dy: number) => void;
    /** Current row layouts in scroll-content coordinates, for memory-only return anchors. */
    onRowsLayout?: (rows: RowPlaces) => void;
    onOpenExpense: (expenseId: string) => void;
    onResumeDraft: () => void;
    onDiscardDraft: () => void;
  }) {
    const now = dayKey ? new Date(`${dayKey}T12:00:00`).getTime() : (legacyNow ?? Date.now());
    const theme = useTheme();
    const { expenses } = state;
    // The latest handler, behind one that never changes, so no row renders again for it.
    const opening = useRef(onOpenExpense);
    useEffect(() => {
      opening.current = onOpenExpense;
    });
    const open = useCallback((expenseId: string) => opening.current(expenseId), []);
    // The same for the Month bar, so the summary renders again only when what it says changes.
    const choosing = useRef(onSelectMonth);
    useEffect(() => {
      choosing.current = onSelectMonth;
    });
    const choose = useCallback((month: string | null) => choosing.current(month), []);
    const household = group.category === 'home';
    // Never show one Month's Expenses under another Month's label.
    const current = expenses.month === state.month;
    const summary = current ? expenses.summary : null;
    const listed =
      current && (expenses.status === 'ready' || summary !== null || expenses.data.length > 0);
    // Load more stays in place, disabled, while the rows shown are read again (a pull, the
    // foreground, or the window after an edit or delete), so the list never gets shorter under the
    // member: at its end, Android would clamp the view a control's height up (#219).
    const more =
      listed &&
      (expenses.status === 'ready' || expenses.status === 'loading') &&
      expenses.pagination !== null &&
      expenses.pagination.page < expenses.pagination.totalPages;
    // The list has slid past its newest page: the pages before it are read with Load newer. It stays
    // in place, disabled, while the window is read again, so the rows below it never move (#219).
    const newer = listed && (expenses.firstPage ?? 1) > 1;

    // The virtualized cells replace one logical placeholder: share its reveal, including cells
    // mounted later by native windowing, without starting another animation for a new page.
    const reveal = useReveal(!listed && expenses.status !== 'error');
    const scope = state.month ? monthLabel(state.month) : 'all-time';
    const items = useMemo(
      () =>
        ledgerItems(
          listed
            ? expenseDays(expenses.data, now).map((day) => ({ ...day, rows: day.expenses }))
            : [],
          (expense) => expense.id,
        ),
      [listed, expenses.data, now],
    );
    const renderRow = useCallback(
      (item: (typeof items)[number]) =>
        item.kind === 'day' ? (
          <ListDayHeader label={item.label} />
        ) : (
          <ExpenseRow
            expense={item.row}
            currentUserId={currentUserId}
            saved={item.row.id === savedExpenseId}
            onOpen={open}
          />
        ),
      [currentUserId, savedExpenseId, open],
    );
    return (
      <GroupLedgerList
        {...listScroll}
        items={items}
        renderRow={renderRow}
        reveal={reveal}
        firstPage={expenses.firstPage ?? 1}
        onShift={onShift}
        onRowsLayout={onRowsLayout}
        header={
          <>
            {header}
            <ExpenseSummary
              household={household}
              month={state.month}
              summary={summary}
              currentUserId={currentUserId}
              refreshedAt={listed ? expenses.refreshedAt : null}
              restored={expenses.restored === true}
              // The rows shown are from before a change written here, and being read again.
              updating={expenses.changed === true && expenses.status === 'loading'}
              offline={offline}
              loading={!listed && expenses.status !== 'error'}
              opening={firstRead}
              current={currentMonthKey(new Date(now))}
              onSelectMonth={choose}
            />
            {listed ? (
              <RetainedNotice
                status={expenses.status}
                refreshedAt={expenses.refreshedAt}
                message={expenses.message}
                subject={`${scope} expenses`}
                retryLabel="Retry expenses"
                offline={offline}
                onRetry={onRefreshExpenses}
              />
            ) : null}
            {process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED !== 'true' &&
            kept?.groupId === group.id ? (
              <KeptDraftNotice kept={kept} onResume={onResumeDraft} onDiscard={onDiscardDraft} />
            ) : null}
            {newer
              ? pageControl({
                  which: 'newer',
                  status: expenses.newerStatus ?? 'idle',
                  disabled: expenses.status !== 'ready',
                  message: expenses.newerMessage ?? null,
                  color: theme.brand.main,
                  onPress: onLoadNewer,
                })
              : null}
          </>
        }
        empty={
          !listed ? (
            expenses.status === 'error' && offline ? (
              <NotAvailableOffline
                compact
                // True whether they were never saved here, removed by a change or a sign-out, or
                // withheld (#323): never "hasn't been opened" (#219, #280 item 2).
                message={
                  state.month
                    ? `Expenses in ${monthLabel(state.month)} aren’t saved on this phone. Connect to load them.`
                    : 'These expenses aren’t saved on this phone. Connect to load them.'
                }
                onRetry={onRefreshExpenses}
              />
            ) : expenses.status === 'error' ? (
              <View style={{ gap: 10 }}>
                <Banner
                  tone="error"
                  message={expenses.message ?? 'These expenses couldn’t be loaded. Try again.'}
                />
                <CompactButton label="Retry expenses" variant="tonal" onPress={onRefreshExpenses} />
              </View>
            ) : (
              <Card loading={`Loading ${scope} expenses`} skeleton={{ heading: true }} />
            )
          ) : (
            <Card padded>
              <CompactText weight="semibold">
                {state.month ? `No expenses in ${monthLabel(state.month)}` : 'No expenses yet'}
              </CompactText>
              <CompactText variant="small" tone="secondary">
                {state.month ? 'Try another Month or All time.' : 'Expenses you add appear here.'}
              </CompactText>
            </Card>
          )
        }
        footer={
          more
            ? pageControl({
                which: 'more',
                status: expenses.moreStatus,
                disabled: expenses.status !== 'ready',
                message: expenses.moreMessage,
                color: theme.brand.main,
                onPress: onLoadMore,
              })
            : null
        }
      />
    );
  },
  (a, b) =>
    sameSelection(
      { ...a, state: a.state.expenses, month: a.state.month },
      { ...b, state: b.state.expenses, month: b.state.month },
    ),
);

/**
 * Load more, below the list, or Load newer, above it once the list has slid past its newest
 * page (#219): loading, failed with the rows kept, or offered. TalkBack names the list.
 */
function pageControl({
  which,
  status,
  message,
  color,
  disabled = false,
  onPress,
}: {
  which: 'more' | 'newer';
  status: 'idle' | 'loading' | 'error';
  message: string | null;
  color: string;
  /** Shown but not offered: the list it adds to is being read again. */
  disabled?: boolean;
  onPress: () => void;
}) {
  if (status === 'loading')
    return (
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
        <ActivityIndicator color={color} />
        <CompactText tone="secondary">{`Loading ${which} expenses…`}</CompactText>
      </View>
    );
  return (
    <>
      {status === 'error' ? (
        <CompactText variant="small" tone="negative" accessibilityRole="alert">
          {message ?? `Couldn’t load ${which} expenses.`} The ones shown are still here.
        </CompactText>
      ) : null}
      <CompactButton
        label={status === 'error' ? `Try loading ${which}` : `Load ${which}`}
        accessibilityLabel={
          status === 'error' ? `Try loading ${which} expenses` : `Load ${which} expenses`
        }
        variant="tonal"
        block
        disabled={disabled}
        onPress={onPress}
      />
    </>
  );
}
