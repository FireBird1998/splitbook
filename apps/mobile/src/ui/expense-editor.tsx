import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { EXPENSE_CATEGORIES } from '@splitbook/shared/categories';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { ExpenseDraft, ExpenseEditor as Editor } from '../data/expense-draft';
import { Field } from './group-workflows';
import { Button, Copy, Label, Loading, Notice, Panel } from './primitives';
import { fonts, useTheme } from './theme';

export function ExpenseEditor({
  state,
  onChange,
  onSave,
  onResume,
  onDiscard,
  onRetry,
}: {
  state: Editor;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  onSave: () => void;
  onResume: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const [details, setDetails] = useState(false);
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
    members.find((member) => member.id === id)?.name ?? 'Unavailable member';
  const invalidMembers =
    context &&
    [draft.payerId, ...draft.participantIds].some(
      (id) => !members.some((member) => member.id === id),
    );
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
  return (
    <View style={{ gap: 20 }}>
      <Label>{context?.group.name ?? 'SAVED GROUP DRAFT'}</Label>
      <Copy
        accessibilityRole="header"
        style={{ fontFamily: fonts.semibold, fontSize: 32, lineHeight: 38 }}
      >
        Add expense
      </Copy>
      <Copy style={{ color: theme.textSecondary }}>
        Split a shared cost equally. Your draft stays on this device until you save or discard it.
      </Copy>
      {state.status === 'resume' && (
        <Panel>
          <Copy accessibilityRole="header" style={{ fontFamily: fonts.semibold }}>
            You have a saved draft
          </Copy>
          <Copy>
            {state.attempt
              ? 'This submission may already be saved. Resume to confirm it with the same details.'
              : 'Resume your entries or discard them to start again.'}
          </Copy>
          <Button
            label={state.attempt ? 'Resume save recovery' : 'Resume draft'}
            onPress={onResume}
          />
          {!state.attempt && <Button label="Discard draft" secondary onPress={onDiscard} />}
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
        <Copy style={{ fontFamily: fonts.mono }}>{draft.currency} · Group currency</Copy>
        {context && draft.currency !== context.group.defaultCurrency && (
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
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        <Copy style={{ fontFamily: fonts.semibold }}>Paid by</Copy>
        {members.map((member) =>
          choice(
            member.id,
            `Paid by ${member.name}`,
            draft.payerId === member.id,
            () => onChange({ payerId: member.id }),
            true,
          ),
        )}
        {!members.length && <Copy>{name(draft.payerId)}</Copy>}
      </View>
      <View style={{ gap: 8 }}>
        <Copy style={{ fontFamily: fonts.semibold }}>Split equally between</Copy>
        {members.map((member) =>
          choice(
            member.id,
            `Include ${member.name}`,
            draft.participantIds.includes(member.id),
            () =>
              onChange({
                participantIds: draft.participantIds.includes(member.id)
                  ? draft.participantIds.filter((id) => id !== member.id)
                  : [...draft.participantIds, member.id],
              }),
          ),
        )}
        {invalidMembers && (
          <>
            <Copy accessibilityRole="alert">
              A saved payer or participant is no longer in this Group. Choose a current payer and
              review the participants.
            </Copy>
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
          </>
        )}
      </View>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        <Copy style={{ fontFamily: fonts.semibold }}>Tag · required</Copy>
        {draft.tagId && context && (!tag || tag.isArchived || tag.isDeleted) ? (
          <Copy accessibilityRole="alert">
            {state.attempt
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
        <Label>EQUAL SPLIT PREVIEW</Label>
        {state.preview ? (
          state.preview.map((share) => (
            <View
              key={String(share.user)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
            >
              <Copy style={{ flex: 1 }}>{name(String(share.user))}</Copy>
              <Copy style={{ fontFamily: fonts.mono }}>
                {formatCurrency(toMajorAmount(share.amountMinor, draft.currency), draft.currency)}
              </Copy>
            </View>
          ))
        ) : (
          <Copy>Enter an amount and choose participants to see each share.</Copy>
        )}
        <Copy style={{ fontSize: 13, color: theme.textSecondary }}>
          Any smallest-unit remainder goes to the first selected participants.
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
      {state.status !== 'resume' && (
        <Button
          label={
            state.status === 'saving'
              ? 'Saving expense…'
              : state.attempt
                ? 'Retry same submission'
                : 'Save expense'
          }
          onPress={onSave}
          disabled={state.status === 'saving' || state.persistence !== 'saved'}
        />
      )}
      {state.status === 'editing' && <Button label="Discard draft" secondary onPress={onDiscard} />}
      {state.attempt && (
        <Copy>
          Details are locked until the save is confirmed. Signing out removes recovery information;
          check Group history before recreating this expense.
        </Copy>
      )}
    </View>
  );
}
