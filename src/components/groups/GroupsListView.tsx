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
import AddIcon from '@mui/icons-material/Add';
import GroupCard from './GroupCard';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface GroupsListViewProps {
  userId: string;
}

export default function GroupsListView({ userId }: GroupsListViewProps) {
  const { data, isLoading } = useSWR('/api/groups', fetcher, {
    refreshInterval: 30_000,
  });

  const groups = data?.data || [];

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

      {isLoading ? (
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
          {groups.map((group: Record<string, unknown>) => (
            <GroupCard key={group._id as string} group={group} userId={userId} />
          ))}
        </Box>
      )}
    </Container>
  );
}
