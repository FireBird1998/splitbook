import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { getCurrency } from '@splitbook/shared/currency';
import {
  rateText,
  suggestedRateText,
  type RateSuggestion,
} from '@splitbook/shared/cross-currency-payment';
import { decimalMoney, minorMoney } from '@splitbook/shared/cross-currency-settlement';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import { groupCurrencies } from '@splitbook/shared/group-currencies';
import { acceptsNumericText } from '../data/field-feedback';
import {
  readBatchPayment,
  type BatchLine,
  type RateState,
  type SettlementState,
} from '../data/settlement';
import {
  Banner,
  BottomSheet,
  Card,
  Chip,
  CompactButton,
  CompactText,
  Divider,
  LinearProgress,
  progressHeight,
  radius,
  useTextColumn,
} from './compact';
import { CodeChip } from './cross-currency-fields';
import { inPlace } from './financial-views';
import {
  checkingBalances,
  recordPaymentFootnote,
  recordWaitsForCheck,
  retryWaitsForCheck,
} from './payment-words';
import { fonts, useTheme } from './theme';

const symbol = (currency: string) => getCurrency(currency)?.symbol ?? currency;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "20 Oct", from a provider's calendar date, whatever the phone's time zone. */
const rateDay = (asOf: string) => {
  const [, month, day] = asOf.split('-').map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
};
/** "Frankfurter, 20 Oct", or "rates of 21 Oct" for a second source, which its link names. */
const sourceWords = (suggestion: RateSuggestion) =>
  suggestion.source === 'frankfurter'
    ? `Frankfurter, ${rateDay(suggestion.asOf)}`
    : `rates of ${rateDay(suggestion.asOf)}`;

/** One Debt of the payment as the sheet shows it: from the member's entries, or as it was sent. */
interface Leg extends BatchLine {
  rateState: RateState | null;
  custom: string | null;
}

/** "₹1,480.00 Debt", or "€20.00 Debt × ₹92.10": what a Debt clears, and at what rate. */
function legWords(leg: Leg, paidCurrency: string) {
  const debt = minorMoney(leg.debtMinor, leg.currency);
  const paid = leg.paidMinor === null ? null : minorMoney(leg.paidMinor, paidCurrency);
  const rate = leg.rate && decimalMoney(rateText(leg.rate), paidCurrency);
  const suggestion = leg.rateState?.status === 'ready' ? leg.rateState.suggestion : null;
  const kindWords =
    leg.kind === 'suggested'
      ? suggestion
        ? `suggested, ${sourceWords(suggestion)}`
        : 'suggested'
      : leg.kind === 'custom'
        ? 'your rate'
        : 'no rate suggested';
  const caption =
    leg.kind === 'same'
      ? 'Same currency, no rate'
      : leg.rateState?.status === 'loading'
        ? 'Looking up a suggested rate…'
        : leg.rateState?.status === 'unreachable'
          ? 'A suggested rate needs a connection.'
          : leg.kind === 'custom' && suggestion
            ? `Your rate · suggested ${decimalMoney(rateText(suggestion.rate), paidCurrency)}, ${sourceWords(suggestion)}`
            : suggestion && (leg.kind === 'suggested' || leg.kind === null)
              ? `Suggested · ${sourceWords(suggestion)}`
              : leg.rateState
                ? 'No rate suggested · Enter the rate you agreed'
                : leg.kind === 'suggested'
                  ? 'Suggested'
                  : leg.kind === 'custom'
                    ? 'Your rate'
                    : 'No rate suggested';
  const spoken =
    leg.kind === 'same'
      ? `${leg.currency} Debt ${debt}, same currency, no rate. Pays ${paid}`
      : rate && paid
        ? `${leg.currency} Debt ${debt} at ${rate} per ${symbol(leg.currency)}, ${kindWords}. Pays ${paid}`
        : `${leg.currency} Debt ${debt}, ${caption}`;
  return {
    title: rate ? `${debt} Debt × ${rate}` : `${debt} Debt`,
    caption,
    paid,
    spoken,
  };
}

/** One Debt of the payment: its line, and its rate to change while the member enters it. */
function DebtLeg({
  leg,
  paidCurrency,
  editable,
  onEditRate,
  onRestoreRate,
  onOpenLink,
}: {
  leg: Leg;
  paidCurrency: string;
  editable: boolean;
  onEditRate: (currency: string, text: string) => void;
  onRestoreRate: (currency: string) => void;
  onOpenLink: (url: string) => void;
}) {
  const theme = useTheme();
  const column = useTextColumn();
  const [changing, setChanging] = useState(false);
  const words = legWords(leg, paidCurrency);
  const suggestion = leg.rateState?.status === 'ready' ? leg.rateState.suggestion : null;
  const noSuggestion = leg.rateState?.status === 'none';
  // The rate's own field: once Change is chosen, while the member's own rate stands, or when
  // there is no suggestion to pay at.
  const field =
    editable && leg.kind !== 'same' && (changing || leg.custom !== null || noSuggestion);
  const attribution = suggestion?.attributionRequired ? suggestion.attribution : null;
  const mono = { fontFamily: fonts.mono, fontVariant: ['tabular-nums' as const] };
  return (
    <View style={{ gap: 6, paddingVertical: 10 }}>
      <View
        accessible
        accessibilityLabel={words.spoken}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          ...(column ? { flexWrap: 'wrap', rowGap: 4 } : {}),
        }}
      >
        <CodeChip code={leg.currency} />
        <View style={{ flex: 1, minWidth: column ?? 0, gap: 2 }}>
          <CompactText weight="semibold" style={mono}>
            {words.title}
          </CompactText>
          <CompactText variant="caption" tone="secondary">
            {words.caption}
          </CompactText>
        </View>
        <CompactText style={{ ...mono, marginLeft: 'auto' }}>{words.paid ?? '—'}</CompactText>
      </View>
      {attribution || (editable && suggestion && leg.kind !== 'same') ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {attribution ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={attribution.text}
              onPress={() => onOpenLink(attribution.url)}
              hitSlop={8}
            >
              <CompactText
                variant="caption"
                tone="brand"
                weight="semibold"
                style={{ textDecorationLine: 'underline' }}
              >
                {attribution.text}
              </CompactText>
            </Pressable>
          ) : null}
          {editable && suggestion && leg.custom !== null ? (
            <CompactButton
              label={`Use ${decimalMoney(rateText(suggestion.rate), paidCurrency)}`}
              accessibilityLabel={`Use ${decimalMoney(rateText(suggestion.rate), paidCurrency)} for the ${leg.currency} Debt`}
              variant="text"
              dense
              onPress={() => {
                setChanging(false);
                onRestoreRate(leg.currency);
              }}
            />
          ) : editable && suggestion && !field ? (
            <CompactButton
              label="Change"
              accessibilityLabel={`Change the rate for the ${leg.currency} Debt`}
              variant="text"
              dense
              onPress={() => setChanging(true)}
            />
          ) : null}
        </View>
      ) : null}
      {field ? (
        <View
          style={{
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 12,
            borderWidth: 1,
            borderRadius: radius.tile,
            borderColor: theme.borderStrong,
            backgroundColor: theme.surface,
          }}
        >
          <CompactText variant="small" tone="secondary">
            {`1 ${symbol(leg.currency)} =`}
          </CompactText>
          <CompactText tone="secondary" style={{ fontFamily: fonts.mono }}>
            {symbol(paidCurrency)}
          </CompactText>
          <TextInput
            value={leg.custom ?? (suggestion ? suggestedRateText(suggestion.rate) : '')}
            maxLength={40}
            keyboardType="decimal-pad"
            placeholder="Rate"
            placeholderTextColor={theme.textMuted}
            selectionColor={theme.brand.main}
            accessibilityLabel={`Rate for the ${leg.currency} Debt, ${paidCurrency} for each ${leg.currency}`}
            onChangeText={(text) => {
              const shown = leg.custom ?? '';
              if (text !== shown && acceptsNumericText(text, shown)) onEditRate(leg.currency, text);
            }}
            style={{
              flex: 1,
              minHeight: 44,
              color: theme.text,
              fontFamily: fonts.mono,
              fontSize: 17,
              textAlign: 'right',
              padding: 0,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Settle up (#734, board "Android · Settle both currencies at once"): one payment, in one
 * currency, that clears every Debt between two people, each at its own rate, recorded as one
 * Settlement each in one request. A sheet over Balances, as Record payment is: it checks the latest
 * balances first, and keeps an unconfirmed payment locked for an explicit Retry.
 */
export function SettleAllSheet({
  visible,
  state,
  currentUserId,
  onRecord,
  onRetry,
  onClose,
  onDiscard,
  onChoosePaidCurrency = () => undefined,
  onEditBatchRate = () => undefined,
  onRestoreBatchRate = () => undefined,
  onOpenLink = () => undefined,
}: {
  visible: boolean;
  state: SettlementState;
  currentUserId: string;
  onRecord: () => void;
  onRetry: () => void;
  onClose: () => void;
  onDiscard?: () => void;
  onChoosePaidCurrency?: (currency: string) => void;
  /** The member's own rate for one Debt. */
  onEditBatchRate?: (currency: string, text: string) => void;
  /** Use ₹92.10: a Debt's suggested rate again. */
  onRestoreBatchRate?: (currency: string) => void;
  onOpenLink?: (url: string) => void;
}) {
  const { status, batch, draft, chosen, attempt } = state;
  const paidBy = batch?.paidBy ?? draft?.paidBy ?? chosen?.paidBy ?? '';
  const paidTo = batch?.paidTo ?? draft?.paidTo ?? chosen?.paidTo ?? '';
  const fullName = (id: string) =>
    (state.group
      ? state.group.members.find((member) => member.user.id === id)?.user.name
      : state.known[id]) ?? 'Former member';
  const youPay = paidBy === currentUserId;
  const other = fullName(youPay ? paidTo : paidBy);
  const checking = status === 'loading';
  const editable = !!batch && ['editing', 'review'].includes(status) && !attempt;
  // While entered, each Debt as the shared rules read it; once sent, as it was sent.
  const reading = batch && !attempt ? readBatchPayment(batch) : null;
  const paidCurrency = (reading ? batch?.paidCurrency : draft?.currency) ?? '';
  const legs: Leg[] = reading
    ? reading.lines.map((line) => ({
        ...line,
        rateState: batch!.rates[line.currency]?.rate ?? null,
        custom: batch!.rates[line.currency]?.custom ?? null,
      }))
    : (draft?.batch ?? []).map((row) => {
        const debtMinor = parseAmountMinor(row.amount, row.currency);
        return {
          currency: row.currency,
          debtMinor,
          paidMinor: row.amountPaidMinor ?? debtMinor,
          rate: row.appliedRate ?? null,
          kind: row.amountPaidMinor === undefined ? ('same' as const) : (row.rateKind ?? null),
          rateState: null,
          custom: null,
        };
      });
  const totalMinor = reading
    ? (reading.amounts?.totalPaidMinor ?? null)
    : draft?.batch && draft.amount
      ? parseAmountMinor(draft.amount, draft.currency)
      : null;
  const waiting = reading?.waiting ?? null;
  const count = legs.length;
  const payCurrencies =
    batch && state.group
      ? batch.debts
          .map(({ currency }) => currency)
          .filter((currency) => groupCurrencies(state.group!).includes(currency))
      : [];
  const retrying = checking && attempt !== null;
  // What it pays in all, as Record and the total say it.
  const totalWords = totalMinor === null ? undefined : minorMoney(totalMinor, paidCurrency);

  const footer = (
    <>
      {status === 'blocked' && state.accessLost && attempt && onDiscard ? (
        <CompactButton label="Discard unconfirmed payment" block onPress={onDiscard} />
      ) : status === 'uncertain' ? (
        <CompactButton label="Retry payment" block onPress={onRecord} />
      ) : status === 'error' ? (
        <CompactButton label="Try again" block onPress={onRetry} />
      ) : status !== 'blocked' ? (
        <CompactButton
          label={retrying ? 'Retry payment' : 'Record'}
          amount={retrying ? undefined : totalWords}
          busy={status === 'saving' ? 'Recording payment…' : undefined}
          block
          disabled={checking || waiting !== null || !batch}
          hint={
            checking
              ? retrying
                ? retryWaitsForCheck
                : recordWaitsForCheck
              : (waiting ?? undefined)
          }
          onPress={onRecord}
        />
      ) : null}
      {inPlace({
        holds: checking ? (
          <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            {recordPaymentFootnote}
          </CompactText>
        ) : null,
        children: (
          <View style={{ alignSelf: 'stretch' }}>
            <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              {checking ? checkingBalances : (waiting ?? recordPaymentFootnote)}
            </CompactText>
          </View>
        ),
      })}
    </>
  );

  return (
    <BottomSheet
      visible={visible}
      title={`Settle up with ${other}`}
      doneLabel="Close"
      dismissLabel="Close without recording"
      dismissible={status !== 'saving'}
      onDone={onClose}
      footer={footer}
    >
      {/* The bar's room stays, so nothing below moves when it comes or goes. */}
      <View style={{ marginHorizontal: -20, height: progressHeight }}>
        {checking || status === 'saving' ? (
          <LinearProgress
            label={status === 'saving' ? 'Recording payment' : 'Checking the latest balances'}
          />
        ) : null}
      </View>
      {status === 'uncertain' ? (
        <Banner
          tone="warning"
          title="Payment not confirmed"
          message={state.message ?? 'This payment may already be recorded.'}
        />
      ) : status === 'blocked' || status === 'error' ? (
        <Banner tone="error" message={state.message ?? 'This payment can’t be recorded.'} />
      ) : state.message && state.message !== waiting ? (
        <Banner tone={batch ? 'warning' : 'info'} message={state.message} />
      ) : null}
      {!count ? (
        checking ? (
          <CompactText tone="secondary">{checkingBalances}</CompactText>
        ) : null
      ) : (
        <>
          <CompactText tone="secondary">
            {`${youPay ? `You owe ${other}` : `${other} owes you`} in ${count} currencies. One payment can clear ${count === 2 ? 'both' : 'them all'}; each Debt keeps its own rate.`}
          </CompactText>
          {editable && payCurrencies.length > 1 ? (
            <View style={{ gap: 6 }}>
              <CompactText variant="caption" tone="secondary" weight="medium">
                Pay in
              </CompactText>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Pay in"
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
              >
                {payCurrencies.map((code) => (
                  <Chip
                    key={code}
                    role="radio"
                    label={code}
                    selected={code === paidCurrency}
                    onPress={() => onChoosePaidCurrency(code)}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <Card>
            <View style={{ paddingHorizontal: 14 }}>
              {legs.map((leg, index) => (
                <View key={leg.currency}>
                  {index > 0 ? <Divider inset={0} /> : null}
                  <DebtLeg
                    leg={leg}
                    paidCurrency={paidCurrency}
                    editable={editable}
                    onEditRate={onEditBatchRate}
                    onRestoreRate={onRestoreBatchRate}
                    onOpenLink={onOpenLink}
                  />
                </View>
              ))}
              <Divider inset={0} />
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 12,
                }}
              >
                <CompactText weight="semibold">
                  {youPay ? `You pay ${other}` : `${other} pays you`}
                </CompactText>
                <CompactText
                  weight="semibold"
                  style={{ marginLeft: 'auto', fontFamily: fonts.mono, fontSize: 20 }}
                >
                  {totalWords ?? '—'}
                </CompactText>
              </View>
            </View>
          </Card>
          <CompactText variant="caption" tone="secondary">
            {`Records ${count} Settlements, one for each Debt, each with its own rate. Activity shows them as one payment. To pay part of a Debt, record it on its own.`}
          </CompactText>
        </>
      )}
    </BottomSheet>
  );
}
