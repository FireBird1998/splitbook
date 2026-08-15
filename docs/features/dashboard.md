# Feature: Expense Dashboard & Filters

## Overview

Each group has an expense dashboard as its primary view. It shows a filterable, searchable, paginated list of expenses with quick-access time filters and advanced filter options.

---

## User Stories

1. **As a user**, I can see all expenses in a group sorted by date.
2. **As a user**, I can filter expenses by date range.
3. **As a user**, I can filter expenses by tag or category.
4. **As a user**, I can search expenses by description (supports regex-like patterns).
5. **As a user**, I can use quick filters like "This Week", "Last Week", "This Month".
6. **As a user**, I can sort expenses by date or amount.

---

## Dashboard Layout

```
┌──────────────────────────────────────────────────────┐
│ Europe Trip 2026                        [+ Add Expense]│
├──────────────────────────────────────────────────────┤
│ [Expenses] [Balances] [Activity]                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│ ── Quick Filters ──                                  │
│ [All] [This Week] [Last Week] [This Month]           │
│ [Last Month] [Last 30 Days]                          │
│                                                      │
│ ── Advanced Filters ──                        [▼]    │
│ Date: [Feb 1] → [Feb 10]                            │
│ Category: [All ▾]  Tag: [All ▾]                    │
│ Search: [🔍 Search expenses...              ]       │
│ Sort: [Date ▾] [Newest first ▾]                     │
│                                                      │
│ Showing 12 of 45 expenses         [Clear Filters]   │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Feb 10, 2026                                         │
│ ┌────────────────────────────────────────────────┐  │
│ │ 🍕 Dinner at restaurant                 €120.00│  │
│ │ John paid · Split 3 ways · You owe €40.00      │  │
│ │ [dinner] [birthday]                            │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ┌────────────────────────────────────────────────┐  │
│ │ 🚗 Taxi to hotel                         €25.00│  │
│ │ You paid · Split 3 ways                        │  │
│ │ [transport]                                    │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ Feb 9, 2026                                          │
│ ┌────────────────────────────────────────────────┐  │
│ │ 🏨 Hotel booking                        €300.00│  │
│ │ Jane paid · Split 3 ways · You owe €100.00     │  │
│ │ [accommodation]                                │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│              [1] [2] [3] → (Pagination)              │
└──────────────────────────────────────────────────────┘
```

---

## Quick Filters

One-click pill buttons that set date range automatically.

| Filter       | Date Range                       |
| ------------ | -------------------------------- |
| All          | No date filter                   |
| This Week    | Monday of current week → today   |
| Last Week    | Monday → Sunday of previous week |
| This Month   | 1st of current month → today     |
| Last Month   | 1st → last day of previous month |
| Last 30 Days | Today - 30 days → today          |

### Implementation

```typescript
function getQuickFilterDates(filter: string): { from: Date; to: Date } | null {
  const now = new Date();
  switch (filter) {
    case 'thisWeek':
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: now };
    case 'lastWeek':
      const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      return {
        from: lastWeekStart,
        to: endOfWeek(lastWeekStart, { weekStartsOn: 1 }),
      };
    case 'thisMonth':
      return { from: startOfMonth(now), to: now };
    case 'lastMonth':
      return {
        from: startOfMonth(subMonths(now, 1)),
        to: endOfMonth(subMonths(now, 1)),
      };
    case 'last30Days':
      return { from: subDays(now, 30), to: now };
    default:
      return null;
  }
}
```

---

## Advanced Filters

Expandable section (collapsed by default on mobile).

### Date Range Filter

- Two date pickers: "From" and "To"
- Selecting a quick filter auto-fills these
- Custom date range overrides quick filter selection

### Category Filter

- Dropdown with all categories
- "All" option to reset

### Tag Filter

- Autocomplete chip input
- Shows tags that exist in group expenses
- Multiple tags = AND filter (expense must have ALL selected tags)

### Search

- Text input with debounce (300ms)
- Searches `description` field
- Supports partial matches (substring search)
- API uses regex: `/searchTerm/i`

### Sort

- **Sort by**: Date (default), Amount
- **Sort order**: Newest first (default), Oldest first, Highest amount, Lowest amount

---

## Filter State Management

Filters are stored in URL search params for shareability and back-button support.

```
/api/groups/abc123/expenses?quickFilter=thisWeek&category=food&tag=Food&search=rest&sortBy=date&sortOrder=desc&page=1
```

### Filter state

There is **no `useExpenseFilters` hook** and no `src/hooks` directory. Filters
are local React state inside `ExpenseListView`, which builds the query string and
passes it to `useSWR` directly. Note also that the tag param is singular
(`tag=Food`), not a comma-separated `tags` list.

The one filter that _is_ URL-backed is the Household month lens: `MonthCycleBar`
reads and writes `?month=YYYY-MM` so a month view is linkable and survives
refresh. Its parser, `parseMonthParam`, is exported from the component.

---

## Pagination

- Default page size: 20 expenses
- Show total count: "Showing 1-20 of 45 expenses"
- Page navigation at bottom
- Changing filters resets to page 1

---

## Empty States

| State                     | Message                                    |
| ------------------------- | ------------------------------------------ |
| No expenses in group      | "No expenses yet. Add your first expense!" |
| No expenses match filters | "No expenses match your filters."          |
| No expenses this week     | "No expenses this week."                   |

---

## API Query

`ExpenseListView` builds the query string from its local filter state and calls
SWR inline — there is no wrapper hook:

```typescript
// src/components/expenses/ExpenseListView.tsx
const params = new URLSearchParams();
if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
if (filters.dateTo) params.set('dateTo', filters.dateTo);
if (filters.category) params.set('category', filters.category);
if (filters.tag) params.set('tag', filters.tag); // singular
if (filters.search) params.set('search', filters.search);
params.set('sortBy', filters.sortBy);
params.set('sortOrder', filters.sortOrder);
params.set('page', String(filters.page));
params.set('limit', '20');

const { data, isLoading, isValidating, error, mutate } = useSWR(
  `/api/groups/${groupId}/expenses?${params}`,
  fetcher,
  { refreshInterval: 10_000, keepPreviousData: true },
);
```

---

## Mobile Considerations

- Quick filters: Horizontal scrollable row
- Advanced filters: Collapsed behind "Filters" button, opens as bottom sheet
- Expense cards: Full-width, stacked
- Search: Always visible at top
- Pagination: "Load More" button instead of page numbers
