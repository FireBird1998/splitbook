import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import { acceptsNumericText, visibleFieldErrors } from '../data/field-feedback';
import {
  settlementFields,
  type SettlementDraft,
  type SettlementField,
  type SettlementState,
} from '../data/settlement';
import {
  Banner,
  BottomSheet,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  FieldMarker,
  LinearProgress,
  SelectorTile,
  TileGrid,
  progressHeight,
  radius,
} from './compact';
import { inPlace } from './financial-views';
import { Field, FieldError } from './group-workflows';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';

export const recordPaymentFootnote = 'Records a payment made outside Splitbook. No money moves.';
/** Record's reason while the sheet checks the latest balances (#334). */
export const recordWaitsForCheck = 'Record is available once the latest balances are checked.';
const checkingBalances = 'Checking the latest balances…';

/** Minor units, or null while the entry isn't a valid amount yet. */
const minor = (amount: string | number, currency: string) => {
  try {
    return parseAmountMinor(amount, currency);
  } catch {
    return null;
  }
};

/**
 * Above the suggestion, how much extra and where the payer would stand afterwards. Balances
 * are simplified across the Group, so this states the payer's overall position, not a debt
 * between these two people.
 */
export function overpayment(state: SettlementState, currentUserId: string, name: string) {
  const { draft, suggested } = state;
  if (!draft || suggested === null) return null;
  const paid = minor(draft.amount, draft.currency),
    suggestion = minor(suggested, draft.currency);
  if (paid === null || suggestion === null || paid <= suggestion) return null;
  const money = (value: number) =>
    formatCurrency(toMajorAmount(Math.abs(value), draft.currency), draft.currency);
  const net =
    state.balances
      .find((bucket) => bucket.currency === draft.currency)
      ?.balances.find(({ user }) => user.id === draft.paidBy)?.balance ?? 0;
  const after = (minor(net, draft.currency) ?? 0) + paid;
  const you = draft.paidBy === currentUserId;
  const position =
    after > 0
      ? `${you ? 'you’d' : `${name} would`} be owed ${money(after)}`
      : after < 0
        ? `${you ? 'you’d' : `${name} would`} still owe ${money(after)}`
        : `${you ? 'you’d' : `${name} would`} be settled up`;
  return `That’s ${money(paid - suggestion)} more than suggested. Afterwards ${position} in this Group.`;
}

function Checkbox({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? theme.brand.main : theme.borderStrong,
          backgroundColor: checked ? theme.brand.main : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Icon name="checkmark" size={16} color={theme.brand.contrastText} /> : null}
      </View>
      <CompactText weight="semibold" style={{ flex: 1 }}>
        {label}
      </CompactText>
    </Pressable>
  );
}

/**
 * Record payment, a sheet over Balances. Pre-filled from the chosen suggestion; Record checks
 * the latest balances live, waits for the overpayment tick, and keeps an unconfirmed record
 * locked for an explicit retry.
 *
 * While the sheet checks the latest balances, it shows the chosen payment as Balances showed
 * it, locked, and Record waits for the check, saying so where the footnote was; when the check
 * can't reach SplitBook, the figures stay and Try again checks again (#334). Nothing moves when
 * the progress bar comes or goes: the sheet keeps its room.
 */
export function RecordPaymentSheet({
  visible,
  state,
  currentUserId,
  today,
  onChange,
  onLeaveField,
  onAcknowledge,
  onRecord,
  onRetry,
  onClose,
}: {
  visible: boolean;
  state: SettlementState;
  currentUserId: string;
  /** Shown on the Date tile, e.g. "Today, Oct 1": a payment is dated when it's recorded. */
  today: string;
  onChange: (patch: Partial<Pick<SettlementDraft, 'amount' | 'note'>>) => void;
  onLeaveField: (field: SettlementField) => void;
  onAcknowledge: (acknowledged: boolean) => void;
  onRecord: () => void;
  /** Try again, after the sheet couldn't check the latest balances: it checks them again. */
  onRetry: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { draft, status, chosen } = state;
  // Until the check confirms the chosen payment, or when it can't run, the payment as Balances
  // showed it: shown locked, and never recorded from.
  const shown =
    !draft && (status === 'loading' || status === 'error') ? (chosen?.shown ?? null) : null;
  const figures: SettlementDraft | null =
    draft ??
    (shown !== null && chosen
      ? {
          paidBy: chosen.paidBy,
          paidTo: chosen.paidTo,
          currency: chosen.currency,
          amount: String(shown),
          note: '',
        }
      : null);
  const suggested = draft ? state.suggested : shown;
  const checking = status === 'loading';
  const errors = visibleFieldErrors(settlementFields, state.validation);
  const amountInput = useRef<TextInput | null>(null);
  const noteInput = useRef<TextInput | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [amountFocused, setAmountFocused] = useState(false);
  const focus = state.validation.focus;
  useEffect(() => {
    // Each rejected Record asks once for the first invalid field; later edits never move focus.
    if (!focus) return;
    if (focus.field === 'note') setNoteOpen(true);
    (focus.field === 'amount' ? amountInput : noteInput).current?.focus();
  }, [focus?.request]);
  useEffect(() => {
    if (visible) return;
    setNoteOpen(false);
    setAmountFocused(false);
  }, [visible]);

  // Once the check has read the Group, it alone names people; until then, this phone's own
  // knowledge of the Group does. "Former member" only for someone neither knows (#334).
  const fullName = (id: string) =>
    (state.group
      ? state.group.members.find((member) => member.user.id === id)?.user.name
      : state.known[id]) ?? 'Former member';
  const name = (id: string) => (id === currentUserId ? 'You' : fullName(id));
  const editable = Boolean(draft) && ['editing', 'review'].includes(status) && !state.attempt;
  const extra = draft ? overpayment(state, currentUserId, name(draft.paidBy)) : null;
  const waitingForTick = Boolean(extra) && !state.acknowledged;
  const paid = figures ? minor(figures.amount, figures.currency) : null;
  const amountLabel =
    figures && paid !== null && paid > 0
      ? formatCurrency(toMajorAmount(paid, figures.currency), figures.currency)
      : undefined;
  // A single correction already shows on its field.
  const message =
    state.message && !Object.values(errors).includes(state.message) ? state.message : null;
  // An unconfirmed payment found on this phone waits for the check as Retry.
  const retrying = checking && state.attempt !== null;

  const footer =
    figures || status === 'error' ? (
      <>
        {status === 'uncertain' ? (
          <CompactButton label="Retry payment" block onPress={onRecord} />
        ) : status === 'error' ? (
          <CompactButton label="Try again" block onPress={onRetry} />
        ) : status !== 'blocked' ? (
          <CompactButton
            label={retrying ? 'Retry payment' : 'Record payment'}
            amount={retrying ? undefined : amountLabel}
            busy={status === 'saving' ? 'Recording payment…' : undefined}
            block
            disabled={checking || waitingForTick}
            hint={
              checking
                ? recordWaitsForCheck
                : waitingForTick
                  ? 'Tick “I meant to pay more than suggested” first.'
                  : undefined
            }
            onPress={onRecord}
          />
        ) : null}
        {/* While the check runs, it says so in the footnote's place, which the footnote holds. */}
        {inPlace({
          holds: checking ? (
            <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              {recordPaymentFootnote}
            </CompactText>
          ) : null,
          children: (
            <View style={{ alignSelf: 'stretch' }}>
              <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
                {checking ? checkingBalances : recordPaymentFootnote}
              </CompactText>
            </View>
          ),
        })}
      </>
    ) : undefined;

  return (
    <BottomSheet
      visible={visible}
      title="Record payment"
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
      ) : message ? (
        <Banner tone={draft ? 'warning' : 'info'} message={message} />
      ) : null}
      {!figures ? (
        checking ? (
          <CompactText tone="secondary">{checkingBalances}</CompactText>
        ) : null
      ) : (
        <>
          <View
            accessible
            accessibilityLabel={`${
              figures.paidBy === currentUserId
                ? `You pay ${fullName(figures.paidTo)}`
                : `${fullName(figures.paidBy)} pays ${figures.paidTo === currentUserId ? 'you' : fullName(figures.paidTo)}`
            }.${
              suggested === null ? '' : ` Suggested ${formatCurrency(suggested, figures.currency)}.`
            }`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          >
            <CompactAvatar name={fullName(figures.paidBy)} />
            <CompactText weight="semibold">{name(figures.paidBy)}</CompactText>
            <Icon name="arrow-forward" size={18} color={theme.textMuted} />
            <CompactAvatar name={fullName(figures.paidTo)} />
            <CompactText weight="semibold" style={{ flexShrink: 1 }}>
              {name(figures.paidTo)}
            </CompactText>
            {suggested !== null ? (
              <CompactText variant="caption" tone="secondary" style={{ marginLeft: 'auto' }}>
                Suggested{' '}
                <CompactText variant="caption" tone="secondary" style={{ fontFamily: fonts.mono }}>
                  {formatCurrency(suggested, figures.currency)}
                </CompactText>
              </CompactText>
            ) : null}
          </View>
          <Card state={errors.amount ? 'error' : editable ? 'default' : 'locked'} padded>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <CompactText
                  variant="caption"
                  tone={errors.amount ? 'negative' : 'secondary'}
                  weight="medium"
                >
                  Amount paid
                </CompactText>
                <FieldMarker kind="required" />
              </View>
              {/* As on the Expense form: a transparent border keeps blur from shifting layout. */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  marginHorizontal: -10,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderWidth: 2,
                  borderRadius: radius.tile,
                  borderColor: amountFocused && editable ? theme.focus : 'transparent',
                }}
              >
                <View
                  accessible
                  accessibilityLabel={`Currency ${figures.currency}, the Group’s currency`}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 10,
                    backgroundColor: theme.surfaceMuted,
                  }}
                >
                  <CompactText tone="secondary" style={{ fontFamily: fonts.mono, fontSize: 15 }}>
                    {figures.currency}
                  </CompactText>
                </View>
                <TextInput
                  ref={amountInput}
                  value={figures.amount}
                  maxLength={40}
                  keyboardType="decimal-pad"
                  editable={editable}
                  placeholder="0.00"
                  placeholderTextColor={theme.textMuted}
                  selectionColor={theme.brand.main}
                  accessibilityLabel="Amount paid, required"
                  accessibilityHint={errors.amount}
                  onChangeText={(amount) => {
                    // A refused edit leaves the field showing the draft's amount.
                    if (amount !== figures.amount && acceptsNumericText(amount, figures.amount))
                      onChange({ amount });
                  }}
                  onFocus={() => setAmountFocused(true)}
                  onBlur={() => {
                    setAmountFocused(false);
                    onLeaveField('amount');
                  }}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    color: theme.text,
                    fontFamily: fonts.mono,
                    fontSize: 32,
                    lineHeight: 38,
                    padding: 0,
                  }}
                />
              </View>
              <FieldError message={errors.amount} />
            </View>
          </Card>
          {extra && editable ? (
            <View
              style={{
                gap: 6,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: radius.tile,
                backgroundColor: theme.warning.bg,
              }}
            >
              <View
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={{ flexDirection: 'row', gap: 10 }}
              >
                <Icon name="alert-circle-outline" size={20} color={theme.status.warning} />
                <CompactText variant="small" style={{ flex: 1 }}>
                  {extra}
                </CompactText>
              </View>
              <View style={{ paddingLeft: 30 }}>
                <Checkbox
                  label="I meant to pay more than suggested"
                  checked={state.acknowledged}
                  onPress={() => onAcknowledge(!state.acknowledged)}
                />
              </View>
            </View>
          ) : null}
          <TileGrid>
            <SelectorTile icon="calendar-outline" label="Date" value={today} />
            <SelectorTile
              icon="document-text-outline"
              label="Note, optional"
              value={figures.note.trim() || 'Add a note'}
              locked={!editable}
              onPress={() => {
                setNoteOpen(true);
                setTimeout(() => noteInput.current?.focus(), 0);
              }}
            />
          </TileGrid>
          {noteOpen || errors.note ? (
            <Field
              label="Note"
              inputRef={(node) => {
                noteInput.current = node;
              }}
              error={errors.note}
              value={figures.note}
              editable={editable}
              maxLength={500}
              multiline
              onChangeText={(note) => onChange({ note })}
              onBlur={() => onLeaveField('note')}
            />
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}
