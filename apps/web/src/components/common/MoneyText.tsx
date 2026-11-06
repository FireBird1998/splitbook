'use client';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
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
  /**
   * Styles for the figure on its own. Given, the figure is an element apart from a currency code
   * written before it ("CHF" in "CHF 10,000,000.00"), so a narrow table can put the code above
   * it (#942); a symbol ("₹621.50") stays with its figure. Read aloud, it is one amount still.
   */
  figureSx?: SxProps<Theme>;
}

/**
 * "CHF 10,000,000.00" as its code and its figure; null for "₹621.50", whose symbol is part of
 * its figure, and for a signed amount, whose sign comes before the code.
 */
export function codeAndFigure(text: string): { code: string; figure: string } | null {
  const match = /^([A-Z]{3})[ \u00a0](\d[\d,.]*)$/.exec(text);
  return match ? { code: match[1]!, figure: match[2]! } : null;
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
  figureSx,
  ...props
}: MoneyTextProps) {
  const resolvedTone = tone === 'auto' ? getMoneyTone(amount) : tone;
  const text = signed
    ? formatSignedCurrency(amount, currency)
    : formatCurrencyWithMinus(amount, currency);
  const parts = figureSx === undefined ? null : codeAndFigure(text);

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
      {figureSx === undefined ? (
        text
      ) : (
        <>
          {/* A plain space: where the code goes above, it ends that line and is not drawn. */}
          {parts && `${parts.code} `}
          <Box component="span" sx={figureSx}>
            {parts ? parts.figure : text}
          </Box>
        </>
      )}
    </Typography>
  );
}
