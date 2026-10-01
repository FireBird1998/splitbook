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
  radius,
} from './compact';
import { Field, FieldError } from './group-workflows';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';

export const recordPaymentFootnote = 'Records a payment made outside Splitbook. No money moves.';

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
  onClose: () => void;
}) {
  const theme = useTheme();
  const { draft, status } = state;
  const errors = visibleFieldErrors(settlementFields, state.validation);
  const amountInput = useRef<TextInput | null>(null);
  const noteInput = useRef<TextInput | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const focus = state.validation.focus;
  useEffect(() => {
    // Each rejected Record asks once for the first invalid field; later edits never move focus.
    if (!focus) return;
    if (focus.field === 'note') setNoteOpen(true);
    (focus.field === 'amount' ? amountInput : noteInput).current?.focus();
  }, [focus?.request]);
  useEffect(() => {
    if (!visible) setNoteOpen(false);
  }, [visible]);

  const fullName = (id: string) =>
    state.group?.members.find((member) => member.user.id === id)?.user.name ?? 'Former member';
  const name = (id: string) => (id === currentUserId ? 'You' : fullName(id));
  const editable = Boolean(draft) && ['editing', 'review'].includes(status) && !state.attempt;
  const extra = draft ? overpayment(state, currentUserId, name(draft.paidBy)) : null;
  const waitingForTick = Boolean(extra) && !state.acknowledged;
  const paid = draft ? minor(draft.amount, draft.currency) : null;
  const amountLabel =
    draft && paid !== null && paid > 0
      ? formatCurrency(toMajorAmount(paid, draft.currency), draft.currency)
      : undefined;
  // A single correction already shows on its field.
  const message =
    state.message && !Object.values(errors).includes(state.message) ? state.message : null;

  const footer = draft ? (
    <>
      {status === 'uncertain' ? (
        <CompactButton label="Retry payment" block onPress={onRecord} />
      ) : status !== 'blocked' ? (
        <CompactButton
          label="Record payment"
          amount={amountLabel}
          block
          disabled={status === 'saving' || waitingForTick}
          hint={waitingForTick ? 'Tick “I meant to pay more than suggested” first.' : undefined}
          onPress={onRecord}
        />
      ) : null}
      <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
        {recordPaymentFootnote}
      </CompactText>
    </>
  ) : undefined;

  return (
    <BottomSheet
      visible={visible}
      title="Record payment"
      doneLabel="Close"
      dismissLabel="Close without recording"
      onDone={onClose}
      footer={footer}
    >
      {status === 'loading' || status === 'saving' ? (
        <View style={{ marginHorizontal: -20 }}>
          <LinearProgress
            label={status === 'saving' ? 'Recording payment' : 'Checking the latest balances'}
          />
        </View>
      ) : null}
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
      {!draft ? (
        status === 'loading' ? (
          <CompactText tone="secondary">Checking the latest balances…</CompactText>
        ) : null
      ) : (
        <>
          <View
            accessible
            accessibilityLabel={`${
              draft.paidBy === currentUserId
                ? `You pay ${fullName(draft.paidTo)}`
                : `${fullName(draft.paidBy)} pays ${draft.paidTo === currentUserId ? 'you' : fullName(draft.paidTo)}`
            }.${
              state.suggested === null
                ? ''
                : ` Suggested ${formatCurrency(state.suggested, draft.currency)}.`
            }`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          >
            <CompactAvatar name={fullName(draft.paidBy)} />
            <CompactText weight="semibold">{name(draft.paidBy)}</CompactText>
            <Icon name="arrow-forward" size={18} color={theme.textMuted} />
            <CompactAvatar name={fullName(draft.paidTo)} />
            <CompactText weight="semibold" style={{ flexShrink: 1 }}>
              {name(draft.paidTo)}
            </CompactText>
            {state.suggested !== null ? (
              <CompactText variant="caption" tone="secondary" style={{ marginLeft: 'auto' }}>
                Suggested {formatCurrency(state.suggested, draft.currency)}
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  accessible
                  accessibilityLabel={`Currency ${draft.currency}, the Group’s currency`}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 10,
                    backgroundColor: theme.surfaceMuted,
                  }}
                >
                  <CompactText tone="secondary" style={{ fontFamily: fonts.mono, fontSize: 15 }}>
                    {draft.currency}
                  </CompactText>
                </View>
                <TextInput
                  ref={amountInput}
                  value={draft.amount}
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
                    if (amount !== draft.amount && acceptsNumericText(amount, draft.amount))
                      onChange({ amount });
                  }}
                  onBlur={() => onLeaveField('amount')}
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
              value={draft.note.trim() || 'Add a note'}
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
              value={draft.note}
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
