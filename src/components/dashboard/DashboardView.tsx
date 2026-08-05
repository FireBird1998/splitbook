'use client';

import useSWR from 'swr';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import AddIcon from '@mui/icons-material/Add';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import GroupCard from '@/components/groups/GroupCard';
import InvitationCard from '@/components/dashboard/InvitationCard';
import MoneyText from '@/components/common/MoneyText';
import { formatRelativeTime } from '@/lib/utils/date';
import { selectNextAction } from '@/lib/utils/dashboard';
import { fetcher } from '@/lib/utils/fetcher';
import type { UserBalancesResponse } from '@/types';

interface DashboardViewProps {
  userId: string;
  userName: string;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const panelIn = (delayMs = 0) => ({
  animation: 'panel-in 280ms ease-out both',
  animationDelay: `${delayMs}ms`,
});

export default function DashboardView({ userId, userName }: DashboardViewProps) {
  const {
    data: groupsData,
    isLoading: groupsLoading,
    error: groupsError,
    mutate: mutateGroups,
  } = useSWR('/api/groups', fetcher, { refreshInterval: 30_000 });
  const {
    data: balancesData,
    isLoading: balancesLoading,
    error: balancesError,
    mutate: mutateBalances,
  } = useSWR('/api/user/balances', fetcher, { refreshInterval: 30_000 });
  const {
    data: invitationsData,
    isLoading: invitationsLoading,
    error: invitationsError,
    mutate: mutateInvitations,
  } = useSWR('/api/invitations', fetcher, { refreshInterval: 30_000 });

  const groups = (groupsData?.data || []) as Record<string, unknown>[];
  const invitations = (invitationsData?.data || []) as Record<string, unknown>[];
  const balanceSummary = balancesData?.data as UserBalancesResponse | undefined;
  const groupBalances = balanceSummary?.groups || [];
  const balanceByGroupId = new Map(
    groupBalances.map((groupBalance) => [groupBalance.groupId, groupBalance]),
  );
  const nextAction = selectNextAction(groupBalances, invitations.length);
  const recentGroups = [...groups]
    .sort((a, b) => Date.parse(b.updatedAt as string) - Date.parse(a.updatedAt as string))
    .slice(0, 3);
  const initialLoading =
    !groupsData &&
    !invitationsData &&
    !balancesData &&
    (groupsLoading || invitationsLoading || balancesLoading);

  if (initialLoading) {
    return (
      <Container maxWidth="lg" disableGutters>
        <Stack spacing={3}>
          <Skeleton variant="text" width={240} height={40} />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
              gap: 2,
            }}
          >
            {[1, 2].map((item) => (
              <Skeleton key={item} variant="rounded" height={156} />
            ))}
          </Box>
          <Skeleton variant="rounded" height={128} />
          <Skeleton variant="rounded" height={240} />
        </Stack>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" disableGutters>
      <Stack spacing={4}>
        <Box sx={panelIn()}>
          <Typography
            variant="overline"
            component="p"
            color="text.disabled"
            sx={{ display: 'block' }}
          >
            Your money
          </Typography>
          <Typography variant="h5" component="h1" color="text.primary">
            {getGreeting()}, {userName.split(' ')[0]}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Here&apos;s where your shared money stands.
          </Typography>
        </Box>

        <Box
          component="section"
          aria-labelledby="current-balance-heading"
          sx={{ animation: 'balance-settle 400ms ease-out both' }}
        >
          <Stack
            direction="row"
            alignItems="baseline"
            justifyContent="space-between"
            sx={{ mb: 2 }}
          >
            <Typography id="current-balance-heading" variant="h6">
              Current balance
            </Typography>
            {balanceSummary?.buckets.length ? (
              <Typography
                variant="caption"
                color="text.disabled"
                sx={(theme) => ({ ...(theme.typography.money as React.CSSProperties) })}
              >
                {balanceSummary.buckets.map((bucket) => bucket.currency).join(' · ')} kept separate
              </Typography>
            ) : null}
          </Stack>
          {balancesLoading && !balanceSummary ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                gap: 2,
              }}
            >
              {[1, 2].map((item) => (
                <Skeleton key={item} variant="rounded" height={148} />
              ))}
            </Box>
          ) : balancesError && !balanceSummary ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => void mutateBalances()}>
                  Retry
                </Button>
              }
            >
              {balancesError.message || 'Balances could not be loaded.'}
            </Alert>
          ) : balanceSummary?.buckets.length ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                gap: 2,
              }}
            >
              {balanceSummary.buckets.map((bucket) => (
                <Paper key={bucket.currency} variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography
                      variant="caption"
                      fontWeight={600}
                      color="text.disabled"
                      sx={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
                    >
                      Balance
                    </Typography>
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.disabled"
                      sx={(theme) => ({ ...(theme.typography.money as React.CSSProperties) })}
                    >
                      {bucket.currency}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={2} sx={{ mt: 1.5 }} alignItems="center">
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        You owe
                      </Typography>
                      <MoneyText
                        amount={bucket.youOwe}
                        currency={bucket.currency}
                        tone={bucket.youOwe > 0.005 ? 'negative' : 'neutral'}
                        variant="h6"
                        sx={{ display: 'block', fontWeight: 600 }}
                      />
                    </Box>
                    <Divider orientation="vertical" flexItem />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        You&apos;re owed
                      </Typography>
                      <MoneyText
                        amount={bucket.youAreOwed}
                        currency={bucket.currency}
                        tone={bucket.youAreOwed > 0.005 ? 'positive' : 'neutral'}
                        variant="h6"
                        sx={{ display: 'block', fontWeight: 600 }}
                      />
                    </Box>
                  </Stack>
                </Paper>
              ))}
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography fontWeight={700} color="success.main">
                You&apos;re all settled up
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                No outstanding balances across your groups.
              </Typography>
            </Paper>
          )}
          {balanceSummary?.hasMixedCurrencies && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              A group contains legacy transactions in more than one currency. Amounts remain in
              separate currency buckets.
            </Alert>
          )}
        </Box>

        {balancesLoading && !balanceSummary ? (
          <Skeleton variant="rounded" height={128} />
        ) : (
          <Paper
            component="section"
            variant="outlined"
            sx={{ p: { xs: 2, sm: 2.5 }, ...panelIn(60) }}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              spacing={2}
            >
              <Box
                aria-hidden="true"
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '10px',
                  bgcolor: 'tint.info',
                  color: 'info.main',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  fontWeight: 700,
                }}
              >
                →
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  color="text.disabled"
                  sx={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                  Next best action
                </Typography>
                <Typography variant="subtitle1" color="text.primary">
                  {nextAction.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {nextAction.kind === 'settle' ? (
                    <>
                      <MoneyText
                        amount={nextAction.amount}
                        currency={nextAction.currency}
                        tone="neutral"
                        color="text.secondary"
                      />
                      {` · ${nextAction.description}`}
                    </>
                  ) : (
                    nextAction.description
                  )}
                </Typography>
              </Box>
              <Button
                component={Link}
                href={nextAction.href}
                variant="contained"
                color="info"
                endIcon={<ArrowForwardIcon />}
                sx={{ flexShrink: 0 }}
              >
                {nextAction.kind === 'settle'
                  ? 'Settle up'
                  : nextAction.kind === 'review-invitations'
                    ? 'Review'
                    : nextAction.kind === 'create-group'
                      ? 'Create group'
                      : 'Add expense'}
              </Button>
            </Stack>
          </Paper>
        )}

        <Box component="section" sx={panelIn(100)}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Box>
              <Typography variant="h6">Your groups</Typography>
              <Typography variant="body2" color="text.secondary">
                Personal balances and the quickest next step for each group.
              </Typography>
            </Box>
            <Button component={Link} href="/groups/new" startIcon={<AddIcon />} size="small">
              New group
            </Button>
          </Stack>

          {groupsError && !groupsData ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => void mutateGroups()}>
                  Retry
                </Button>
              }
            >
              {groupsError.message || 'Groups could not be loaded.'}
            </Alert>
          ) : groupsLoading && !groupsData ? (
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
            <Paper variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
              <Typography variant="h6">No groups yet</Typography>
              <Typography color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                Create a group to start tracking shared expenses.
              </Typography>
              <Button
                component={Link}
                href="/groups/new"
                variant="contained"
                startIcon={<AddIcon />}
              >
                Create your first group
              </Button>
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
                const groupBalance = balanceByGroupId.get(group._id as string);
                return (
                  <GroupCard
                    key={group._id as string}
                    group={group}
                    userId={userId}
                    balances={groupBalance?.balances}
                    hasMixedCurrencies={groupBalance?.hasMixedCurrencies}
                  />
                );
              })}
            </Box>
          )}
        </Box>

        <Box
          component="section"
          id="pending-actions"
          aria-labelledby="activity-heading"
          sx={panelIn(140)}
        >
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <Typography id="activity-heading" variant="h6">
              Recent activity & pending actions
            </Typography>
            {invitations.length > 0 && (
              <Chip label={invitations.length} size="small" color="primary" />
            )}
          </Stack>

          {invitationsError && !invitationsData ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => void mutateInvitations()}>
                  Retry
                </Button>
              }
            >
              {invitationsError.message || 'Pending actions could not be loaded.'}
            </Alert>
          ) : invitationsLoading && groupsLoading && !invitationsData && !groupsData ? (
            <Skeleton variant="rounded" height={120} />
          ) : (
            <Stack spacing={1.5}>
              {invitations.map((invitation) => (
                <InvitationCard
                  key={invitation._id as string}
                  invitation={invitation}
                  onAction={() => mutateInvitations()}
                />
              ))}
              {recentGroups.map((group) => (
                <Paper
                  key={group._id as string}
                  component={Link}
                  href={`/groups/${group._id}`}
                  variant="outlined"
                  sx={{
                    p: 2,
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box>
                    <Typography variant="body2" fontWeight={600} color="text.primary">
                      {group.name as string}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Last activity {formatRelativeTime(group.updatedAt as string)}
                    </Typography>
                  </Box>
                  <ArrowForwardIcon fontSize="small" color="action" />
                </Paper>
              ))}
              {invitations.length === 0 && recentGroups.length === 0 && (
                <Paper variant="outlined" sx={{ p: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    No recent activity or pending actions.
                  </Typography>
                </Paper>
              )}
            </Stack>
          )}
        </Box>
      </Stack>
    </Container>
  );
}
