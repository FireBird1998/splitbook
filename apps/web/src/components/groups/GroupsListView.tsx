'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import GroupCard from './GroupCard';
import { useGroups } from '@/lib/hooks/use-groups';
import ErrorState from '@/components/common/ErrorState';

interface GroupsListViewProps {
  userId: string;
}

export default function GroupsListView({ userId }: GroupsListViewProps) {
  const { data: groups, isLoading, error, mutate } = useGroups(userId);

  return (
    <Container maxWidth="lg" disableGutters>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700} color="text.primary">
          Groups
        </Typography>
        <Button component={Link} href="/groups/new" variant="contained" startIcon={<AddIcon />}>
          New Group
        </Button>
      </Stack>

      {error && (
        <ErrorState
          message={
            groups
              ? 'Groups could not be refreshed. Showing previously loaded groups.'
              : 'Groups could not be loaded.'
          }
          onRetry={() => void mutate()}
        />
      )}
      {isLoading && !groups ? (
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
      ) : !groups ? null : groups.length === 0 ? (
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
          <Button component={Link} href="/groups/new" variant="contained" startIcon={<AddIcon />}>
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
          {groups.map((group) => (
            <GroupCard key={group._id} group={group} userId={userId} mode="management" />
          ))}
        </Box>
      )}
    </Container>
  );
}
