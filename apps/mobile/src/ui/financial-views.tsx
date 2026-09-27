import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { formatDate } from '@splitbook/shared/date';
import { formatSignedCurrency, getMoneyTone, type MoneyTone } from '@splitbook/shared/money';
import { currentMonthKey, shiftMonthKey } from '../data';
import type {
  ExpenseWindowSummary,
  GroupFinancialState,
  HomeFinancialState,
  LoadStatus,
  MobileExpense,
  MobileGroup,
} from '../data/types';
import { Avatar, Button, Copy, Icon, Label, Panel, type IconName } from './primitives';
import { fonts, useTheme } from './theme';

export interface HomeBalancesProps {
  state: HomeFinancialState;
  onRefresh: () => void;
}

export interface GroupFinancialViewsProps {
  group: MobileGroup;
  currentUserId: string;
  state: GroupFinancialState;
  onSelectMonth: (month: string | null) => void;
  onRefreshExpenses: () => void;
  onRefreshBalances: () => void;
  onLoadMore: () => void;
}

function Amount({
  value,
  currency,
  tone = 'neutral',
  large = false,
  signed = false,
}: {
  value: number;
  currency: string;
  tone?: MoneyTone;
  large?: boolean;
  signed?: boolean;
}) {
  const theme = useTheme();
  return (
    <Copy
      style={{
        fontFamily: fonts.mono,
        fontSize: large ? 26 : 20,
        lineHeight: large ? 36 : 29,
        color: tone === 'neutral' ? theme.text : theme.status[tone],
      }}
    >
      {signed ? formatSignedCurrency(value, currency) : formatCurrency(value, currency)}{' '}
      <Copy style={{ fontSize: 12, lineHeight: 20, color: theme.textSecondary }}>{currency}</Copy>
    </Copy>
  );
}

function IconAction({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        minWidth: 48,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.brand.bg,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={21} color={theme.brand.main} />
    </Pressable>
  );
}

function FinancialState({
  status,
  message,
  loadingLabel,
  retryLabel,
  onRetry,
}: {
  status: LoadStatus;
  message: string | null;
  loadingLabel: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  if (status === 'ready') return null;
  const loading = status === 'idle' || status === 'loading';
  return (
    <View style={{ gap: 14, paddingVertical: 8 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {loading ? (
          <ActivityIndicator color={theme.brand.main} />
        ) : (
          <Icon name="cloud-offline-outline" color={theme.status.negative} />
        )}
        <Copy
          accessibilityRole={loading ? undefined : 'alert'}
          style={{ flex: 1, color: loading ? theme.textSecondary : theme.status.negative }}
        >
          {loading ? loadingLabel : (message ?? 'These figures could not be loaded. Try again.')}
        </Copy>
      </View>
      {!loading && <Button label={retryLabel} secondary onPress={onRetry} />}
    </View>
  );
}

export function HomeBalances({ state, onRefresh }: HomeBalancesProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Label>AT A GLANCE</Label>
          <Copy
            accessibilityRole="header"
            style={{ fontFamily: fonts.semibold, fontSize: 25, lineHeight: 32 }}
          >
            Your balances
          </Copy>
        </View>
        <IconAction
          label="Refresh Home balances"
          icon="refresh-outline"
          onPress={onRefresh}
          disabled={state.status === 'loading'}
        />
      </View>
      <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
        Across your active Groups. Each currency stays separate.
      </Copy>
      {state.status !== 'ready' || state.data === null ? (
        <Panel>
          <FinancialState
            status={state.status === 'ready' ? 'error' : state.status}
            message={state.message}
            loadingLabel="Loading your balances…"
            retryLabel="Retry Home balances"
            onRetry={onRefresh}
          />
        </Panel>
      ) : state.data?.length ? (
        state.data.map((bucket) => (
          <Panel key={bucket.currency}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="wallet-outline" size={19} color={theme.brand.main} />
              <Label>{bucket.currency}</Label>
            </View>
            {[
              { label: 'You owe', value: bucket.youOwe, tone: 'negative' as const },
              { label: 'You are owed', value: bucket.youAreOwed, tone: 'positive' as const },
            ].map((item) => (
              <View
                key={item.label}
                style={{
                  backgroundColor: theme[item.tone].bg,
                  borderRadius: 12,
                  padding: 16,
                  gap: 5,
                }}
              >
                <Copy style={{ fontFamily: fonts.medium, color: theme.status[item.tone] }}>
                  {item.label}
                </Copy>
                <Amount value={item.value} currency={bucket.currency} tone={item.tone} large />
              </View>
            ))}
          </Panel>
        ))
      ) : (
        <Panel>
          <Icon name="checkmark-circle-outline" color={theme.status.positive} size={28} />
          <Copy style={{ fontFamily: fonts.semibold, fontSize: 20 }}>Nothing outstanding</Copy>
          <Copy style={{ color: theme.textSecondary }}>
            You have no outstanding balances in your active Groups.
          </Copy>
        </Panel>
      )}
    </View>
  );
}

function MonthPicker({
  month,
  onSelectMonth,
}: Pick<GroupFinancialViewsProps, 'onSelectMonth'> & { month: string | null }) {
  const theme = useTheme();
  const current = currentMonthKey();
  return (
    <View style={{ gap: 14 }}>
      <Label>HOUSEHOLD MONTH</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconAction
          label="Previous month"
          icon="chevron-back-outline"
          onPress={() => onSelectMonth(shiftMonthKey(month ?? current, -1))}
        />
        <Copy
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: fonts.semibold,
            fontSize: 21,
            lineHeight: 28,
          }}
        >
          {monthLabel(month)}
        </Copy>
        <IconAction
          label="Next month"
          icon="chevron-forward-outline"
          disabled={month === null || month >= current}
          onPress={() => onSelectMonth(shiftMonthKey(month ?? current, 1))}
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Button
          label="This month"
          secondary
          disabled={month === current}
          onPress={() => onSelectMonth(current)}
        />
        <Button
          label="All time"
          secondary
          disabled={month === null}
          onPress={() => onSelectMonth(null)}
        />
      </View>
      <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20 }}>
        Months use your phone’s calendar and timezone. Only the expenses below change.
      </Copy>
    </View>
  );
}

function monthLabel(month: string | null) {
  return month
    ? new Date(`${month}-01T12:00:00`).toLocaleDateString('en', { month: 'long', year: 'numeric' })
    : 'All time';
}

function ExpenseRow({ expense, currentUserId }: { expense: MobileExpense; currentUserId: string }) {
  const theme = useTheme();
  return (
    <Panel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="calendar-outline" size={15} />
        <Copy style={{ flex: 1, fontSize: 13, lineHeight: 20, color: theme.textSecondary }}>
          {formatDate(expense.date)}
        </Copy>
      </View>
      <View style={{ gap: 5 }}>
        <Copy style={{ fontFamily: fonts.semibold, fontSize: 20, lineHeight: 27 }}>
          {expense.description}
        </Copy>
        <Amount value={expense.amount} currency={expense.currency} />
      </View>
      <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
        Paid by{' '}
        {expense.paidBy
          .map(({ user }) => (user.id === currentUserId ? 'you' : user.name))
          .join(', ')}
      </Copy>
      {expense.tag && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Icon name="pricetag-outline" size={15} color={theme.brand.main} />
          <Copy style={{ flex: 1, fontSize: 13, lineHeight: 20, color: theme.textSecondary }}>
            {expense.tag}
          </Copy>
        </View>
      )}
    </Panel>
  );
}

function MemberContributions({
  summary,
  windowLabel,
  currentUserId,
}: {
  summary: ExpenseWindowSummary;
  windowLabel: string;
  currentUserId: string;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ gap: 16, borderTopWidth: 1, borderColor: theme.border, paddingTop: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Member contributions for ${windowLabel} in ${summary.currency}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => ({
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Copy style={{ flex: 1, fontFamily: fonts.semibold, color: theme.brand.main }}>
          Member contributions · {summary.currency}
        </Copy>
        <Icon
          name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
          color={theme.brand.main}
        />
      </Pressable>
      {expanded && (
        <View style={{ gap: 20 }}>
          <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20 }}>
            {windowLabel} expenses in {summary.currency} only. Recorded Settlements are excluded.
            Difference is share minus paid, a comparison of contributions during this Month.
          </Copy>
          {summary.byMember.map((member, index) => (
            <View
              key={member.user.id ?? `former-contributor-${index}`}
              style={{ gap: 12, borderTopWidth: 1, borderColor: theme.border, paddingTop: 16 }}
            >
              <Copy style={{ fontFamily: fonts.semibold }}>
                {member.user.name}
                {member.user.id === currentUserId ? ' · you' : ''}
              </Copy>
              {[
                { label: 'Paid', value: member.paid, signed: false },
                { label: 'Share', value: member.share, signed: false },
                { label: 'Difference', value: member.net, signed: true },
              ].map((figure) => (
                <View key={figure.label} style={{ gap: 2 }}>
                  <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20 }}>
                    {figure.label}
                  </Copy>
                  <Amount value={figure.value} currency={summary.currency} signed={figure.signed} />
                </View>
              ))}
              <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20 }}>
                {member.net > 0
                  ? 'Share exceeds paid'
                  : member.net < 0
                    ? 'Paid exceeds share'
                    : 'Paid and share match'}
              </Copy>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function GroupFinancialViews({
  group,
  currentUserId,
  state,
  onSelectMonth,
  onRefreshExpenses,
  onRefreshBalances,
  onLoadMore,
}: GroupFinancialViewsProps) {
  const theme = useTheme();
  const { balances, expenses } = state;
  const windowLabel = monthLabel(state.month);
  const summary = expenses.status === 'ready' ? expenses.summary : null;
  return (
    <View style={{ gap: 24 }}>
      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Label>ALL TIME</Label>
            <Copy
              accessibilityRole="header"
              style={{ fontFamily: fonts.semibold, fontSize: 23, lineHeight: 30 }}
            >
              Running balances
            </Copy>
          </View>
          <IconAction
            label="Refresh running balances"
            icon="refresh-outline"
            onPress={onRefreshBalances}
            disabled={balances.status === 'loading'}
          />
        </View>
        <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20 }}>
          Includes all Expenses and recorded Settlements. Month selections do not change these
          balances.
        </Copy>
        <FinancialState
          status={balances.status === 'ready' && balances.data === null ? 'error' : balances.status}
          message={balances.message}
          loadingLabel="Loading running balances…"
          retryLabel="Retry running balances"
          onRetry={onRefreshBalances}
        />
        {balances.status === 'ready' &&
          balances.data?.map((bucket) => (
            <View
              key={bucket.currency}
              style={{ gap: 14, borderTopWidth: 1, borderColor: theme.border, paddingTop: 16 }}
            >
              <Label>{bucket.currency}</Label>
              {bucket.balances.length ? (
                bucket.balances.map(({ user, balance }, index) => {
                  const tone = getMoneyTone(balance);
                  const isYou = user.id === currentUserId;
                  const label =
                    tone === 'negative'
                      ? isYou
                        ? 'You owe'
                        : 'Owes'
                      : tone === 'positive'
                        ? isYou
                          ? 'You are owed'
                          : 'Is owed'
                        : 'Settled';
                  return (
                    <View
                      key={user.id ?? `former-member-${index}`}
                      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}
                    >
                      <Avatar name={user.name} small />
                      <View style={{ flex: 1, gap: 3 }}>
                        <Copy style={{ fontFamily: fonts.medium }}>
                          {user.name}
                          {isYou ? ' · you' : ''}
                        </Copy>
                        <Copy
                          style={{
                            color: tone === 'neutral' ? theme.textSecondary : theme.status[tone],
                            fontSize: 13,
                            lineHeight: 20,
                          }}
                        >
                          {label}
                        </Copy>
                        <Amount value={Math.abs(balance)} currency={bucket.currency} tone={tone} />
                      </View>
                    </View>
                  );
                })
              ) : (
                <Copy style={{ color: theme.textSecondary }}>
                  No outstanding balances in {bucket.currency}.
                </Copy>
              )}
              {bucket.debts.length > 0 && (
                <View
                  style={{ gap: 14, borderTopWidth: 1, borderColor: theme.border, paddingTop: 16 }}
                >
                  <Label>WHO OWES WHOM</Label>
                  {bucket.debts.map((debt, index) => (
                    <View
                      key={`${debt.from.id ?? 'former'}:${debt.to.id ?? 'former'}:${index}`}
                      style={{ gap: 5 }}
                    >
                      <Copy style={{ fontFamily: fonts.medium }}>
                        {debt.from.id === currentUserId ? 'You owe' : `${debt.from.name} owes`}{' '}
                        {debt.to.id === currentUserId ? 'you' : debt.to.name}
                      </Copy>
                      <Amount
                        value={debt.amount}
                        currency={bucket.currency}
                        tone={
                          debt.from.id === currentUserId
                            ? 'negative'
                            : debt.to.id === currentUserId
                              ? 'positive'
                              : 'neutral'
                        }
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        {balances.status === 'ready' && balances.data?.length === 0 && (
          <Copy style={{ color: theme.textSecondary }}>No running balances to show.</Copy>
        )}
      </Panel>

      {group.category === 'home' && (
        <Panel>
          <MonthPicker month={state.month} onSelectMonth={onSelectMonth} />
        </Panel>
      )}

      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Label>{state.month ? windowLabel.toUpperCase() : 'ALL TIME'}</Label>
            <Copy
              accessibilityRole="header"
              style={{ fontFamily: fonts.semibold, fontSize: 25, lineHeight: 32 }}
            >
              Expenses
            </Copy>
          </View>
          <IconAction
            label="Refresh expenses"
            icon="refresh-outline"
            onPress={onRefreshExpenses}
            disabled={expenses.status === 'loading' || expenses.moreStatus === 'loading'}
          />
        </View>
        {summary && (
          <Panel>
            <Copy
              accessibilityRole="header"
              style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 25 }}
            >
              {state.month ? `${windowLabel} expense total` : 'All-time expense total'}
            </Copy>
            <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20 }}>
              {summary.count} {summary.count === 1 ? 'expense' : 'expenses'} across the full
              selected window.
            </Copy>
            {summary.totalsByCurrency.map((total) => (
              <Amount
                key={total.currency}
                value={total.totalAmount}
                currency={total.currency}
                large
              />
            ))}
            <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20 }}>
              Spending only. Running balances above also account for Settlements.
            </Copy>
            {group.category === 'home' && state.month && summary.byMember.length > 0 && (
              <MemberContributions
                key={state.month}
                summary={summary}
                windowLabel={windowLabel}
                currentUserId={currentUserId}
              />
            )}
          </Panel>
        )}
        {expenses.status !== 'ready' ? (
          <Panel>
            <FinancialState
              status={expenses.status}
              message={expenses.message}
              loadingLabel={`Loading ${state.month ? windowLabel : 'all-time'} expenses…`}
              retryLabel="Retry expenses"
              onRetry={onRefreshExpenses}
            />
          </Panel>
        ) : expenses.data.length ? (
          <>
            {expenses.data.map((expense) => (
              <ExpenseRow key={expense.id} expense={expense} currentUserId={currentUserId} />
            ))}
            {expenses.pagination && (
              <Copy
                style={{
                  color: theme.textSecondary,
                  textAlign: 'center',
                  fontSize: 13,
                  lineHeight: 20,
                }}
              >
                Showing {expenses.data.length} of {expenses.pagination.total} expenses
              </Copy>
            )}
            {expenses.moreStatus === 'error' && (
              <Copy accessibilityRole="alert" style={{ color: theme.status.negative }}>
                {expenses.moreMessage ??
                  'More expenses could not be loaded. Your displayed expenses are still here.'}
              </Copy>
            )}
            {expenses.pagination && expenses.pagination.page < expenses.pagination.totalPages && (
              <Button
                label={
                  expenses.moreStatus === 'loading'
                    ? 'Loading more…'
                    : expenses.moreStatus === 'error'
                      ? 'Retry more expenses'
                      : 'Load more expenses'
                }
                secondary
                disabled={expenses.moreStatus === 'loading'}
                onPress={onLoadMore}
              />
            )}
          </>
        ) : (
          <Panel>
            <Icon name="receipt-outline" color={theme.brand.main} size={28} />
            <Copy style={{ fontFamily: fonts.semibold, fontSize: 20, lineHeight: 27 }}>
              {state.month ? `No expenses in ${windowLabel}` : 'No expenses yet'}
            </Copy>
            <Copy style={{ color: theme.textSecondary }}>
              {state.month
                ? 'Try another Month or choose All time. Your running balances still cover all time.'
                : 'Saved expenses will appear here with their date, payer, amount, and currency.'}
            </Copy>
          </Panel>
        )}
      </View>
    </View>
  );
}
