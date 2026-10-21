'use client';

import type { ReactNode } from 'react';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputBase from '@mui/material/InputBase';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import { getCurrency, getCurrencyPrecision, wholeUnit } from '@splitbook/shared/currency';
import {
  rateBadge,
  rateNote,
  rateText,
  type CrossCurrencyEntry,
  type CrossCurrencyField,
  type CrossCurrencyReading,
  type PaymentCurrencies,
  type RateSuggestion,
} from '@splitbook/shared/cross-currency-payment';
import {
  decimalMoney,
  type CrossCurrencySettlementFields,
} from '@splitbook/shared/cross-currency-settlement';
import type { RateSuggestionState } from '@/lib/hooks/use-rate-suggestion';
import { money } from './record-payment';

/** "rounded to the paisa", "in whole yen": how the amount paid is rounded. */
function roundedTo(currency: string): string {
  if (getCurrencyPrecision(currency) === 0) return `in whole ${wholeUnit(currency) ?? currency}`;
  if (currency === 'INR') return 'rounded to the paisa';
  return `rounded to ${money(1, currency)}`;
}

/** What the amount cleared is of the Debt: all of it, part of it, or more. */
function clearedQualifier(clearedMinor: number | null, debtMinor: number | null, currency: string) {
  if (debtMinor === null || debtMinor <= 0) return null;
  if (clearedMinor === null || clearedMinor === debtMinor) return 'the whole Debt';
  if (clearedMinor < debtMinor) return `part of ${money(debtMinor, currency)}`;
  return `more than the ${money(debtMinor, currency)} Debt`;
}

const symbol = (currency: string) => getCurrency(currency)?.symbol ?? currency;

const fieldBox = (theme: Theme, invalid: boolean) => ({
  minHeight: 48,
  border: 1,
  borderColor: invalid ? 'status.negative' : 'border.strong',
  borderRadius: '10px',
  bgcolor: 'background.paper',
  color: 'text.primary',
  px: 1.5,
  gap: 1,
  '&.Mui-focused': {
    borderColor: 'focus.main',
    boxShadow: `0 0 0 3px ${(theme.vars ?? theme).palette.focus.ring}`,
  },
  '& input:focus-visible': { outline: 'none', boxShadow: 'none' },
  '& input': { ...theme.typography.money, fontSize: '1rem', textAlign: 'right' },
});

const smallLabel = { fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary' } as const;
const qualifierSx = { fontSize: '0.75rem', color: 'text.secondary' } as const;

export interface CrossCurrencyFieldsProps {
  currencies: PaymentCurrencies;
  /** The Debt between the pair, in the Debt's currency; null when there is none to clear. */
  debtMinor: number | null;
  entry: CrossCurrencyEntry;
  reading: CrossCurrencyReading;
  /** The rate kind the payment would record now. */
  kind: CrossCurrencySettlementFields['rateKind'];
  rate: RateSuggestionState;
  now: Date;
  readOnly: boolean;
  onEdit: (field: CrossCurrencyField, text: string) => void;
  onUseSuggestion: (rate: string) => void;
}

/**
 * The amount cleared, the rate and the amount paid of a Debt paid in another currency (#727):
 * change any one and the others follow. The rate says where a suggestion is from and how old it
 * is, carries the second source's attribution, or says how to go on without one.
 */
export default function CrossCurrencyFields({
  currencies,
  debtMinor,
  entry,
  reading,
  kind,
  rate,
  now,
  readOnly,
  onEdit,
  onUseSuggestion,
}: CrossCurrencyFieldsProps) {
  const { currency, paidCurrency } = currencies;
  const suggestion: RateSuggestion | null = rate.status === 'ready' ? rate.suggestion : null;
  const note = rateNote(kind, suggestion, paidCurrency, now);
  const invalid = reading.status === 'invalid' ? reading : null;
  const clearedMinor = reading.status === 'valid' ? reading.amounts.amountClearedMinor : null;

  const input = (field: CrossCurrencyField, code: string, lead: string | null, label: string) => (
    <InputBase
      value={entry[field]}
      onChange={(event) => onEdit(field, event.target.value)}
      placeholder={field === 'cleared' ? undefined : field === 'rate' ? 'Rate' : 'Amount'}
      startAdornment={
        <Box
          component="span"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flex: 'none' }}
        >
          {lead && (
            <Box
              component="span"
              sx={{ fontSize: '0.8rem', color: 'text.secondary', whiteSpace: 'nowrap' }}
            >
              {lead}
            </Box>
          )}
          <Box
            component="span"
            aria-hidden
            sx={(theme) => ({ ...theme.typography.money, color: 'text.secondary' })}
          >
            {symbol(code)}
          </Box>
        </Box>
      }
      inputProps={{
        id: `record-payment-${field}`,
        inputMode: 'decimal',
        autoComplete: 'off',
        readOnly,
        'aria-label': label,
        'aria-invalid': invalid?.field === field ? 'true' : 'false',
        'aria-describedby': invalid?.field === field ? `record-payment-${field}-error` : undefined,
      }}
      sx={(theme) => fieldBox(theme, invalid?.field === field)}
    />
  );

  const error = (field: CrossCurrencyField) => (
    <Typography
      id={`record-payment-${field}-error`}
      aria-live="polite"
      sx={{ m: 0, fontSize: '0.75rem', color: 'status.negative' }}
    >
      {invalid?.field === field ? invalid.message : null}
    </Typography>
  );

  const head = (label: string, end: ReactNode, htmlFor: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 24 }}>
      <Box component="label" htmlFor={htmlFor} sx={smallLabel}>
        {label}
      </Box>
      <Box sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 1 }}>{end}</Box>
    </Box>
  );

  const qualifier = clearedQualifier(clearedMinor, debtMinor, currency);
  const badge = rateBadge(kind, suggestion);

  return (
    <>
      {rate.status === 'none' && !readOnly && (
        <Alert severity="info" role="status">
          <AlertTitle>No rate suggested right now.</AlertTitle>
          {rate.reason === 'currency_unavailable'
            ? `Splitbook has no rate between ${currency} and ${paidCurrency} right now.`
            : 'Splitbook couldn’t get today’s rates.'}{' '}
          You can still record it with the rate you agreed.
        </Alert>
      )}
      <Box
        role="group"
        aria-label="Amount cleared, rate and amount paid. Change any one and the others follow"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          p: 1.75,
          borderRadius: '12px',
          bgcolor: 'surface.muted',
        }}
      >
        <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
          Change any one; the other two follow.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {head(
            'Amount cleared',
            <>
              {qualifier && (
                <Box component="span" sx={qualifierSx}>
                  {qualifier}
                </Box>
              )}
              <CodeChip code={currency} />
            </>,
            'record-payment-cleared',
          )}
          {input('cleared', currency, null, `Amount cleared, ${currency}`)}
          {error('cleared')}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {head(
            `Rate · ${symbol(paidCurrency)} for each ${symbol(currency)}`,
            // No tag while the suggestion is read: none is known yet.
            rate.status !== 'loading' && (
              <Box
                component="span"
                sx={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  px: 1,
                  py: 0.25,
                  borderRadius: '999px',
                  bgcolor:
                    kind === 'suggested' && suggestion && suggestion.ageDays <= 1
                      ? 'tint.positive'
                      : 'tint.warning',
                  color: 'text.primary',
                }}
              >
                {badge}
              </Box>
            ),
            'record-payment-rate',
          )}
          {input(
            'rate',
            paidCurrency,
            `1 ${symbol(currency)} =`,
            `Rate, ${paidCurrency} for each ${currency}`,
          )}
          {error('rate')}
          {rate.status === 'loading' ? (
            <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
              Looking up a suggested rate…
            </Typography>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: 1,
                rowGap: 0.25,
              }}
            >
              <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
                {note.text}
              </Typography>
              {note.attribution && (
                <Link
                  href={note.attribution.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ fontSize: '0.75rem', fontWeight: 600 }}
                >
                  {note.attribution.text}
                </Link>
              )}
              {note.useSuggestion && !readOnly && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => onUseSuggestion(note.useSuggestion!)}
                  sx={{ minHeight: 32, px: 1, fontSize: '0.75rem' }}
                >
                  Use {decimalMoney(rateText(note.useSuggestion), paidCurrency)}
                </Button>
              )}
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {head(
            'Amount paid',
            <>
              <Box component="span" sx={qualifierSx}>
                {roundedTo(paidCurrency)}
              </Box>
              <CodeChip code={paidCurrency} />
            </>,
            'record-payment-paid',
          )}
          {input('paid', paidCurrency, null, `Amount paid, ${paidCurrency}`)}
          {error('paid')}
        </Box>
      </Box>
    </>
  );
}

function CodeChip({ code }: { code: string }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        ...theme.typography.money,
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'text.secondary',
        bgcolor: 'background.paper',
        borderRadius: '6px',
        px: 0.75,
        py: 0.25,
      })}
    >
      {code}
    </Box>
  );
}
