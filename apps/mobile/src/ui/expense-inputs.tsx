import type { TextInputInstance, ViewInstance } from 'react-native';
import { memo, useState, type Ref } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { getCurrency, getCurrencyPrecision } from '@splitbook/shared/currency';
import type { ExpenseDraft, ExpenseField } from '../data/expense-draft';
import { acceptsNumericText } from '../data/field-feedback';
import { Field, FieldError } from './group-workflows';
import { CompactText, FieldMarker, radius, useLargeText } from './compact';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';
import { useStartWhileUnfocused } from './start-while-unfocused';
export type ExpenseInputProps = {
  draft: Pick<ExpenseDraft, 'amount' | 'currency' | 'original' | 'description'>;
  locked: boolean;
  showLock?: boolean;
  errors: { amount?: string; description?: string };
  amountRef?: Ref<TextInputInstance>;
  descriptionRef?: Ref<TextInputInstance>;
  section: (field: ExpenseField) => Ref<ViewInstance>;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  onLeave: (field: ExpenseField) => void;
  onAmountDone?: () => void;
  /** Opens the Currency sheet, when the Group has more than one currency (#720). */
  onCurrency?: () => void;
  /** The currency waits for the Group's check, as other financial choices do. */
  currencyLocked?: boolean;
};
export function NotesField({
  notes,
  locked,
  onChange,
}: {
  notes: string;
  locked: boolean;
  onChange: (patch: Partial<ExpenseDraft>) => void;
}) {
  return (
    <Field
      label="Notes"
      value={notes}
      maxLength={500}
      multiline
      editable={!locked}
      onChangeText={(notes) => onChange({ notes })}
    />
  );
}
/** A field's visible name with its Required mark, red while the field has a problem. */
export const RequiredFieldLabel = memo(function RequiredFieldLabel({
  text,
  invalid,
}: {
  text: string;
  invalid: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <CompactText variant="small" tone={invalid ? 'negative' : 'secondary'}>
        {text}
      </CompactText>
      <FieldMarker kind="required" />
    </View>
  );
});
export const CurrencyBadge = memo(function CurrencyBadge({
  currency,
  recorded,
}: {
  currency: string;
  recorded: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Currency ${currency}, ${recorded ? 'the Expense’s currency' : 'the Group’s currency'}`}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 10,
        backgroundColor: theme.surfaceMuted,
      }}
    >
      <CompactText tone="secondary" style={{ fontFamily: fonts.mono, fontSize: 15 }}>
        {currency}
      </CompactText>
    </View>
  );
});
/**
 * The currency beside the amount, as a chip that opens the Currency sheet (#720, board "Pick the
 * currency"): "Currency, JPY, Japanese Yen. Change currency".
 */
const CurrencyChip = memo(function CurrencyChip({
  currency,
  locked,
  onPress,
}: {
  currency: string;
  locked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Currency, ${currency}, ${getCurrency(currency)?.name ?? currency}. Change currency`}
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingLeft: 12,
        paddingRight: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.borderStrong,
        backgroundColor: pressed ? theme.surface : theme.surfaceMuted,
        opacity: locked ? 0.65 : 1,
      })}
    >
      <CompactText weight="semibold" style={{ fontFamily: fonts.mono, fontSize: 15 }}>
        {currency}
      </CompactText>
      <Icon name="chevron-down-outline" size={16} color={theme.textSecondary} />
    </Pressable>
  );
});
/**
 * The currency's symbol beside the chip, as the board draws it; TalkBack already hears the
 * currency. Memoized with the chip, so typing an amount never renders it again.
 */
const CurrencySymbol = memo(function CurrencySymbol({ currency }: { currency: string }) {
  return (
    <CompactText
      tone="secondary"
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ fontFamily: fonts.mono, fontSize: 24 }}
    >
      {getCurrency(currency)?.symbol ?? ''}
    </CompactText>
  );
});
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
  onCurrency,
  currencyLocked = locked,
}: ExpenseInputProps) {
  const theme = useTheme();
  // Yen and won are whole (#720): the number keypad, and no decimal places to show.
  const places = getCurrencyPrecision(draft.currency);
  const [amountFocused, setAmountFocused] = useState(false);
  const input = {
    color: theme.text,
    paddingVertical: 4,
    paddingHorizontal: 0,
    opacity: locked ? 0.65 : 1,
  };

  return (
    <View ref={section('amount')} style={{ gap: 6 }}>
      <RequiredFieldLabel text="Amount" invalid={!!errors.amount} />
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
          {onCurrency ? (
            <>
              <CurrencyChip
                currency={draft.currency}
                locked={currencyLocked}
                onPress={onCurrency}
              />
              <CurrencySymbol currency={draft.currency} />
            </>
          ) : (
            <CurrencyBadge currency={draft.currency} recorded={!!draft.original} />
          )}
          <TextInput
            ref={amountRef}
            value={draft.amount}
            maxLength={40}
            keyboardType={places === 0 ? 'number-pad' : 'decimal-pad'}
            returnKeyType="next"
            submitBehavior="submit"
            editable={!locked}
            placeholder={places === 0 ? '0' : `0.${'0'.repeat(places)}`}
            placeholderTextColor={theme.textMuted}
            selectionColor={theme.brand.main}
            // TalkBack reads the currency with the amount (#720).
            accessibilityLabel={`Amount, ${getCurrency(draft.currency)?.name ?? draft.currency}, required`}
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
/**
 * What the Description box says while empty. At large text it leaves out its example, which at
 * 200% wrapped in the one-line box and was cut in half (#639); "What was it for?" fits its line.
 */
export function useDescriptionPlaceholder() {
  return useLargeText() ? 'What was it for?' : 'What was it for? e.g. Groceries';
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
  const start = useStartWhileUnfocused(() => onLeave('description'));
  const placeholder = useDescriptionPlaceholder();
  const input = {
    color: theme.text,
    paddingVertical: 4,
    paddingHorizontal: 0,
    opacity: locked ? 0.65 : 1,
  };
  return (
    <View ref={section('description')} style={{ gap: 6 }}>
      <RequiredFieldLabel text="Description" invalid={!!errors.description} />
      <View>
        <TextInput
          ref={descriptionRef}
          value={draft.description}
          maxLength={200}
          returnKeyType="done"
          editable={!locked}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          selectionColor={theme.brand.main}
          accessibilityLabel="Description, required"
          accessibilityHint={
            errors.description ? `${errors.description} What was this for?` : 'What was this for?'
          }
          onChangeText={(description) => onChange({ description })}
          selection={start.selection}
          onFocus={start.onFocus}
          onBlur={start.onBlur}
          style={[input, { minHeight: 48, fontFamily: fonts.regular, fontSize: 17 }]}
        />
      </View>
      <FieldError message={errors.description} />
    </View>
  );
}
