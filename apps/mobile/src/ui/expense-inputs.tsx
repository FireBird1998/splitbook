import { useState, type Ref } from 'react';
import { TextInput, View } from 'react-native';
import type { ExpenseDraft, ExpenseField } from '../data/expense-draft';
import { acceptsNumericText } from '../data/field-feedback';
import { FieldError } from './group-workflows';
import { CompactText, FieldMarker, radius } from './compact';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';
export type ExpenseInputProps = {
  draft: Pick<ExpenseDraft, 'amount' | 'currency' | 'original' | 'description'>;
  locked: boolean;
  showLock?: boolean;
  errors: { amount?: string; description?: string };
  amountRef?: Ref<TextInput>;
  descriptionRef?: Ref<TextInput>;
  section: (field: ExpenseField) => Ref<View>;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  onLeave: (field: ExpenseField) => void;
  onAmountDone?: () => void;
};
export function AmountField({
  draft,
  locked,
  showLock,
  errors,
  amountRef,
  section,
  onChange,
  onLeave,
  onAmountDone,
}: ExpenseInputProps) {
  const theme = useTheme();
  const [amountFocused, setAmountFocused] = useState(false);
  const input = {
    color: theme.text,
    paddingVertical: 4,
    paddingHorizontal: 0,
    opacity: locked ? 0.65 : 1,
  };
  const label = (text: string, error?: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <CompactText variant="small" tone={error ? 'negative' : 'secondary'}>
        {text}
      </CompactText>
      <FieldMarker kind="required" />
    </View>
  );
  return (
    <View ref={section('amount')} style={{ gap: 6 }}>
      {label('Amount', errors.amount)}
      <View style={{ gap: 4 }}>
        {/* The focus ring sits outside the content and stays as a transparent border on blur. */}
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
            borderColor: amountFocused && !locked ? theme.focus : 'transparent',
          }}
        >
          <View
            accessible
            accessibilityLabel={`Currency ${draft.currency}, ${draft.original ? 'the Expense’s currency' : 'the Group’s currency'}`}
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
            ref={amountRef}
            value={draft.amount}
            maxLength={40}
            keyboardType="decimal-pad"
            returnKeyType="next"
            submitBehavior="submit"
            editable={!locked}
            placeholder="0.00"
            placeholderTextColor={theme.textMuted}
            selectionColor={theme.brand.main}
            accessibilityLabel="Amount, required"
            accessibilityHint={errors.amount}
            onChangeText={(amount) => {
              // A refused edit leaves the field showing the draft's amount.
              if (amount !== draft.amount && acceptsNumericText(amount, draft.amount))
                onChange({ amount });
            }}
            onFocus={() => setAmountFocused(true)}
            onBlur={() => {
              setAmountFocused(false);
              onLeave('amount');
            }}
            onSubmitEditing={onAmountDone}
            style={[
              input,
              {
                flex: 1,
                minHeight: 48,
                fontFamily: fonts.mono,
                fontSize: 32,
                lineHeight: 38,
              },
            ]}
          />
          {showLock ? (
            <Icon name="lock-closed-outline" size={20} color={theme.textSecondary} />
          ) : null}
        </View>
      </View>
      <FieldError message={errors.amount} />
    </View>
  );
}
export function DescriptionField({
  draft,
  locked,
  errors,
  descriptionRef,
  section,
  onChange,
  onLeave,
}: ExpenseInputProps) {
  const theme = useTheme();
  const input = {
    color: theme.text,
    paddingVertical: 4,
    paddingHorizontal: 0,
    opacity: locked ? 0.65 : 1,
  };
  const label = (text: string, error?: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <CompactText variant="small" tone={error ? 'negative' : 'secondary'}>
        {text}
      </CompactText>
      <FieldMarker kind="required" />
    </View>
  );
  return (
    <View ref={section('description')} style={{ gap: 6 }}>
      {label('Description', errors.description)}
      <View>
        <TextInput
          ref={descriptionRef}
          value={draft.description}
          maxLength={200}
          returnKeyType="done"
          editable={!locked}
          placeholder="What was it for? e.g. Groceries"
          placeholderTextColor={theme.textMuted}
          selectionColor={theme.brand.main}
          accessibilityLabel="Description, required"
          accessibilityHint={
            errors.description ? `${errors.description} What was this for?` : 'What was this for?'
          }
          onChangeText={(description) => onChange({ description })}
          onBlur={() => onLeave('description')}
          style={[input, { minHeight: 48, fontFamily: fonts.regular, fontSize: 17 }]}
        />
      </View>
      <FieldError message={errors.description} />
    </View>
  );
}
