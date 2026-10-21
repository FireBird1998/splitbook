import { useState, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { balanceCurrencies, openingBalanceCurrency } from '@splitbook/shared/balance-currencies';
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
  scaledSp,
  textVariants,
  useLargestText,
  useTap,
  useTextColumn,
} from './compact';
import { inPlace, ReadTime, RetainedNotice } from './financial-views';
import { NotAvailableOffline } from './offline-notice';
import { Icon } from './primitives';
import { CurrencyTabs } from './currency-tabs';
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

/** Where payments in a currency other than the main one go, until #727 records them. */
export const recordedInMain = (main: string) =>
  `Payments are recorded in ${main}, the main currency.`;

/**
 * Suggested payments the member can record in `currency`, the Group's own by default: they pay or
 * receive it, and both are still members (the existing Settlement rules). Record is offered on
 * those in the Group's currency.
 */
export function recordablePayments(
  balances: GroupCurrencyBalance[],
  group: MobileGroup,
  currentUserId: string,
  currency = group.defaultCurrency,
) {
  const member = (id: string | null) => group.members.some(({ user }) => user.id === id);
  return balances
    .filter((bucket) => bucket.currency === currency)
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

/** One currency Balances can show, with the member's own balance in it. */
interface BalanceTab {
  currency: string;
  /** The Group's main currency. */
  main: boolean;
  /** Positive: the member is owed; negative: they owe; 0: settled up. */
  balance: number;
}

/**
 * The currencies Balances switches between (#725), each with the member's own position, and the
 * one it opens on: the first the member isn't settled up in, as on the web (#724).
 */
function currencyPositions(
  group: MobileGroup,
  data: GroupCurrencyBalance[],
  currentUserId: string,
) {
  const currencies = balanceCurrencies(
    group,
    data.map((bucket) => bucket.currency),
  );
  const positions: Record<string, number> = Object.fromEntries(
    data.map((bucket) => [
      bucket.currency,
      bucket.balances.find(({ user }) => user.id === currentUserId)?.balance ?? 0,
    ]),
  );
  return { currencies, positions, opening: openingBalanceCurrency(currencies, positions) };
}

/** "INR, main currency, you owe ₹1,480.00", as a screen reader names the tab (as on the web). */
function tabName({ currency, main, balance }: BalanceTab) {
  const tone = getMoneyTone(balance);
  const amount = formatCurrency(Math.abs(balance), currency);
  return [
    currency,
    ...(main ? ['main currency'] : []),
    tone === 'negative'
      ? `you owe ${amount}`
      : tone === 'positive'
        ? `you’re owed ${amount}`
        : 'you’re settled up',
  ].join(', ');
}

/**
 * Balances in one currency at a time (#725, boards "Balances" and its 130% version), as on the
 * web (#724): a tab per currency with the member's own position in it (CurrencyTabs).
 */
function BalanceCurrencySwitch({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly BalanceTab[];
  value: string;
  onChange: (currency: string) => void;
}) {
  return (
    <CurrencyTabs
      label="Balances in"
      tabs={tabs.map((tab) => {
        const tone = getMoneyTone(tab.balance);
        return {
          currency: tab.currency,
          main: tab.main,
          figure: formatSignedCurrency(tab.balance, tab.currency),
          figureTone: tone === 'neutral' ? 'secondary' : tone,
          name: tabName(tab),
        };
      })}
      value={value}
      onChange={onChange}
    />
  );
}

/**
 * The balance card's title beside its time: it takes the line's room, and at large text keeps
 * `largeTextColumn` of it, so where the time leaves it less, the time goes under it. At 200% on
 * a 360dp phone the time squeezed it into a column that broke its words ("ALL-T / IME BAL /
 * ANCE", #639). Its skeleton keeps the same shape.
 */
function useBalanceTitle() {
  return { flex: 1, minWidth: useTextColumn() ?? 0 };
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
  const title = useBalanceTitle();
  return (
    <Card padded>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <CompactText variant="overline" accessibilityRole="header" style={title}>
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
  title,
  payments,
  currentUserId,
  offline,
  locked,
  unavailable,
  recordedIn,
  onRecord,
}: {
  title: string;
  payments: ReturnType<typeof recordablePayments>;
  currentUserId: string;
  offline: boolean;
  /** A change written in this Group made the Balances shown out of date: Record waits for them. */
  locked: boolean;
  /** Why Record can't be used here, said under the payments too; null when it can. */
  unavailable: string | null;
  /**
   * The main currency, for payments in another one: they're listed without Record, which waits
   * for #727, and say where payments go. Null in the main currency.
   */
  recordedIn: string | null;
  onRecord: (paidBy: string, paidTo: string, currency: string) => void;
}) {
  const reason = recordedIn
    ? recordedInMain(recordedIn)
    : offline
      ? recordNeedsConnection
      : unavailable;
  const theme = useTheme();
  // A drag that starts on Record never opens Record payment (#684).
  const recordTap = useTap();
  const { fontScale } = useWindowDimensions();
  const column = useTextColumn();
  const whole = useLargestText();
  return (
    <View style={{ gap: 6 }}>
      <SectionHeader
        title={title}
        trailing={
          recordedIn ? undefined : (
            // The caption takes the room the title leaves, wrapping there rather than running past
            // the screen's edge at large text. While a change keeps Record waiting, its reason
            // takes the caption's place at once, in a box the caption holds, so nothing moves
            // (#219); the full reason is Record's hint. At large text it keeps room for its
            // longest word, "Record", four of its em: with less beside the title, as at 200%, it
            // goes on a line of its own under it, where it was a column a letter wide (#639).
            <View
              style={{
                flex: 1,
                minWidth: column
                  ? 4 * scaledSp(textVariants.caption.fontSize as number, fontScale)
                  : 0,
              }}
            >
              {inPlace({
                holds:
                  locked && !offline ? (
                    <CompactText variant="caption" tone="muted" style={{ textAlign: 'right' }}>
                      {recordCaption}
                    </CompactText>
                  ) : null,
                children: (
                  <StatusText
                    variant="caption"
                    tone="muted"
                    instant={locked && !offline}
                    style={{ textAlign: 'right' }}
                  >
                    {locked && !offline ? recordWaitsShort : recordCaption}
                  </StatusText>
                ),
              })}
            </View>
          )
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
                  // At large text, Record goes onto a line of its own where it would leave the
                  // payment less than `largeTextColumn`: at 200% on a 360dp phone the amount read
                  // "₹1,0…" beside it (#639).
                  ...(column ? { flexWrap: 'wrap', alignContent: 'center', rowGap: 4 } : {}),
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
                  style={{ flex: 1, minWidth: column ?? 0, gap: 1 }}
                >
                  <CompactText weight="semibold" numberOfLines={whole ? 0 : 2}>
                    {title}
                  </CompactText>
                  <Money>{amount}</Money>
                </View>
                {recordedIn ? null : (
                  <Trailing column={column}>
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
                      tap={recordTap}
                    />
                  </Trailing>
                )}
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

/** What ends a row: at large text, on a line of its own, it keeps to the row's end. */
function Trailing({ column, children }: { column: number | undefined; children: ReactNode }) {
  return column ? <View style={{ marginLeft: 'auto' }}>{children}</View> : children;
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
  const column = useTextColumn();
  const whole = useLargestText();
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
                    // As a list row lays out at large text (#639).
                    ...(column ? { flexWrap: 'wrap', alignContent: 'center', rowGap: 4 } : {}),
                  }}
                >
                  <CompactAvatar name={user.name} />
                  <View style={{ flex: 1, minWidth: column ?? 0, gap: 6 }}>
                    <CompactText weight="semibold" numberOfLines={whole ? 0 : 1}>
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
                  <View
                    style={{
                      alignItems: 'flex-end',
                      gap: 1,
                      marginLeft: column ? 'auto' : undefined,
                    }}
                  >
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
  const title = useBalanceTitle();
  /**
   * The currency the member chose, or the one Balances opened on in this Group (#725): fixed once
   * the balances first answer, so a payment that settles the member in the currency shown
   * doesn't move Balances to another one.
   */
  const [chosen, setChosen] = useState(() =>
    balances.data
      ? {
          groupId: group.id,
          currency: currencyPositions(group, balances.data, currentUserId).opening,
        }
      : null,
  );
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
                <View style={title}>
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
  // One currency at a time (#725): the main currency, then each other currency money is in.
  const { currencies, positions, opening } = currencyPositions(group, balances.data, currentUserId);
  // Balances that answer after they opened, or another Group's.
  if (chosen?.groupId !== group.id) setChosen({ groupId: group.id, currency: opening });
  const currency =
    chosen?.groupId === group.id && currencies.includes(chosen.currency)
      ? chosen.currency
      : opening;
  const several = currencies.length > 1;
  const shown = balances.data.find((bucket) => bucket.currency === currency) ?? {
    currency,
    balances: [],
    debts: [],
  };
  const payments = recordablePayments(balances.data, group, currentUserId, currency);
  const inCurrency = (heading: string) => (several ? `${heading} · ${currency}` : heading);
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
      {several ? (
        <BalanceCurrencySwitch
          tabs={currencies.map((code) => ({
            currency: code,
            main: code === group.defaultCurrency,
            balance: positions[code] ?? 0,
          }))}
          value={currency}
          onChange={(code) => setChosen({ groupId: group.id, currency: code })}
        />
      ) : null}
      {balances.data.length === 0 ? (
        <Card padded>
          <CompactText weight="semibold" tone="secondary">
            Settled up
          </CompactText>
        </Card>
      ) : (
        <MemberBalanceCard
          bucket={shown}
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
      )}
      {payments.length ? (
        <SuggestedPayments
          title={inCurrency('Suggested payments')}
          payments={payments}
          currentUserId={currentUserId}
          offline={offline}
          locked={balances.changed === true}
          unavailable={recordUnavailable}
          recordedIn={currency === group.defaultCurrency ? null : group.defaultCurrency}
          onRecord={onRecord}
        />
      ) : null}
      {balances.data.length === 0 ? null : (
        <Everyone bucket={shown} currentUserId={currentUserId} title={inCurrency('Everyone')} />
      )}
      {several ? (
        <CompactText variant="caption" tone="secondary" style={{ paddingHorizontal: 2 }}>
          Each currency keeps its own balances. Nothing is converted.
        </CompactText>
      ) : null}
    </View>
  );
}
