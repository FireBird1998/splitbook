import type { TextInputInstance, ViewInstance } from 'react-native';
import { memo, useState, type Ref } from 'react';
import { Pressable, TextInput, View, useWindowDimensions } from 'react-native';
import { getCurrency, getCurrencyPrecision } from '@splitbook/shared/currency';
import type { ExpenseDraft, ExpenseField } from '../data/expense-draft';
import { acceptsNumericText } from '../data/field-feedback';
import { Field, FieldError } from './group-workflows';
import { CompactText, FieldMarker, radius, scaledSp, useLargeText } from './compact';
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
export const CurrencyChip = memo(function CurrencyChip({
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
/** The amount's size, and its symbol's, in IBM Plex Mono: every character 0.6 of the size across. */
const AMOUNT_SIZE = 32;
const SYMBOL_SIZE = 24;
const LOCK_SIZE = 20;
const AMOUNT_GAP = 10;

/**
 * The currency's symbol beside the chip, as the board draws it; TalkBack already hears the
 * currency. Memoized with the chip, so typing an amount never renders it again.
 */
export const CurrencySymbol = memo(function CurrencySymbol({ currency }: { currency: string }) {
  return (
    <CompactText
      tone="secondary"
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ fontFamily: fonts.mono, fontSize: SYMBOL_SIZE }}
    >
      {getCurrency(currency)?.symbol ?? ''}
    </CompactText>
  );
});
/**
 * The least the amount's line keeps, with its symbol and lock, at this text size: its characters
 * (or the placeholder's) in IBM Plex Mono, whose widths are exact, and room for the cursor. Beside
 * the chip while that fits there, and under it otherwise: 2500.50 in Swiss francs at 200% on a
 * 360 dp phone had shown "CHF 00.50" (#867). It never asks for more than a line under the chip
 * has, `screen` less the form's 16 dp gutters, its card's 14 dp padding and 2 dp border at most,
 * and the ring's 8 dp padding and 2 dp border beyond its -10 dp margins; a longer amount scrolls
 * there.
 */
function amountLine(
  shown: string,
  symbol: string,
  lock: boolean,
  { width: screen, fontScale }: { width: number; fontScale: number },
) {
  const mono = (text: string, size: number) => [...text].length * 0.6 * scaledSp(size, fontScale);
  const needed =
    mono(shown, AMOUNT_SIZE) +
    // The cursor after the last figure.
    2 +
    (symbol ? mono(symbol, SYMBOL_SIZE) + AMOUNT_GAP : 0) +
    (lock ? LOCK_SIZE + AMOUNT_GAP : 0);
  return Math.min(needed, screen - 2 * 16 - 2 * (14 + 2) - 2 * (8 + 2 - 10));
}

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
  // The field is focused for the keypad it has; a new keypad is a new field, not focused yet.
  const [focusedPlaces, setFocusedPlaces] = useState<number | null>(null);
  const amountFocused = focusedPlaces === places;
  const window = useWindowDimensions();
  const placeholder = places === 0 ? '0' : `0.${'0'.repeat(places)}`;
  const symbol = onCurrency ? (getCurrency(draft.currency)?.symbol ?? '') : '';
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
            // The amount goes under the chip where it doesn't fit beside it (#867).
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: AMOUNT_GAP,
            rowGap: 4,
            marginHorizontal: -10,
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderWidth: 2,
            borderRadius: radius.tile,
            borderColor: amountFocused && !locked ? theme.focus : 'transparent',
          }}
        >
          {onCurrency ? (
            <CurrencyChip currency={draft.currency} locked={currencyLocked} onPress={onCurrency} />
          ) : (
            <CurrencyBadge currency={draft.currency} recorded={!!draft.original} />
          )}
          {/* The amount and its symbol keep together: beside the chip while the whole amount
              fits there, on a line of their own under it where it doesn't. */}
          <View
            style={{
              // Yoga breaks a wrapping line by its children's least widths, not their basis.
              minWidth: amountLine(draft.amount || placeholder, symbol, !!showLock, window),
              flexGrow: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: AMOUNT_GAP,
            }}
          >
            {onCurrency ? <CurrencySymbol currency={draft.currency} /> : null}
            <TextInput
              // Android adds the decimal key when the keypad changes but never takes it away, so
              // yen after rupees kept it (#866): a whole currency gets a field of its own.
              key={places === 0 ? 'whole' : 'decimal'}
              ref={amountRef}
              value={draft.amount}
              maxLength={40}
              keyboardType={places === 0 ? 'number-pad' : 'decimal-pad'}
              returnKeyType="next"
              submitBehavior="submit"
              editable={!locked}
              placeholder={placeholder}
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
              onFocus={() => setFocusedPlaces(places)}
              onBlur={() => {
                setFocusedPlaces(null);
                onLeave('amount');
              }}
              onSubmitEditing={onAmountDone}
              style={[
                input,
                {
                  flex: 1,
                  minHeight: 48,
                  fontFamily: fonts.mono,
                  fontSize: AMOUNT_SIZE,
                  lineHeight: 38,
                },
              ]}
            />
            {showLock ? (
              <Icon name="lock-closed-outline" size={LOCK_SIZE} color={theme.textSecondary} />
            ) : null}
          </View>
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
