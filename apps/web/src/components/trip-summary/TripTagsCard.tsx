'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  HomeCard,
  HomeCardBody,
  HomeCardEmpty,
  HomeCardError,
  HomeCardLoading,
} from '@/components/dashboard/HomeCard';
import type { TripCardState, TripTagRow } from './trip-summary';

/*
 * "By Tag" on a Trip's Insights tab (#316, design canvas "Web portal", Trip Group): each Tag's
 * Spent over the whole trip, its share of the trip's spend and how many Expenses it has. Each
 * Tag is a link to the Expenses tab filtered by it, with #310's address filter. The bars are
 * drawn in the one series colour and hidden from assistive technology: every figure is text.
 */

interface TripTagsCardProps {
  currency: string | null;
  rows: TripTagRow[] | null;
  state: TripCardState;
  onRetry: () => void;
}

const moneySx = (theme: { typography: { money: object } }) => ({ ...theme.typography.money });

export default function TripTagsCard({ currency, rows, state, onRetry }: TripTagsCardProps) {
  const ready = state === 'ready' && rows;
  return (
    <HomeCard
      id="trip-tags"
      title="By Tag"
      width="narrow"
      subtitle={ready && currency ? `Whole trip · ${currency}` : undefined}
    >
      {ready ? (
        rows.length > 0 ? (
          <HomeCardBody>
            <Box component="ul" aria-label="Spending by Tag" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {rows.map((row) => (
                <Box component="li" key={row.key} sx={{ mx: -1 }}>
                  <TagRow row={row} />
                </Box>
              ))}
            </Box>
          </HomeCardBody>
        ) : (
          <HomeCardEmpty
            title="Nothing to sort by Tag"
            description={`This trip has no Expenses in ${currency ?? 'its currency'} yet.`}
          />
        )
      ) : state === 'empty' ? (
        <HomeCardEmpty
          title="No Expenses yet"
          description="Each Tag’s share of the trip shows here once it has Expenses."
        />
      ) : state === 'failed' ? (
        <HomeCardError message="By Tag could not be loaded." onRetry={onRetry} />
      ) : (
        <HomeCardLoading label="Loading spending by Tag" blocks={3} height={44} />
      )}
    </HomeCard>
  );
}

const rowSx = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gridTemplateAreas: '"name value" "track track" "detail detail"',
  gap: '4px 12px',
  alignItems: 'center',
  minHeight: 56,
  px: 1,
  py: '6px',
  borderRadius: '10px',
  color: 'text.primary',
  textDecoration: 'none',
} as const;

function TagRow({ row }: { row: TripTagRow }) {
  const content = (
    <>
      <Typography
        component="span"
        noWrap
        sx={{ gridArea: 'name', fontSize: '0.875rem', fontWeight: 500 }}
      >
        {row.name}
      </Typography>
      <Box component="span" sx={[{ gridArea: 'value', fontSize: '0.875rem' }, moneySx]}>
        {row.spentText}
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        sx={{
          gridArea: 'track',
          display: 'block',
          height: 12,
        }}
      >
        <Box
          component="span"
          sx={{
            display: 'block',
            height: 1,
            width: `${row.width}%`,
            minWidth: 2,
            borderRadius: '0 4px 4px 0',
            bgcolor: 'chart.series',
          }}
        />
      </Box>
      <Typography
        component="span"
        sx={{ gridArea: 'detail', fontSize: '0.75rem', color: 'text.secondary' }}
      >
        {row.percentText} of spend · {row.countText}
      </Typography>
    </>
  );
  if (!row.href)
    return (
      <Box aria-label={row.label} role="group" sx={rowSx}>
        {content}
      </Box>
    );
  return (
    <Box
      component={Link}
      href={row.href}
      aria-label={row.label}
      sx={{ ...rowSx, '&:hover': { bgcolor: 'surface.hover' } }}
    >
      {content}
    </Box>
  );
}
