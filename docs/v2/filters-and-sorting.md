# V2: Filters & Sorting

## Problem

The backend supports filtering by category, tags, date range, member, and sorting by date/amount. The frontend only exposes quick-date-filters and search. Users can't filter by category, can't sort, and can't filter by who paid or who owes.

## What Changes

### File: `src/components/expenses/ExpenseListView.tsx`

#### Add new filter state

```typescript
const [category, setCategory] = useState<string>("");        // category filter
const [sortBy, setSortBy] = useState<"date" | "amount">("date");
const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
const [showFilters, setShowFilters] = useState(false);        // toggle advanced filters
```

#### Update URL params builder

```typescript
if (category) params.set("category", category);
params.set("sortBy", sortBy);
params.set("sortOrder", sortOrder);
```

#### UI — Filter bar (below quick filters)

```
[🔽 Filters]  [Sort: Date ↓ ▾]

── Expanded Filters (when showFilters = true) ──
Category: [All ▾]  [🍕Food] [🚗Transport] [🏨Accom] ...  (chip row)
```

**Sort dropdown** (always visible, compact):
```
Sort: [Date ▾]  [↑↓]
```
- Dropdown: Date, Amount
- Toggle button: Ascending / Descending (arrow icon flips)

**Category filter** (expandable):
- Row of category chips (from `EXPENSE_CATEGORIES`)
- "All" chip to clear
- Active chip highlighted with brand color

#### Add filter count badge

Show a badge on the "Filters" button when any filter is active:

```typescript
const activeFilterCount = [category, quickFilter !== "all", search].filter(Boolean).length;
```

### New Backend Support: Member Filter

#### File: `src/types/index.ts`

Add to `ExpenseFilters`:
```typescript
paidByUser?: string;     // filter by who paid
owedByUser?: string;     // filter by who is in the split
```

#### File: `src/lib/services/expense.service.ts`

Add to `getGroupExpenses` query builder:

```typescript
// Paid-by filter
if (filters.paidByUser) {
  query["paidBy.user"] = new mongoose.Types.ObjectId(filters.paidByUser);
}

// Owed-by filter (who is in splitBetween)
if (filters.owedByUser) {
  query["splitBetween.user"] = new mongoose.Types.ObjectId(filters.owedByUser);
}
```

#### File: `src/app/api/groups/[id]/expenses/route.ts`

Parse new query params:
```typescript
paidByUser: searchParams.get("paidByUser") || undefined,
owedByUser: searchParams.get("owedByUser") || undefined,
```

### Future Consideration (not in this PR)

- Date range picker (calendar) alongside quick filters
- Tag filter (select specific tags)
- Export filtered results as CSV

## Files Modified

- `src/components/expenses/ExpenseListView.tsx` — add category chips, sort controls, filter toggle
- `src/types/index.ts` — add `paidByUser`, `owedByUser` to `ExpenseFilters`
- `src/lib/services/expense.service.ts` — handle new filter params
- `src/app/api/groups/[id]/expenses/route.ts` — parse new query params

