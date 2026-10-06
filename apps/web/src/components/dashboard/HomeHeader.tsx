'use client';

import { useState, useSyncExternalStore } from 'react';
import { useSWRConfig } from 'swr';
import { format } from 'date-fns';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useGroups } from '@/lib/hooks/use-groups';
import { lastAnswered, subscribeToAnswers } from '@/lib/utils/read-times';
import { HOME_BALANCES_KEY } from './home-reads';

/** "5 Groups · Updated 10:42 AM", leaving out what isn't known yet. */
export function homeStatusLine(groupCount: number | null, updatedAt: number | null): string {
  return [
    groupCount === null ? null : `${groupCount} ${groupCount === 1 ? 'Group' : 'Groups'}`,
    updatedAt === null ? null : `Updated ${format(updatedAt, 'h:mm a')}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

interface HomeHeaderViewProps {
  groupCount: number | null;
  /** When the member's balances last answered (epoch ms), or null before they have. */
  updatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}

export function HomeHeaderView({
  groupCount,
  updatedAt,
  refreshing,
  onRefresh,
}: HomeHeaderViewProps) {
  const status = homeStatusLine(groupCount, updatedAt);
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '12px 20px',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
        <Typography
          component="h1"
          sx={{
            fontSize: '1.75rem',
            lineHeight: 1.15,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'text.primary',
          }}
        >
          Home
        </Typography>
        {/* Kept in the layout while empty, so the page doesn't shift when the reads answer. */}
        <Typography sx={{ color: 'text.secondary', minHeight: '1.4em' }}>{status}</Typography>
      </Box>
      <Button
        variant="outlined"
        color="inherit"
        startIcon={<RefreshIcon />}
        loading={refreshing}
        loadingPosition="start"
        onClick={onRefresh}
        sx={{
          bgcolor: 'background.paper',
          borderColor: 'border.strong',
          color: 'text.primary',
        }}
      >
        Refresh
      </Button>
    </Box>
  );
}

/**
 * Home's heading (#306): how many Groups the member has, when Home last updated, and Refresh,
 * which reads again everything the page shows (every card's reads and the sidebar's).
 * "Updated" is when the member's balances, the figures at the top of Home, last answered.
 */
export default function HomeHeader({ userId }: { userId: string }) {
  const { data: groups } = useGroups(userId);
  const updatedAt = useSyncExternalStore(
    subscribeToAnswers,
    () => lastAnswered(HOME_BALANCES_KEY),
    () => null,
  );
  const { mutate } = useSWRConfig();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      // Every read on screen: unmounted ones aren't fetched, and each keeps its data on failure.
      await mutate(() => true);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <HomeHeaderView
      groupCount={groups ? groups.length : null}
      updatedAt={updatedAt}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    />
  );
}
