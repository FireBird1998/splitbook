# Household Monthly Views — API and Data Contract

Technical spec for Phase 2 of [V4](./README.md). Covers what is reused, the one additive response field, and the date-boundary correction that monthly totals depend on.

**Guiding constraint:** monthly views are read-only lenses over expenses. No new collection, no new write path, and no month-scoped balance. See §3 of the V4 README for why balances stay running.

## What already exists

`GET /api/groups/[id]/expenses` covers most of this feature today.

| Capability                                                | Where                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| Arbitrary date range filter (`dateFrom`, `dateTo`)        | `ExpenseFilters` → `expenseService.getGroupExpenses`               |
| Named ranges (`quickFilter`: `thisMonth`, `lastMonth`, …) | `getQuickFilterDates` in `src/lib/utils/date.ts`                   |
| Total and count **across the whole filtered set**         | `summary.totalAmount`, `summary.count` (aggregation, not the page) |
| Current user's owe / get-back for the filtered set        | `summary.userOwes`, `summary.userGetsBack`                         |
| `yyyy-MM-dd` formatting for query params                  | `toDateParam`                                                      |

So the month total, the expense count, and "what you owe within this month" are already served. The month switcher is a client that computes `startOfMonth` / `endOfMonth` and sets `dateFrom` / `dateTo`.

### Why not `quickFilter`

`getQuickFilterDates` only knows `thisMonth` and `lastMonth`, and `thisMonth` returns `to: now` rather than the month end. Arbitrary month stepping would mean adding a key per month, which is not a thing. The month switcher sends explicit `dateFrom` / `dateTo` and leaves `getQuickFilterDates` alone.

### Why not date-filter the balances endpoint

Adding `dateFrom` / `dateTo` to `GET /api/groups/[id]/balances` would be the smaller diff and the worse design. That endpoint returns `balances` and simplified `debts` — a cumulative statement of who owes whom. Restricting it to a month would produce a number that looks like a balance, is labelled like a balance, and is not one, because settlements cannot be attributed to a month (`Settlement` has no `date`, only `createdAt`). The monthly numbers belong on the expense summary, where they are unambiguously "what was spent in this window".

---

## 1. Fix: inclusive `dateTo`

**Bug, pre-existing.** In `expenseService.getGroupExpenses`:

```ts
if (filters.dateTo) (query.date as Record<string, unknown>).$lte = new Date(filters.dateTo);
```

`new Date('2026-08-31')` is `2026-08-31T00:00:00.000Z`. An expense recorded at 14:00 on 31 August is excluded. Today this quietly truncates the Custom Range filter; with a month switcher it makes every month total wrong by up to one day, and the missing amount reappears in no other month.

**Fix in the service, not the client.** Treat a date-only `dateTo` as end-of-day:

```ts
// dateTo is inclusive: a date-only string covers the whole day.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const to = DATE_ONLY.test(filters.dateTo)
  ? new Date(`${filters.dateTo}T23:59:59.999Z`)
  : new Date(filters.dateTo);
```

One place, fixes the existing Custom Range bug, keeps the API shape, and needs no client coordination. Timestamps passed in full ISO form are respected as-is.

Boundaries are **viewer-local**: the month switcher computes `startOfMonth` / `endOfMonth` in the viewer's timezone and sends full ISO 8601 bounds (e.g. an IST viewer's August runs `2026-07-31T18:30:00.000Z` → `2026-08-31T18:29:59.999Z`), which the service respects as-is. The date-only → end-of-day-UTC widening above stays purely as a fallback for plain `yyyy-MM-dd` params (the Custom Range filter). A late-night 31 August expense therefore lands in August for an IST viewer; two viewers in different timezones can legitimately see different month totals for the same group — months are a lens, not a ledger boundary.

**Tests:** an expense at `23:30` on the last day of the range is included; an expense at `00:15` the next day is excluded; a full ISO `dateTo` is not widened.

---

## 2. Additive: per-member breakdown

The one number monthly views need and nothing serves: for a given window, what each member fronted and what each member's share was.

### Request

Opt-in, so the default expense-list payload does not grow:

```
GET /api/groups/[id]/expenses?dateFrom=2026-08-01&dateTo=2026-08-31&includeMemberBreakdown=1&limit=20
```

`ExpenseFilters` gains `includeMemberBreakdown?: boolean`, parsed in the route alongside the existing params.

### Response

`summary` gains one optional field. Everything else is unchanged, so existing callers are unaffected.

```ts
interface ExpenseSummary {
  totalAmount: number;
  count: number;
  userOwes: number;
  userGetsBack: number;
  /** Present only when includeMemberBreakdown is requested. */
  byMember?: Array<{
    user: { _id: string; name: string; image?: string };
    /** Sum of this member's paidBy amounts in the window. */
    paid: number;
    /** Sum of this member's splitBetween amounts in the window. */
    share: number;
    /** share - paid. Positive = under-contributed this window. */
    net: number;
  }>;
}
```

Invariants: `sum(paid) === sum(share) === totalAmount` and `sum(net) === 0`, each within rounding tolerance. All amounts are rounded to 2 decimals with the same `Math.round(x * 100) / 100` treatment the summary already uses.

Members with no activity in the window appear with zeroes, so the table has a stable row set as the user steps between months.

### Implementation

Reuse the pass that already exists. `getGroupExpenses` loads the full filtered set when computing `userOwes` / `userGetsBack`:

```ts
let allFiltered = expenses;
if (total > limit) {
  allFiltered = await Expense.find(query).select('paidBy splitBetween').lean();
}
```

Extend that single loop to accumulate a `Map<userId, { paid, share }>` for all members instead of only the current user, then derive `net` and hydrate names from the group's members. No second aggregation pipeline, no extra round trip, and `userOwes` / `userGetsBack` fall out of the same map, removing the duplicated per-user branch.

The volume is bounded — a household month is tens of expenses — so the in-memory pass is the right shape. If a group ever gets large enough for this to matter, the same numbers are expressible as an `$unwind` + `$group` pipeline, and the extracted pure reducer makes that swap a drop-in.

**Extract the maths.** Put the accumulation in a pure helper (e.g. `src/lib/services/expense-summary.ts`) taking `{ paidBy, splitBetween }[]` and a member ID list, returning the breakdown. Pure, unit-testable with no DB, and consistent with how `split-calculation` and `debt-simplifier` are factored.

**Tests:** multi-payer expenses split unevenly; a member in `splitBetween` who never paid; a member who paid but is not in the split; nets summing to zero; an empty window returning all-zero rows.

---

## 3. Client contract

### Month state

`MonthCycleBar` owns the active month; `ExpenseListView` receives it.

| Concern                        | Behaviour                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source of truth                | `?month=YYYY-MM` search param; absent means "all time"                                                                                                                          |
| Range computation              | `startOfMonth` / `endOfMonth` from `date-fns` in the **viewer's timezone**, sent as full ISO 8601 bounds (`dateFrom` / `dateTo`) — not date-only strings                        |
| Forward limit                  | `›` disabled when the active month is the current month                                                                                                                         |
| Backward limit                 | None. Empty months render an empty state, not an error                                                                                                                          |
| Interaction with quick filters | While a month is active, `ExpenseListView` hides its quick-filter chip row. "All time" restores it                                                                              |
| Fetch keys                     | Unchanged SWR-key-from-query-string pattern, so month stepping is cached per month and `keepPreviousData` holds the previous month on screen during the swap                    |
| Expense date default           | When the form opens while a **past** month is active, its date defaults to that month's last day (viewer-local); current month or All time → today. The user can still override |

`ExpenseListView` gains an optional controlled date range prop (full ISO bounds). When provided it overrides internal `quickFilter` / `dateFrom` / `dateTo` state and suppresses the chip row; when absent the component behaves exactly as it does today. Trip, Couple, Work, and General groups pass nothing and are untouched. The group page passes the active month down to whatever opens `ExpenseFormDialog` so the date default above applies only when a month view is active.

### Reads per month view

Two requests, both already cached by SWR:

| Request                                                    | Serves                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `expenses?dateFrom&dateTo&includeMemberBreakdown=1`        | Month total, count, expense list, member table                                               |
| `balances` (unfiltered, already fetched by the group page) | Running balance in the header, settle-up debts (running simplified debts, expense-only lens) |

Monthly views aggregate **expenses only** — settlements are never month-attributed (`Settlement` has no `date`, only `createdAt`; see §3 of the V4 README). The "Settle {Month}?" prompt reads from the **running** simplified debts in the unfiltered balances response and simply links to the Balances tab; it is visible only when viewing a **past** month with non-empty running debts, and its copy must not imply the month itself is being closed.

### Labelling rules

Non-negotiable, because two similar-looking numbers sit on one screen:

- Monthly figures are always qualified by the month: "August total", "Your net in August".
- The running balance is the only number labelled "Your balance", and it lives in the header.
- No "Close month", no "Settled for August", no month-scoped figure styled as a balance.
- The end-of-month prompt reads "Settle August?" and links to the Balances tab — it settles the running balance, and its copy must not imply otherwise.

---

## 4. Out of scope for this spec

- Month-scoped balances or settlements, and `Settlement.date` (see V4 README §3).
- Configurable cycle start day; calendar months only.
- Multi-month comparison, trends, or charts.
- Recurring expense generation — Phase 3, and it needs a new collection.
