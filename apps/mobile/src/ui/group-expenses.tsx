import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
  SkeletonText,
  SummaryStats,
  type SummaryStat,
  useLargeText,
} from './compact';
import { Freshness, RetainedNotice } from './financial-views';
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
      meta={[paid, expense.tag].filter(Boolean).join(' · ')}
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

/** Previous and next Month (next stops at the current one), and All time or This month. */
function MonthBar({
  month,
  now,
  onSelectMonth,
}: {
  month: string | null;
  now: number;
  onSelectMonth: (month: string | null) => void;
}) {
  const current = currentMonthKey(new Date(now));
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
        onPress={() => onSelectMonth(shiftMonthKey(month ?? current, -1))}
      />
      <CompactText
        variant="heading"
        weight="medium"
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={{ flex: 1, textAlign: 'center' }}
      >
        {monthLabel(month)}
      </CompactText>
      <IconButton
        icon="chevron-forward"
        label="Next month"
        disabled={month === null || month >= current}
        onPress={() => onSelectMonth(shiftMonthKey(month ?? current, 1))}
      />
      {month === null ? (
        <CompactButton label="This month" variant="text" onPress={() => onSelectMonth(current)} />
      ) : (
        <CompactButton label="All time" variant="text" onPress={() => onSelectMonth(null)} />
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
 * It describes spending only, never running Balances.
 */
function ExpenseSummary({
  household,
  month,
  summary,
  currentUserId,
  refreshedAt,
  refreshing,
  offline,
  loading,
  now,
  onSelectMonth,
}: {
  household: boolean;
  month: string | null;
  summary: ExpenseWindowSummary | null;
  currentUserId: string;
  refreshedAt: number | null;
  /** Read again while they stay on screen. */
  refreshing: boolean;
  /** The figures come from this device: "Saved", not "Updated". */
  offline: boolean;
  loading: boolean;
  now: number;
  onSelectMonth: (month: string | null) => void;
}) {
  const figures = summary ? summaryStats(summary, currentUserId) : null;
  const large = useLargeText();
  const updated = <Freshness refreshedAt={refreshedAt} refreshing={refreshing} offline={offline} />;
  const count = summary ? `${summary.count} ${summary.count === 1 ? 'expense' : 'expenses'}` : '';
  const within = !month
    ? ''
    : month === currentMonthKey(new Date(now))
      ? ' this month'
      : ` in ${new Date(`${month}-01T12:00:00`).toLocaleDateString('en', { month: 'long' })}`;
  return (
    <Card>
      {household ? (
        <MonthBar month={month} now={now} onSelectMonth={onSelectMonth} />
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
}

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
export function GroupExpensesView({
  group,
  currentUserId,
  state,
  kept,
  savedExpenseId,
  refreshing = false,
  offline = false,
  now,
  onSelectMonth,
  onRefreshExpenses,
  onLoadMore,
  onLoadNewer,
  onShift,
  onOpenExpense,
  onResumeDraft,
  onDiscardDraft,
}: {
  group: MobileGroup;
  currentUserId: string;
  state: GroupFinancialState;
  /** This Group's kept draft, if any. */
  kept: KeptDraft | null;
  /** Highlighted after a save while its confirmation shows. */
  savedExpenseId: string | null;
  /** Shown Expenses are read again: their freshness says so. */
  refreshing?: boolean;
  /** Figures come from this device's saved copy. */
  offline?: boolean;
  now: number;
  onSelectMonth: (month: string | null) => void;
  onRefreshExpenses: () => void;
  onLoadMore: () => void;
  /** Reads the page before the list's window, once it has slid past its newest page (#219). */
  onLoadNewer: () => void;
  /** Scroll the view by `dy`: the rows above the one on screen changed by as much. */
  onShift?: (dy: number) => void;
  onOpenExpense: (expenseId: string) => void;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
}) {
  const theme = useTheme();
  const { expenses } = state;
  // The latest handler, behind one that never changes, so no row renders again for it.
  const opening = useRef(onOpenExpense);
  useEffect(() => {
    opening.current = onOpenExpense;
  });
  const open = useCallback((expenseId: string) => opening.current(expenseId), []);
  // When the window moves (#219), rows above the one on screen go or come: Load more past 5
  // pages drops the newest page, and Load newer brings it back above. The view moves by as much
  // as a row shown on both sides of the change moved, so the row on screen keeps its place.
  // Where the list, each day and each row lie, as their layouts last said.
  const places = useRef({
    list: 0,
    days: new Map<string, number>(),
    rows: new Map<string, { day: string; y: number }>(),
  });
  const anchor = useRef<{ id: string; at: number; timer?: ReturnType<typeof setTimeout> } | null>(
    null,
  );
  const firstPage = expenses.firstPage ?? 1;
  const shownFirst = useRef(firstPage);
  /** The rows as last shown: the window's change keeps the first of them still listed. */
  const shownRows = useRef(expenses.data);
  const top = (id: string) => {
    const row = places.current.rows.get(id),
      day = row && places.current.days.get(row.day);
    return row && day !== undefined ? places.current.list + day + row.y : null;
  };
  useLayoutEffect(() => {
    const moved = firstPage !== shownFirst.current;
    shownFirst.current = firstPage;
    if (anchor.current?.timer) clearTimeout(anchor.current.timer);
    if (!moved) return;
    // The first row shown before the change that is still listed: the newest one left after a
    // slide, or the one that was first before Load newer.
    const listedNow = new Set(expenses.data.map(({ id }) => id));
    const id = shownRows.current.find((row) => listedNow.has(row.id))?.id;
    // Laid out before the change: where it was.
    const at = id ? top(id) : null;
    anchor.current = id && at !== null ? { id, at } : null;
    // Only this commit's change: the layout it leads to moves the view, once.
  }, [firstPage]);
  useLayoutEffect(() => {
    shownRows.current = expenses.data;
  });
  /** A layout changed: once the slide's layouts have all arrived, the view follows its row. */
  const place = (
    change: { list: number } | { day: string; y: number } | { row: string; day: string; y: number },
  ) => {
    if ('list' in change) places.current.list = change.list;
    else if ('row' in change) places.current.rows.set(change.row, change);
    else places.current.days.set(change.day, change.y);
    const held = anchor.current;
    if (!held || held.timer) return;
    // A layout's events arrive together: the shift waits for all of them.
    held.timer = setTimeout(() => {
      if (anchor.current === held) anchor.current = null;
      const at = top(held.id);
      if (at !== null && at !== held.at) onShift?.(at - held.at);
    }, 0);
  };
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

  const scope = state.month ? monthLabel(state.month) : 'all-time';
  return (
    <View style={{ gap: 12 }}>
      <ExpenseSummary
        household={household}
        month={state.month}
        summary={summary}
        currentUserId={currentUserId}
        refreshedAt={listed ? expenses.refreshedAt : null}
        refreshing={refreshing}
        offline={offline}
        loading={!listed && expenses.status !== 'error'}
        now={now}
        onSelectMonth={onSelectMonth}
      />
      {listed ? (
        <RetainedNotice
          status={expenses.status}
          refreshedAt={expenses.refreshedAt}
          message={expenses.message}
          subject={`${scope} expenses`}
          retryLabel="Retry expenses"
          onRetry={onRefreshExpenses}
        />
      ) : null}
      {kept?.groupId === group.id ? (
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
      {/* Where the list lies, for the row kept on screen when the newest page drops (#219). It
          wraps every state of the list, so the Card that showed its skeleton stays the Card that
          fades its rows in. */}
      <View onLayout={({ nativeEvent }) => place({ list: nativeEvent.layout.y })}>
        {!listed ? (
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
        ) : expenses.data.length ? (
          <Card>
            {expenseDays(expenses.data, now).map((day) => (
              <View
                key={day.key}
                onLayout={({ nativeEvent }) => place({ day: day.key, y: nativeEvent.layout.y })}
              >
                <CompactText
                  variant="small"
                  tone="secondary"
                  accessibilityRole="header"
                  style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 }}
                >
                  {day.label}
                </CompactText>
                {day.expenses.map((expense) => (
                  <View
                    key={expense.id}
                    onLayout={({ nativeEvent }) =>
                      place({ row: expense.id, day: day.key, y: nativeEvent.layout.y })
                    }
                  >
                    <ExpenseRow
                      expense={expense}
                      currentUserId={currentUserId}
                      saved={expense.id === savedExpenseId}
                      onOpen={open}
                    />
                  </View>
                ))}
              </View>
            ))}
          </Card>
        ) : (
          <Card padded>
            <CompactText weight="semibold">
              {state.month ? `No expenses in ${monthLabel(state.month)}` : 'No expenses yet'}
            </CompactText>
            <CompactText variant="small" tone="secondary">
              {state.month ? 'Try another Month or All time.' : 'Expenses you add appear here.'}
            </CompactText>
          </Card>
        )}
      </View>
      {more
        ? pageControl({
            which: 'more',
            status: expenses.moreStatus,
            disabled: expenses.status !== 'ready',
            message: expenses.moreMessage,
            color: theme.brand.main,
            onPress: onLoadMore,
          })
        : null}
    </View>
  );
}

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
