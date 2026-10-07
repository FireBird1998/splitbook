import type { ReactNode } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { initials } from '@/components/layout/AccountMenu';

/*
 * The Balances tab's building blocks (#312), sized as the design canvas draws them
 * (web.css: .card, .card-h, .avatar.sm).
 */

const CARD_RADIUS = '16px';

/**
 * Read aloud, never seen. Sizes are strings: in `sx`, a width or height of 1 means 100% and a
 * margin of -1 means one spacing unit.
 */
export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

interface TabCardProps {
  /** The heading's id; the card is a region named by it. */
  headingId: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Beside the heading, such as a currency. */
  aside?: ReactNode;
  children: ReactNode;
}

/** A card with a heading, as a region named by that heading. */
export function TabCard({ headingId, title, subtitle, aside, children }: TabCardProps) {
  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: CARD_RADIUS,
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px 12px',
          minHeight: 56,
          px: 2.5,
          pt: 2,
          pb: 1,
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <Typography
            id={headingId}
            component="h2"
            sx={{ m: 0, fontSize: '1rem', lineHeight: 1.3, fontWeight: 600, color: 'text.primary' }}
          >
            {title}
          </Typography>
          {subtitle ? (
            <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {aside}
      </Box>
      {children}
    </Box>
  );
}

/** A person's initials in the small rounded square the canvas uses beside a name. */
export function PersonAvatar({ name }: { name: string }) {
  return (
    <Avatar
      aria-hidden
      sx={{
        width: 26,
        height: 26,
        borderRadius: '9px',
        bgcolor: 'tint.brand',
        color: 'primary.main',
        fontSize: '0.66rem',
        fontWeight: 600,
        flex: 'none',
      }}
    >
      {initials(name)}
    </Avatar>
  );
}

/** "→" between two people, hidden from screen readers, which hear `to` instead. */
export function PaysArrow() {
  return (
    <>
      <Box
        component="svg"
        viewBox="0 0 24 24"
        aria-hidden
        sx={{
          width: 16,
          height: 16,
          flex: 'none',
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
      <Box component="span" sx={visuallyHidden}>
        {' to '}
      </Box>
    </>
  );
}
