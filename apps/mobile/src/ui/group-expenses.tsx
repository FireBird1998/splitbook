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
  SummaryStats,
  type SummaryStat,
} from './compact';
import { RetainedNotice } from './financial-views';
import type { IconName } from './primitives';
import { refreshedLabel } from './refresh-feedback';
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

function ExpenseRow({
  expense,
  currentUserId,
  saved,
  onOpen,
}: {
  expense: MobileExpense;
  currentUserId: string;
  saved: boolean;
  onOpen: () => void;
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
      onPress={onOpen}
    />
  );
}

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
  loading,
  now,
  onSelectMonth,
}: {
  household: boolean;
  month: string | null;
  summary: ExpenseWindowSummary | null;
  currentUserId: string;
  refreshedAt: number | null;
  loading: boolean;
  now: number;
  onSelectMonth: (month: string | null) => void;
}) {
  const figures = summary ? summaryStats(summary, currentUserId) : null;
  const updated =
    refreshedAt !== null ? (
      <CompactText variant="caption" tone="secondary">
        Updated {refreshedLabel(refreshedAt)}
      </CompactText>
    ) : null;
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
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 14 }}>
          {[0, 1, 2].map((stat) => (
            <View key={stat} style={{ flex: 1, gap: 6 }}>
              <Skeleton width="60%" height={12} />
              <Skeleton width="85%" height={18} />
            </View>
          ))}
        </View>
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
  now,
  onSelectMonth,
  onRefreshExpenses,
  onLoadMore,
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
  now: number;
  onSelectMonth: (month: string | null) => void;
  onRefreshExpenses: () => void;
  onLoadMore: () => void;
  onOpenExpense: (expenseId: string) => void;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
}) {
  const theme = useTheme();
  const { expenses } = state;
  const household = group.category === 'home';
  // Never show one Month's Expenses under another Month's label.
  const current = expenses.month === state.month;
  const summary = current ? expenses.summary : null;
  const listed =
    current && (expenses.status === 'ready' || summary !== null || expenses.data.length > 0);
  const more =
    listed &&
    expenses.status === 'ready' &&
    expenses.pagination !== null &&
    expenses.pagination.page < expenses.pagination.totalPages;
  const scope = state.month ? monthLabel(state.month) : 'all-time';
  return (
    <View style={{ gap: 12 }}>
      <ExpenseSummary
        household={household}
        month={state.month}
        summary={summary}
        currentUserId={currentUserId}
        refreshedAt={listed ? expenses.refreshedAt : null}
        loading={!listed && expenses.status !== 'error'}
        now={now}
        onSelectMonth={onSelectMonth}
      />
      {listed ? (
        <RetainedNotice
          status={expenses.status}
          stale={false}
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
      {!listed ? (
        expenses.status === 'error' ? (
          <View style={{ gap: 10 }}>
            <Banner
              tone="error"
              message={expenses.message ?? 'These expenses couldn’t be loaded. Try again.'}
            />
            <CompactButton label="Retry expenses" variant="tonal" onPress={onRefreshExpenses} />
          </View>
        ) : (
          <View
            accessibilityLabel={`Loading ${scope} expenses`}
            accessibilityState={{ busy: true }}
          >
            <Card>
              {[0, 1, 2].map((row) => (
                <View
                  key={row}
                  style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }}
                >
                  <Skeleton width={40} height={40} rounded={12} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Skeleton width="65%" />
                    <Skeleton width="40%" height={12} />
                  </View>
                  <Skeleton width={64} />
                </View>
              ))}
            </Card>
          </View>
        )
      ) : expenses.data.length ? (
        <Card>
          {expenseDays(expenses.data, now).map((day) => (
            <View key={day.key}>
              <CompactText
                variant="small"
                tone="secondary"
                accessibilityRole="header"
                style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 }}
              >
                {day.label}
              </CompactText>
              {day.expenses.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  currentUserId={currentUserId}
                  saved={expense.id === savedExpenseId}
                  onOpen={() => onOpenExpense(expense.id)}
                />
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
      {more && expenses.moreStatus === 'loading' ? (
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
          <CompactText tone="secondary">Loading more expenses…</CompactText>
        </View>
      ) : more ? (
        <>
          {expenses.moreStatus === 'error' ? (
            <CompactText variant="small" tone="negative" accessibilityRole="alert">
              {expenses.moreMessage ?? 'Couldn’t load more expenses.'} The ones shown are still
              here.
            </CompactText>
          ) : null}
          <CompactButton
            label={expenses.moreStatus === 'error' ? 'Try loading more' : 'Load more'}
            accessibilityLabel={
              expenses.moreStatus === 'error' ? 'Try loading more expenses' : 'Load more expenses'
            }
            variant="tonal"
            block
            onPress={onLoadMore}
          />
        </>
      ) : null}
    </View>
  );
}
