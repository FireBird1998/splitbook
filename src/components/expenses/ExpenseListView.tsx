"use client";

import useSWR from "swr";
import { useState, useMemo } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Button from "@mui/material/Button";
import Pagination from "@mui/material/Pagination";
import LinearProgress from "@mui/material/LinearProgress";
import { alpha } from "@mui/material/styles";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ExpenseCard from "./ExpenseCard";
import ExpenseFormDialog from "./ExpenseFormDialog";
import DeleteExpenseDialog from "./DeleteExpenseDialog";
import { formatDate } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/currency";
import { EXPENSE_CATEGORIES } from "@/lib/constants/categories";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const QUICK_FILTERS = [
  { id: "all", label: "All" },
  { id: "thisWeek", label: "This Week" },
  { id: "lastWeek", label: "Last Week" },
  { id: "thisMonth", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
  { id: "last30Days", label: "Last 30 Days" },
  { id: "custom", label: "Custom Range" },
];

interface ExpenseListViewProps {
  groupId: string;
  userId: string;
  group: Record<string, unknown>;
}

export default function ExpenseListView({ groupId, userId, group }: ExpenseListViewProps) {
  const [quickFilter, setQuickFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);

  const [editingExpense, setEditingExpense] = useState<Record<string, unknown> | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Record<string, unknown> | null>(null);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; expenseId?: string }>({
    open: false,
    message: "",
  });

  const dateRangeError = useMemo(() => {
    if (quickFilter !== "custom") return "";
    if (dateFrom && dateTo) {
      const from = new Date(dateFrom);
      const to = new Date(dateTo);
      if (from > to) return "Start date must be before end date";
      const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 31) return "Date range cannot exceed 31 days";
    }
    return "";
  }, [quickFilter, dateFrom, dateTo]);

  const params = new URLSearchParams();
  if (quickFilter === "custom") {
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
  } else if (quickFilter !== "all") {
    params.set("quickFilter", quickFilter);
  }
  if (search) params.set("search", search);
  if (category) params.set("category", category);
  if (tagFilter) params.set("tag", tagFilter);
  params.set("sortBy", sortBy);
  params.set("sortOrder", sortOrder);
  params.set("page", String(page));
  params.set("limit", "20");

  const shouldFetch = !(quickFilter === "custom" && dateRangeError);

  const { data, isLoading, isValidating, mutate } = useSWR(
    shouldFetch ? `/api/groups/${groupId}/expenses?${params.toString()}` : null,
    fetcher,
    { refreshInterval: 10_000, keepPreviousData: true }
  );

  const expenses = data?.data?.expenses || [];
  const pagination = data?.data?.pagination;
  const summary = data?.data?.summary;

  const currency = group.defaultCurrency as string;

  const activeFilterCount = [category, tagFilter, quickFilter !== "all" ? quickFilter : "", search].filter(Boolean).length;

  const groupedExpenses: Record<string, Array<Record<string, unknown>>> = {};
  for (const expense of expenses) {
    const dateKey = formatDate(expense.date);
    if (!groupedExpenses[dateKey]) groupedExpenses[dateKey] = [];
    groupedExpenses[dateKey].push(expense);
  }

  const handleDeleted = (expenseId: string) => {
    mutate();
    if (expandedExpenseId === expenseId) setExpandedExpenseId(null);
    setSnackbar({ open: true, message: "Expense deleted", expenseId });
  };

  const handleUndo = async () => {
    if (!snackbar.expenseId) return;
    try {
      await fetch(`/api/groups/${groupId}/expenses/${snackbar.expenseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDeleted: false }),
      });
      mutate();
    } catch {
      // silently fail
    }
    setSnackbar({ open: false, message: "" });
  };

  const handleQuickFilterChange = (filterId: string) => {
    setQuickFilter(filterId);
    setPage(1);
    if (filterId !== "custom") {
      setDateFrom("");
      setDateTo("");
    }
  };

  const hasData = !!data;
  const showSkeleton = isLoading && !hasData;
  const showLoadingIndicator = isValidating && hasData;

  return (
    <Stack spacing={2}>
      {/* Quick Filters */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          overflowX: "auto",
          pb: 1,
          "&::-webkit-scrollbar": { height: 4 },
          "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
          "&::-webkit-scrollbar-thumb": { bgcolor: "grey.300", borderRadius: 2 },
          scrollbarWidth: "thin",
        }}
      >
        {QUICK_FILTERS.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            variant={quickFilter === f.id ? "filled" : "outlined"}
            onClick={() => handleQuickFilterChange(f.id)}
            size="small"
            sx={{
              ...(quickFilter === f.id
                ? { backgroundColor: "primary.main", color: "white" }
                : {}),
              flexShrink: 0,
            }}
          />
        ))}
      </Stack>

      {/* Custom Date Range */}
      {quickFilter === "custom" && (
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
              <Typography variant="caption" color="error.main">{dateRangeError}</Typography>
            )}
            {!dateRangeError && dateFrom && dateTo && (
              <Typography variant="caption" color="text.secondary">
                {Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24))} days selected (max 31)
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
          sx={{
            border: "1px solid",
            borderColor: activeFilterCount > 0 ? "primary.main" : "divider",
            backgroundColor: (theme) => activeFilterCount > 0 ? alpha(theme.palette.primary.main, 0.08) : "transparent",
          }}
        >
          <FilterListIcon fontSize="small" sx={{ color: activeFilterCount > 0 ? "primary.main" : "inherit" }} />
        </IconButton>
      </Stack>

      {/* Expanded Filters */}
      {showFilters && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            {/* Category */}
            <Box>
              <Typography variant="caption" fontWeight={500} color="text.secondary" sx={{ mb: 1, display: "block" }}>
                Category
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ overflowX: "auto", pb: 0.5 }}>
                <Chip
                  label="All"
                  size="small"
                  variant={!category ? "filled" : "outlined"}
                  onClick={() => {
                    setCategory("");
                    setPage(1);
                  }}
                  sx={!category ? { backgroundColor: "primary.main", color: "white" } : {}}
                />
                {EXPENSE_CATEGORIES.map((c) => (
                  <Chip
                    key={c.id}
                    label={`${c.icon} ${c.label}`}
                    size="small"
                    variant={category === c.id ? "filled" : "outlined"}
                    onClick={() => {
                      setCategory(category === c.id ? "" : c.id);
                      setPage(1);
                    }}
                    sx={{
                      flexShrink: 0,
                      fontSize: 12,
                      ...(category === c.id ? { backgroundColor: "primary.main", color: "white" } : {}),
                    }}
                  />
                ))}
              </Stack>
            </Box>

            {/* Tag filter */}
            <Box>
              <Typography variant="caption" fontWeight={500} color="text.secondary" sx={{ mb: 1, display: "block" }}>
                Tag
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ overflowX: "auto", pb: 0.5 }}>
                <Chip
                  label="All"
                  size="small"
                  variant={!tagFilter ? "filled" : "outlined"}
                  onClick={() => {
                    setTagFilter("");
                    setPage(1);
                  }}
                  sx={!tagFilter ? { backgroundColor: "primary.main", color: "white" } : {}}
                />
                {((group.tags || []) as Array<{ _id: string; name: string; isArchived: boolean }>)
                  .filter((t) => !t.isArchived)
                  .map((t) => (
                    <Chip
                      key={t._id}
                      label={t.name}
                      size="small"
                      variant={tagFilter === t.name ? "filled" : "outlined"}
                      onClick={() => {
                        setTagFilter(tagFilter === t.name ? "" : t.name);
                        setPage(1);
                      }}
                      sx={{
                        flexShrink: 0,
                        fontSize: 12,
                        ...(tagFilter === t.name ? { backgroundColor: "primary.main", color: "white" } : {}),
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
                  setSortBy(e.target.value as "date" | "amount");
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
                onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                title={sortOrder === "desc" ? "Descending" : "Ascending"}
              >
                {sortOrder === "desc" ? (
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
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: { xs: 1.5, sm: 2 },
            }}
          >
            <Box>
              <Typography variant="caption" fontWeight={500} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Total expenses
              </Typography>
              <Typography fontWeight={700} color="text.primary" sx={{ fontSize: { xs: "1.1rem", sm: "1.25rem" } }}>
                {formatCurrency(summary.totalAmount || 0, currency)}
              </Typography>
              <Typography variant="caption" color="text.disabled">
                {summary.count || 0} expense{(summary.count || 0) !== 1 ? "s" : ""}
              </Typography>
            </Box>
            <Box sx={{ textAlign: { xs: "left", sm: "right" } }}>
              {(summary.userOwes || 0) > 0.01 && (
                <Box sx={{ mb: 0.5 }}>
                  <Typography variant="caption" fontWeight={500} color="error.main" sx={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    You owe
                  </Typography>
                  <Typography fontWeight={700} color="error.main" sx={{ fontSize: { xs: "1.1rem", sm: "1.25rem" } }}>
                    {formatCurrency(summary.userOwes, currency)}
                  </Typography>
                </Box>
              )}
              {(summary.userGetsBack || 0) > 0.01 && (
                <Box>
                  <Typography variant="caption" fontWeight={500} color="success.main" sx={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    You get back
                  </Typography>
                  <Typography fontWeight={700} color="success.main" sx={{ fontSize: { xs: "1.1rem", sm: "1.25rem" } }}>
                    {formatCurrency(summary.userGetsBack, currency)}
                  </Typography>
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
            "& .MuiLinearProgress-bar": { backgroundColor: "primary.main" },
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
        <Paper variant="outlined" sx={{ p: 6, textAlign: "center" }}>
          <Typography component="span" sx={{ fontSize: "2.5rem", display: "block", mb: 2 }}>
            🧾
          </Typography>
          <Typography variant="subtitle1" fontWeight={500} color="text.primary" sx={{ mb: 1 }}>
            No expenses yet
          </Typography>
          <Typography color="text.secondary">
            {search || quickFilter !== "all" || category || tagFilter
              ? "No expenses match your filters."
              : "Add your first expense using the + button below."}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={3} sx={{ transition: "opacity 0.2s", opacity: showLoadingIndicator ? 0.6 : 1 }}>
          {Object.entries(groupedExpenses).map(([date, exps]) => (
            <Box key={date}>
              <Typography variant="body2" fontWeight={500} color="text.secondary" sx={{ mb: 1 }}>
                {date}
              </Typography>
              <Stack spacing={1}>
                {exps.map((expense) => (
                  <ExpenseCard
                    key={expense._id as string}
                    expense={expense}
                    userId={userId}
                    isExpanded={expandedExpenseId === (expense._id as string)}
                    onToggleExpand={() =>
                      setExpandedExpenseId(
                        expandedExpenseId === (expense._id as string) ? null : (expense._id as string)
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
            <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
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
        onClose={() => setSnackbar({ open: false, message: "" })}
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
