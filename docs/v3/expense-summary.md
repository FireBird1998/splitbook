# Expense Summary Bar

## Problem

Users can't see aggregate totals for the currently filtered expense list. They have to mentally add up amounts, and there's no quick way to see "how much do I owe based on these filters?"

## Solution

A sticky summary bar at the top of the expense list (below filters, above expense cards) showing:

```
┌──────────────────────────────────────────────────┐
│  Total: ₹12,450.00   │   You owe: ₹3,200.00     │
│  8 expenses           │   You get back: ₹1,100.00│
└──────────────────────────────────────────────────┘
```

### Fields

1. **Total expenses** — sum of all `expense.amount` in current filtered result
2. **Expense count** — number of expenses matching current filters
3. **You owe** — sum of what the current user owes across filtered expenses (split amount - paid amount, when positive)
4. **You get back** — sum of what others owe the current user across filtered expenses (paid amount - split amount, when positive)

### Data Source

**Option A (chosen)**: Compute summary in the backend and return alongside the expense list response.

Add a `summary` field to the response from `GET /api/groups/[id]/expenses`:

```json
{
  "expenses": [...],
  "pagination": {...},
  "summary": {
    "totalAmount": 12450.00,
    "count": 8,
    "userOwes": 3200.00,
    "userGetsBack": 1100.00,
    "currency": "INR"
  }
}
```

The summary is computed from the **full filtered set** (not just the current page), so it reflects all matching expenses regardless of pagination.

## Backend Changes

### `expense.service.ts` — `getGroupExpenses`

After building the filter query, run an aggregation pipeline in parallel to compute:

- `totalAmount`: `$sum` of `amount`
- `count`: document count (already have this)
- For user-specific amounts, we need `userId` passed to the method

New method signature:

```typescript
async getGroupExpenses(groupId: string, filters: ExpenseFilters = {}, userId?: string)
```

The aggregation:

```javascript
Expense.aggregate([
  { $match: query },
  {
    $group: {
      _id: null,
      totalAmount: { $sum: "$amount" },
      count: { $sum: 1 },
    },
  },
]);
```

For user owe/get-back, iterate through the expense list's `paidBy` and `splitBetween` arrays server-side.

### `GET /api/groups/[id]/expenses` route

- Pass `userId` to the service
- Return `summary` in response

## Frontend Changes

### `ExpenseListView.tsx`

- Read `data.data.summary` from the SWR response
- Render a summary bar component between filters and expense list
- Use `formatCurrency` for display

## Notes

- Summary computation should be efficient — the aggregation runs on the same query as the list
- The summary updates automatically when filters change (because it's part of the SWR response)
- Currency for summary comes from the group's default currency
