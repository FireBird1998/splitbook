'use client';

import Typography, { type TypographyProps } from '@mui/material/Typography';
import { formatCurrency } from '@/lib/utils/currency';
import { formatSignedCurrency, getMoneyTone, type MoneyTone } from '@/lib/utils/money';

interface MoneyTextProps extends Omit<TypographyProps, 'children'> {
  amount: number;
  currency: string;
  /** Show an explicit +/− sign and derive color from the sign. */
  signed?: boolean;
  /** Defaults to 'auto' (sign-based). Pass 'neutral' to opt out of coloring. */
  tone?: MoneyTone | 'auto';
}

const TONE_COLORS: Record<MoneyTone, string> = {
  positive: 'success.main',
  negative: 'error.main',
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
  const text = signed ? formatSignedCurrency(amount, currency) : formatCurrency(amount, currency);

  return (
    <Typography
      component="span"
      variant={variant}
      color={color ?? TONE_COLORS[resolvedTone]}
      sx={[
        (theme) => ({ ...(theme.typography.money as React.CSSProperties) }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...props}
    >
      {text}
    </Typography>
  );
}
