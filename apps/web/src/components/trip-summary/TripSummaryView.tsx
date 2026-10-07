'use client';

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { statementPath } from '@splitbook/shared/statement-request';
import type { TripSummaryRead } from '@splitbook/shared/trip-summary-read';
import ErrorState from '@/components/common/ErrorState';
import { HomeRow, HomeSlot } from '@/components/dashboard/HomeCard';
import { visuallyHidden } from '@/components/insights/a11y';
import { RADIUS } from '@/lib/theme/tokens';
import TripDayChartCard, { type TripDayView } from './TripDayChartCard';
import TripTagsCard from './TripTagsCard';
import TripWrapUpCard from './TripWrapUpCard';
import {
  otherCurrenciesNote,
  tripCardState,
  tripDayChart,
  tripFigures,
  tripTags,
  wrapUp,
  type TripFigures,
} from './trip-summary';

/*
 * A Trip's Insights tab (#316, design canvas "Web portal", Trip Group): the whole trip in
 * figures, the day-by-day chart with the daily average, the wrap-up's suggested payments with
 * Record, and By Tag. One read feeds every card, and each card shows its own loading, empty and
 * failed state. The Trip keeps one currency: there is no second-currency row.
 */

export interface TripSummaryViewProps {
  groupId: string;
  userId: string;
  /** The viewer's today, `YYYY-MM-DD` in their own time zone. */
  today: string;
  /** The viewer's own IANA time zone, which the Trip's statement is read in too. */
  timeZone: string;
  /** The read for the viewer's time zone; undefined while it loads. */
  read: TripSummaryRead | undefined;
  failed: boolean;
  onRetry: () => void;
  /** The day-by-day card's first view. */
  initialView?: TripDayView;
}

/** The figures' columns, as the canvas's .cols-sm: as many 180 px figures as fit. */
const FIGURE_COLUMNS = 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))';
const FIGURE_LABELS = ['Spent', 'Your share', 'You paid', 'Per person per day'];

export default function TripSummaryView({
  groupId,
  userId,
  today,
  timeZone,
  read,
  failed,
  onRetry,
  initialView,
}: TripSummaryViewProps) {
  const state = tripCardState(read, failed);
  const ready = state === 'ready' && read ? read : null;
  const thisYear = Number(today.slice(0, 4));
  const note = ready ? otherCurrenciesNote(ready) : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <WholeTrip figures={ready ? tripFigures(ready) : null} state={state} onRetry={onRetry} />

      {note ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>
          {note}
        </Typography>
      ) : null}

      <HomeRow>
        <TripDayChartCard
          model={ready ? tripDayChart(ready, { thisYear }) : null}
          state={state}
          onRetry={onRetry}
          initialView={initialView}
        />
        <HomeSlot width="narrow">
          <Box sx={{ display: 'grid', gap: 2.5 }}>
            <TripWrapUpCard
              currency={ready?.currency ?? null}
              model={ready ? wrapUp(ready, { groupId, userId, today }) : null}
              state={state}
              onRetry={onRetry}
              shareHref={statementPath(groupId, { timeZone, wholeTrip: true })}
            />
            <TripTagsCard
              currency={ready?.currency ?? null}
              rows={ready ? tripTags(ready, groupId) : null}
              state={state}
              onRetry={onRetry}
            />
          </Box>
        </HomeSlot>
      </HomeRow>
    </Box>
  );
}

const subSx = { fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' } as const;

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
      <Typography component="p" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function Amount({ text }: { text: string | null }) {
  return (
    <Typography
      component="p"
      sx={[
        (theme) => ({ ...theme.typography.money }),
        {
          fontSize: '1.75rem',
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          color: 'text.primary',
          overflowWrap: 'anywhere',
        },
      ]}
    >
      {text ?? (
        <>
          <span aria-hidden="true">–</span>
          <Box component="span" sx={visuallyHidden}>
            None
          </Box>
        </>
      )}
    </Typography>
  );
}

/** "Whole trip · INR": Spent, the member's share, what they paid, and per person per day. */
function WholeTrip({
  figures,
  state,
  onRetry,
}: {
  figures: TripFigures | null;
  state: ReturnType<typeof tripCardState>;
  onRetry: () => void;
}) {
  return (
    <Box
      component="section"
      aria-labelledby="trip-whole-heading"
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
        px: 2.5,
        pt: 1.75,
        pb: 2.25,
      }}
    >
      <Typography
        id="trip-whole-heading"
        component="h2"
        sx={{
          fontSize: '0.75rem',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'text.secondary',
          mb: 1.25,
        }}
      >
        {figures ? figures.heading : 'Whole trip'}
      </Typography>
      {figures ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: FIGURE_COLUMNS, gap: '16px 24px' }}>
          <Figure label="Spent">
            <Amount text={figures.spent.text} />
            <Typography component="p" sx={subSx}>
              {figures.spent.line}
            </Typography>
          </Figure>
          <Figure label="Your share">
            <Amount text={figures.share.text} />
            <Typography component="p" sx={subSx}>
              {figures.share.line}
            </Typography>
          </Figure>
          <Figure label="You paid">
            <Amount text={figures.paid.text} />
            <Typography
              component="p"
              sx={{
                ...subSx,
                color: figures.paid.tone === 'positive' ? 'status.positive' : 'text.secondary',
              }}
            >
              {figures.paid.line}
            </Typography>
          </Figure>
          <Figure label="Per person per day">
            <Amount text={figures.perPersonPerDay.text} />
            <Typography component="p" sx={subSx}>
              {figures.perPersonPerDay.line}
            </Typography>
          </Figure>
        </Box>
      ) : state === 'empty' ? (
        <Box sx={{ p: 2, borderRadius: `${RADIUS.md}px`, bgcolor: 'surface.muted' }}>
          <Typography component="p" sx={{ fontWeight: 600, color: 'text.primary' }}>
            No Expenses yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Once the trip has Expenses, what it cost shows here.
          </Typography>
        </Box>
      ) : state === 'failed' ? (
        <ErrorState
          message="The trip’s figures could not be loaded."
          onRetry={onRetry}
          retryLabel="Try again"
        />
      ) : (
        <Box
          role="status"
          aria-label="Loading the trip’s figures"
          aria-busy="true"
          sx={{ display: 'grid', gridTemplateColumns: FIGURE_COLUMNS, gap: '16px 24px' }}
        >
          {FIGURE_LABELS.map((label) => (
            <Figure key={label} label={label}>
              <Skeleton variant="text" width="70%" height={36} />
              <Skeleton variant="text" width="55%" height={18} />
            </Figure>
          ))}
        </Box>
      )}
    </Box>
  );
}
