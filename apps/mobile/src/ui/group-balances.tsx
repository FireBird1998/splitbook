import { View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { formatSignedCurrency, getMoneyTone } from '@splitbook/shared/money';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import type { PendingPayment } from '../data/settlement';
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
  SkeletonOf,
  SkeletonText,
  StatusText,
} from './compact';
import { ReadTime, RetainedNotice } from './financial-views';
import { NotAvailableOffline } from './offline-notice';
import { Icon } from './primitives';
import { useTheme } from './theme';

export const recordNeedsConnection = 'Recording a payment needs a connection.';
/** Balances not yet read again after a change: their payments wait for the read (#219). */
export const recordWaitsForBalances = 'Record is available once these balances are updated.';
/** Above the suggested payments: when to record one. */
const recordCaption = 'Record one once it’s paid';
/** The caption while Record waits for the read after a change: no longer, so it fits there. */
const recordWaitsShort = 'Record once updated';
/** A Group whose details couldn't be read (owner decision 2A): the sheet needs them (#219). */
export const recordWaitsForDetails = (name: string) =>
  `Record is available once ${name}’s details load.`;

/**
 * Whether Home last read the member as settled up in a Group: its balances there are known,
 * and nothing is owed either way in any currency.
 */
export const settledIn = (balances: { balance: number }[] | undefined) =>
  balances !== undefined && balances.every(({ balance }) => getMoneyTone(balance) === 'neutral');

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

/** "Your payment of ₹500.00 to Sam Chen", or the other way round, for the unconfirmed row. */
export function pendingPaymentMessage(
  pending: PendingPayment,
  group: MobileGroup,
  currentUserId: string,
) {
  const { draft } = pending;
  if (!draft)
    return 'A payment stored on this device couldn’t be read. Check it before recording another.';
  const name = (id: string, fallback: string) =>
    group.members.find(({ user }) => user.id === id)?.user.name ?? fallback;
  const amount = formatCurrency(Number(draft.amount), draft.currency);
  const payment =
    draft.paidBy === currentUserId
      ? `Your payment of ${amount} to ${name(draft.paidTo, 'a former member')}`
      : `${name(draft.paidBy, 'A former member')}’s payment of ${amount} to you`;
  return `${payment} may already be recorded. Check it before recording another.`;
}

/** A payment whose response was lost, offered whatever the suggestions say. */
function PendingPaymentNotice({
  pending,
  group,
  currentUserId,
  offline,
  onCheck,
}: {
  pending: PendingPayment;
  group: MobileGroup;
  currentUserId: string;
  offline: boolean;
  onCheck: () => void;
}) {
  return (
    <Banner
      tone="warning"
      title="Payment not confirmed"
      message={pendingPaymentMessage(pending, group, currentUserId)}
      standing
    >
      <CompactButton
        label="Check payment"
        variant="text"
        dense
        disabled={offline}
        hint={offline ? recordNeedsConnection : undefined}
        onPress={onCheck}
      />
    </Banner>
  );
}

function MemberBalanceCard({
  bucket,
  currentUserId,
  refreshedAt,
  restored,
  updating,
  offline,
  monthLens,
}: {
  bucket: GroupCurrencyBalance;
  currentUserId: string;
  refreshedAt: number | null;
  /** The figures are this device's saved copy: "Saved", not "Updated". */
  restored: boolean;
  /** A change made them out of date, and they're being read again: "Updating…". */
  updating: boolean;
  offline: boolean;
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
          <ReadTime
            refreshedAt={refreshedAt}
            restored={restored}
            updating={updating}
            offline={offline}
            tone="muted"
          />
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
  locked,
  unavailable,
  onRecord,
}: {
  payments: ReturnType<typeof recordablePayments>;
  currentUserId: string;
  offline: boolean;
  /** A change written in this Group made the Balances shown out of date: Record waits for them. */
  locked: boolean;
  /** Why Record can't be used here, said under the payments too; null when it can. */
  unavailable: string | null;
  onRecord: (paidBy: string, paidTo: string, currency: string) => void;
}) {
  const reason = offline ? recordNeedsConnection : unavailable;
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <SectionHeader
        title="Suggested payments"
        trailing={
          // While a change keeps Record waiting, its caption says why, in a line no longer than
          // the caption's, so nothing moves (#219); the full reason is Record's hint.
          <StatusText variant="caption" tone="muted">
            {locked && !offline ? recordWaitsShort : recordCaption}
          </StatusText>
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
                  disabled={offline || locked || unavailable !== null}
                  hint={
                    offline
                      ? recordNeedsConnection
                      : locked
                        ? recordWaitsForBalances
                        : (unavailable ?? undefined)
                  }
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
        {reason ? (
          <CompactText
            variant="small"
            tone="secondary"
            style={{ paddingHorizontal: 14, paddingBottom: 12 }}
          >
            {reason}
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
 * The Balances destination: an unconfirmed payment first, then the member's all-time balance
 * per currency, the suggested payments they can record, and everyone's net position.
 * Choosing a Month never changes it.
 */
export function GroupBalancesView({
  group,
  currentUserId,
  state,
  pending,
  offline,
  knownSettled = false,
  recordUnavailable = null,
  onRecord,
  onCheckPayment,
  onRefreshBalances,
}: {
  group: MobileGroup;
  currentUserId: string;
  state: GroupFinancialState;
  /** This Group's unconfirmed payment, if one is stored on the device. */
  pending: PendingPayment | null;
  offline: boolean;
  /**
   * The member's last-known balance in this Group is settled (as Home last read it): while the
   * Balances load, their placeholder takes the settled card's shape, with no amount.
   */
  knownSettled?: boolean;
  /** Why Record can't be used, such as a Group whose details couldn't be read (2A, #219). */
  recordUnavailable?: string | null;
  onRecord: (paidBy: string, paidTo: string, currency: string) => void;
  onCheckPayment: () => void;
  onRefreshBalances: () => void;
}) {
  const { balances } = state;
  const notice =
    pending?.groupId === group.id ? (
      <PendingPaymentNotice
        pending={pending}
        group={group}
        currentUserId={currentUserId}
        offline={offline}
        onCheck={onCheckPayment}
      />
    ) : null;
  if (balances.data === null) {
    if (balances.status === 'error' && offline)
      return (
        <View style={{ gap: 10 }}>
          {notice}
          <NotAvailableOffline
            compact
            // True whether they were never saved here, removed by a change or a sign-out, or
            // withheld (#323): never "haven't been opened" (#219, #280 item 2).
            message="These balances aren’t saved on this phone. Connect to load them."
            onRetry={onRefreshBalances}
          />
        </View>
      );
    if (balances.status === 'error')
      return (
        <View style={{ gap: 10 }}>
          {notice}
          <Banner
            tone="error"
            message={balances.message ?? 'These balances couldn’t be loaded. Try again.'}
          />
          <CompactButton label="Retry balances" variant="tonal" onPress={onRefreshBalances} />
        </View>
      );
    return (
      <View style={{ gap: 14 }}>
        {notice}
        <View accessibilityLabel="Loading balances" accessibilityState={{ busy: true }}>
          <Card padded>
            {/* The balance card's lines, as MemberBalanceCard lays them out: its heading and a
                typical "Updated" time wrap where the card's do, and a Household's note about
                Months takes two lines. */}
            <View style={{ gap: 4 }}>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
              >
                <View style={{ flex: 1 }}>
                  <SkeletonOf bar>
                    <CompactText variant="overline">
                      All-time balance · {group.defaultCurrency}
                    </CompactText>
                  </SkeletonOf>
                </View>
                <SkeletonOf bar>
                  <CompactText variant="caption">Updated 10:42 AM</CompactText>
                </SkeletonOf>
              </View>
              <SkeletonText
                gap={4}
                lines={[
                  // "Settled up", or a label and an amount when anything is owed; with nothing
                  // known, an amount, as an open balance is the commoner case.
                  knownSettled
                    ? { width: '30%' as const, line: 'body' as const }
                    : { width: '70%' as const, line: 'form' as const },
                  ...(group.category === 'home'
                    ? [{ width: '90%' as const, line: 'small' as const, count: 2 }]
                    : []),
                ]}
              />
            </View>
          </Card>
        </View>
      </View>
    );
  }
  const payments = recordablePayments(balances.data, group, currentUserId);
  const several = balances.data.length > 1;
  return (
    <View style={{ gap: 14 }}>
      <RetainedNotice
        status={balances.status}
        refreshedAt={balances.refreshedAt}
        message={balances.message}
        subject="balances"
        retryLabel="Retry balances"
        offline={offline}
        onRetry={onRefreshBalances}
      />
      {notice}
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
            restored={balances.restored === true}
            // The figures shown are from before a change written here: they say so from the
            // publish that says the change was made, before their reads start, until the read
            // after it lands or fails (#219).
            updating={balances.changed === true && balances.status !== 'error'}
            offline={offline}
            monthLens={group.category === 'home'}
          />
        ))
      )}
      {payments.length ? (
        <SuggestedPayments
          payments={payments}
          currentUserId={currentUserId}
          offline={offline}
          locked={balances.changed === true}
          unavailable={recordUnavailable}
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
