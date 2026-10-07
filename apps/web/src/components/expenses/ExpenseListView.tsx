'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Pagination from '@mui/material/Pagination';
import Skeleton from '@mui/material/Skeleton';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import MoneyText from '@/components/common/MoneyText';
import { formatDate } from '@splitbook/shared/date';
import { expensePagePath, expenseRecordPath } from '@splitbook/shared/api-paths';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupRead } from '@splitbook/shared/group-read';
import {
  parseExpensePageResponse,
  type ExpensePageRead,
  type ExpenseRead,
} from '@splitbook/shared/expense-page-read';
import { fetcher } from '@/lib/utils/fetcher';
import { apiFetch } from '@/lib/utils/api-fetch';
import { RADIUS } from '@/lib/theme/tokens';
import ExpenseCard from './ExpenseCard';
import ExpenseDetails, { type ExpenseDetailsRecord } from './ExpenseDetails';
import ExpenseFormDialog from './ExpenseFormDialog';
import DeleteExpenseDialog from './DeleteExpenseDialog';
import ExpenseStats, { StatCount } from './ExpenseStats';
import ExpenseTable from './ExpenseTable';
import ExpenseToolbar, { type ToolbarOption } from './ExpenseToolbar';
import {
  EXPENSE_SORTS,
  activeFilterCount,
  customRangeError,
  expenseListFilters,
  readExpenseListQuery,
  writeExpenseListQuery,
  CLEARED_FILTERS,
  type ExpenseListQuery,
} from './expense-list-query';

/** Expenses on one page of the list, on a computer or a phone. */
export const EXPENSE_LIST_PAGE_SIZE = 50;

/** A response the shared decoder refuses is a failed read; SWR keeps the last good one. */
async function fetchExpensePage(path: string): Promise<ExpensePageRead> {
  return parseExpensePageResponse(await fetcher(path));
}

interface ExpenseListViewProps {
  groupId: string;
  userId: string;
  group: GroupRead;
  onAddExpense?: () => void;
  /**
   * A Household's Month, owned by its Month bar. It sets the list's dates in place of the date
   * quick-filters, and the Month bar shows the Month's figures, so the list shows no summary.
   */
  month?: { dateFrom: string; dateTo: string; label: string } | null;
  /** A Household: the Month bar picks dates, so the date quick-filters are left out. */
  monthCycle?: boolean;
  /** Repeat icons show only while recurring Expenses are switched on (#289). */
  recurringExpensesEnabled?: boolean;
}

/**
 * A Group's Expenses (#310): the toolbar, then a table on a computer or cards on a phone,
 * with the view kept in the address so reloading or sharing the link keeps it. Opening an
 * Expense shows its details below it, until the side panel (#311).
 */
export default function ExpenseListView({
  groupId,
  userId,
  group,
  onAddExpense,
  month = null,
  monthCycle = false,
  recurringExpensesEnabled = false,
}: ExpenseListViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const theme = useTheme();
  const onComputer = useMediaQuery(theme.breakpoints.up('md'));
  const currency = group.defaultCurrency;

  const members = useMemo<ToolbarOption[]>(
    () =>
      group.members.map(({ user }) => ({
        id: user._id,
        label: user._id === userId ? 'You' : user.name,
      })),
    [group.members, userId],
  );
  const tags = useMemo<ToolbarOption[]>(
    () =>
      group.tags.filter((tag) => !tag.isDeleted).map((tag) => ({ id: tag._id, label: tag.name })),
    [group.tags],
  );
  const query = useMemo(
    () =>
      readExpenseListQuery(searchParams, {
        memberIds: members.map(({ id }) => id),
        tagIds: tags.map(({ id }) => id),
        currency,
        dateWindows: !monthCycle,
      }),
    [searchParams, members, tags, currency, monthCycle],
  );
  const update = useCallback(
    (change: Partial<ExpenseListQuery>) => {
      const next = writeExpenseListQuery(searchParams.toString(), change);
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const rangeProblem = customRangeError(query);
  const path = rangeProblem
    ? null
    : expensePagePath(
        groupId,
        expenseListFilters(query, { userId, pageSize: EXPENSE_LIST_PAGE_SIZE, month }),
      );
  const { data, error, isLoading, mutate } = useSWR(path, fetchExpensePage, {
    refreshInterval: 10_000,
    keepPreviousData: true,
  });
  // The previous view's Expenses, kept while a changed view loads (not the 10 s refresh).
  const changing = isLoading && Boolean(data);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const recordPath = expandedId ? expenseRecordPath(groupId, expandedId) : null;
  const record = useSWR<{ data: ExpenseDetailsRecord }>(recordPath, fetcher);

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    expenseId?: string;
    revision?: number;
  }>({ open: false, message: '' });

  const filters = activeFilterCount(query);
  const expenses = data?.expenses ?? [];
  const pagination = data?.pagination;
  const nouns = getGroupTheme(group.category).nouns;

  const handleDeleted = (expenseId: string, revision: number) => {
    void mutate();
    if (expandedId === expenseId) setExpandedId(null);
    setSnackbar({ open: true, message: 'Expense deleted', expenseId, revision });
  };

  const handleUndo = async () => {
    if (!snackbar.expenseId) return;
    try {
      const response = await apiFetch(expenseRecordPath(groupId, snackbar.expenseId), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Splitbook-Revision': String(snackbar.revision),
        },
        body: JSON.stringify({ isDeleted: false }),
      });
      if (!response.ok) {
        setSnackbar({ open: true, message: 'Could not restore this Expense. Please retry.' });
        return;
      }
      void mutate();
    } catch {
      setSnackbar({ open: true, message: 'Could not restore this Expense. Please retry.' });
      return;
    }
    setSnackbar({ open: false, message: '' });
  };

  const toggle = (expenseId: string) =>
    setExpandedId((current) => (current === expenseId ? null : expenseId));
  const detailsId = (expenseId: string) => `expense-${expenseId}-details`;
  const details = (expense: ExpenseRead) => {
    const own = record.data?.data;
    const loaded = own && own._id === expense._id ? own : null;
    // The list row until the Expense's own read, with its history, arrives.
    const shown: ExpenseDetailsRecord = loaded ?? (expense as ExpenseDetailsRecord);
    return (
      <ExpenseDetails
        id={detailsId(expense._id)}
        expense={shown}
        userId={userId}
        recurringExpensesEnabled={recurringExpensesEnabled}
        history={loaded ? 'ready' : record.error ? 'failed' : 'loading'}
        onRetryHistory={() => void record.mutate()}
        onEdit={() => setEditing(shown as unknown as Record<string, unknown>)}
        onDelete={() => setDeleting(shown as unknown as Record<string, unknown>)}
      />
    );
  };

  const sortLabel = EXPENSE_SORTS.find(({ id }) => id === query.sort)?.label ?? 'Newest first';
  const listLabel = month ? `Expenses, ${month.label}` : 'Expenses';
  const caption =
    `${month ? `Expenses in ${month.label}` : 'Expenses'}, ${sortLabel.toLowerCase()}. ` +
    'Select an Expense to see its details.';

  return (
    <Stack spacing={2}>
      <ExpenseToolbar
        query={query}
        onChange={update}
        groupName={group.name}
        currency={currency}
        members={members}
        tags={tags}
        dateWindows={!monthCycle}
      />

      {!monthCycle && data && (
        <ExpenseSummary summary={data.summary} currency={currency} filtered={filters > 0} />
      )}

      {filters > 0 && pagination && (
        <Typography role="status" variant="body2" color="text.secondary">
          {pagination.total === 1 ? '1 Expense matches' : `${pagination.total} Expenses match`}
        </Typography>
      )}

      {error && data && (
        <ErrorState
          severity="warning"
          message="Expenses could not be refreshed. Showing the list loaded before."
          onRetry={() => void mutate()}
          retryLabel="Try again"
        />
      )}

      {changing && (
        <LinearProgress aria-label="Updating Expenses" sx={{ height: 2, borderRadius: 1 }} />
      )}

      {rangeProblem ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          Choose a date range of up to 31 days to see its Expenses.
        </Typography>
      ) : !data && error ? (
        <ErrorState
          message="Expenses could not be loaded."
          onRetry={() => void mutate()}
          retryLabel="Try again"
        />
      ) : !data ? (
        <Box role="status" aria-label="Loading Expenses">
          <Stack spacing={1.5} aria-hidden>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} variant="rounded" height={64} />
            ))}
          </Stack>
        </Box>
      ) : expenses.length === 0 && (pagination?.total ?? 0) > 0 ? (
        // A link to a page past the end, or the last Expense on a page was deleted.
        <EmptyState
          title={`There are no Expenses on page ${query.page}`}
          description="The list is shorter than that now."
          action={
            <Button variant="outlined" onClick={() => update({ page: 1 })}>
              Go to the first page
            </Button>
          }
        />
      ) : expenses.length === 0 ? (
        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: `${RADIUS.lg}px`,
          }}
        >
          {filters > 0 || month ? (
            <EmptyState
              title="No matching Expenses"
              description={
                filters > 0
                  ? `Nothing in this ${nouns.singular} matches. Clear the filters to see every Expense.`
                  : `Nothing logged in ${month?.label} yet.`
              }
              action={
                filters > 0 ? (
                  <Button variant="outlined" onClick={() => update(CLEARED_FILTERS)}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              title="No expenses yet"
              description="Add a shared cost — tags and equal split are ready."
              action={
                onAddExpense ? (
                  <Button variant="contained" onClick={onAddExpense}>
                    Add first expense
                  </Button>
                ) : undefined
              }
            />
          )}
        </Box>
      ) : onComputer ? (
        <ExpenseTable
          expenses={expenses}
          userId={userId}
          recurringExpensesEnabled={recurringExpensesEnabled}
          label={listLabel}
          caption={caption}
          expandedId={expandedId}
          onToggle={toggle}
          details={details}
          detailsId={detailsId}
          stale={changing}
        />
      ) : (
        <ExpenseCards
          expenses={expenses}
          byDay={query.sort === 'newest' || query.sort === 'oldest'}
          label={listLabel}
          render={(expense) => (
            <ExpenseCard
              key={expense._id}
              expense={expense}
              userId={userId}
              recurringExpensesEnabled={recurringExpensesEnabled}
              isExpanded={expandedId === expense._id}
              onToggleExpand={() => toggle(expense._id)}
              details={details(expense)}
              detailsId={detailsId(expense._id)}
            />
          )}
        />
      )}

      {!rangeProblem && pagination && pagination.totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
          <Pagination
            count={pagination.totalPages}
            page={Math.min(query.page, pagination.totalPages)}
            onChange={(_, page) => update({ page })}
            color="primary"
            getItemAriaLabel={(type, page, selected) =>
              type === 'page'
                ? `${selected ? 'Page' : 'Go to page'} ${page} of Expenses`
                : `Go to ${type} page of Expenses`
            }
          />
        </Box>
      )}

      <ExpenseFormDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        groupId={groupId}
        group={group}
        userId={userId}
        expense={editing}
      />

      <DeleteExpenseDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        expense={deleting}
        groupId={groupId}
        onDeleted={handleDeleted}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar({ open: false, message: '' })}
        message={snackbar.message}
        action={
          snackbar.expenseId ? (
            <Button color="primary" size="small" onClick={handleUndo}>
              Undo
            </Button>
          ) : undefined
        }
      />
    </Stack>
  );
}

/** The phone list: cards, under day headings while the list is in date order. */
function ExpenseCards({
  expenses,
  byDay,
  label,
  render,
}: {
  expenses: ExpenseRead[];
  byDay: boolean;
  label: string;
  render: (expense: ExpenseRead) => React.ReactNode;
}) {
  const days: Array<{ day: string; expenses: ExpenseRead[] }> = [];
  for (const expense of expenses) {
    const day = byDay ? formatDate(expense.date) : '';
    const last = days.at(-1);
    if (last && last.day === day) last.expenses.push(expense);
    else days.push({ day, expenses: [expense] });
  }
  return (
    <Stack component="section" aria-label={label} spacing={2.5}>
      {days.map(({ day, expenses: dayExpenses }, index) => (
        <Box key={`${day}-${index}`}>
          {day && (
            <Typography
              component="h3"
              variant="body2"
              fontWeight={500}
              color="text.secondary"
              sx={{ mb: 1 }}
            >
              {day}
            </Typography>
          )}
          <Stack spacing={1}>{dayExpenses.map(render)}</Stack>
        </Box>
      ))}
    </Stack>
  );
}

/**
 * Above a Group's list outside a Household (whose Month bar has its own figures): what the
 * Expenses shown add up to, and what the member owes or gets back on them.
 */
function ExpenseSummary({
  summary,
  currency,
  filtered,
}: {
  summary: ExpensePageRead['summary'];
  currency: string;
  filtered: boolean;
}) {
  const others = summary.totalsByCurrency.filter((total) => total.currency !== currency);
  const groupTotal =
    summary.totalsByCurrency.find((total) => total.currency === currency)?.totalAmount ?? 0;
  const money = (amount: number, code: string, tone: 'neutral' | 'negative' | 'positive') => (
    <MoneyText
      amount={amount}
      currency={code}
      tone={tone}
      variant="body2"
      sx={{ fontSize: '0.875rem', lineHeight: 1.3, display: 'block' }}
    />
  );
  return (
    <Box
      component="section"
      aria-label={filtered ? 'Summary of the matching Expenses' : 'Summary'}
      sx={{
        px: '20px',
        py: '12px',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
      }}
    >
      <ExpenseStats
        stats={[
          {
            term: 'Spent',
            value: (
              <>
                {money(groupTotal, currency, 'neutral')}
                {others.map((total) => (
                  <Box key={total.currency}>
                    {money(total.totalAmount, total.currency, 'neutral')}
                  </Box>
                ))}
              </>
            ),
          },
          { term: 'Expenses', value: <StatCount value={summary.count} /> },
          ...(summary.userOwes > 0
            ? [{ term: 'You owe', value: money(summary.userOwes, currency, 'negative') }]
            : []),
          ...(summary.userGetsBack > 0
            ? [{ term: 'You get back', value: money(summary.userGetsBack, currency, 'positive') }]
            : []),
        ]}
      />
    </Box>
  );
}
