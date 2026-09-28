import { TextInput, View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { SettlementDraft, SettlementState } from '../data/settlement';
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
}: {
  state: SettlementState;
  accountId: string;
  onSelect: (payer: string, recipient: string, currency: string) => void;
  onChange: (patch: Partial<Pick<SettlementDraft, 'amount' | 'note'>>) => void;
  onReview: () => void;
  onAcknowledge: () => void;
  onRecord: () => void;
  onRefresh: () => void;
}) {
  const theme = useTheme(),
    draft = state.draft;
  const name = (id: string) =>
    state.group?.members.find((m) => m.user.id === id)?.user.name ?? `Member · ${id.slice(-6)}`;
  const money = (amount: number, currency: string) =>
    `${formatCurrency(amount, currency)} ${currency}`;
  const editable = state.status === 'editing';
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
          label={state.status === 'saving' ? 'Recording payment…' : 'Refreshing payment review…'}
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
              <Copy>Actual amount paid</Copy>
              <TextInput
                accessibilityLabel="Actual amount paid"
                value={draft.amount}
                onChangeText={(amount) => onChange({ amount })}
                keyboardType="decimal-pad"
                maxLength={40}
                style={{
                  color: theme.text,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 14,
                  fontFamily: fonts.mono,
                  fontSize: 22,
                }}
              />
              <Copy>Note (optional)</Copy>
              <TextInput
                accessibilityLabel="Payment note"
                value={draft.note}
                onChangeText={(note) => onChange({ note })}
                maxLength={500}
                multiline
                style={{
                  color: theme.text,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 14,
                  fontFamily: fonts.regular,
                  fontSize: 16,
                }}
              />
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
              <Copy>
                Confirm who paid, who received it, and the actual amount. The balance may change
                again before this is recorded.
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
                onPress={onRecord}
                disabled={exceeds && !state.acknowledged}
              />
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
