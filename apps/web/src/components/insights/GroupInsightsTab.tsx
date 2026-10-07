'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { groupInsightsPath } from '@splitbook/shared/api-paths';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import {
  parseGroupInsightsResponse,
  type GroupInsightsRead,
} from '@splitbook/shared/group-insights-read';
import { useGroupPage } from '@/components/groups/group-page-context';
import { useViewerMonth, useViewerTimeZone } from '@/lib/hooks/use-viewer-time-zone';
import { fetcher } from '@/lib/utils/fetcher';
import GroupInsightsView from './GroupInsightsView';
import { insightsHref, readInsightsAddress, type CompareChoice } from './group-insights';

async function fetchInsights(path: string): Promise<GroupInsightsRead> {
  return parseGroupInsightsResponse(await fetcher(path));
}

/**
 * The Insights tab's route content (#314). The Month and the earlier-Month count come from the
 * address, so reload, Back and a shared link keep them; the Month is the viewer's own, in their
 * time zone, which only the browser knows, so the server render shows the tab loading.
 */
export default function GroupInsightsTab({
  recurringExpensesEnabled = false,
}: {
  /** The product-wide recurring Expenses switch (#289), which only the server reads. */
  recurringExpensesEnabled?: boolean;
}) {
  const { groupId, userId, group } = useGroupPage();
  const timeZone = useViewerTimeZone();
  const searchParams = useSearchParams();
  const router = useRouter();

  const currentMonth = useViewerMonth(timeZone);
  const address = currentMonth ? readInsightsAddress(searchParams, currentMonth) : null;
  const { data, error, mutate } = useSWR(
    timeZone && address
      ? groupInsightsPath(groupId, {
          month: address.month,
          compare: address.compare,
          timeZone,
        })
      : null,
    fetchInsights,
    // Sooner than the Group's own 30 s poll, so a refused read here is the first (#201).
    { refreshInterval: 20_000 },
  );

  const onCompareChange = useCallback(
    (compare: CompareChoice) => {
      if (!address || !currentMonth) return;
      router.replace(insightsHref(groupId, { ...address, compare }, currentMonth), {
        scroll: false,
      });
    },
    [address, currentMonth, groupId, router],
  );

  if (!address || !currentMonth)
    return (
      <Box role="status" aria-label="Loading insights" aria-busy="true">
        <Skeleton variant="rounded" height={44} sx={{ maxWidth: 520, mb: 2.5 }} />
        <Skeleton variant="rounded" height={112} sx={{ mb: 2.5 }} />
        <Skeleton variant="rounded" height={300} />
      </Box>
    );

  return (
    <GroupInsightsView
      groupId={groupId}
      userId={userId}
      address={address}
      currentMonth={currentMonth}
      recurringTheme={getGroupTheme(group.category).recurringExpenses}
      recurringExpensesEnabled={recurringExpensesEnabled}
      isAdmin={group.members.some(
        (member) => member.user._id === userId && member.role === 'admin',
      )}
      read={data}
      failed={!data && Boolean(error)}
      onRetry={() => void mutate()}
      onCompareChange={onCompareChange}
    />
  );
}
