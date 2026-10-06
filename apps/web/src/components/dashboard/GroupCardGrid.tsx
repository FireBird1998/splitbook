'use client';

import Link from 'next/link';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import GroupCard from '@/components/groups/GroupCard';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { fetcher } from '@/lib/utils/fetcher';
import { useGroups } from '@/lib/hooks/use-groups';
import type { UserBalancesResponse } from '@splitbook/shared/types';
import { HOME_BALANCES_KEY } from './home-reads';

/**
 * Home's grid of Group cards, as it was before the Home redesign (#306). It stays until #308
 * replaces it with the Groups table from the design canvas. Its reads load and fail on their
 * own; it sits in a row as the wide card.
 */
export default function GroupCardGrid({ userId }: { userId: string }) {
  const {
    data: groupsData,
    isLoading: groupsLoading,
    error: groupsError,
    mutate: mutateGroups,
  } = useGroups(userId);
  const { data: balancesData } = useSWR(HOME_BALANCES_KEY, fetcher, { refreshInterval: 30_000 });

  const groups = groupsData ?? [];
  const balanceSummary = balancesData?.data as UserBalancesResponse | undefined;
  const balanceByGroupId = new Map(
    (balanceSummary?.groups ?? []).map((groupBalance) => [groupBalance.groupId, groupBalance]),
  );

  return (
    <Box
      component="section"
      aria-labelledby="home-groups-heading"
      sx={{ flex: '999 1 600px', minWidth: 0 }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography id="home-groups-heading" variant="h6" component="h2">
            Your groups
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Personal balances and the quickest next step for each group.
          </Typography>
        </Box>
        <Button component={Link} href="/groups/new" startIcon={<AddIcon />} size="small">
          New group
        </Button>
      </Stack>

      {groupsError && (
        <ErrorState
          message={
            groupsData
              ? 'Groups could not be refreshed. Showing previously loaded groups.'
              : 'Groups could not be loaded.'
          }
          onRetry={() => void mutateGroups()}
        />
      )}
      {groupsError && !groupsData ? null : groupsLoading && !groupsData ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
            gap: 2,
          }}
        >
          {[1, 2].map((item) => (
            <Skeleton key={item} variant="rounded" height={180} />
          ))}
        </Box>
      ) : groups.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState
            title="No groups yet"
            description="Create a group to start tracking shared expenses."
            action={
              <Button
                component={Link}
                href="/groups/new"
                variant="contained"
                startIcon={<AddIcon />}
              >
                Create your first group
              </Button>
            }
          />
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
            gap: 2,
          }}
        >
          {groups.map((group) => {
            const groupBalance = balanceByGroupId.get(group._id);
            return (
              <GroupCard
                key={group._id}
                group={group}
                userId={userId}
                balances={groupBalance?.balances}
                balanceUnavailable={!balanceSummary}
                hasMixedCurrencies={groupBalance?.hasMixedCurrencies}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
}
