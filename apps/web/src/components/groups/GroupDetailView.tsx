'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import Button from '@mui/material/Button';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SettingsIcon from '@mui/icons-material/Settings';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import ShareIcon from '@mui/icons-material/Share';
import TripStrip from '@/components/trip/TripStrip';
import GroupHeader from '@/components/groups/GroupHeader';
import MonthCycleBar, { parseMonthParam } from '@/components/groups/MonthCycleBar';
import MonthMemberTable from '@/components/groups/MonthMemberTable';
import ExpenseListView from '@/components/expenses/ExpenseListView';
import BalancesView from '@/components/balances/BalancesView';
import ActivityView from '@/components/activity/ActivityView';
import ExpenseFormDialog from '@/components/expenses/ExpenseFormDialog';
import InviteDialog from '@/components/groups/InviteDialog';
import { useGroup } from '@/lib/hooks/use-groups';
import ErrorState from '@/components/common/ErrorState';
import { fetcher } from '@/lib/utils/fetcher';
import { formatDate } from '@splitbook/shared/date';
import { buildTripChecklist, shouldShowTripChecklist } from '@splitbook/shared/trip-setup';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { ExpenseMemberBreakdownRow } from '@splitbook/shared/types';

interface GroupDetailViewProps {
  groupId: string;
  userId: string;
}

export default function GroupDetailView(props: GroupDetailViewProps) {
  return <GroupDetailContent key={`${props.userId}:${props.groupId}`} {...props} />;
}

function GroupDetailContent({ groupId, userId }: GroupDetailViewProps) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(0);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  // Month-view summary surfaced from ExpenseListView while a month is active.
  const [monthSummary, setMonthSummary] = useState<{
    totalAmount: number;
    count: number;
    byMember?: ExpenseMemberBreakdownRow[];
    userFronted: number;
  } | null>(null);

  useEffect(() => {
    // Defer so deep-link params apply after mount without sync setState-in-effect.
    const timeout = window.setTimeout(() => {
      if (searchParams.get('tab') === 'balances') setTab(1);
      if (searchParams.get('action') === 'add-expense') setExpenseDialogOpen(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [searchParams]);

  const { data: group, isLoading, error, mutate } = useGroup(userId, groupId);

  const { data: expensesData } = useSWR(`/api/groups/${groupId}/expenses?page=1&limit=1`, fetcher, {
    refreshInterval: 30_000,
  });

  const { data: balancesData } = useSWR(`/api/groups/${groupId}/balances`, fetcher, {
    refreshInterval: 30_000,
  });

  const checklist = useMemo(() => {
    const memberCount = group?.members.length ?? 1;
    const expenseCount =
      (expensesData?.data?.pagination?.total as number | undefined) ??
      (expensesData?.data?.expenses as unknown[] | undefined)?.length ??
      0;
    const outstandingDebtCount = (balancesData?.data?.debts as unknown[] | undefined)?.length ?? 0;
    return buildTripChecklist({ memberCount, expenseCount, outstandingDebtCount });
  }, [group?.members, expensesData, balancesData]);

  const handleMonthSummaryChange = useCallback(
    (summary: Record<string, unknown> | undefined) => {
      if (!summary) {
        setMonthSummary(null);
        return;
      }
      const byMember = summary.byMember as ExpenseMemberBreakdownRow[] | undefined;
      setMonthSummary({
        totalAmount: (summary.totalAmount as number) ?? 0,
        count: (summary.count as number) ?? 0,
        byMember,
        userFronted: byMember?.find((row) => row.user._id === userId)?.paid ?? 0,
      });
    },
    [userId],
  );

  if (isLoading && !group) {
    return (
      <Container maxWidth="lg" disableGutters>
        <Skeleton variant="text" width={192} height={32} sx={{ mb: 2 }} />
        <Skeleton variant="text" width={128} height={20} sx={{ mb: 4 }} />
        <Skeleton variant="rounded" height={384} />
      </Container>
    );
  }

  if (error && !group) {
    return (
      <Container maxWidth="lg" disableGutters>
        <ErrorState message="Group could not be loaded." onRetry={() => void mutate()} />
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

  const members = group.members;
  const theme = getGroupTheme(group.category);
  const nounTitle = theme.nouns.singular.charAt(0).toUpperCase() + theme.nouns.singular.slice(1);
  const startDate = group.startDate;
  const endDate = group.endDate;
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
  const currency = group.defaultCurrency;
  const userBalance = (
    (balancesData?.data?.balances || []) as Array<{
      user: { _id: string };
      balance: number;
    }>
  ).find((balance) => balance.user._id === userId);
  const tripTotal = expensesData?.data?.summary?.totalAmount as number | undefined;
  const showChecklist = shouldShowTripChecklist(checklist);

  // ── Household month view (read-only lens; balances stay running) ──
  const hasMonthCycle = theme.signature === 'monthCycle';
  const activeMonth = hasMonthCycle ? parseMonthParam(searchParams.get('month')) : null;
  const runningDebts = (balancesData?.data?.debts || []) as Array<{
    from: { _id: string };
    to: { _id: string };
    amount: number;
  }>;
  const memberFronted = activeMonth
    ? (monthSummary?.byMember?.find((row) => row.user._id === userId)?.paid ?? 0)
    : 0;
  // Amendment B: opening the form from a past-month view defaults the expense
  // date to that month's last day (viewer-local). Current month / All time → today.
  const expenseDefaultDate =
    activeMonth && !activeMonth.isCurrentMonth
      ? `${activeMonth.key}-${String(activeMonth.lastDay.getDate()).padStart(2, '0')}`
      : null;
  // Amendment D: the "Settle {Month}?" nudge — past month + outstanding running debt.
  const showSettlePrompt = Boolean(
    activeMonth && !activeMonth.isCurrentMonth && runningDebts.length > 0,
  );

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
      {error && (
        <ErrorState
          message="Group could not be refreshed. Showing previously loaded group."
          onRetry={() => void mutate()}
        />
      )}
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
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setExpenseDialogOpen(true)}
            sx={{ display: { xs: 'none', sm: 'inline-flex' }, mr: 1 }}
          >
            Add expense
          </Button>
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
            name={group.name}
            currency={currency}
            variant="full"
            dateLabel={dateLabel}
            memberCount={members.length}
            memberNames={members.map((member) =>
              member.user._id === userId ? 'You' : member.user.name.split(' ')[0],
            )}
            inviteCode={group.inviteCode ?? null}
            balance={userBalance ? { amount: userBalance.balance, currency } : null}
            balanceUnavailable={!balancesData}
            tripTotal={typeof tripTotal === 'number' ? { amount: tripTotal, currency } : null}
          />
        ) : (
          <GroupHeader
            name={group.name}
            themeLabel={theme.label}
            themeIcon={theme.icon}
            currency={currency}
            variant="full"
            dateLabel={dateLabel}
            members={members.map((member) => member.user)}
            userId={userId}
            inviteCode={group.inviteCode ?? null}
            balance={userBalance ? { amount: userBalance.balance, currency } : null}
            balanceUnavailable={!balancesData}
          />
        )}
      </Box>

      {hasMonthCycle && (
        <Box sx={{ mb: 3, animation: 'panel-in 280ms ease-out both' }}>
          <MonthCycleBar
            currency={currency}
            summary={
              activeMonth && monthSummary
                ? {
                    totalAmount: monthSummary.totalAmount,
                    count: monthSummary.count,
                    userFronted: memberFronted,
                  }
                : null
            }
          />
        </Box>
      )}

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
        <Stack spacing={2}>
          {activeMonth && monthSummary?.byMember && monthSummary.byMember.length > 0 && (
            <MonthMemberTable
              rows={monthSummary.byMember}
              currency={currency}
              userId={userId}
              monthName={activeMonth.monthName}
            />
          )}

          {showSettlePrompt && activeMonth && (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '12px',
                px: { xs: 2, sm: 2.5 },
                py: 1.75,
                display: 'flex',
                alignItems: { xs: 'flex-start', sm: 'center' },
                justifyContent: 'space-between',
                flexDirection: { xs: 'column', sm: 'row' },
                gap: 1.5,
                bgcolor: 'tint.info',
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} color="text.primary">
                  Settle {activeMonth.monthName}?
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {activeMonth.monthName}&apos;s numbers are in — settle the running balance on the
                  Balances tab.
                </Typography>
              </Box>
              <Button
                size="small"
                variant="contained"
                onClick={() => setTab(1)}
                sx={{ textTransform: 'none', flexShrink: 0 }}
              >
                Open Balances
              </Button>
            </Box>
          )}

          <ExpenseListView
            groupId={groupId}
            userId={userId}
            group={group}
            onAddExpense={() => setExpenseDialogOpen(true)}
            controlledDateRange={
              activeMonth ? { dateFrom: activeMonth.dateFrom, dateTo: activeMonth.dateTo } : null
            }
            includeMemberBreakdown={Boolean(activeMonth)}
            onSummaryChange={activeMonth ? handleMonthSummaryChange : undefined}
          />
        </Stack>
      )}
      {tab === 1 && <BalancesView groupId={groupId} userId={userId} group={group} />}
      {tab === 2 && <ActivityView groupId={groupId} />}

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
        defaultDate={expenseDefaultDate}
      />

      <InviteDialog
        open={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        groupId={groupId}
      />
    </Container>
  );
}
