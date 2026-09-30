import { canEditExpense } from '../data/expense-record';
import { ExpenseRecordView } from './expense-record-view';
import { useState } from 'react';
import { View, Pressable, Modal, ScrollView, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EXPENSE_CATEGORIES } from '@splitbook/shared/categories';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import {
  expenseMoney,
  type ExpenseDraft,
  type ExpenseEditor as Editor,
} from '../data/expense-draft';
import { Field } from './group-workflows';
import { ReceiptScanPanel } from './receipt-scan-panel';
import { Button, Copy, Label, Loading, Notice, Panel } from './primitives';
import { fonts, useTheme } from './theme';

const methods = [
  { id: 'equal', label: 'Equal', hint: 'Everyone has an equal share.' },
  { id: 'unequal', label: 'Unequal', hint: 'Enter each person’s amount in the Group currency.' },
  { id: 'percentage', label: 'Percentage', hint: 'Enter percentages that add up to 100.' },
  {
    id: 'shares',
    label: 'Shares',
    hint: 'Enter whole-number weights. For example, 2 shares and 1 share split the cost 2:1.',
  },
  { id: 'exact', label: 'Exact', hint: 'Enter exact amounts that add up to the Expense total.' },
] as const;

export function ExpenseEditor({
  state,
  onChange,
  onSave,
  onResume,
  onDiscard,
  onRetry,
  onEdit,
  onReviewDelete,
  onDelete,
  onCancelDelete,
  onReconcile,
  onReviewLatest,
  onAcceptCurrent,
  receiptScanEnabled = false,
  onScanReceipt = () => {},
  onApplyReceiptScan = () => {},
  onDismissReceiptScan = () => {},
}: {
  state: Editor;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  onSave: () => void;
  onResume: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  onEdit: () => void;
  onReviewDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onReconcile: () => void;
  onReviewLatest: () => void;
  onAcceptCurrent: () => void;
  receiptScanEnabled?: boolean;
  onScanReceipt?: () => void;
  onApplyReceiptScan?: () => void;
  onDismissReceiptScan?: () => void;
}) {
  const theme = useTheme();
  const [details, setDetails] = useState(false);
  const [editor, setEditor] = useState<'payers' | 'split' | null>(null);
  if (state.status === 'loading') return <Loading label="Opening your draft…" />;
  if (!state.draft)
    return (
      <Notice
        title="Couldn’t open this draft"
        message={state.message ?? 'Please try again.'}
        retry={onRetry}
      />
    );
  const { draft, context } = state;
  const locked = state.status !== 'editing';
  const members = context?.group.members.map(({ user }) => user) ?? [];
  const name = (id: string) =>
    members.find((member) => member.id === id)?.name ??
    [...(draft.original?.paidBy ?? []), ...(draft.original?.splitBetween ?? [])].find(
      (row) => row.user === id,
    )?.name ??
    'Unavailable member';
  const invalidMembers =
    context &&
    [
      ...(draft.multiPayer ? draft.payers.map((payer) => payer.user) : [draft.payerId]),
      ...draft.participantIds,
    ].some((id) => !members.some((member) => member.id === id));
  let allocation: ReturnType<typeof expenseMoney> | null = null;
  let allocationError = '';
  try {
    allocation = expenseMoney(draft);
  } catch (error) {
    allocationError = error instanceof Error ? error.message : 'Review the allocation.';
  }
  const money = (minor: number) =>
    formatCurrency(toMajorAmount(minor, draft.currency), draft.currency);
  const method = methods.find((item) => item.id === draft.splitMethod)!;
  const valueLabel =
    draft.splitMethod === 'percentage'
      ? 'Percent'
      : draft.splitMethod === 'shares'
        ? 'Shares'
        : `Amount (${draft.currency})`;
  const tag = context?.tags.find((item) => item.id === draft.tagId);
  const choice = (
    key: string,
    label: string,
    selected: boolean,
    onPress: () => void,
    radio = false,
  ) => (
    <Pressable
      key={key}
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={{
        minHeight: 48,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? theme.brand.main : theme.border,
        backgroundColor: selected ? theme.brand.bg : theme.surface,
      }}
    >
      <Copy>
        {selected ? '✓ ' : ''}
        {label}
      </Copy>
    </Pressable>
  );
  if (draft.original && ['detail', 'delete-review'].includes(state.status))
    return (
      <View style={{ gap: 20 }}>
        <ExpenseRecordView record={draft.original} />
        {state.message ? <Copy accessibilityRole="alert">{state.message}</Copy> : null}
        {state.status === 'delete-review' ? (
          <Panel>
            <Copy accessibilityRole="header" style={{ fontFamily: fonts.semibold }}>
              Delete this Expense?
            </Copy>
            <Copy>
              This removes the Expense from balances. Its saved history is retained. Review the
              record above before confirming.
            </Copy>
            <Button label="Confirm delete Expense" onPress={onDelete} />
            <Button label="Keep Expense" secondary onPress={onCancelDelete} />
          </Panel>
        ) : !draft.original.isDeleted ? (
          <>
            <Button
              label="Edit Expense"
              onPress={onEdit}
              disabled={!canEditExpense(draft.original)}
            />
            {!canEditExpense(draft.original) ? (
              <Copy>
                This historical Expense includes a member whose account is no longer available. It
                can be reviewed or deleted, but not edited.
              </Copy>
            ) : null}
            <Button label="Delete Expense" secondary onPress={onReviewDelete} />
            <Button label="Refresh Expense" secondary onPress={onRetry} />
          </>
        ) : null}
      </View>
    );
  return (
    <View style={{ gap: 20 }}>
      <Label>{context?.group.name ?? 'SAVED GROUP DRAFT'}</Label>
      <Copy
        accessibilityRole="header"
        style={{ fontFamily: fonts.semibold, fontSize: 32, lineHeight: 38 }}
      >
        {draft.original ? 'Edit expense' : 'Add expense'}
      </Copy>
      <Copy style={{ color: theme.textSecondary }}>
        Split a shared cost. Your draft stays on this device until you save or discard it.
      </Copy>
      {state.latest && <ExpenseRecordView record={state.latest} title="Current saved record" />}
      {state.status === 'conflict' && (
        <Panel>
          <Copy>
            Your draft is shown below. Compare every field with the current record before choosing.
          </Copy>
          <Button
            label="Keep my draft for review"
            onPress={onReviewLatest}
            disabled={!state.latest || !canEditExpense(state.latest)}
          />
          <Button label="Keep current saved record" secondary onPress={onAcceptCurrent} />
        </Panel>
      )}
      {state.status === 'blocked' && state.latest && (
        <Button label="Keep current saved record" secondary onPress={onAcceptCurrent} />
      )}
      {state.status === 'resume' && (
        <Panel>
          <Copy accessibilityRole="header" style={{ fontFamily: fonts.semibold }}>
            You have a saved draft
          </Copy>
          <Copy>
            {state.mutation
              ? 'This change needs a current-record check before another write. Resume to review it.'
              : state.attempt
                ? 'This submission may already be saved. Resume to confirm it with the same details.'
                : 'Resume your entries or discard them to start again.'}
          </Copy>
          <Button
            label={state.attempt || state.mutation ? 'Resume save recovery' : 'Resume draft'}
            onPress={onResume}
          />
          {!state.attempt && !state.mutation && (
            <Button label="Discard draft" secondary onPress={onDiscard} />
          )}
        </Panel>
      )}
      {!context && (
        <Copy>
          Connect to check the current members and Tags. You can still edit your saved text.
        </Copy>
      )}
      <Panel>
        <Field
          label="Amount"
          value={draft.amount}
          maxLength={40}
          keyboardType="decimal-pad"
          editable={!locked}
          onChangeText={(amount) => onChange({ amount })}
        />
        <Copy style={{ fontFamily: fonts.mono }}>
          {draft.currency} · {draft.original ? 'Expense currency' : 'Group currency'}
        </Copy>
        {!draft.original && context && draft.currency !== context.group.defaultCurrency && (
          <>
            <Copy accessibilityRole="alert">
              This draft uses {draft.currency}; the Group now uses {context.group.defaultCurrency}.
              Review the amount before choosing the new currency.
            </Copy>
            <Button
              label={`Use ${context.group.defaultCurrency}`}
              secondary
              disabled={locked}
              onPress={() => onChange({ currency: context.group.defaultCurrency })}
            />
          </>
        )}
      </Panel>
      <ReceiptScanPanel
        state={state}
        enabled={receiptScanEnabled}
        onScan={onScanReceipt}
        onApply={onApplyReceiptScan}
        onDismiss={onDismissReceiptScan}
      />
      <Field
        label="Description"
        value={draft.description}
        maxLength={200}
        editable={!locked}
        onChangeText={(description) => onChange({ description })}
      />
      <Field
        label="Date"
        hint="YYYY-MM-DD"
        value={draft.date}
        maxLength={10}
        editable={!locked}
        onChangeText={(date) => onChange({ date })}
      />
      <Panel>
        <Copy style={{ fontFamily: fonts.semibold }}>Paid by</Copy>
        <Copy>
          {draft.multiPayer
            ? `${draft.payers.length} ${draft.payers.length === 1 ? 'payer' : 'payers'}`
            : name(draft.payerId)}
        </Copy>
        <Button
          label="Edit payers"
          secondary
          disabled={locked}
          onPress={() => setEditor('payers')}
        />
        <Copy style={{ fontFamily: fonts.semibold }}>Split · {method.label}</Copy>
        <Copy>{draft.participantIds.length} participants</Copy>
        <Button label="Edit split" secondary disabled={locked} onPress={() => setEditor('split')} />
        {invalidMembers && (
          <Copy accessibilityRole="alert">
            A saved payer or participant is no longer in this Group. Open the editors to remove
            unavailable members.
          </Copy>
        )}
      </Panel>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        <Copy style={{ fontFamily: fonts.semibold }}>Tag · required</Copy>
        {draft.tagId && context && (!tag || tag.isArchived || tag.isDeleted) ? (
          <Copy accessibilityRole="alert">
            {draft.original && draft.tagId === (draft.original.tagId ?? '')
              ? `Historical Tag: ${tag?.name ?? draft.original.tag}. This association is retained.`
              : state.attempt
                ? `Submitted Tag: ${tag?.name ?? 'unavailable'}. Recovery keeps the original Tag identity.`
                : `Saved Tag: ${tag?.name ?? 'unavailable'}. It is unavailable or archived; choose an active Tag before saving.`}
          </Copy>
        ) : null}
        {context?.tags
          .filter((item) => !item.isArchived && !item.isDeleted)
          .map((item) =>
            choice(
              item.id,
              `Tag: ${item.name}`,
              draft.tagId === item.id,
              () => onChange({ tagId: item.id }),
              true,
            ),
          )}
        {context && !context.tags.some((item) => !item.isArchived && !item.isDeleted) && (
          <Copy>This Group needs an active Tag. Add one on the web, then reopen this draft.</Copy>
        )}
      </View>
      <Panel>
        <Label>REVIEW ALLOCATION · {draft.currency}</Label>
        {allocation ? (
          <>
            <Copy style={{ fontFamily: fonts.semibold }}>Paid</Copy>
            {allocation.paidBy.map((payer) => (
              <View
                key={String(payer.user)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
              >
                <Copy style={{ flex: 1 }}>{name(String(payer.user))}</Copy>
                <Copy style={{ fontFamily: fonts.mono }}>{money(payer.amountMinor)}</Copy>
              </View>
            ))}
            <Copy style={{ fontFamily: fonts.semibold }}>Owes · {method.label}</Copy>
            {allocation.splitBetween.map((share) => (
              <View
                key={String(share.user)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
              >
                <Copy style={{ flex: 1 }}>{name(String(share.user))}</Copy>
                <Copy style={{ fontFamily: fonts.mono }}>{money(share.amountMinor)}</Copy>
              </View>
            ))}
            <Copy>Total paid = total allocated = {money(allocation.amountMinor)}</Copy>
          </>
        ) : (
          <Copy accessibilityRole="alert">
            {draft.amount
              ? allocationError
              : 'Enter an amount and choose participants to review the allocation.'}
          </Copy>
        )}
        <Copy style={{ fontSize: 13, color: theme.textSecondary }}>
          Rounding keeps the full amount accounted for, even when it cannot divide evenly.
        </Copy>
      </Panel>
      <Button
        label={details ? 'Hide optional details' : 'Optional details'}
        secondary
        onPress={() => setDetails(!details)}
      />
      {details && (
        <View style={{ gap: 12 }}>
          <Copy style={{ fontFamily: fonts.semibold }}>Category</Copy>
          {EXPENSE_CATEGORIES.map((category) =>
            choice(
              category.id,
              category.label,
              draft.category === category.id,
              () => onChange({ category: category.id }),
              true,
            ),
          )}
          <Field
            label="Notes"
            value={draft.notes}
            maxLength={500}
            multiline
            editable={!locked}
            onChangeText={(notes) => onChange({ notes })}
          />
        </View>
      )}
      <Copy style={{ fontSize: 13, color: theme.textSecondary }}>
        {state.persistence === 'saved'
          ? 'Draft storage ready on this device'
          : state.persistence === 'saving'
            ? 'Saving draft on this device…'
            : 'Draft has not been saved on this device'}
      </Copy>
      {state.message && <Copy accessibilityRole="alert">{state.message}</Copy>}
      {state.persistence === 'error' && !state.attempt && (
        <Button label="Retry saving draft" secondary onPress={() => onChange({})} />
      )}
      {draft.original && ['uncertain', 'blocked'].includes(state.status) && (
        <Button label="Check current Expense" onPress={onReconcile} />
      )}
      {(state.status === 'editing' ||
        state.status === 'saving' ||
        (!draft.original && state.status === 'uncertain')) && (
        <Button
          label={
            state.status === 'saving'
              ? 'Saving expense…'
              : state.attempt
                ? 'Retry same submission'
                : draft.original
                  ? 'Save changes'
                  : 'Save expense'
          }
          onPress={onSave}
          disabled={state.status === 'saving' || state.persistence !== 'saved'}
        />
      )}
      {state.status === 'editing' && <Button label="Discard draft" secondary onPress={onDiscard} />}
      {(state.attempt || state.mutation) && (
        <Copy>
          Details are locked until the save is confirmed. Signing out removes recovery information;
          check Group history before recreating this expense.
        </Copy>
      )}
      <Modal visible={editor !== null} animationType="slide" onRequestClose={() => setEditor(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
            <View style={{ padding: 20, gap: 12 }}>
              <Copy
                accessibilityRole="header"
                style={{ fontFamily: fonts.semibold, fontSize: 26, lineHeight: 32 }}
              >
                {editor === 'payers' ? 'Who paid?' : 'Choose the split'}
              </Copy>
              <Button label="Done" onPress={() => setEditor(null)} />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, gap: 16 }}
            >
              {editor === 'payers' ? (
                <>
                  {choice('multiple', 'Multiple payers', draft.multiPayer, () =>
                    onChange({
                      multiPayer: !draft.multiPayer,
                      ...(draft.multiPayer || draft.payers.length
                        ? {}
                        : { payers: [{ user: draft.payerId, amount: draft.amount }] }),
                    }),
                  )}
                  <Copy>
                    {draft.multiPayer
                      ? 'Enter what each person paid. The amounts must add up to the Expense total.'
                      : 'One person paid the full Expense amount.'}
                  </Copy>
                  {members.map((member) => (
                    <View key={member.id} style={{ gap: 8 }}>
                      {choice(
                        member.id,
                        `Paid by ${member.name}`,
                        draft.multiPayer
                          ? draft.payers.some((payer) => payer.user === member.id)
                          : draft.payerId === member.id,
                        () =>
                          onChange(
                            draft.multiPayer
                              ? {
                                  payers: draft.payers.some((payer) => payer.user === member.id)
                                    ? draft.payers.filter((payer) => payer.user !== member.id)
                                    : [...draft.payers, { user: member.id, amount: '' }],
                                }
                              : { payerId: member.id },
                          ),
                        !draft.multiPayer,
                      )}
                      {draft.multiPayer &&
                        draft.payers.some((payer) => payer.user === member.id) && (
                          <Field
                            label={`Paid by ${member.name} (${draft.currency})`}
                            value={draft.payers.find((payer) => payer.user === member.id)!.amount}
                            keyboardType="decimal-pad"
                            maxLength={40}
                            editable={!locked}
                            onChangeText={(amount) =>
                              onChange({
                                payers: draft.payers.map((payer) =>
                                  payer.user === member.id ? { ...payer, amount } : payer,
                                ),
                              })
                            }
                          />
                        )}
                    </View>
                  ))}
                  {draft.multiPayer &&
                    draft.payers.some(
                      (payer) => !members.some((member) => member.id === payer.user),
                    ) && (
                      <Button
                        label="Remove unavailable payers"
                        secondary
                        disabled={locked}
                        onPress={() =>
                          onChange({
                            payers: draft.payers.filter((payer) =>
                              members.some((member) => member.id === payer.user),
                            ),
                          })
                        }
                      />
                    )}
                </>
              ) : (
                <>
                  <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                    {methods.map((item) =>
                      choice(
                        item.id,
                        item.label,
                        draft.splitMethod === item.id,
                        () => onChange({ splitMethod: item.id }),
                        true,
                      ),
                    )}
                  </View>
                  <Copy>{method.hint}</Copy>
                  <Copy style={{ color: theme.textSecondary }}>
                    Changing method clears the previous split values. Other draft entries stay
                    saved.
                  </Copy>
                  {members.map((member) => (
                    <View key={member.id} style={{ gap: 8 }}>
                      {choice(
                        member.id,
                        `Include ${member.name}`,
                        draft.participantIds.includes(member.id),
                        () =>
                          onChange({
                            participantIds: draft.participantIds.includes(member.id)
                              ? draft.participantIds.filter((id) => id !== member.id)
                              : [...draft.participantIds, member.id],
                          }),
                      )}
                      {draft.splitMethod !== 'equal' &&
                        draft.participantIds.includes(member.id) && (
                          <Field
                            label={`${valueLabel} for ${member.name}`}
                            value={draft.splitValues[member.id] ?? ''}
                            hint="Use 0 for no share."
                            keyboardType={
                              draft.splitMethod === 'shares' ? 'number-pad' : 'decimal-pad'
                            }
                            maxLength={40}
                            editable={!locked}
                            onChangeText={(value) =>
                              onChange({
                                splitValues: { ...draft.splitValues, [member.id]: value },
                              })
                            }
                          />
                        )}
                    </View>
                  ))}
                  {draft.participantIds.some(
                    (id) => !members.some((member) => member.id === id),
                  ) && (
                    <Button
                      label="Remove unavailable participants"
                      secondary
                      disabled={locked}
                      onPress={() =>
                        onChange({
                          participantIds: draft.participantIds.filter((id) =>
                            members.some((member) => member.id === id),
                          ),
                        })
                      }
                    />
                  )}
                </>
              )}
              {allocationError && draft.amount ? (
                <Copy accessibilityRole="alert">{allocationError}</Copy>
              ) : null}
              <Copy>
                {state.persistence === 'saving'
                  ? 'Saving draft…'
                  : state.persistence === 'error'
                    ? 'Could not save these entries on this device. Close this editor and retry saving the draft.'
                    : 'Entries are saved with your draft. Done or Android Back keeps them.'}
              </Copy>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
