import { View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { formatSignedCurrency, getMoneyTone } from '@splitbook/shared/money';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import type { GroupCurrencyBalance, GroupFinancialState, MobileGroup } from '../data/types';
import {
  Banner,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  Money,
  RowAmount,
  SectionHeader,
  Skeleton,
} from './compact';
import { RetainedNotice } from './financial-views';
import { Icon } from './primitives';
import { refreshedLabel } from './refresh-feedback';
import { useTheme } from './theme';

export const recordNeedsConnection = 'Recording a payment needs a connection.';

/**
 * Suggested payments the member can record: they pay or receive it, both are still members,
 * and it is in the Group's currency (the existing Settlement rules).
 */
export function recordablePayments(
  balances: GroupCurrencyBalance[],
  group: MobileGroup,
  currentUserId: string,
) {
  const member = (id: string | null) => group.members.some(({ user }) => user.id === id);
  return balances
    .filter((bucket) => bucket.currency === group.defaultCurrency)
    .flatMap((bucket) =>
      bucket.debts
        .filter(
          (debt) =>
            debt.from.id &&
            debt.to.id &&
            canRecordSettlement(currentUserId, debt.from.id, debt.to.id) &&
            member(debt.from.id) &&
            member(debt.to.id),
        )
        .map((debt) => ({
          paidBy: debt.from.id!,
          paidTo: debt.to.id!,
          payer: debt.from.name,
          recipient: debt.to.name,
          amount: debt.amount,
          currency: bucket.currency,
        })),
    );
}

const youOr = (id: string | null, name: string, currentUserId: string) =>
  id === currentUserId ? 'You' : name;

/** "Sam Chen gets back ₹1,060.00", or "You owe ₹1,480.00" for the member's own row. */
const spokenBalance = (you: boolean, name: string, balance: number, currency: string) => {
  const tone = getMoneyTone(balance);
  const amount = formatCurrency(Math.abs(balance), currency);
  if (tone === 'neutral') return `${name} ${you ? 'are' : 'is'} settled up`;
  if (you) return `You ${tone === 'positive' ? 'get back' : 'owe'} ${amount}`;
  return `${name} ${tone === 'positive' ? 'gets back' : 'owes'} ${amount}`;
};

function MemberBalanceCard({
  bucket,
  currentUserId,
  refreshedAt,
  monthLens,
}: {
  bucket: GroupCurrencyBalance;
  currentUserId: string;
  refreshedAt: number | null;
  monthLens: boolean;
}) {
  const own = bucket.balances.find(({ user }) => user.id === currentUserId)?.balance ?? 0;
  const tone = getMoneyTone(own);
  const label = tone === 'negative' ? 'You owe' : tone === 'positive' ? 'You’re owed' : null;
  return (
    <Card padded>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <CompactText variant="overline" accessibilityRole="header" style={{ flex: 1 }}>
            All-time balance · {bucket.currency}
          </CompactText>
          {refreshedAt !== null ? (
            <CompactText variant="caption" tone="muted">
              Updated {refreshedLabel(refreshedAt)}
            </CompactText>
          ) : null}
        </View>
        {label ? (
          <View
            accessible
            accessibilityLabel={`${label} ${formatCurrency(Math.abs(own), bucket.currency)}`}
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <CompactText tone="secondary">{label}</CompactText>
            <Money size="form" tone={tone === 'negative' ? 'negative' : 'positive'}>
              {formatCurrency(Math.abs(own), bucket.currency)}
            </Money>
          </View>
        ) : (
          <CompactText weight="semibold" tone="secondary">
            Settled up
          </CompactText>
        )}
        {monthLens ? (
          <CompactText variant="small" tone="secondary">
            Includes every month. Picking a month on Expenses doesn’t change it.
          </CompactText>
        ) : null}
      </View>
    </Card>
  );
}

function SuggestedPayments({
  payments,
  currentUserId,
  offline,
  onRecord,
}: {
  payments: ReturnType<typeof recordablePayments>;
  currentUserId: string;
  offline: boolean;
  onRecord: (paidBy: string, paidTo: string, currency: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <SectionHeader
        title="Suggested payments"
        trailing={
          <CompactText variant="caption" tone="muted">
            Record one once it’s paid
          </CompactText>
        }
      />
      <Card>
        {payments.map((payment, index) => {
          const youPay = payment.paidBy === currentUserId;
          const title = youPay ? `You pay ${payment.recipient}` : `${payment.payer} pays you`;
          const amount = formatCurrency(payment.amount, payment.currency);
          return (
            <View key={`${payment.paidBy}:${payment.paidTo}`}>
              {index > 0 ? <Divider /> : null}
              <View
                style={{
                  minHeight: 60,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                }}
              >
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <CompactAvatar small name={payment.payer} />
                  <Icon name="arrow-forward" size={14} color={theme.textMuted} />
                  <CompactAvatar small name={payment.recipient} />
                </View>
                <View
                  accessible
                  accessibilityLabel={`${title}, ${amount}`}
                  style={{ flex: 1, minWidth: 0, gap: 1 }}
                >
                  <CompactText weight="semibold" numberOfLines={2}>
                    {title}
                  </CompactText>
                  <Money>{amount}</Money>
                </View>
                <CompactButton
                  label="Record"
                  variant="tonal"
                  dense
                  disabled={offline}
                  hint={offline ? recordNeedsConnection : undefined}
                  accessibilityLabel={
                    youPay
                      ? `Record your payment to ${payment.recipient}`
                      : `Record ${payment.payer}’s payment to you`
                  }
                  onPress={() => onRecord(payment.paidBy, payment.paidTo, payment.currency)}
                />
              </View>
            </View>
          );
        })}
        {offline ? (
          <CompactText
            variant="small"
            tone="secondary"
            style={{ paddingHorizontal: 14, paddingBottom: 12 }}
          >
            {recordNeedsConnection}
          </CompactText>
        ) : null}
      </Card>
    </View>
  );
}

function Everyone({
  bucket,
  currentUserId,
  title,
}: {
  bucket: GroupCurrencyBalance;
  currentUserId: string;
  title: string;
}) {
  const theme = useTheme();
  const largest = Math.max(...bucket.balances.map(({ balance }) => Math.abs(balance)), 0);
  // The member's own row last, as in the design: the others first.
  const rows = [...bucket.balances].sort(
    (a, b) => Number(a.user.id === currentUserId) - Number(b.user.id === currentUserId),
  );
  return (
    <View style={{ gap: 6 }}>
      <SectionHeader title={title} />
      <Card>
        {rows.length ? (
          rows.map(({ user, balance }, index) => {
            const tone = getMoneyTone(balance);
            const name = youOr(user.id, user.name, currentUserId);
            const caption =
              tone === 'positive' ? 'gets back' : tone === 'negative' ? 'owes' : 'settled up';
            const signed = formatSignedCurrency(balance, bucket.currency);
            return (
              <View key={user.id ?? `former-member-${index}`}>
                {index > 0 ? <Divider /> : null}
                <View
                  accessible
                  accessibilityLabel={spokenBalance(
                    user.id === currentUserId,
                    name,
                    balance,
                    bucket.currency,
                  )}
                  style={{
                    minHeight: 60,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                  }}
                >
                  <CompactAvatar name={user.name} />
                  <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                    <CompactText weight="semibold" numberOfLines={1}>
                      {name}
                    </CompactText>
                    {tone !== 'neutral' && largest > 0 ? (
                      <View
                        style={{
                          height: 4,
                          borderRadius: 2,
                          width: `${Math.max(4, (Math.abs(balance) / largest) * 100)}%`,
                          backgroundColor:
                            tone === 'positive' ? theme.positive.main : theme.negative.main,
                        }}
                      />
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 1 }}>
                    <RowAmount
                      amount={signed}
                      tone={tone === 'neutral' ? 'secondary' : tone}
                      caption={caption}
                    />
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          <CompactText tone="secondary" style={{ padding: 14 }}>
            No outstanding balances in {bucket.currency}.
          </CompactText>
        )}
      </Card>
    </View>
  );
}

/**
 * The Balances destination: the member's all-time balance per currency, the suggested
 * payments they can record, and everyone's net position. Choosing a Month never changes it.
 */
export function GroupBalancesView({
  group,
  currentUserId,
  state,
  offline,
  onRecord,
  onRefreshBalances,
}: {
  group: MobileGroup;
  currentUserId: string;
  state: GroupFinancialState;
  offline: boolean;
  onRecord: (paidBy: string, paidTo: string, currency: string) => void;
  onRefreshBalances: () => void;
}) {
  const { balances } = state;
  if (balances.data === null) {
    if (balances.status === 'error')
      return (
        <View style={{ gap: 10 }}>
          <Banner
            tone="error"
            message={balances.message ?? 'These balances couldn’t be loaded. Try again.'}
          />
          <CompactButton label="Retry balances" variant="tonal" onPress={onRefreshBalances} />
        </View>
      );
    return (
      <View accessibilityLabel="Loading balances" accessibilityState={{ busy: true }}>
        <Card padded>
          <View style={{ gap: 10 }}>
            <Skeleton width="45%" />
            <Skeleton width="70%" height={26} />
            <Skeleton width="90%" />
          </View>
        </Card>
      </View>
    );
  }
  const payments = recordablePayments(balances.data, group, currentUserId);
  const several = balances.data.length > 1;
  return (
    <View style={{ gap: 14 }}>
      <RetainedNotice
        status={balances.status}
        stale={balances.stale}
        refreshedAt={balances.refreshedAt}
        message={balances.message}
        subject="balances"
        retryLabel="Retry balances"
        onRetry={onRefreshBalances}
      />
      {balances.data.length === 0 ? (
        <Card padded>
          <CompactText weight="semibold" tone="secondary">
            Settled up
          </CompactText>
        </Card>
      ) : (
        balances.data.map((bucket) => (
          <MemberBalanceCard
            key={bucket.currency}
            bucket={bucket}
            currentUserId={currentUserId}
            refreshedAt={balances.refreshedAt}
            monthLens={group.category === 'home'}
          />
        ))
      )}
      {payments.length ? (
        <SuggestedPayments
          payments={payments}
          currentUserId={currentUserId}
          offline={offline}
          onRecord={onRecord}
        />
      ) : null}
      {balances.data.map((bucket) => (
        <Everyone
          key={bucket.currency}
          bucket={bucket}
          currentUserId={currentUserId}
          title={several ? `Everyone · ${bucket.currency}` : 'Everyone'}
        />
      ))}
    </View>
  );
}
