'use client';

import { Children, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import ErrorState from '@/components/common/ErrorState';
import { RADIUS } from '@/lib/theme/tokens';

/**
 * The frame of Home's cards, from the design canvas ("Web portal", Home; web.css .duo, .card,
 * .card-h). Every card on Home uses it, so they share one look and one set of states.
 */

/**
 * A row of Home's cards: a wide card and a narrow one side by side, wrapping to one column on
 * a narrow screen. A wide card alone fills the row; a row without cards renders nothing.
 */
export function HomeRow({ children }: { children?: ReactNode }) {
  const cards = Children.toArray(children);
  if (cards.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
      {cards}
    </Box>
  );
}

/** How wide and narrow cards share a row: a wide card takes what the narrow one leaves. */
const CARD_FLEX = { wide: '999 1 600px', narrow: '1 1 340px' } as const;

/**
 * A row's place for a card that brings its own frame (Latest changes, #309), so it takes the
 * same share of the row as a `HomeCard` of that width.
 */
export function HomeSlot({
  width = 'wide',
  children,
}: {
  width?: 'wide' | 'narrow';
  children: ReactNode;
}) {
  return <Box sx={{ flex: CARD_FLEX[width], minWidth: 0 }}>{children}</Box>;
}

interface HomeCardProps {
  /** Prefix of the heading's id, which labels the card's region. */
  id: string;
  title: string;
  /** Wide cards take the row's larger share; narrow ones sit beside them. */
  width?: 'wide' | 'narrow';
  /** Under the title, in small secondary text: what the card covers, as on the canvas. */
  subtitle?: ReactNode;
  /** Beside the title: a count, a hint or a link. */
  aside?: ReactNode;
  children: ReactNode;
}

function HomeCardTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Typography
      id={id}
      component="h2"
      sx={{ fontSize: '1rem', lineHeight: 1.3, fontWeight: 600, color: 'text.primary' }}
    >
      {children}
    </Typography>
  );
}

/** One card: a labelled region with its heading row, then its content. */
export function HomeCard({ id, title, width = 'wide', subtitle, aside, children }: HomeCardProps) {
  const headingId = `${id}-heading`;
  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      sx={{
        flex: CARD_FLEX[width],
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
        pb: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px 12px',
          px: 2.5,
          pt: 2,
          pb: 1,
          minHeight: 56,
        }}
      >
        {subtitle ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <HomeCardTitle id={headingId}>{title}</HomeCardTitle>
            <Typography sx={{ fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' }}>
              {subtitle}
            </Typography>
          </Box>
        ) : (
          <HomeCardTitle id={headingId}>{title}</HomeCardTitle>
        )}
        {aside}
      </Box>
      {children}
    </Box>
  );
}

/** A list of rows inside a card (Needs you, Latest changes): web.css .lrow. */
export function HomeList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box component="ul" aria-label={label} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {children}
    </Box>
  );
}

/** One row of a `HomeList`, as an `li`: at least 60 px high, divided from the row above. */
export const homeRowSx = {
  display: 'flex',
  flexWrap: { xs: 'wrap', sm: 'nowrap' },
  alignItems: 'center',
  gap: '4px 12px',
  minHeight: 60,
  px: 2.5,
  py: 1,
  '& + &': { borderTop: 1, borderColor: 'divider' },
  '&:hover': { bgcolor: 'surface.hover' },
} as const;

/** A card's content area, padded like the canvas's .card-b. */
export function HomeCardBody({ children }: { children: ReactNode }) {
  return <Box sx={{ px: 2.5, pt: 0.5, pb: 1.5 }}>{children}</Box>;
}

/** A card still loading: announced once, with placeholder blocks of the content's shape. */
export function HomeCardLoading({
  label,
  blocks,
  height,
}: {
  /** What is loading, for screen readers: "Loading your balances". */
  label: string;
  blocks: number;
  height: number;
}) {
  return (
    <HomeCardBody>
      <Box role="status" aria-label={label} aria-busy="true" sx={{ display: 'grid', gap: 1.5 }}>
        {Array.from({ length: blocks }, (_, index) => (
          <Skeleton key={index} variant="rounded" height={height} />
        ))}
      </Box>
    </HomeCardBody>
  );
}

/** A card whose read failed: a message safe to show, and Try again. */
export function HomeCardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <HomeCardBody>
      <ErrorState message={message} onRetry={onRetry} retryLabel="Try again" />
    </HomeCardBody>
  );
}

/** A card with nothing to show: calm, never an alert. */
export function HomeCardEmpty({
  icon,
  title,
  description,
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
}) {
  return (
    <HomeCardBody>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 2,
          borderRadius: `${RADIUS.md}px`,
          bgcolor: 'surface.muted',
        }}
      >
        {icon}
        <Box sx={{ minWidth: 0 }}>
          <Typography component="p" sx={{ fontWeight: 600, color: 'text.primary' }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
            {description}
          </Typography>
        </Box>
      </Box>
    </HomeCardBody>
  );
}
