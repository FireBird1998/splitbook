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
import Fab from '@mui/material/Fab';
import Button from '@mui/material/Button';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SettingsIcon from '@mui/icons-material/Settings';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import ShareIcon from '@mui/icons-material/Share';
import TripStrip from '@/components/trip/TripStrip';
import GroupHeader from '@/components/groups/GroupHeader';
import ExpenseListView from '@/components/expenses/ExpenseListView';
import BalancesView from '@/components/balances/BalancesView';
import ActivityView from '@/components/activity/ActivityView';
import ExpenseFormDialog from '@/components/expenses/ExpenseFormDialog';
import InviteDialog from '@/components/groups/InviteDialog';
import { fetcher } from '@/lib/utils/fetcher';
import { formatDate } from '@/lib/utils/date';
import { buildTripChecklist, shouldShowTripChecklist } from '@/lib/utils/trip-setup';
import { getGroupTheme } from '@/lib/group-themes';
import type { GroupCategory } from '@/types';

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

  const { data: expensesData } = useSWR(`/api/groups/${groupId}/expenses?page=1&limit=1`, fetcher, {
    refreshInterval: 30_000,
  });

  const { data: balancesData } = useSWR(`/api/groups/${groupId}/balances`, fetcher, {
    refreshInterval: 30_000,
  });

  const group = groupData?.data;

  const checklist = useMemo(() => {
    const memberCount = (group?.members as unknown[] | undefined)?.length ?? 1;
    const expenseCount =
      (expensesData?.data?.pagination?.total as number | undefined) ??
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
  const theme = getGroupTheme(group.category as GroupCategory);
  const nounTitle = theme.nouns.singular.charAt(0).toUpperCase() + theme.nouns.singular.slice(1);
  const startDate = group.startDate as string | undefined;
  const endDate = group.endDate as string | undefined;
  const dateLabel =
    theme.dates === 'bounded'
      ? startDate && endDate
        ? `${formatDate(startDate)} – ${formatDate(endDate)}`
        : startDate
          ? `Starts ${formatDate(startDate)}`
          : null
      : theme.signature === 'monthCycle' && startDate
        ? `Tracking since ${formatDate(startDate)}`
        : null;
  const currency =
    (balancesData?.data?.currency as string | undefined) ?? (group.defaultCurrency as string);
  const userBalance = (
    (balancesData?.data?.balances || []) as Array<{
      user: { _id: string };
      balance: number;
    }>
  ).find((balance) => balance.user._id === userId);
  const tripTotal = expensesData?.data?.summary?.totalAmount as number | undefined;
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
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2, animation: 'panel-in 280ms ease-out both' }}
      >
        <Button
          component={Link}
          href="/"
          size="small"
          startIcon={<ArrowBackIcon />}
          sx={{ color: 'text.secondary', px: 0 }}
        >
          Dashboard
        </Button>
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
            aria-label={`${nounTitle} settings`}
          >
            <SettingsIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Box sx={{ mb: 3, animation: 'panel-in 280ms ease-out both' }}>
        {theme.header === 'strip' ? (
          <TripStrip
            name={group.name as string}
            currency={currency}
            variant="full"
            dateLabel={dateLabel}
            memberCount={members.length}
            memberNames={members.map((member) =>
              member.user._id === userId ? 'You' : member.user.name.split(' ')[0],
            )}
            inviteCode={(group.inviteCode as string | null | undefined) ?? null}
            balance={userBalance ? { amount: userBalance.balance, currency } : null}
            tripTotal={typeof tripTotal === 'number' ? { amount: tripTotal, currency } : null}
          />
        ) : (
          <GroupHeader
            name={group.name as string}
            themeLabel={theme.label}
            themeIcon={theme.icon}
            currency={currency}
            variant="full"
            dateLabel={dateLabel}
            members={members.map((member) => member.user)}
            userId={userId}
            inviteCode={(group.inviteCode as string | null | undefined) ?? null}
            balance={userBalance ? { amount: userBalance.balance, currency } : null}
          />
        )}
      </Box>

      {theme.signature === 'checklist' && showChecklist && (
        <Box
          sx={{
            mb: 3,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '12px',
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
        aria-label={`${nounTitle} sections`}
        sx={{ mb: 3 }}
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
