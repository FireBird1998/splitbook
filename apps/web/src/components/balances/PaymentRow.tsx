import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { PersonAvatar } from './TabCard';

interface PaymentRowProps {
  /** The payer's and payee's own names, for their initials. */
  fromName: string;
  toName: string;
  /** "You pay Sam Chen", "Priya Shah owes you". */
  title: ReactNode;
  /** The line under the title. */
  sub: ReactNode;
  /** The amount, and any action after it. */
  end: ReactNode;
  /** The row whose payment is in the form. */
  highlighted?: boolean;
}

/**
 * One payment between two people on Settle up (design canvas "Web portal", Balances): the
 * payer's initials → the payee's, a title with a line under it, then the amount. Suggested
 * payments and the Debts before simplifying both use it (#646).
 */
export default function PaymentRow({
  fromName,
  toName,
  title,
  sub,
  end,
  highlighted = false,
}: PaymentRowProps) {
  return (
    <Box
      component="li"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1.5,
        minHeight: 60,
        px: 2.5,
        py: 1,
        bgcolor: highlighted ? 'tint.brand' : 'transparent',
        '& + li': { borderTop: 1, borderColor: 'divider' },
      }}
    >
      <Box aria-hidden sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        <PersonAvatar name={fromName} />
        <Box
          component="svg"
          viewBox="0 0 24 24"
          sx={{
            width: 16,
            height: 16,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            color: 'text.disabled',
          }}
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </Box>
        <PersonAvatar name={toName} />
      </Box>
      <Box
        sx={{
          flex: '1 1 160px',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '1px',
        }}
      >
        <Typography sx={{ m: 0, fontSize: '0.875rem', fontWeight: 600, color: 'text.primary' }}>
          {title}
        </Typography>
        <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>{sub}</Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 'auto' }}>{end}</Box>
    </Box>
  );
}
