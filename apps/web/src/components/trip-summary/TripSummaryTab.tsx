'use client';

import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { useCallback, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { tripSummaryKey, queryKeyPath, type GroupQueryKey } from '@splitbook/shared/query-keys';
import {
  parseTripSummaryResponse,
  type TripSummaryRead,
} from '@splitbook/shared/trip-summary-read';
import { dayKeyInZone } from '@splitbook/shared/zoned-calendar';
import { useGroupPage } from '@/components/groups/group-page-context';
import { useViewerTimeZone } from '@/lib/hooks/use-viewer-time-zone';
import { fetcher } from '@/lib/utils/fetcher';
import TripSummaryView from './TripSummaryView';

async function fetchTripSummary(key: GroupQueryKey): Promise<TripSummaryRead> {
  return parseTripSummaryResponse(await fetcher(queryKeyPath(key)));
}

/** Checked once a minute, so a page left open moves to the next day when it starts. */
const DAY_CHECK_MS = 60_000;

function everyMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, DAY_CHECK_MS);
  return () => window.clearInterval(timer);
}

/** The viewer's today (`YYYY-MM-DD`) in their time zone; null in a server render. */
function useViewerToday(timeZone: string | null): string | null {
  const snapshot = useCallback(
    () => (timeZone ? dayKeyInZone(Date.now(), timeZone) : null),
    [timeZone],
  );
  return useSyncExternalStore(everyMinute, snapshot, () => null);
}

/**
 * A Trip's Insights tab (#316): the Trip summary in the viewer's own time zone, which only the
 * browser knows, so the server render shows the tab loading.
 */
export default function TripSummaryTab() {
  const { groupId, userId } = useGroupPage();
  const timeZone = useViewerTimeZone();
  const today = useViewerToday(timeZone);
  const { data, error, mutate } = useSWR(
    timeZone ? tripSummaryKey(WEB_QUERY_ACCOUNT, groupId, { timeZone }) : null,
    fetchTripSummary,
    // Sooner than the Group's own 30 s poll, so a refused read here is the first (#201).
    { refreshInterval: 20_000 },
  );

  if (!timeZone || !today)
    return (
      <Box role="status" aria-label="Loading the trip summary" aria-busy="true">
        <Skeleton variant="rounded" height={128} sx={{ mb: 2.5 }} />
        <Skeleton variant="rounded" height={300} />
      </Box>
    );

  return (
    <TripSummaryView
      groupId={groupId}
      userId={userId}
      today={today}
      timeZone={timeZone}
      read={data}
      failed={!data && Boolean(error)}
      onRetry={() => void mutate()}
    />
  );
}
