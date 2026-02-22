# Custom Date Range Filter

## Problem

Current expense list only supports quick filters (This Week, Last Week, etc.) and doesn't allow picking arbitrary date ranges. Users want to see expenses for specific trips or periods.

## Solution

Add a "Custom" option to the quick filter chips that reveals a date range picker.

### UI

When "Custom" chip is selected, show two date inputs inline:

```
[All] [This Week] [Last Week] [This Month] [Custom ✓]

From: [2026-01-15]  To: [2026-02-12]   ⚠️ Max 31 days
```

### Validation

- **Max range**: 31 days. If user picks a range > 31 days, show inline error: "Date range cannot exceed 31 days" and don't fetch.
- **From ≤ To**: `dateFrom` must be on or before `dateTo`.
- **To ≤ Today**: `dateTo` cannot be in the future.

### Behavior

- Selecting "Custom" chip shows the date pickers
- Selecting any other quick filter chip hides the date pickers and clears `dateFrom`/`dateTo`
- When custom dates are set, they take priority over `quickFilter` (set `quickFilter` to `"custom"`)
- Changing dates triggers re-fetch with `dateFrom` and `dateTo` query params

## Backend

The backend already supports `dateFrom` and `dateTo` query params in `GET /api/groups/[id]/expenses`. No backend changes needed.

The service (`expense.service.ts`) already handles:

```typescript
if (filters.dateFrom || filters.dateTo) {
  query.date = {};
  if (filters.dateFrom) query.date.$gte = new Date(filters.dateFrom);
  if (filters.dateTo) query.date.$lte = new Date(filters.dateTo);
}
```

## Files Changed

- `src/components/expenses/ExpenseListView.tsx`:
  - Add `dateFrom` and `dateTo` state
  - Add "Custom" to `QUICK_FILTERS` array
  - Show date inputs when `quickFilter === "custom"`
  - Validate max 31 days
  - Pass `dateFrom` / `dateTo` as query params

## Notes

- The 31-day limit is a client-side validation only (prevents fetching unreasonably large datasets)
- Date inputs use native `<input type="date">` via MUI `TextField` with `type="date"`
