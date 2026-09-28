'use client';

import useSWR from 'swr';
import { useState, useMemo, useEffect } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Snackbar from '@mui/material/Snackbar';
import Button from '@mui/material/Button';
import Pagination from '@mui/material/Pagination';
import LinearProgress from '@mui/material/LinearProgress';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ExpenseCard from './ExpenseCard';
import ExpenseFormDialog from './ExpenseFormDialog';
import DeleteExpenseDialog from './DeleteExpenseDialog';
import MoneyText from '@/components/common/MoneyText';
import { formatDate } from '@splitbook/shared/date';
import { EXPENSE_CATEGORIES } from '@splitbook/shared/categories';
import { fetcher } from '@/lib/utils/fetcher';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupRead } from '@splitbook/shared/group-read';

const QUICK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'thisWeek', label: 'This Week' },
  { id: 'lastWeek', label: 'Last Week' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'last30Days', label: 'Last 30 Days' },
  { id: 'custom', label: 'Custom Range' },
];

interface ExpenseListViewProps {
  groupId: string;
  userId: string;
  group: GroupRead;
  onAddExpense?: () => void;
  /**
   * Controlled date range (full ISO 8601 bounds), owned by the Household
   * month switcher. When present it overrides the internal quick-filter /
   * date state and the quick-filter chip row is hidden; when absent the
   * component behaves exactly as before.
   */
  controlledDateRange?: { dateFrom: string; dateTo: string } | null;
  /**
   * Opt-in per-member breakdown — appended to the fetch only when a month
   * view is active, and surfaced via `onSummaryChange` for the member table.
   */
  includeMemberBreakdown?: boolean;
  onSummaryChange?: (summary: Record<string, unknown> | undefined) => void;
}

export default function ExpenseListView({
  groupId,
  userId,
  group,
  onAddExpense,
  controlledDateRange = null,
  includeMemberBreakdown = false,
  onSummaryChange,
}: ExpenseListViewProps) {
  const [quickFilter, setQuickFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);

  const [editingExpense, setEditingExpense] = useState<Record<string, unknown> | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Record<string, unknown> | null>(null);

  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    expenseId?: string;
    revision?: number;
  }>({
    open: false,
    message: '',
  });

  const dateRangeError = useMemo(() => {
    if (quickFilter !== 'custom') return '';
    if (dateFrom && dateTo) {
      const from = new Date(dateFrom);
      const to = new Date(dateTo);
      if (from > to) return 'Start date must be before end date';
      const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 31) return 'Date range cannot exceed 31 days';
    }
    return '';
  }, [quickFilter, dateFrom, dateTo]);

  const params = new URLSearchParams();
  if (controlledDateRange) {
    params.set('dateFrom', controlledDateRange.dateFrom);
    params.set('dateTo', controlledDateRange.dateTo);
    if (includeMemberBreakdown) params.set('includeMemberBreakdown', '1');
  } else if (quickFilter === 'custom') {
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
  } else if (quickFilter !== 'all') {
    params.set('quickFilter', quickFilter);
  }
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (tagFilter) params.set('tagId', tagFilter);
  params.set('sortBy', sortBy);
  params.set('sortOrder', sortOrder);
  params.set('page', String(page));
  params.set('limit', '20');

  const shouldFetch = controlledDateRange ? true : !(quickFilter === 'custom' && dateRangeError);

  const { data, isLoading, isValidating, error, mutate } = useSWR(
    shouldFetch ? `/api/groups/${groupId}/expenses?${params.toString()}` : null,
    fetcher,
    { refreshInterval: 10_000, keepPreviousData: true },
  );

  const expenses = data?.data?.expenses || [];
  const { data: detail, error: detailError } = useSWR(
    expandedExpenseId ? `/api/groups/${groupId}/expenses/${expandedExpenseId}` : null,
    fetcher,
  );
  const pagination = data?.data?.pagination;
  const summary = data?.data?.summary;

  // Surface the summary (month totals + per-member breakdown) to the parent
  // when a month view drives this list. Deferred to avoid setState-in-render.
  useEffect(() => {
    onSummaryChange?.(summary);
  }, [onSummaryChange, summary]);

  const currency = group.defaultCurrency;

  const activeFilterCount = [
    category,
    tagFilter,
    quickFilter !== 'all' ? quickFilter : '',
    search,
  ].filter(Boolean).length;

  const groupedExpenses: Record<string, Array<Record<string, unknown>>> = {};
  for (const expense of expenses) {
    const dateKey = formatDate(expense.date);
    if (!groupedExpenses[dateKey]) groupedExpenses[dateKey] = [];
    groupedExpenses[dateKey].push(expense);
  }

  const handleDeleted = (expenseId: string, revision: number) => {
    mutate();
    if (expandedExpenseId === expenseId) setExpandedExpenseId(null);
    setSnackbar({ open: true, message: 'Expense deleted', expenseId, revision });
  };

  const handleUndo = async () => {
    if (!snackbar.expenseId) return;
    try {
      const response = await fetch(`/api/groups/${groupId}/expenses/${snackbar.expenseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(snackbar.revision) },
        body: JSON.stringify({ isDeleted: false }),
      });
      if (!response.ok) {
        const result = await response.json();
        setSnackbar({ open: true, message: result.error || 'Could not restore this Expense.' });
        return;
      }
      mutate();
    } catch {
      setSnackbar({ open: true, message: 'Could not restore this Expense. Please retry.' });
      return;
    }
    setSnackbar({ open: false, message: '' });
  };

  const handleQuickFilterChange = (filterId: string) => {
    setQuickFilter(filterId);
    setPage(1);
    if (filterId !== 'custom') {
      setDateFrom('');
      setDateTo('');
    }
  };

  const hasData = !!data;
  const showSkeleton = isLoading && !hasData;
  const showLoadingIndicator = isValidating && hasData;

  return (
    <Stack spacing={2}>
      {detailError && (
        <Typography role="alert" color="error.main">
          Could not load Expense details. Close and reopen the row to retry.
        </Typography>
      )}
      {error && <Typography color="error.main">{error.message}</Typography>}

      {/* Quick Filters — hidden while a month view drives the date range */}
      {!controlledDateRange && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            overflowX: 'auto',
            pb: 1,
            '&::-webkit-scrollbar': { height: 4 },
            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
            '&::-webkit-scrollbar-thumb': {
              bgcolor: 'border.strong',
              borderRadius: 2,
            },
            scrollbarWidth: 'thin',
          }}
        >
          {QUICK_FILTERS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              variant={quickFilter === f.id ? 'filled' : 'outlined'}
              onClick={() => handleQuickFilterChange(f.id)}
              size="small"
              sx={{
                ...(quickFilter === f.id
                  ? { backgroundColor: 'primary.main', color: 'primary.contrastText' }
                  : {}),
                flexShrink: 0,
              }}
            />
          ))}
        </Stack>
      )}

      {/* Custom Date Range */}
      {quickFilter === 'custom' && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.5} alignItems="flex-end">
              <TextField
                label="From"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                size="small"
                sx={{ flex: 1 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="To"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                size="small"
                sx={{ flex: 1 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            {dateRangeError && (
              <Typography variant="caption" color="error.main">
                {dateRangeError}
              </Typography>
            )}
            {!dateRangeError && dateFrom && dateTo && (
              <Typography variant="caption" color="text.secondary">
                {Math.ceil(
                  (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) /
                    (1000 * 60 * 60 * 24),
                )}{' '}
                days selected (max 31)
              </Typography>
            )}
          </Stack>
        </Paper>
      )}

      {/* Search + Filter toggle + Sort */}
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          placeholder="Search expenses..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          size="small"
          fullWidth
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <IconButton
          onClick={() => setShowFilters(!showFilters)}
          size="small"
          aria-label={showFilters ? 'Hide filters' : 'Show filters'}
          aria-expanded={showFilters}
          sx={{
            border: '1px solid',
            borderColor: activeFilterCount > 0 ? 'primary.main' : 'divider',
            backgroundColor: (theme) =>
              activeFilterCount > 0 ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
          }}
        >
          <FilterListIcon
            fontSize="small"
            sx={{ color: activeFilterCount > 0 ? 'primary.main' : 'inherit' }}
          />
        </IconButton>
      </Stack>

      {/* Expanded Filters */}
      {showFilters && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            {/* Category */}
            <Box>
              <Typography
                variant="caption"
                fontWeight={500}
                color="text.secondary"
                sx={{ mb: 1, display: 'block' }}
              >
                Category
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ overflowX: 'auto', pb: 0.5 }}>
                <Chip
                  label="All"
                  size="small"
                  variant={!category ? 'filled' : 'outlined'}
                  onClick={() => {
                    setCategory('');
                    setPage(1);
                  }}
                  sx={
                    !category
                      ? { backgroundColor: 'primary.main', color: 'primary.contrastText' }
                      : {}
                  }
                />
                {EXPENSE_CATEGORIES.map((c) => (
                  <Chip
                    key={c.id}
                    label={`${c.icon} ${c.label}`}
                    size="small"
                    variant={category === c.id ? 'filled' : 'outlined'}
                    onClick={() => {
                      setCategory(category === c.id ? '' : c.id);
                      setPage(1);
                    }}
                    sx={{
                      flexShrink: 0,
                      fontSize: 12,
                      ...(category === c.id
                        ? { backgroundColor: 'primary.main', color: 'primary.contrastText' }
                        : {}),
                    }}
                  />
                ))}
              </Stack>
            </Box>

            {/* Tag filter */}
            <Box>
              <Typography
                variant="caption"
                fontWeight={500}
                color="text.secondary"
                sx={{ mb: 1, display: 'block' }}
              >
                Tag
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ overflowX: 'auto', pb: 0.5 }}>
                <Chip
                  label="All"
                  size="small"
                  variant={!tagFilter ? 'filled' : 'outlined'}
                  onClick={() => {
                    setTagFilter('');
                    setPage(1);
                  }}
                  sx={
                    !tagFilter
                      ? { backgroundColor: 'primary.main', color: 'primary.contrastText' }
                      : {}
                  }
                />
                {group.tags
                  .filter((t) => !t.isDeleted)
                  .map((t) => (
                    <Chip
                      key={t._id}
                      label={t.name}
                      size="small"
                      variant={tagFilter === t._id ? 'filled' : 'outlined'}
                      onClick={() => {
                        setTagFilter(tagFilter === t._id ? '' : t._id);
                        setPage(1);
                      }}
                      sx={{
                        flexShrink: 0,
                        fontSize: 12,
                        ...(tagFilter === t._id
                          ? { backgroundColor: 'primary.main', color: 'primary.contrastText' }
                          : {}),
                      }}
                    />
                  ))}
              </Stack>
            </Box>

            {/* Sort */}
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" fontWeight={500} color="text.secondary">
                Sort by
              </Typography>
              <TextField
                select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as 'date' | 'amount');
                  setPage(1);
                }}
                size="small"
                sx={{ width: 120 }}
              >
                <MenuItem value="date">Date</MenuItem>
                <MenuItem value="amount">Amount</MenuItem>
              </TextField>
              <IconButton
                size="small"
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
                aria-label={`Sort ${sortOrder === 'desc' ? 'descending' : 'ascending'}, switch to ${
                  sortOrder === 'desc' ? 'ascending' : 'descending'
                }`}
              >
                {sortOrder === 'desc' ? (
                  <ArrowDownwardIcon fontSize="small" />
                ) : (
                  <ArrowUpwardIcon fontSize="small" />
                )}
              </IconButton>
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* Summary Bar */}
      {summary && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: { xs: 1.5, sm: 2 },
            }}
          >
            <Box>
              <Typography
                variant="caption"
                fontWeight={500}
                color="text.secondary"
                sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                Total expenses
              </Typography>
              <MoneyText
                amount={summary.totalAmount || 0}
                currency={currency}
                tone="neutral"
                fontWeight={700}
                sx={{ display: 'block', fontSize: { xs: '1.1rem', sm: '1.25rem' } }}
              />
              {(summary.totalsByCurrency || [])
                .filter((total: { currency: string }) => total.currency !== currency)
                .map((total: { currency: string; totalAmount: number }) => (
                  <MoneyText
                    key={total.currency}
                    amount={total.totalAmount}
                    currency={total.currency}
                    tone="neutral"
                    variant="body2"
                    sx={{ display: 'block' }}
                  />
                ))}
              <Typography variant="caption" color="text.disabled">
                {summary.count || 0} expense
                {(summary.count || 0) !== 1 ? 's' : ''}
              </Typography>
            </Box>
            <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
              {(summary.userOwes || 0) > 0 && (
                <Box sx={{ mb: 0.5 }}>
                  <Typography
                    variant="caption"
                    fontWeight={500}
                    color="error.main"
                    sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
                  >
                    You owe
                  </Typography>
                  <MoneyText
                    amount={summary.userOwes}
                    currency={currency}
                    tone="negative"
                    fontWeight={700}
                    sx={{ display: 'block', fontSize: { xs: '1.1rem', sm: '1.25rem' } }}
                  />
                </Box>
              )}
              {(summary.userGetsBack || 0) > 0 && (
                <Box>
                  <Typography
                    variant="caption"
                    fontWeight={500}
                    color="success.main"
                    sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
                  >
                    You get back
                  </Typography>
                  <MoneyText
                    amount={summary.userGetsBack}
                    currency={currency}
                    tone="positive"
                    fontWeight={700}
                    sx={{ display: 'block', fontSize: { xs: '1.1rem', sm: '1.25rem' } }}
                  />
                </Box>
              )}
            </Box>
          </Box>
        </Paper>
      )}

      {/* Loading Indicator (non-blocking) */}
      {showLoadingIndicator && (
        <LinearProgress
          sx={{
            height: 2,
            borderRadius: 1,
            '& .MuiLinearProgress-bar': { backgroundColor: 'primary.main' },
            backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.1),
          }}
        />
      )}

      {/* Expenses List */}
      {showSkeleton ? (
        <Stack spacing={1.5}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" height={80} />
          ))}
        </Stack>
      ) : expenses.length === 0 ? (
        <Box sx={{ py: { xs: 4, sm: 6 }, textAlign: 'center' }}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 1 }}>
            {search || quickFilter !== 'all' || category || tagFilter || controlledDateRange
              ? 'No matching expenses'
              : 'No expenses yet'}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: onAddExpense ? 2.5 : 0 }}>
            {controlledDateRange && !(search || category || tagFilter)
              ? 'Nothing logged in this month yet.'
              : search || quickFilter !== 'all' || category || tagFilter
                ? `Try clearing filters to see everything in this ${getGroupTheme(group.category).nouns.singular}.`
                : 'Add a shared cost — tags and equal split are ready.'}
          </Typography>
          {onAddExpense &&
            !(search || quickFilter !== 'all' || category || tagFilter || controlledDateRange) && (
              <Button variant="contained" onClick={onAddExpense} sx={{ textTransform: 'none' }}>
                Add first expense
              </Button>
            )}
        </Box>
      ) : (
        <Stack
          spacing={3}
          sx={{
            transition: 'opacity 0.2s',
            opacity: showLoadingIndicator ? 0.6 : 1,
          }}
        >
          {Object.entries(groupedExpenses).map(([date, exps]) => (
            <Box key={date}>
              <Typography variant="body2" fontWeight={500} color="text.secondary" sx={{ mb: 1 }}>
                {date}
              </Typography>
              <Stack spacing={1}>
                {exps.map((expense) => (
                  <ExpenseCard
                    key={expense._id as string}
                    expense={
                      expandedExpenseId === expense._id && detail?.data ? detail.data : expense
                    }
                    userId={userId}
                    isExpanded={expandedExpenseId === (expense._id as string)}
                    onToggleExpand={() =>
                      setExpandedExpenseId(
                        expandedExpenseId === (expense._id as string)
                          ? null
                          : (expense._id as string),
                      )
                    }
                    onEdit={(exp) => setEditingExpense(exp)}
                    onDelete={(exp) => setDeletingExpense(exp)}
                  />
                ))}
              </Stack>
            </Box>
          ))}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2 }}>
              <Pagination
                count={pagination.totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                color="primary"
              />
            </Box>
          )}
        </Stack>
      )}

      {/* Edit Expense Dialog */}
      <ExpenseFormDialog
        open={!!editingExpense}
        onClose={() => setEditingExpense(null)}
        groupId={groupId}
        group={group}
        userId={userId}
        expense={editingExpense}
      />

      {/* Delete Expense Dialog */}
      <DeleteExpenseDialog
        open={!!deletingExpense}
        onClose={() => setDeletingExpense(null)}
        expense={deletingExpense}
        groupId={groupId}
        onDeleted={handleDeleted}
      />

      {/* Undo Snackbar */}
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
