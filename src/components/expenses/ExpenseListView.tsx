"use client";

import useSWR from "swr";
import { useState, useMemo } from "react";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Button from "@mui/material/Button";
import Pagination from "@mui/material/Pagination";
import LinearProgress from "@mui/material/LinearProgress";
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
  // Filters
  const [quickFilter, setQuickFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  // Custom date range
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Inline expansion
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);

  // Edit / Delete state
  const [editingExpense, setEditingExpense] = useState<Record<string, unknown> | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Record<string, unknown> | null>(null);

  // Undo snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; expenseId?: string }>({
    open: false,
    message: "",
  });

  // Custom date range validation
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

  // Build query params
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

  // Don't fetch if custom date range has validation errors
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

  // Active filter count
  const activeFilterCount = [category, tagFilter, quickFilter !== "all" ? quickFilter : "", search].filter(Boolean).length;

  // Group expenses by date
  const groupedExpenses: Record<string, Array<Record<string, unknown>>> = {};
  for (const expense of expenses) {
    const dateKey = formatDate(expense.date);
    if (!groupedExpenses[dateKey]) groupedExpenses[dateKey] = [];
    groupedExpenses[dateKey].push(expense);
  }

  // Handlers
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
    <div className="space-y-4">
      {/* Quick Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {QUICK_FILTERS.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            variant={quickFilter === f.id ? "filled" : "outlined"}
            onClick={() => handleQuickFilterChange(f.id)}
            sx={{
              ...(quickFilter === f.id
                ? { backgroundColor: "#6C63FF", color: "white" }
                : {}),
              flexShrink: 0,
            }}
          />
        ))}
      </div>

      {/* Custom Date Range */}
      {quickFilter === "custom" && (
        <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-3">
          <div className="flex gap-3 items-end">
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
          </div>
          {dateRangeError && (
            <p className="text-xs text-red-500">{dateRangeError}</p>
          )}
          {!dateRangeError && dateFrom && dateTo && (
            <p className="text-xs text-gray-500">
              {Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24))} days selected (max 31)
            </p>
          )}
        </div>
      )}

      {/* Search + Filter toggle + Sort */}
      <div className="flex gap-2 items-center">
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
            borderColor: activeFilterCount > 0 ? "#6C63FF" : "divider",
            backgroundColor: activeFilterCount > 0 ? "rgba(108,99,255,0.08)" : "transparent",
          }}
        >
          <FilterListIcon fontSize="small" sx={{ color: activeFilterCount > 0 ? "#6C63FF" : "inherit" }} />
        </IconButton>
      </div>

      {/* Expanded Filters */}
      {showFilters && (
        <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-3">
          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Category</label>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <Chip
                label="All"
                size="small"
                variant={!category ? "filled" : "outlined"}
                onClick={() => {
                  setCategory("");
                  setPage(1);
                }}
                sx={!category ? { backgroundColor: "#6C63FF", color: "white" } : {}}
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
                    ...(category === c.id ? { backgroundColor: "#6C63FF", color: "white" } : {}),
                  }}
                />
              ))}
            </div>
          </div>

          {/* Tag filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Tag</label>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <Chip
                label="All"
                size="small"
                variant={!tagFilter ? "filled" : "outlined"}
                onClick={() => {
                  setTagFilter("");
                  setPage(1);
                }}
                sx={!tagFilter ? { backgroundColor: "#6C63FF", color: "white" } : {}}
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
                      ...(tagFilter === t.name ? { backgroundColor: "#6C63FF", color: "white" } : {}),
                    }}
                  />
                ))}
            </div>
          </div>

          {/* Sort */}
          <div className="flex gap-2 items-center">
            <label className="text-xs font-medium text-gray-500">Sort by</label>
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
          </div>
        </div>
      )}

      {/* Summary Bar */}
      {summary && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total expenses</p>
              <p className="text-lg font-bold text-gray-900">
                {formatCurrency(summary.totalAmount || 0, currency)}
              </p>
              <p className="text-xs text-gray-400">{summary.count || 0} expense{(summary.count || 0) !== 1 ? "s" : ""}</p>
            </div>
            <div className="text-right">
              {(summary.userOwes || 0) > 0.01 && (
                <div className="mb-1">
                  <p className="text-xs font-medium text-red-500 uppercase tracking-wide">You owe</p>
                  <p className="text-lg font-bold text-red-500">
                    {formatCurrency(summary.userOwes, currency)}
                  </p>
                </div>
              )}
              {(summary.userGetsBack || 0) > 0.01 && (
                <div>
                  <p className="text-xs font-medium text-green-600 uppercase tracking-wide">You get back</p>
                  <p className="text-lg font-bold text-green-600">
                    {formatCurrency(summary.userGetsBack, currency)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Loading Indicator (non-blocking) */}
      {showLoadingIndicator && (
        <LinearProgress
          sx={{
            height: 2,
            borderRadius: 1,
            "& .MuiLinearProgress-bar": { backgroundColor: "#6C63FF" },
            backgroundColor: "rgba(108,99,255,0.1)",
          }}
        />
      )}

      {/* Expenses List */}
      {showSkeleton ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : expenses.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center">
          <span className="text-4xl mb-4 block">🧾</span>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No expenses yet</h3>
          <p className="text-gray-500">
            {search || quickFilter !== "all" || category || tagFilter
              ? "No expenses match your filters."
              : "Add your first expense using the + button below."}
          </p>
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${showLoadingIndicator ? "opacity-60" : "opacity-100"}`}>
          {Object.entries(groupedExpenses).map(([date, exps]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-gray-500 mb-2">{date}</h3>
              <div className="space-y-2">
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
              </div>
            </div>
          ))}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center pt-4">
              <Pagination
                count={pagination.totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                color="primary"
              />
            </div>
          )}
        </div>
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
    </div>
  );
}
