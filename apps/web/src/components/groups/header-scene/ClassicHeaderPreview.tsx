'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import FlightIcon from '@mui/icons-material/Flight';
import type { headerCard } from '@splitbook/shared/group-header';
import { counted, SEPARATOR } from '@splitbook/shared/separator';
import { tripDateRange } from '../group-dates';

/** Preview the Classic identity, with real Group facts and no invented balance or spend. */
export default function ClassicHeaderPreview({ card }: { card: ReturnType<typeof headerCard> }) {
  return (
    <Box
      role="group"
      aria-label="Classic header preview"
      sx={{
        height: 232,
        display: 'flex',
        alignItems: 'center',
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '14px',
        bgcolor: 'surface.muted',
      }}
    >
      {card.trip ? (
        <Box
          sx={{
            width: '100%',
            p: 2,
            borderRadius: '12px',
            background: (theme) => (theme.vars ?? theme).palette.strip.bg,
            color: 'strip.text',
          }}
        >
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 22, fontWeight: 600 }}
          >
            <span>{card.trip.route.from}</span>
            <Box aria-hidden sx={{ flex: 1, borderTop: '1px dashed', opacity: 0.6 }} />
            <FlightIcon aria-hidden fontSize="small" />
            <Box aria-hidden sx={{ flex: 1, borderTop: '1px dashed', opacity: 0.6 }} />
            <span>{card.trip.route.to}</span>
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
            {[
              tripDateRange(card.trip.start, card.trip.end),
              counted(card.members, 'member'),
              card.currencies.join(SEPARATOR),
            ]
              .filter(Boolean)
              .join(SEPARATOR)}
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            width: '100%',
            p: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            borderRadius: '12px',
          }}
        >
          <Typography fontWeight={600}>{card.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {[card.theme, counted(card.members, 'member'), card.currencies.join(SEPARATOR)].join(
              SEPARATOR,
            )}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
