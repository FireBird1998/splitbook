import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { getCurrency } from '@splitbook/shared/currency';
import {
  clearedPart,
  paidRounding,
  rateBadge,
  rateNote,
  rateText,
  type CrossCurrencyEntry,
  type CrossCurrencyField,
  type CrossCurrencyReading,
  type PaymentCurrencies,
} from '@splitbook/shared/cross-currency-payment';
import {
  decimalMoney,
  type CrossCurrencySettlementFields,
} from '@splitbook/shared/cross-currency-settlement';
import { acceptsNumericText } from '../data/field-feedback';
import type { RateState } from '../data/settlement';
import { Badge, Banner, CompactButton, CompactText, radius } from './compact';
import { FieldError } from './group-workflows';
import { fonts, useTheme } from './theme';

const symbol = (currency: string) => getCurrency(currency)?.symbol ?? currency;

/** What the rate's line says while there is no suggestion to tell of. */
const lookingUp = 'Looking up a suggested rate…';
const rateNeedsConnection = 'A suggested rate needs a connection.';

/** A currency's code, beside a field's label. */
export function CodeChip({ code }: { code: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: theme.surface,
      }}
    >
      <CompactText variant="caption" tone="secondary" style={{ fontFamily: fonts.mono }}>
        {code}
      </CompactText>
    </View>
  );
}

/** A field's label, and what it says beside it at the end of its line. */
function Head({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <CompactText variant="caption" tone="secondary" weight="semibold">
        {label}
      </CompactText>
      <View
        style={{
          marginLeft: 'auto',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * The amount cleared, the rate and the amount paid of a Debt paid in another currency (#728, as
 * the web's #727 `CrossCurrencyFields`): change any one and the others follow. The rate says
 * where a suggestion is from and how old it is, links the second source's attribution, offers
 * the suggestion back beside the member's own rate, or says how to go on without one.
 */
export function CrossCurrencyFields({
  currencies,
  debtMinor,
  entry,
  reading,
  kind,
  rate,
  now,
  editable,
  onEdit,
  onUseSuggestion,
  onOpenLink,
}: {
  currencies: PaymentCurrencies;
  /** The Debt between the two, in its currency; null when there is none to clear. */
  debtMinor: number | null;
  entry: CrossCurrencyEntry;
  reading: CrossCurrencyReading;
  /** The rate kind the payment would record now. */
  kind: CrossCurrencySettlementFields['rateKind'];
  rate: RateState;
  now: Date;
  editable: boolean;
  onEdit: (field: CrossCurrencyField, text: string) => void;
  onUseSuggestion: () => void;
  onOpenLink: (url: string) => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState<CrossCurrencyField | null>(null);
  const { currency, paidCurrency } = currencies;
  const suggestion = rate.status === 'ready' ? rate.suggestion : null;
  const invalid = reading.status === 'invalid' ? reading : null;
  const clearedMinor = reading.status === 'valid' ? reading.amounts.amountClearedMinor : null;
  const qualifier = clearedPart(clearedMinor, debtMinor, currency);
  const note =
    rate.status === 'loading'
      ? null
      : rate.status === 'unreachable'
        ? null
        : rateNote(kind, suggestion, paidCurrency, now);
  const known = rate.status === 'ready' || rate.status === 'none';

  const field = (name: CrossCurrencyField, code: string, label: string, lead?: string) => {
    const error = invalid?.field === name ? invalid.message : undefined;
    return (
      <>
        <View
          style={{
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 12,
            borderWidth: 1,
            borderRadius: radius.tile,
            borderColor: error
              ? theme.status.negative
              : focused === name && editable
                ? theme.focus
                : theme.borderStrong,
            backgroundColor: editable ? theme.surface : theme.surfaceMuted,
          }}
        >
          {lead ? (
            <CompactText variant="small" tone="secondary">
              {lead}
            </CompactText>
          ) : null}
          <CompactText tone="secondary" style={{ fontFamily: fonts.mono }}>
            {symbol(code)}
          </CompactText>
          <TextInput
            value={entry[name]}
            maxLength={40}
            keyboardType="decimal-pad"
            editable={editable}
            placeholder={name === 'rate' ? 'Rate' : name === 'paid' ? 'Amount' : undefined}
            placeholderTextColor={theme.textMuted}
            selectionColor={theme.brand.main}
            accessibilityLabel={label}
            accessibilityHint={error}
            onChangeText={(text) => {
              // A letter isn't part of an amount or a rate: the field keeps what it had.
              if (text !== entry[name] && acceptsNumericText(text, entry[name])) onEdit(name, text);
            }}
            onFocus={() => setFocused(name)}
            onBlur={() => setFocused(null)}
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
        <FieldError message={error} />
      </>
    );
  };

  return (
    <>
      {rate.status === 'none' && editable ? (
        <Banner
          tone="info"
          title="No rate suggested right now."
          message={`${
            rate.reason === 'currency_unavailable'
              ? `Splitbook has no rate between ${currency} and ${paidCurrency} right now.`
              : 'Splitbook couldn’t get today’s rates.'
          } You can still record it with the rate you agreed.`}
        />
      ) : null}
      <View
        style={{
          gap: 12,
          padding: 14,
          borderRadius: radius.tile,
          backgroundColor: theme.surfaceMuted,
        }}
      >
        <CompactText variant="caption" tone="secondary">
          Change any one; the other two follow.
        </CompactText>
        <View style={{ gap: 4 }}>
          <Head label="Amount cleared">
            {qualifier ? (
              <CompactText variant="caption" tone="secondary">
                {qualifier}
              </CompactText>
            ) : null}
            <CodeChip code={currency} />
          </Head>
          {field('cleared', currency, `Amount cleared, ${currency}`)}
        </View>
        <View style={{ gap: 4 }}>
          <Head label={`Rate · ${symbol(paidCurrency)} for each ${symbol(currency)}`}>
            {/* No tag while no suggestion is known either way. */}
            {known ? (
              <Badge
                label={rateBadge(kind, suggestion)}
                tone={
                  kind === 'suggested' && suggestion && suggestion.ageDays <= 1
                    ? 'positive'
                    : 'warning'
                }
              />
            ) : null}
          </Head>
          {field(
            'rate',
            paidCurrency,
            `Rate, ${paidCurrency} for each ${currency}`,
            `1 ${symbol(currency)} =`,
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <CompactText variant="caption" tone="secondary">
              {rate.status === 'loading'
                ? lookingUp
                : rate.status === 'unreachable'
                  ? rateNeedsConnection
                  : note!.text}
            </CompactText>
            {note?.attribution ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={note.attribution.text}
                onPress={() => onOpenLink(note.attribution!.url)}
                hitSlop={8}
              >
                <CompactText
                  variant="caption"
                  tone="brand"
                  weight="semibold"
                  style={{ textDecorationLine: 'underline' }}
                >
                  {note.attribution.text}
                </CompactText>
              </Pressable>
            ) : null}
            {note?.useSuggestion && editable ? (
              <CompactButton
                label={`Use ${decimalMoney(rateText(note.useSuggestion), paidCurrency)}`}
                variant="text"
                dense
                onPress={onUseSuggestion}
              />
            ) : null}
          </View>
        </View>
        <View style={{ gap: 4 }}>
          <Head label="Amount paid">
            <CompactText variant="caption" tone="secondary">
              {paidRounding(paidCurrency)}
            </CompactText>
            <CodeChip code={paidCurrency} />
          </Head>
          {field('paid', paidCurrency, `Amount paid, ${paidCurrency}`)}
        </View>
      </View>
    </>
  );
}
