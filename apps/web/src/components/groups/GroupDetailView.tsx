'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Button from '@mui/material/Button';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import TripStrip from '@/components/trip/TripStrip';
import { parseMonthParam } from '@/components/groups/MonthCycleBar';
import ExpenseFormDialog from '@/components/expenses/ExpenseFormDialog';
import InviteDialog from '@/components/groups/InviteDialog';
import { useGroup } from '@/lib/hooks/use-groups';
import ErrorState from '@/components/common/ErrorState';
import { fetcher } from '@/lib/utils/fetcher';
import { formatDate } from '@splitbook/shared/date';
import { buildTripChecklist, shouldShowTripChecklist } from '@splitbook/shared/trip-setup';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupRead } from '@splitbook/shared/group-read';
import GroupPageHeader from './GroupPageHeader';
import GroupTabs from './GroupTabs';
import {
  GroupPageContext,
  type GroupBalancesRead,
  type GroupPageValue,
} from './group-page-context';
import { groupSettingsHref, groupTabHref } from './group-tabs';
import { groupExportHref } from '@/components/layout/shell-nav';

interface GroupDetailViewProps {
  groupId: string;
  userId: string;
  /** The open tab's route (`/groups/[id]/expenses`, …). */
  children?: ReactNode;
}

/**
 * The Group page (#305): the layout around every tab. It reads the Group and shows the header,
 * the trip strip and checklist on a Trip, the tabs and the open tab, while the Group can be
 * shown. When it cannot (a refused read, #201, or a deleted Group), every tab gets the same
 * refusal and the tab's content unmounts, so the month figures it surfaced and any dialog it
 * had open go with it; when access returns, the content mounts afresh, on the tab the member
 * was on, since the tab is the address.
 */
export default function GroupDetailView(props: GroupDetailViewProps) {
  return <GroupDetailPage key={`${props.userId}:${props.groupId}`} {...props} />;
}

/** The header's reads, made beside the Group read rather than after it. */
interface HeaderReads {
  /** `expenses?page=1&limit=1`: the Expense count and the trip total. */
  expensesData?: {
    data?: {
      pagination?: { total?: number };
      expenses?: unknown[];
      summary?: { totalAmount?: number };
    };
  };
  balancesData?: GroupBalancesRead;
}

function GroupDetailPage({ groupId, userId, children }: GroupDetailViewProps) {
  const { data: group, isLoading, error, mutate } = useGroup(userId, groupId);

  const { data: expensesData } = useSWR(`/api/groups/${groupId}/expenses?page=1&limit=1`, fetcher, {
    refreshInterval: 30_000,
  });

  const { data: balancesData } = useSWR(`/api/groups/${groupId}/balances`, fetcher, {
    refreshInterval: 30_000,
  });

  // The query (with or without `?action=add-expense`) last applied on this page, so content
  // mounted again after the Group was unavailable does not reopen the form by itself.
  const appliedDeepLink = useRef<string | null>(null);
  const takeDeepLink = useCallback((link: string) => {
    if (appliedDeepLink.current === link) return false;
    appliedDeepLink.current = link;
    return true;
  }, []);

  if (isLoading && !group) {
    return (
      <Box>
        <Skeleton variant="text" width={192} height={32} sx={{ mb: 2 }} />
        <Skeleton variant="text" width={128} height={20} sx={{ mb: 4 }} />
        <Skeleton variant="rounded" height={384} />
      </Box>
    );
  }

  if (error && !group) {
    return <ErrorState message="Group could not be loaded." onRetry={() => void mutate()} />;
  }

  if (!group) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="h6" fontWeight={500} color="text.primary" sx={{ mb: 1 }}>
          Group not found
        </Typography>
        <Typography color="text.secondary">
          This group may have been deleted or you don&apos;t have access.
        </Typography>
      </Box>
    );
  }

  return (
    <GroupDetailContent
      groupId={groupId}
      userId={userId}
      group={group}
      refreshFailed={Boolean(error)}
      onRetry={() => void mutate()}
      expensesData={expensesData}
      balancesData={balancesData}
      takeDeepLink={takeDeepLink}
    >
      {children}
    </GroupDetailContent>
  );
}

interface GroupDetailContentProps extends GroupDetailViewProps, HeaderReads {
  group: GroupRead;
  /** A refresh failed; the Group shown is the one loaded before. */
  refreshFailed: boolean;
  onRetry: () => void;
  /** Whether this deep link has yet to be applied on the page. */
  takeDeepLink: (link: string) => boolean;
}

function GroupDetailContent({
  groupId,
  userId,
  group,
  refreshFailed,
  onRetry,
  expensesData,
  balancesData,
  takeDeepLink,
  children,
}: GroupDetailContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  useEffect(() => {
    // `?action=add-expense` (an old link, or Home's "Add expense") opens the form once, then
    // leaves the address, so reloading the tab or coming Back to it doesn't open the form
    // again. Deferred so it applies after mount.
    const link = searchParams.toString();
    const timeout = window.setTimeout(() => {
      if (!takeDeepLink(link) || searchParams.get('action') !== 'add-expense') return;
      setExpenseDialogOpen(true);
      const rest = new URLSearchParams(link);
      rest.delete('action');
      const query = rest.toString();
      // Next keeps its router in step with the native history API.
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [searchParams, pathname, takeDeepLink]);

  const checklist = useMemo(() => {
    const memberCount = group.members.length;
    const expenseCount =
      (expensesData?.data?.pagination?.total as number | undefined) ??
      (expensesData?.data?.expenses as unknown[] | undefined)?.length ??
      0;
    const outstandingDebtCount = (balancesData?.data?.debts as unknown[] | undefined)?.length ?? 0;
    return buildTripChecklist({ memberCount, expenseCount, outstandingDebtCount });
  }, [group.members, expensesData, balancesData]);

  const openExpenseForm = useCallback(() => setExpenseDialogOpen(true), []);
  const openInvite = useCallback(() => setInviteDialogOpen(true), []);
  const page = useMemo<GroupPageValue>(
    () => ({ groupId, userId, group, balancesData, openExpenseForm, openInvite }),
    [groupId, userId, group, balancesData, openExpenseForm, openInvite],
  );

  const members = group.members;
  const theme = getGroupTheme(group.category);
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
  const userBalance = (balancesData?.data?.balances || []).find(
    (balance) => balance.user._id === userId,
  );
  const tripTotal = expensesData?.data?.summary?.totalAmount as number | undefined;
  const showChecklist = shouldShowTripChecklist(checklist);

  // Amendment B: opening the form from a past-month view defaults the expense date to that
  // month's last day (viewer-local). Current month / All time → today.
  const activeMonth =
    theme.signature === 'monthCycle' ? parseMonthParam(searchParams.get('month')) : null;
  const expenseDefaultDate =
    activeMonth && !activeMonth.isCurrentMonth
      ? `${activeMonth.key}-${String(activeMonth.lastDay.getDate()).padStart(2, '0')}`
      : null;

  const handleChecklistAction = (id: 'invite' | 'expense' | 'settle') => {
    if (id === 'invite') setInviteDialogOpen(true);
    if (id === 'expense') setExpenseDialogOpen(true);
    if (id === 'settle') router.push(groupTabHref(groupId, 'balances'));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {refreshFailed && (
        <ErrorState
          message="Group could not be refreshed. Showing previously loaded group."
          onRetry={onRetry}
        />
      )}

      <Box sx={{ animation: 'panel-in 280ms ease-out both' }}>
        <GroupPageHeader
          name={group.name}
          category={group.category}
          themeLabel={theme.label}
          currency={currency}
          members={members.map((member) => member.user)}
          userId={userId}
          settingsHref={groupSettingsHref(groupId)}
          exportHref={groupExportHref(groupId)}
          onInvite={openInvite}
        />
      </Box>

      {theme.header === 'strip' && (
        <Box sx={{ animation: 'panel-in 280ms ease-out both' }}>
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
        </Box>
      )}

      {theme.signature === 'checklist' && showChecklist && (
        <Box
          sx={{
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

      <GroupTabs groupId={groupId} label={`${group.name} sections`} />

      <GroupPageContext.Provider value={page}>{children}</GroupPageContext.Provider>

      {/* The page's own form, for `?action=add-expense`, the trip checklist and the empty
          Expense list. The top bar's Add expense (#304) opens its own for this Group. */}
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
    </Box>
  );
}
