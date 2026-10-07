'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { formatDate, toDateParam } from '@splitbook/shared/date';
import { ExpenseDraft, type SavedDraftExpense } from '@splitbook/shared/expense-draft';
import {
  expensePagePath,
  expenseRecordPath,
  recurringExpensesPath,
} from '@splitbook/shared/api-paths';
import { repeatsLabel, type RecurringSchedule } from '@splitbook/shared/expense-detail';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupRead } from '@splitbook/shared/group-read';
import {
  parseExpensePageResponse,
  type ExpensePageRead,
  type ExpenseRead,
} from '@splitbook/shared/expense-page-read';
import {
  parseExpenseRecordResponse,
  type ExpenseRecordRead,
} from '@splitbook/shared/expense-record-read';
import { fetcher, HttpResponseError } from '@/lib/utils/fetcher';
import { apiFetch } from '@/lib/utils/api-fetch';
import { RADIUS, TOPBAR_HEIGHT } from '@/lib/theme/tokens';
import ExpenseCard from './ExpenseCard';
import ExpenseDetails, { type ExpenseDetailsRecord } from './ExpenseDetails';
import ExpenseFormDialog from './ExpenseFormDialog';
import ExpensePanel, { type ExpensePanelState, type PanelExpense } from './ExpensePanel';
import DeleteExpenseDialog from './DeleteExpenseDialog';
import ExpenseStats, { StatCount } from './ExpenseStats';
import ExpenseTable from './ExpenseTable';
import ExpenseToolbar, { type ToolbarOption } from './ExpenseToolbar';
import { getDefaultExpenseTag } from './expense-form-helpers';
import {
  EXPENSE_SORTS,
  activeFilterCount,
  customRangeError,
  expenseListFilters,
  readExpenseListQuery,
  readOpenExpense,
  writeExpenseListQuery,
  writeOpenExpense,
  CLEARED_FILTERS,
  type ExpenseListQuery,
} from './expense-list-query';

/** Expenses on one page of the list, on a computer or a phone. */
export const EXPENSE_LIST_PAGE_SIZE = 50;

/** The side panel's element, which the open row's button controls (#311). */
export const EXPENSE_PANEL_ID = 'expense-panel';

/** A response the shared decoder refuses is a failed read; SWR keeps the last good one. */
async function fetchExpensePage(path: string): Promise<ExpensePageRead> {
  return parseExpensePageResponse(await fetcher(path));
}

/** The open Expense's own read (#210), with its revision and history. */
async function fetchExpenseRecord(path: string): Promise<ExpenseRecordRead> {
  return parseExpenseRecordResponse(await fetcher(path));
}

/**
 * The Group's recurring Expenses, for the Repeats row: only each one's id and schedule, and
 * nothing the read sends that the row doesn't use.
 */
async function fetchRecurringSchedules(path: string): Promise<Map<string, RecurringSchedule>> {
  const read = (await fetcher(path)) as { data?: unknown };
  const schedules = new Map<string, RecurringSchedule>();
  for (const item of Array.isArray(read?.data) ? read.data : []) {
    const template = item as Record<string, unknown>;
    if (
      typeof template._id === 'string' &&
      typeof template.dayOfMonth === 'number' &&
      typeof template.startsOn === 'string'
    )
      schedules.set(template._id, {
        dayOfMonth: template.dayOfMonth,
        startsOn: template.startsOn,
        endsOn: typeof template.endsOn === 'string' ? template.endsOn : null,
        isPaused: template.isPaused === true,
        lastGeneratedFor:
          typeof template.lastGeneratedFor === 'string' ? template.lastGeneratedFor : null,
      });
  }
  return schedules;
}

/**
 * The open Expense has gone: deleted (its read says so, or no longer finds it), or the member
 * can't read it. A 403 also takes the whole Group away (#201), which the Group page shows.
 */
function isGone(record: ExpenseRecordRead | undefined, error: unknown) {
  return (
    record?.isDeleted === true ||
    (error instanceof HttpResponseError && (error.status === 404 || error.status === 403))
  );
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
  /** Repeat icons and the Repeats row show only while recurring Expenses are on (#289). */
  recurringExpensesEnabled?: boolean;
}

/**
 * A Group's Expenses (#310): the toolbar, then a table on a computer or cards on a phone,
 * with the view kept in the address so reloading or sharing the link keeps it. The open
 * Expense is in the address too (`?expense=`, #311), so reload, Back and a shared link reopen
 * it: on a computer it shows in a side panel beside the table, and on a phone below its card.
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
  const names = useMemo(
    () => new Map(group.members.map(({ user }) => [user._id, user.name])),
    [group.members],
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

  const filters = activeFilterCount(query);
  const expenses = data?.expenses ?? [];
  const pagination = data?.pagination;
  const nouns = getGroupTheme(group.category).nouns;

  // ── The open Expense, kept in the address (#311) ──
  const openId = readOpenExpense(searchParams);
  /**
   * Open an Expense, or none. On a computer each choice is a step in the history, so Back goes
   * to the Expense open before; on a phone, as before #311, opening a card adds none. The
   * browser's own history API changes only the address: Next keeps `useSearchParams` in step
   * without asking the server for the page again.
   */
  const showOpen = useCallback(
    (expenseId: string | null, step: 'push' | 'replace') => {
      const next = writeOpenExpense(searchParams.toString(), expenseId);
      const url = next ? `${pathname}?${next}` : pathname;
      if (step === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [pathname, searchParams],
  );

  const recordPath = openId ? expenseRecordPath(groupId, openId) : null;
  const record = useSWR(recordPath, fetchExpenseRecord, { refreshInterval: 10_000 });
  const loaded = record.data && record.data._id === openId ? record.data : null;
  const listed = openId ? expenses.find((expense) => expense._id === openId) : undefined;
  const gone = Boolean(openId) && isGone(loaded ?? undefined, record.error);

  // An Expense that has gone leaves the address, and the panel says it has gone until another
  // is opened or the panel is closed.
  const [lostId, setLostId] = useState<string | null>(null);
  if (openId && gone && lostId !== openId) setLostId(openId);
  else if (openId && !gone && lostId !== null) setLostId(null);
  useEffect(() => {
    if (openId && gone) showOpen(null, 'replace');
  }, [openId, gone, showOpen]);

  const listBox = useRef<HTMLDivElement>(null);
  const panelBox = useRef<HTMLDivElement>(null);

  /** Open a row's Expense, or close it when it is already open. */
  const toggle = (expenseId: string) => {
    const closing = openId === expenseId;
    setLostId(null);
    showOpen(closing ? null : expenseId, onComputer ? 'push' : 'replace');
    if (closing || !onComputer) return;
    // Where the panel wraps below the table, bring it into view.
    window.requestAnimationFrame(() => {
      const panel = panelBox.current;
      if (!panel || panel.getBoundingClientRect().top < window.innerHeight) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    });
  };

  /**
   * Where focus goes once the panel has let its Expense go, so it isn't lost with the button
   * that closed or deleted it: that Expense's row, or ('') the panel itself.
   */
  const focusAfterClose = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfterClose.current;
    if (target === null || openId) return;
    focusAfterClose.current = null;
    const row = target
      ? listBox.current?.querySelector<HTMLButtonElement>(
          `[data-expense-id="${target}"] button[aria-expanded]`,
        )
      : null;
    (row ?? document.getElementById(EXPENSE_PANEL_ID))?.focus();
  }, [openId, lostId]);

  /** Close the panel, and give focus back to the row it was opened from. */
  const closePanel = () => {
    focusAfterClose.current = openId ?? '';
    setLostId(null);
    if (openId) showOpen(null, 'push');
  };

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [duplicating, setDuplicating] = useState<ExpenseDraft | null>(null);
  /**
   * Duplicate: the form for a new Expense with this one's entries, dated today (#311), through
   * the form's `initialDraft` (#320). It saves like any new Expense: its own idempotency key,
   * and an unconfirmed save resent unchanged can't record it twice.
   */
  const duplicate = (saved: Record<string, unknown>) =>
    setDuplicating(
      ExpenseDraft.duplicate(
        {
          groupId,
          accountId: userId,
          memberIds: group.members.map(({ user }) => user._id),
          currency,
          defaultTag: getDefaultExpenseTag(group.tags),
          date: toDateParam(new Date()),
        },
        saved as unknown as SavedDraftExpense,
        group.tags.flatMap((tag) =>
          tag._id && !tag.isArchived && !tag.isDeleted ? [tag._id] : [],
        ),
      ),
    );
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    expenseId?: string;
    revision?: number;
  }>({ open: false, message: '' });

  const handleDeleted = (expenseId: string, revision: number) => {
    void mutate();
    if (openId === expenseId) {
      if (onComputer) focusAfterClose.current = '';
      showOpen(null, 'replace');
    }
    setSnackbar({ open: true, message: 'Expense deleted', expenseId, revision });
  };

  const handleUndo = async () => {
    const { expenseId, revision } = snackbar;
    if (!expenseId) return;
    try {
      const response = await apiFetch(expenseRecordPath(groupId, expenseId), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Splitbook-Revision': String(revision),
        },
        body: JSON.stringify({ isDeleted: false }),
      });
      if (!response.ok) {
        setSnackbar({ open: true, message: 'Could not restore this Expense. Please retry.' });
        return;
      }
      void mutate();
      // Back where the member was: the restored Expense open again, if nothing else is.
      if (!readOpenExpense(new URLSearchParams(window.location.search))) {
        setLostId(null);
        showOpen(expenseId, 'replace');
      }
    } catch {
      setSnackbar({ open: true, message: 'Could not restore this Expense. Please retry.' });
      return;
    }
    setSnackbar({ open: false, message: '' });
  };

  // What the open Expense shows: its own read once it arrives, the list's row until then.
  const shown = (loaded ?? listed ?? null) as PanelExpense | null;
  const act = (start: (expense: Record<string, unknown>) => void) =>
    shown ? () => start(shown as unknown as Record<string, unknown>) : undefined;
  const historyState = loaded ? 'ready' : record.error ? 'failed' : 'loading';

  const recurringId = recurringExpensesEnabled ? (shown?.recurringExpense ?? null) : null;
  const schedules = useSWR(
    recurringId && onComputer ? recurringExpensesPath(groupId) : null,
    fetchRecurringSchedules,
  );
  const repeats = recurringId
    ? repeatsLabel(schedules.data?.get(recurringId), {
        deleted: Boolean(schedules.data && !schedules.data.has(recurringId)),
      })
    : null;

  const panelState: ExpensePanelState = !openId
    ? lostId
      ? { kind: 'lost' }
      : { kind: 'empty' }
    : gone
      ? { kind: 'lost' }
      : shown
        ? { kind: 'open', expense: shown, history: historyState, repeats }
        : record.error
          ? { kind: 'failed' }
          : { kind: 'loading' };

  /** A phone's opened card (as before #311): its own read once it arrives, the row until then. */
  const details = (expense: ExpenseRead) => {
    const own = loaded && loaded._id === expense._id ? loaded : null;
    const opened = (own ?? expense) as unknown as Record<string, unknown>;
    return (
      <ExpenseDetails
        id={detailsId(expense._id)}
        expense={opened as unknown as ExpenseDetailsRecord}
        userId={userId}
        recurringExpensesEnabled={recurringExpensesEnabled}
        history={own ? 'ready' : record.error ? 'failed' : 'loading'}
        onRetryHistory={() => void record.mutate()}
        onEdit={() => setEditing(opened)}
        onDelete={() => setDeleting(opened)}
      />
    );
  };

  const sortLabel = EXPENSE_SORTS.find(({ id }) => id === query.sort)?.label ?? 'Newest first';
  const listLabel = month ? `Expenses, ${month.label}` : 'Expenses';
  const caption =
    `${month ? `Expenses in ${month.label}` : 'Expenses'}, ${sortLabel.toLowerCase()}. ` +
    'Select an Expense to see its details.';

  const list = rangeProblem ? (
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
      openId={openId}
      onToggle={toggle}
      panelId={EXPENSE_PANEL_ID}
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
          isExpanded={openId === expense._id}
          onToggleExpand={() => toggle(expense._id)}
          details={details(expense)}
          detailsId={detailsId(expense._id)}
        />
      )}
    />
  );

  const pager = !rangeProblem && pagination && pagination.totalPages > 1 && (
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
  );

  // The panel sits beside the list unless the list is empty with nothing open.
  const showPanel = Boolean(openId || lostId) || expenses.length > 0 || (!data && !error);

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

      {onComputer ? (
        // The design canvas's `.duo`: the table takes what the panel leaves, and the panel wraps
        // below it where there isn't room for both.
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 2.5 }}>
          <Stack ref={listBox} spacing={2} sx={{ flex: '999 1 600px', minWidth: 0 }}>
            {list}
            {pager}
          </Stack>
          {showPanel && (
            <Box
              ref={panelBox}
              sx={{
                // The canvas's 340 px from 1400 px up; 320 px below, where the table needs it.
                flex: '1 1 320px',
                [theme.breakpoints.up(1400)]: { flexBasis: 340 },
                minWidth: 0,
                // Beside a long table it stays in view as the table scrolls.
                position: 'sticky',
                top: TOPBAR_HEIGHT + 16,
                maxHeight: `calc(100vh - ${TOPBAR_HEIGHT + 32}px)`,
                overflowY: 'auto',
                borderRadius: `${RADIUS.lg}px`,
              }}
            >
              <ExpensePanel
                id={EXPENSE_PANEL_ID}
                state={panelState}
                userId={userId}
                names={names}
                onClose={closePanel}
                onRetry={() => void record.mutate()}
                onEdit={act(setEditing)}
                onDuplicate={act(duplicate)}
                onDelete={act(setDeleting)}
              />
            </Box>
          )}
        </Box>
      ) : (
        <>
          {list}
          {pager}
        </>
      )}

      <ExpenseFormDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        groupId={groupId}
        group={group}
        userId={userId}
        expense={editing}
      />

      <ExpenseFormDialog
        open={!!duplicating}
        onClose={() => setDuplicating(null)}
        groupId={groupId}
        group={group}
        userId={userId}
        initialDraft={duplicating}
        // The copy joins the list, dated today; the Expense it came from stays open.
        onSaved={() => setSnackbar({ open: true, message: 'Expense duplicated' })}
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

const detailsId = (expenseId: string) => `expense-${expenseId}-details`;

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
