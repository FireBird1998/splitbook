'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import MonthCycleBar, { parseMonthParam } from '@/components/groups/MonthCycleBar';
import MonthMemberTable from '@/components/groups/MonthMemberTable';
import ExpenseListView from '@/components/expenses/ExpenseListView';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { ExpenseMemberBreakdownRow } from '@splitbook/shared/types';
import { useGroupPage } from './group-page-context';
import { groupTabHref } from './group-tabs';

interface MonthSummary {
  totalAmount: number;
  count: number;
  byMember?: ExpenseMemberBreakdownRow[];
  userFronted: number;
}

/**
 * The Expenses tab (`/groups/[id]/expenses`). Its content is today's Expenses tab, moved into
 * its own route (#305); #310 rebuilds it. A Household's Month bar sits here, above the list it
 * filters: a Month is a lens over Expenses, and Balances always include every Month.
 */
export default function GroupExpensesTab() {
  const { groupId, userId, group, balancesData, openExpenseForm } = useGroupPage();
  const searchParams = useSearchParams();
  // Month-view summary surfaced from ExpenseListView while a month is active.
  const [monthSummary, setMonthSummary] = useState<MonthSummary | null>(null);

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

  const currency = group.defaultCurrency;
  // ── Household month view (read-only lens; balances stay running) ──
  const hasMonthCycle = getGroupTheme(group.category).signature === 'monthCycle';
  const activeMonth = hasMonthCycle ? parseMonthParam(searchParams.get('month')) : null;
  const runningDebts = balancesData?.data?.debts ?? [];
  const memberFronted = activeMonth
    ? (monthSummary?.byMember?.find((row) => row.user._id === userId)?.paid ?? 0)
    : 0;
  // Amendment D: the "Settle {Month}?" nudge — past month + outstanding running debt.
  const showSettlePrompt = Boolean(
    activeMonth && !activeMonth.isCurrentMonth && runningDebts.length > 0,
  );

  return (
    <Stack spacing={2}>
      {hasMonthCycle && (
        <Box sx={{ animation: 'panel-in 280ms ease-out both' }}>
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
            component={Link}
            href={groupTabHref(groupId, 'balances')}
            size="small"
            variant="contained"
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
        onAddExpense={openExpenseForm}
        controlledDateRange={
          activeMonth ? { dateFrom: activeMonth.dateFrom, dateTo: activeMonth.dateTo } : null
        }
        includeMemberBreakdown={Boolean(activeMonth)}
        onSummaryChange={activeMonth ? handleMonthSummaryChange : undefined}
      />
    </Stack>
  );
}
