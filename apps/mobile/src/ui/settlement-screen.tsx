import { useEffect, useRef } from 'react';
import { View, type TextInput } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import { visibleFieldErrors } from '../data/field-feedback';
import {
  settlementFields,
  type SettlementDraft,
  type SettlementField,
  type SettlementState,
} from '../data/settlement';
import { Field } from './group-workflows';
import { Button, Copy, Label, Loading, Panel } from './primitives';
import { fonts, useTheme } from './theme';

export function SettlementScreen({
  state,
  accountId,
  onSelect,
  onChange,
  onReview,
  onAcknowledge,
  onRecord,
  onRefresh,
  onLeaveField = () => undefined,
  onReveal = () => undefined,
}: {
  state: SettlementState;
  accountId: string;
  onSelect: (payer: string, recipient: string, currency: string) => void;
  onChange: (patch: Partial<Pick<SettlementDraft, 'amount' | 'note'>>) => void;
  onReview: () => void;
  onAcknowledge: () => void;
  onRecord: () => void;
  onRefresh: () => void;
  onLeaveField?: (field: SettlementField) => void;
  /** Scrolls a field into view within the screen's ScrollView. */
  onReveal?: (section: View) => void;
}) {
  const theme = useTheme(),
    draft = state.draft;
  const errors = visibleFieldErrors(settlementFields, state.validation);
  const sections = useRef<Partial<Record<SettlementField, View | null>>>({});
  const inputs = useRef<Partial<Record<SettlementField, TextInput | null>>>({});
  const focus = state.validation.focus;
  useEffect(() => {
    // Each rejected review asks once for the first invalid field; later edits never move focus.
    if (!focus) return;
    const section = sections.current[focus.field];
    if (section) onReveal(section);
    inputs.current[focus.field]?.focus();
  }, [focus?.request]);
  const name = (id: string) =>
    state.group?.members.find((m) => m.user.id === id)?.user.name ?? `Member · ${id.slice(-6)}`;
  const money = (amount: number, currency: string) =>
    `${formatCurrency(amount, currency)} ${currency}`;
  const editable = state.status === 'editing';
  const confirmFirst = 'Record is available once you confirm this is the actual amount paid.';
  let exceeds = false;
  if (draft && state.suggested !== null) {
    try {
      exceeds =
        parseAmountMinor(draft.amount, draft.currency) >
        parseAmountMinor(state.suggested, draft.currency);
    } catch {
      /* Invalid editable input is validated during Review. */
    }
  }
  const debts = state.balances.flatMap((bucket) =>
    bucket.debts
      .filter(
        (d) =>
          d.from.id &&
          d.to.id &&
          canRecordSettlement(accountId, d.from.id, d.to.id) &&
          bucket.currency === state.group?.defaultCurrency &&
          state.group.members.some((m) => m.user.id === d.from.id) &&
          state.group.members.some((m) => m.user.id === d.to.id),
      )
      .map((d) => ({ ...d, currency: bucket.currency })),
  );
  return (
    <View style={{ gap: 20 }}>
      <Label>{state.group?.name ?? 'GROUP PAYMENTS'}</Label>
      <Copy
        accessibilityRole="header"
        style={{ fontFamily: fonts.semibold, fontSize: 30, lineHeight: 38 }}
      >
        Payments
      </Copy>
      <Copy>
        Record a payment that already happened. SplitBook does not transfer money or confirm a bank
        payment. Recording a payment does not close a Household Month.
      </Copy>
      {state.message ? <Copy accessibilityRole="alert">{state.message}</Copy> : null}
      {state.status === 'loading' || state.status === 'saving' ? (
        <Loading
          label={
            state.status === 'saving'
              ? 'Recording payment… Keep this screen open until SplitBook confirms it.'
              : 'Refreshing payment review…'
          }
        />
      ) : null}
      {draft ? (
        <Panel>
          <Copy style={{ fontFamily: fonts.semibold }}>
            {name(draft.paidBy)} paid {name(draft.paidTo)}
          </Copy>
          <Label>ACTUAL PAYMENT · {draft.currency}</Label>
          {editable ? (
            <>
              <View
                ref={(node) => {
                  sections.current.amount = node;
                }}
              >
                <Field
                  label="Actual amount paid"
                  required
                  hint={`What ${name(draft.paidBy)} actually paid, in ${draft.currency}. Partial payments are fine.`}
                  inputRef={(node) => {
                    inputs.current.amount = node;
                  }}
                  error={errors.amount}
                  value={draft.amount}
                  onChangeText={(amount) => onChange({ amount })}
                  onBlur={() => onLeaveField('amount')}
                  keyboardType="decimal-pad"
                  maxLength={40}
                  style={{ fontFamily: fonts.mono, fontSize: 22, lineHeight: 30 }}
                />
              </View>
              <View
                ref={(node) => {
                  sections.current.note = node;
                }}
              >
                <Field
                  label="Note (optional)"
                  inputRef={(node) => {
                    inputs.current.note = node;
                  }}
                  error={errors.note}
                  value={draft.note}
                  onChangeText={(note) => onChange({ note })}
                  onBlur={() => onLeaveField('note')}
                  maxLength={500}
                  multiline
                />
              </View>
            </>
          ) : (
            <>
              <Copy style={{ fontFamily: fonts.mono, fontSize: 24, lineHeight: 32 }}>
                {draft.amount} {draft.currency}
              </Copy>
              {draft.note ? <Copy>{draft.note}</Copy> : null}
            </>
          )}
          {state.suggested !== null ? (
            <Copy>Latest reviewed suggestion: {money(state.suggested, draft.currency)}</Copy>
          ) : null}
          {editable ? <Button label="Review payment" onPress={onReview} /> : null}
          {state.status === 'review' ? (
            <>
              <Copy
                accessibilityRole="header"
                style={{ fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28 }}
              >
                Review the payment already made
              </Copy>
              <Copy>
                You’re recording that {name(draft.paidBy)} already paid {name(draft.paidTo)}{' '}
                {money(Number(draft.amount), draft.currency)}. SplitBook doesn’t move money or
                contact a bank; recording only updates this Group’s balances.
              </Copy>
              <Copy style={{ color: theme.textSecondary }}>
                The balance may change again before this is recorded.
              </Copy>
              {exceeds ? (
                <>
                  <Copy accessibilityRole="alert" style={{ color: theme.status.negative }}>
                    This amount exceeds the current suggestion. Record it only if this is the
                    payment that actually happened.
                  </Copy>
                  <Button
                    label={
                      state.acknowledged
                        ? 'Actual amount acknowledged'
                        : 'Yes, this is the actual amount paid'
                    }
                    secondary
                    disabled={state.acknowledged}
                    onPress={onAcknowledge}
                  />
                </>
              ) : null}
              <Button
                label="Record payment"
                hint={exceeds && !state.acknowledged ? confirmFirst : undefined}
                onPress={onRecord}
                disabled={exceeds && !state.acknowledged}
              />
              {exceeds && !state.acknowledged ? (
                <Copy style={{ fontSize: 14, color: theme.textSecondary }}>{confirmFirst}</Copy>
              ) : null}
              <Button label="Change payment details" secondary onPress={() => onChange({})} />
            </>
          ) : null}
          {state.status === 'uncertain' ? (
            <>
              <Copy>
                This submission is locked so a retry cannot become a second payment. Reconnecting
                alone will not send it.
              </Copy>
              <Button label="Retry same payment record" onPress={onRecord} />
            </>
          ) : null}
          {['editing', 'review'].includes(state.status) ? (
            <Button label="Back to payments" secondary onPress={onRefresh} />
          ) : null}
        </Panel>
      ) : null}
      {state.status === 'ready' ? (
        <Panel>
          <Copy
            accessibilityRole="header"
            style={{ fontFamily: fonts.semibold, fontSize: 22, lineHeight: 30 }}
          >
            Record an actual payment
          </Copy>
          <Copy>
            Choose a suggested debt involving you, then review the amount actually paid. Partial
            payments are welcome.
          </Copy>
          {debts.length ? (
            debts.map((debt) => (
              <View key={`${debt.currency}:${debt.from.id}:${debt.to.id}`} style={{ gap: 10 }}>
                <Copy>
                  {debt.from.name} → {debt.to.name}
                </Copy>
                <Copy style={{ fontFamily: fonts.mono }}>{money(debt.amount, debt.currency)}</Copy>
                <Button
                  label={`Review payment from ${debt.from.name} to ${debt.to.name}`}
                  onPress={() => onSelect(debt.from.id!, debt.to.id!, debt.currency)}
                />
              </View>
            ))
          ) : (
            <Copy>No eligible suggested payments in this Group’s currency.</Copy>
          )}
        </Panel>
      ) : null}
      {!['loading', 'saving', 'editing', 'review'].includes(state.status) ? (
        <Button label="Refresh payments" secondary onPress={onRefresh} />
      ) : null}
      {state.group ? (
        <Panel>
          <Copy
            accessibilityRole="header"
            style={{ fontFamily: fonts.semibold, fontSize: 22, lineHeight: 30 }}
          >
            Recorded payments
          </Copy>
          {state.history.length ? (
            state.history.map((item) => (
              <View
                key={item._id}
                style={{ gap: 6, borderTopWidth: 1, borderColor: theme.border, paddingTop: 12 }}
              >
                <Copy>
                  {item.paidBy.name} paid {item.paidTo.name}
                </Copy>
                <Copy style={{ fontFamily: fonts.mono }}>{money(item.amount, item.currency)}</Copy>
                {item.note ? <Copy>{item.note}</Copy> : null}
                <Copy>{new Date(item.createdAt).toLocaleString()}</Copy>
              </View>
            ))
          ) : (
            <Copy>No payments recorded yet.</Copy>
          )}
        </Panel>
      ) : null}
    </View>
  );
}
