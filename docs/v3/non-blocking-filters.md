# Non-Blocking Filter Loading

## Problem

When the user changes a filter (quick filter, category, search, sort), the entire expense list shows a skeleton/loading state — 3 empty animated boxes. This is visually jarring and makes it feel like the whole page is reloading. It also destroys the user's scroll position and mental model of where they were.

## Solution

Keep the existing expense list visible while loading and show a subtle loading indicator:

1. **Small linear progress bar** or **spinner icon** at the top of the list area (between filters and first expense)
2. **Existing expenses remain visible** but slightly dimmed (opacity 0.5)
3. Once new data arrives, replace the list seamlessly
4. Only show full skeleton on **initial load** (when there's no existing data at all)

### Implementation

SWR provides `isLoading` (true on first fetch) and `isValidating` (true on any fetch, including revalidation). Use this distinction:

```tsx
// Show skeleton ONLY when there's no previous data
if (isLoading) return <Skeleton />;

// Show subtle indicator when revalidating with existing data
return (
  <Box sx={{ position: 'relative' }}>
    {isValidating && <LinearProgress />}
    <Box sx={isValidating ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      {/* existing expense list */}
    </Box>
  </Box>
);
```

### Key SWR Properties

- `isLoading`: `true` only on first load when no data exists
- `isValidating`: `true` whenever a request is in-flight (including revalidation, filter changes)
- `data`: persists from last successful fetch even during revalidation

By checking `!data` (no previous data) for skeleton and `isValidating` (in-flight) for the subtle indicator, we get the best of both worlds.

## Files Changed

- `src/components/expenses/ExpenseListView.tsx`:
  - Destructure `isValidating` from `useSWR` (in addition to `isLoading`)
  - Use `isLoading && !data` for initial skeleton
  - Use `isValidating && data` for subtle loading indicator
  - Add `LinearProgress` from MUI at top of list
  - Add `sx={{ opacity: 0.5 }}` when validating

## Notes

- No backend changes
- SWR's `keepPreviousData` option can also help — it keeps stale data visible while revalidating: `useSWR(key, fetcher, { keepPreviousData: true })`
- The `pointerEvents: "none"` sx prevents clicking on stale items during transition
- Pagination changes should also use this pattern (not show skeleton)
