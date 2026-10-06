'use client';

import Link from 'next/link';
import useSWR from 'swr';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import ErrorState from '@/components/common/ErrorState';
import { userActivityPath } from '@splitbook/shared/api-paths';
import {
  activityLineParts,
  formatActivityAmount,
  formatActivityTimestamp,
  type ActivityAmount,
} from '@splitbook/shared/activity-timeline';
import {
  USER_ACTIVITY_DEFAULT_LIMIT,
  parseUserActivityResponse,
  type UserActivityEventRead,
} from '@splitbook/shared/user-activity-read';
import { fetcher } from '@/lib/utils/fetcher';
import { RADIUS } from '@/lib/theme/tokens';

/** The read behind the card: the member's latest changes across their Groups (#309). */
export const LATEST_CHANGES_KEY = userActivityPath({ limit: USER_ACTIVITY_DEFAULT_LIMIT });

async function fetchLatestChanges(path: string) {
  // A response the shared decoder refuses is a failed read; SWR keeps the last good one.
  return parseUserActivityResponse(await fetcher(path));
}

/**
 * Read aloud, never seen. Sizes are strings: in `sx`, a width or height of 1 means 100% and a
 * margin of -1 means one spacing unit, which would stretch the span down the page.
 */
const visuallyHidden = {
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

/** "Priya Shah" → "PS", as the account menu's avatar shows a name. */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return `${words[0][0]}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase();
}

/**
 * Where an entry leads: its Group's page, which holds the Group's Activity. Neither the
 * Activity tab nor an Expense has an address of its own yet (#305, #311).
 */
const latestChangeHref = (event: UserActivityEventRead) => `/groups/${event.group._id}`;

export type LatestChangesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; activities: UserActivityEventRead[] };

interface LatestChangesCardProps {
  /** The signed-in member, who reads as "You". */
  userId: string;
}

/**
 * Home's "Latest changes": the newest Activity across every Group the member belongs to, each
 * with who did what, to which Expense, in which Group and when, and the amount ("₹899.00 →
 * ₹999.00" for an edit). It loads, fails and recovers on its own, without holding up Home.
 */
export default function LatestChangesCard({ userId }: LatestChangesCardProps) {
  const { data, error, mutate } = useSWR(LATEST_CHANGES_KEY, fetchLatestChanges, {
    refreshInterval: 30_000,
  });
  const state: LatestChangesState = data
    ? { status: 'ready', activities: data.activities }
    : error
      ? { status: 'error' }
      : { status: 'loading' };
  return <LatestChangesView state={state} viewerId={userId} onRetry={() => void mutate()} />;
}

interface LatestChangesViewProps {
  state: LatestChangesState;
  viewerId: string;
  onRetry: () => void;
}

export function LatestChangesView({ state, viewerId, onRetry }: LatestChangesViewProps) {
  return (
    <Box
      component="section"
      aria-labelledby="latest-changes-heading"
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
        minWidth: 0,
        pb: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 56, px: 2.5, pt: 2, pb: 1 }}>
        <Typography
          id="latest-changes-heading"
          component="h2"
          sx={{ fontSize: '1rem', lineHeight: 1.3, fontWeight: 600 }}
        >
          Latest changes
        </Typography>
      </Box>

      {state.status === 'loading' ? (
        <Box role="status" aria-label="Loading latest changes" sx={{ px: 2.5 }}>
          {[0, 1, 2].map((row) => (
            <Box
              key={row}
              aria-hidden
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 60 }}
            >
              <Skeleton variant="rounded" width={26} height={26} sx={{ borderRadius: '9px' }} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="35%" sx={{ fontSize: '0.75rem' }} />
              </Box>
            </Box>
          ))}
        </Box>
      ) : state.status === 'error' ? (
        <Box sx={{ px: 2.5, pb: 1.5 }}>
          <ErrorState
            message="Latest changes could not be loaded."
            onRetry={onRetry}
            retryLabel="Try again"
          />
        </Box>
      ) : state.activities.length === 0 ? (
        <Box sx={{ px: 2.5, pb: 2 }}>
          <Typography variant="body2" fontWeight={600} color="text.primary">
            No changes yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Expenses, payments and members joining any of your Groups will show here.
          </Typography>
        </Box>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {state.activities.map((event) => (
            <LatestChangeRow key={event._id} event={event} viewerId={viewerId} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function LatestChangeRow({ event, viewerId }: { event: UserActivityEventRead; viewerId: string }) {
  const { actor, action, subject } = activityLineParts(event, viewerId);
  const amount = formatActivityAmount(event, event.currency);

  return (
    <Box component="li" sx={{ '& + &': { borderTop: 1, borderColor: 'divider' } }}>
      <Box
        component={Link}
        href={latestChangeHref(event)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          minHeight: 60,
          px: 2.5,
          py: 1,
          color: 'text.primary',
          textDecoration: 'none',
          outlineOffset: '-2px',
          '&:hover': { bgcolor: 'surface.hover' },
        }}
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
          {initials(event.actor?.name ?? '') || undefined}
        </Avatar>
        <Box
          sx={{
            flex: '1 1 auto',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '1px',
          }}
        >
          <Box component="span" sx={{ fontSize: '0.8125rem', lineHeight: 1.4 }}>
            <Box component="strong" sx={{ fontWeight: 600 }}>
              {actor}
            </Box>{' '}
            {action}
            {subject ? (
              <>
                {' '}
                <Box component="strong" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {subject}
                </Box>
              </>
            ) : null}
          </Box>
          <Box
            component="span"
            sx={{ fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' }}
          >
            {event.group.name} ·{' '}
            <time dateTime={event.createdAt}>{formatActivityTimestamp(event)}</time>
          </Box>
        </Box>
        {amount ? <AmountText amount={amount} /> : null}
      </Box>
    </Box>
  );
}

/**
 * "₹1,249.50", or for an edit "₹899.00 → ₹999.00", read aloud as "from ₹899.00 to ₹999.00".
 * On a narrow card the amount after an edit moves to its own line; an amount never breaks.
 */
function AmountText({ amount }: { amount: ActivityAmount }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        ...theme.typography.money,
        flex: '0 1 auto',
        fontSize: '0.78125rem',
        lineHeight: 1.3,
        letterSpacing: '-0.02em',
        textAlign: 'right',
        '& > span': { whiteSpace: 'nowrap' },
      })}
    >
      {amount.before ? (
        <>
          {/* Quieter than the amount after, and still readable on the row's hover fill. */}
          <Box component="span" sx={{ color: 'text.secondary' }}>
            <Box component="span" sx={visuallyHidden}>
              from{' '}
            </Box>
            {amount.before}
            <span aria-hidden> →</span>
            <Box component="span" sx={visuallyHidden}>
              {' '}
              to
            </Box>
          </Box>{' '}
        </>
      ) : null}
      <span>{amount.after}</span>
    </Box>
  );
}
