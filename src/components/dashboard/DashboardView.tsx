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
import AddIcon from '@mui/icons-material/Add';
import GroupCard from '@/components/groups/GroupCard';
import InvitationCard from '@/components/dashboard/InvitationCard';
import { formatCurrency } from '@/lib/utils/currency';
import { fetcher } from '@/lib/utils/fetcher';

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

export default function DashboardView({ userId, userName }: DashboardViewProps) {
  const { data: groupsData, isLoading: groupsLoading, error: groupsError } = useSWR('/api/groups', fetcher, {
    refreshInterval: 30_000,
  });
  const { data: invitationsData, error: invitationsError, mutate: mutateInvitations } = useSWR('/api/invitations', fetcher, {
    refreshInterval: 30_000,
  });

  const groups = groupsData?.data || [];
  const invitations = invitationsData?.data || [];

  return (
    <Container maxWidth="lg" disableGutters>
      <Stack spacing={4}>
        {/* Greeting */}
        <Typography variant="h5" fontWeight={700} color="text.primary">
          {getGreeting()}, {userName.split(' ')[0]}! 👋
        </Typography>

        {/* Pending Invitations */}
        {invitations.length > 0 && (
          <Box component="section">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <Typography variant="subtitle1" fontWeight={600} color="text.primary">
                📩 Pending Invitations
              </Typography>
              <Chip label={invitations.length} size="small" color="primary" />
            </Stack>
            <Stack spacing={1.5}>
              {invitations.map((inv: Record<string, unknown>) => (
                <InvitationCard
                  key={inv._id as string}
                  invitation={inv}
                  onAction={() => mutateInvitations()}
                />
              ))}
            </Stack>
          </Box>
        )}

        {(groupsError || invitationsError) && (
          <Typography color="error.main">
            {groupsError?.message || invitationsError?.message}
          </Typography>
        )}

        {/* Groups */}
        <Box component="section">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600} color="text.primary">
              Your Groups
            </Typography>
            <Button
              component={Link}
              href="/groups/new"
              variant="contained"
              startIcon={<AddIcon />}
              size="small"
            >
              New Group
            </Button>
          </Stack>

          {groupsLoading ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  md: '1fr 1fr',
                  lg: '1fr 1fr 1fr',
                },
                gap: 2,
              }}
            >
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} variant="rounded" height={144} />
              ))}
            </Box>
          ) : groups.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
              <Typography component="span" sx={{ fontSize: '2.5rem', display: 'block', mb: 2 }}>
                👥
              </Typography>
              <Typography variant="subtitle1" fontWeight={500} color="text.primary" sx={{ mb: 1 }}>
                No groups yet
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                Create your first group to start splitting expenses!
              </Typography>
              <Button
                component={Link}
                href="/groups/new"
                variant="contained"
                startIcon={<AddIcon />}
              >
                Create Group
              </Button>
            </Paper>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  md: '1fr 1fr',
                  lg: '1fr 1fr 1fr',
                },
                gap: 2,
              }}
            >
              {groups.map((group: Record<string, unknown>) => (
                <GroupCard key={group._id as string} group={group} userId={userId} />
              ))}
            </Box>
          )}
        </Box>
      </Stack>
    </Container>
  );
}
