'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
import Button from '@mui/material/Button';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
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
import { formatDate } from '@/lib/utils/date';
import { buildTripChecklist, shouldShowTripChecklist } from '@/lib/utils/trip-setup';

interface GroupDetailViewProps {
  groupId: string;
  userId: string;
}

export default function GroupDetailView({ groupId, userId }: GroupDetailViewProps) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(0);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  useEffect(() => {
    // Defer so deep-link params apply after mount without sync setState-in-effect.
    const timeout = window.setTimeout(() => {
      if (searchParams.get('tab') === 'balances') setTab(1);
      if (searchParams.get('action') === 'add-expense') setExpenseDialogOpen(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [searchParams]);

  const {
    data: groupData,
    isLoading,
    error,
  } = useSWR(`/api/groups/${groupId}`, fetcher, {
    refreshInterval: 30_000,
  });

  const { data: expensesData } = useSWR(
    `/api/groups/${groupId}/expenses?page=1&limit=1`,
    fetcher,
    { refreshInterval: 30_000 },
  );

  const { data: balancesData } = useSWR(`/api/groups/${groupId}/balances`, fetcher, {
    refreshInterval: 30_000,
  });

  const group = groupData?.data;

  const checklist = useMemo(() => {
    const memberCount = (group?.members as unknown[] | undefined)?.length ?? 1;
    const expenseCount = (expensesData?.data?.pagination?.total as number | undefined) ??
      (expensesData?.data?.expenses as unknown[] | undefined)?.length ??
      0;
    const outstandingDebtCount = (balancesData?.data?.debts as unknown[] | undefined)?.length ?? 0;
    return buildTripChecklist({ memberCount, expenseCount, outstandingDebtCount });
  }, [group?.members, expensesData, balancesData]);

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
            Trip not found
          </Typography>
          <Typography color="text.secondary">
            This trip may have been deleted or you don&apos;t have access.
          </Typography>
        </Box>
      </Container>
    );
  }

  const members = (group.members || []) as Array<{
    user: { _id: string; name: string; image?: string; email?: string };
    role: string;
  }>;
  const startDate = group.startDate as string | undefined;
  const endDate = group.endDate as string | undefined;
  const dateLabel =
    startDate && endDate
      ? `${formatDate(startDate)} – ${formatDate(endDate)}`
      : startDate
        ? `Starts ${formatDate(startDate)}`
        : null;
  const showChecklist = shouldShowTripChecklist(checklist);

  const handleChecklistAction = (id: 'invite' | 'expense' | 'settle') => {
    if (id === 'invite') setInviteDialogOpen(true);
    if (id === 'expense') setExpenseDialogOpen(true);
    if (id === 'settle') setTab(1);
  };

  return (
    <Container
      maxWidth="lg"
      disableGutters
      sx={{
        overflow: 'hidden',
        pb: { xs: 'calc(88px + env(safe-area-inset-bottom, 0px))', sm: 0 },
      }}
    >
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
            <IconButton component={Link} href="/" size="small" aria-label="Back to dashboard">
              <ArrowBackIcon />
            </IconButton>
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
            <IconButton
              onClick={() => setInviteDialogOpen(true)}
              size="small"
              aria-label="Invite friends"
            >
              <ShareIcon />
            </IconButton>
            <IconButton
              component={Link}
              href={`/groups/${groupId}/settings`}
              size="small"
              aria-label="Trip settings"
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
          {dateLabel ? (
            <Typography variant="body2" color="text.secondary">
              {dateLabel}
            </Typography>
          ) : (
            <Chip label={String(group.category || 'trip')} size="small" variant="outlined" />
          )}
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

      {showChecklist && (
        <Box
          sx={{
            mb: 3,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            px: { xs: 2, sm: 2.5 },
            py: 2,
          }}
        >
          <Typography variant="subtitle2" fontWeight={700} color="text.primary" sx={{ mb: 0.5 }}>
            Get this trip going
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A short checklist so balances show up quickly.
          </Typography>
          <Stack spacing={1.25}>
            {checklist.map((item) => (
              <Stack
                key={item.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ minWidth: 0 }}>
                  {item.done ? (
                    <CheckCircleOutlineIcon fontSize="small" color="success" sx={{ mt: 0.25 }} />
                  ) : (
                    <RadioButtonUncheckedIcon
                      fontSize="small"
                      sx={{ mt: 0.25, color: 'text.disabled' }}
                    />
                  )}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      color={item.done ? 'text.secondary' : 'text.primary'}
                      sx={{ textDecoration: item.done ? 'line-through' : 'none' }}
                    >
                      {item.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.description}
                    </Typography>
                  </Box>
                </Stack>
                {!item.done && (
                  <Button
                    size="small"
                    variant={item.id === 'expense' ? 'contained' : 'outlined'}
                    onClick={() => handleChecklistAction(item.id)}
                    sx={{ alignSelf: { xs: 'stretch', sm: 'center' }, textTransform: 'none' }}
                  >
                    {item.actionLabel}
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

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

      {tab === 0 && (
        <ExpenseListView
          groupId={groupId}
          userId={userId}
          group={group}
          onAddExpense={() => setExpenseDialogOpen(true)}
        />
      )}
      {tab === 1 && <BalancesView groupId={groupId} userId={userId} group={group} />}
      {tab === 2 && <ActivityView groupId={groupId} />}

      <Fab
        color="primary"
        onClick={() => setExpenseDialogOpen(true)}
        aria-label="Add expense"
        sx={{
          position: 'fixed',
          right: 24,
          bottom: {
            xs: 'calc(24px + env(safe-area-inset-bottom, 0px))',
            sm: 24,
          },
          display: { xs: 'none', sm: 'flex' },
        }}
      >
        <AddIcon />
      </Fab>

      <Box
        sx={{
          display: { xs: 'flex', sm: 'none' },
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          px: 2,
          pt: 1.5,
          pb: 'calc(12px + env(safe-area-inset-bottom, 0px))',
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          zIndex: (theme) => theme.zIndex.appBar,
        }}
      >
        <Button
          fullWidth
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setExpenseDialogOpen(true)}
          sx={{ textTransform: 'none', minHeight: 44 }}
        >
          Add expense
        </Button>
      </Box>

      <ExpenseFormDialog
        open={expenseDialogOpen}
        onClose={() => setExpenseDialogOpen(false)}
        groupId={groupId}
        group={group}
        userId={userId}
      />

      <InviteDialog
        open={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        groupId={groupId}
      />
    </Container>
  );
}
