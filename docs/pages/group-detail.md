# Page: Group Detail

**Route**: `/groups/[id]`
**Auth**: Required (must be group member)

---

## Purpose

The main page for interacting with a group. Uses tabs to switch between Expenses, Balances, and Activity views.

---

## Layout

```
┌──────────────────────────────────────────────────────────┐
│ Sidebar │  [← Groups]  Europe Trip 2026      [⚙ Settings]│
│         │  ✈️ Trip · 3 members                           │
│         │  👤👤👤 John, Jane, Bob                        │
│         │                                                │
│         │  ┌──────────┬──────────┬──────────┐            │
│         │  │ Expenses │ Balances │ Activity │            │
│         │  └──────────┴──────────┴──────────┘            │
│         │                                                │
│         │  ┌──────────────────────────────────────────┐  │
│         │  │                                          │  │
│         │  │  Active tab content renders here         │  │
│         │  │  (see below for each tab)                │  │
│         │  │                                          │  │
│         │  └──────────────────────────────────────────┘  │
└─────────┴────────────────────────────────────────────────┘
  Add expense is the top bar's button (#304), on every tab.
```

---

## Tab: Expenses (Default)

The Expenses as a table on computers and cards on phones (#310), with the
view kept in the address. See [`docs/ui.md`](../ui.md) for the parameters.

```
Month bar (Household): ‹ September 2026 ›  [This month] [All time]
                       Spent · Your share · You paid · Expenses
Toolbar: [Search Maple House] [Paid by] [Tag] [Amount] [Involves me]
         [Date] (not in a Household) [Newest first]
Table:   Date | Description + Tag | Paid by | Split | Amount | You
         (phones: one card per Expense, under day headings)
```

---

## Tab: Balances

Balance summary + simplified debts. See [balances.md](../features/balances.md) for details.

```
Your balance: +€50.00 (owed)
─────────────────
Member balances:
  John:  +€50.00
  Jane:  -€30.00
  Bob:   -€20.00

Simplified debts (2 payments):
  Jane → John: €30.00  [Settle Up]
  Bob  → John: €20.00  [Settle Up]
```

---

## Tab: Activity

Chronological activity feed. See [activity-feed.md](../features/activity-feed.md) for details.

```
Today
● John added "Dinner at restaurant" €120.00 — 10:30 PM
● Jane paid John €30.00 — 9:15 PM

Yesterday
● Bob added "Taxi to airport" €45.00 — 3:20 PM
```

`ActivityView` fetches a single page of 50 and renders it — there is no Load More
control, despite the endpoint supporting pagination.

---

## Group Header

Shows at the top of all tabs:

- **Back button**: Navigate to groups list
- **Group name**: Large title
- **Category badge**: Icon + label (e.g. ✈️ Trip)
- **Member count + avatars**: Overlapping avatar stack
- **Settings icon**: Link to group settings (for admins, visible to all but settings page enforces permissions)

---

## Add expense

- The top bar's primary Add expense (#304), an icon button on phones, opens
  this Group's form on every tab and on its settings; the page has no button
  of its own
- The trip checklist's Add expense, the empty Expense list's "Add first
  expense" and the old `?action=add-expense` link open the same form
- See [add-expense.md](./add-expense.md) for the form spec

---

## URL Structure

```
/groups/abc123                          → redirects to /groups/abc123/expenses
/groups/abc123/expenses                 → Expenses tab
/groups/abc123/balances                 → Balances tab
/groups/abc123/activity                 → Activity tab
/groups/abc123/members                  → Members tab (read-only roster)
/groups/abc123?tab=balances             → old link: redirects to /balances
/groups/abc123?action=add-expense       → old link: Expenses, with the form open
```

Each tab is its own route (#305), so deep links, reload and Back work. Insights
joins the tabs with #314.

---

## Access Control

- Only group members can view this page
- Non-members get redirected to `/dashboard` with error toast
- Check membership in the page's server component:

```typescript
const group = await groupService.getGroup(params.id);
const isMember = group.members.some((m) => m.user.toString() === session.user.id);
if (!isMember) redirect('/dashboard');
```

---

## Data Fetching Strategy

- **Group info**: Server-side (for initial render + SEO)
- **Expenses**: Client-side with SWR (for filtering, pagination, real-time)
- **Balances**: Client-side with SWR (auto-refresh)
- **Activity**: Client-side with SWR (paginated)

---

## Components Used

- `GroupDetailView` — owns the tabs and the theme branch
- `TripStrip` (trip theme) **or** `GroupHeader` (all other themes)
- `MonthCycleBar` + `MonthMemberTable` (Household theme only)
- MUI `Tabs` for tab navigation
- `ExpenseListView` (Expenses tab)
- `BalancesView` (Balances tab — balances _and_ simplified debts in one component)
- `ActivityView` (Activity tab)

Which header renders is decided by `theme.header`, and the month bar by
`theme.signature === 'monthCycle'` — never by switching on the raw category
string. See [`../v4/README.md`](../v4/README.md).
