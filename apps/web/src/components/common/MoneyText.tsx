'use client';

import Typography, { type TypographyProps } from '@mui/material/Typography';
import {
  formatCurrencyWithMinus,
  formatSignedCurrency,
  getMoneyTone,
  type MoneyTone,
} from '@splitbook/shared/money';

interface MoneyTextProps extends Omit<TypographyProps, 'children'> {
  amount: number;
  currency: string;
  /**
   * Show an explicit +/− sign and derive color from the sign. Unsigned, a negative amount still
   * reads "−₹920.00", with the app's "−" kept to its figure (#906), never a hyphen.
   */
  signed?: boolean;
  /** Defaults to 'auto' (sign-based). Pass 'neutral' to opt out of coloring. */
  tone?: MoneyTone | 'auto';
}

const TONE_COLORS: Record<MoneyTone, string> = {
  positive: 'status.positive',
  negative: 'status.negative',
  neutral: 'text.primary',
};

/**
 * Shared money/amount treatment: IBM Plex Mono + tabular figures,
 * with semantic owe/owed coloring. Use for every rendered amount.
 */
export default function MoneyText({
  amount,
  currency,
  signed = false,
  tone = 'auto',
  variant = 'body2',
  color,
  sx,
  ...props
}: MoneyTextProps) {
  const resolvedTone = tone === 'auto' ? getMoneyTone(amount) : tone;
  const text = signed
    ? formatSignedCurrency(amount, currency)
    : formatCurrencyWithMinus(amount, currency);

  return (
    <Typography
      component="span"
      variant={variant}
      color={color ?? TONE_COLORS[resolvedTone]}
      sx={[
        (theme) => ({ ...theme.typography.money, overflowWrap: 'anywhere' }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...props}
    >
      {text}
    </Typography>
  );
}
