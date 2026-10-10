'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import MonthCycleBar, {
  parseMonthParam,
  type MonthSummary,
} from '@/components/groups/MonthCycleBar';
import MonthMemberTable from '@/components/groups/MonthMemberTable';
import ExpenseListView from '@/components/expenses/ExpenseListView';
import QuickAddExpense from '@/components/expenses/QuickAddExpense';
import { ShortcutsFooter } from '@/components/shortcuts/ShortcutHint';
import { expensePageKey } from '@splitbook/shared/query-keys';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { ExpenseMemberBreakdownRow } from '@splitbook/shared/types';
import { fetchWebExpensePage } from '@/lib/web-read';
import { useGroupPage } from './group-page-context';
import { groupTabHref } from './group-tabs';

interface GroupExpensesTabProps {
  /** The product switch for recurring Expenses (#289), read by the server for the page. */
  recurringExpensesEnabled?: boolean;
}

/**
 * The Expenses tab (`/groups/[id]/expenses`, #310): a Household's Month bar, then the
 * toolbar and the Expenses, as a table on computers and cards on phones, and on computers a
 * footer listing the keyboard shortcuts (#322). A Month is a lens over Expenses, and Balances
 * always include every Month.
 */
export default function GroupExpensesTab({
  recurringExpensesEnabled = false,
}: GroupExpensesTabProps) {
  const { groupId, userId, group, balancesData, openExpenseForm } = useGroupPage();
  const searchParams = useSearchParams();

  const currency = group.defaultCurrency;
  // ── Household month view (read-only lens; balances stay running) ──
  const hasMonthCycle = getGroupTheme(group.category).signature === 'monthCycle';
  const activeMonth = hasMonthCycle ? parseMonthParam(searchParams.get('month')) : null;

  // The Month bar's figures: the whole Month (or all time), whatever the list's filters.
  const monthPath = hasMonthCycle
    ? expensePageKey(WEB_QUERY_ACCOUNT, groupId, {
        page: 1,
        limit: 1,
        includeMemberBreakdown: true,
        ...(activeMonth ? { dateFrom: activeMonth.dateFrom, dateTo: activeMonth.dateTo } : {}),
      })
    : null;
  const monthRead = useSWR(monthPath, fetchWebExpensePage, {
    refreshInterval: 10_000,
    keepPreviousData: true,
  });
  const monthData = monthRead.data?.data.summary;
  const byMember = (monthData?.byMember ?? []) as ExpenseMemberBreakdownRow[];
  const own = byMember.find((row) => row.user._id === userId);
  const monthSummary: MonthSummary | null = monthData
    ? {
        spent:
          monthData.totalsByCurrency.find((total) => total.currency === currency)?.totalAmount ?? 0,
        share: own?.share ?? 0,
        paid: own?.paid ?? 0,
        count: monthData.count,
      }
    : null;

  const runningDebts = balancesData?.data?.debts ?? [];
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
            summary={monthSummary}
            failed={Boolean(monthRead.error && !monthData)}
            onRetry={() => void monthRead.mutate()}
          />
        </Box>
      )}

      {activeMonth && byMember.length > 0 && (
        <MonthMemberTable
          rows={byMember}
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

      {/* Quick add (#320), above the list's toolbar. */}
      <QuickAddExpense groupId={groupId} userId={userId} group={group} />

      <ExpenseListView
        groupId={groupId}
        userId={userId}
        group={group}
        onAddExpense={openExpenseForm}
        month={
          activeMonth
            ? {
                dateFrom: activeMonth.dateFrom,
                dateTo: activeMonth.dateTo,
                label: activeMonth.label,
              }
            : null
        }
        monthCycle={hasMonthCycle}
        recurringExpensesEnabled={recurringExpensesEnabled}
      />

      <ShortcutsFooter />
    </Stack>
  );
}
