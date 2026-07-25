'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import IconButton from '@mui/material/IconButton';
import Avatar from '@mui/material/Avatar';
import AvatarGroup from '@mui/material/AvatarGroup';
import Fab from '@mui/material/Fab';
import Chip from '@mui/material/Chip';
import SettingsIcon from '@mui/icons-material/Settings';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import ShareIcon from '@mui/icons-material/Share';
import ExpenseListView from '@/components/expenses/ExpenseListView';
import BalancesView from '@/components/balances/BalancesView';
import ActivityView from '@/components/activity/ActivityView';
import ExpenseFormDialog from '@/components/expenses/ExpenseFormDialog';
import InviteDialog from '@/components/groups/InviteDialog';
import { fetcher } from '@/lib/utils/fetcher';

const CATEGORY_ICONS: Record<string, string> = {
  trip: '✈️',
  home: '🏠',
  couple: '💑',
  work: '💼',
  other: '📋',
};

interface GroupDetailViewProps {
  groupId: string;
  userId: string;
}

export default function GroupDetailView({ groupId, userId }: GroupDetailViewProps) {
  const [tab, setTab] = useState(0);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'balances') setTab(1);
      if (params.get('action') === 'add-expense') setExpenseDialogOpen(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  const {
    data: groupData,
    isLoading,
    error,
  } = useSWR(`/api/groups/${groupId}`, fetcher, {
    refreshInterval: 30_000,
  });

  const group = groupData?.data;

  if (isLoading) {
    return (
      <Container maxWidth="lg" disableGutters>
        <Skeleton variant="text" width={192} height={32} sx={{ mb: 2 }} />
        <Skeleton variant="text" width={128} height={20} sx={{ mb: 4 }} />
        <Skeleton variant="rounded" height={384} />
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" disableGutters>
        <Typography color="error.main">{error.message}</Typography>
      </Container>
    );
  }

  if (!group) {
    return (
      <Container maxWidth="lg" disableGutters>
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="h6" fontWeight={500} color="text.primary" sx={{ mb: 1 }}>
            Group not found
          </Typography>
          <Typography color="text.secondary">
            This group may have been deleted or you don&apos;t have access.
          </Typography>
        </Box>
      </Container>
    );
  }

  const members = (group.members || []) as Array<{
    user: { _id: string; name: string; image?: string; email?: string };
    role: string;
  }>;
  const category = group.category as string;

  return (
    <Container maxWidth="lg" disableGutters sx={{ overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <IconButton component={Link} href="/groups" size="small">
              <ArrowBackIcon />
            </IconButton>
            <Typography component="span" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
              {CATEGORY_ICONS[category] || '📋'}
            </Typography>
            <Typography
              variant="h5"
              fontWeight={700}
              color="text.primary"
              sx={{ fontSize: { xs: '1.15rem', sm: '1.5rem' } }}
              noWrap
            >
              {group.name}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
            <IconButton onClick={() => setInviteDialogOpen(true)} size="small" title="Invite">
              <ShareIcon />
            </IconButton>
            <IconButton
              component={Link}
              href={`/groups/${groupId}/settings`}
              size="small"
              title="Settings"
            >
              <SettingsIcon />
            </IconButton>
          </Stack>
        </Stack>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ pl: { xs: 1, sm: 5.5 }, flexWrap: 'wrap', rowGap: 0.5 }}
        >
          <Chip label={category} size="small" variant="outlined" />
          <AvatarGroup
            max={4}
            sx={{
              '& .MuiAvatar-root': { width: 24, height: 24, fontSize: 11 },
            }}
          >
            {members.map((m) => (
              <Avatar
                key={m.user._id}
                src={m.user.image}
                alt={m.user.name}
                sx={{ width: 24, height: 24 }}
              >
                {m.user.name?.[0]}
              </Avatar>
            ))}
          </AvatarGroup>
          <Typography variant="body2" color="text.secondary">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </Typography>
        </Stack>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          mb: 3,
          '& .MuiTab-root': {
            textTransform: 'none',
            fontWeight: 600,
            minWidth: { xs: 'auto', sm: 90 },
            px: { xs: 2, sm: 3 },
          },
          '& .Mui-selected': { color: 'primary.main' },
          '& .MuiTabs-indicator': { backgroundColor: 'primary.main' },
        }}
      >
        <Tab label="Expenses" />
        <Tab label="Balances" />
        <Tab label="Activity" />
      </Tabs>

      {/* Tab Content */}
      {tab === 0 && <ExpenseListView groupId={groupId} userId={userId} group={group} />}
      {tab === 1 && <BalancesView groupId={groupId} userId={userId} group={group} />}
      {tab === 2 && <ActivityView groupId={groupId} />}

      {/* Add Expense FAB */}
      <Fab
        color="primary"
        onClick={() => setExpenseDialogOpen(true)}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
        }}
      >
        <AddIcon />
      </Fab>

      {/* Expense Form Dialog */}
      <ExpenseFormDialog
        open={expenseDialogOpen}
        onClose={() => setExpenseDialogOpen(false)}
        groupId={groupId}
        group={group}
        userId={userId}
      />

      {/* Invite Dialog */}
      <InviteDialog
        open={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        groupId={groupId}
      />
    </Container>
  );
}
