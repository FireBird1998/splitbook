'use client';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import RepeatIcon from '@mui/icons-material/Repeat';
import MoneyText from '@/components/common/MoneyText';
import { visuallyHidden } from '@/components/common/visually-hidden';
import { initials } from '@/components/layout/AccountMenu';
import type { ExpensePosition } from '@splitbook/shared/expense-position';
import type { ExpensePayerSummary } from '@splitbook/shared/expense-row';

/** An Expense's Tag, as the design canvas's `.tag` pill. */
export function ExpenseTag({ name }: { name: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: '0.75rem',
        fontWeight: 500,
        lineHeight: 1.45,
        color: 'text.secondary',
        bgcolor: 'surface.muted',
        borderRadius: '6px',
        px: '7px',
        py: '1px',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </Box>
  );
}

/**
 * The repeat icon beside an Expense a recurring Expense added. Shown only while recurring
 * Expenses are switched on (#289); templates repeat monthly, the only cadence there is.
 */
export function RepeatsIcon() {
  return (
    <RepeatIcon
      role="img"
      aria-hidden={false}
      aria-label="Repeats monthly"
      sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }}
    />
  );
}

/**
 * What the Expense means for the member: "lent ₹833.00" or "owe ₹953.33", read aloud as "you
 * lent" and "you owe", in the status colours, which reach 4.5:1 on every surface a row has.
 * Nothing either way shows a dash.
 */
export function PositionText({
  position,
  currency,
}: {
  position: ExpensePosition | null;
  currency: string;
}) {
  if (!position)
    return (
      <Box component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
        <span aria-hidden>—</span>
        <Box component="span" sx={visuallyHidden}>
          nothing to settle
        </Box>
      </Box>
    );
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        justifyContent: 'flex-end',
        gap: '5px',
        whiteSpace: 'nowrap',
        color: position.kind === 'lent' ? 'status.positive' : 'status.negative',
      }}
    >
      <Box component="span" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
        <Box component="span" sx={visuallyHidden}>
          you{' '}
        </Box>
        {position.kind}
      </Box>
      <MoneyText amount={position.amount} currency={currency} color="inherit" variant="body2" />
    </Box>
  );
}

/** Who paid, with their initials (design canvas `.gx-payer`): "You", a name or "2 people". */
export function PayerLabel({ payer }: { payer: ExpensePayerSummary }) {
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, whiteSpace: 'nowrap' }}
    >
      <Avatar
        aria-hidden
        sx={{
          width: 26,
          height: 26,
          borderRadius: '9px',
          bgcolor: 'tint.brand',
          color: 'primary.main',
          fontSize: '0.65625rem',
          fontWeight: 600,
        }}
      >
        {payer.name ? initials(payer.name) : <GroupOutlinedIcon sx={{ fontSize: 16 }} />}
      </Avatar>
      {payer.label}
    </Box>
  );
}
