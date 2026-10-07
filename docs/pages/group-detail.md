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

The all-time balance, Settle up (the suggested payments, each with Record when the member is
one of the pair), Record payment on the page itself (#312), Everyone (#313) and Payments
(#312). See [balances.md](../features/balances.md) for details.

```
All-time balance  INR                      │ Record payment
  You owe ₹1,480.00                         │   From [You ▾] → To [Sam Chen ▾]
─────────────────                           │   Amount paid  INR [1060.00]  Suggested ₹1,060.00
Settle up                                   │   (paying more than suggested: warning + tick)
  You pay Sam Chen     ₹1,060.00  [Record]  │   After this payment: You owe ₹420.00 …
  You pay Priya Shah     ₹420.00  [Record]  │   Note, optional
Everyone          [Chart | Table]           │   [Record payment ₹1,060.00]
  Owes ■  Gets back ■
  Sam Chen          │███████      +₹1,060.00 gets back
  Priya Shah        │███            +₹420.00 gets back
  You       ████████│             −₹1,480.00 owes
               −₹1.5K   0   +₹1.5K
  (Table: Member · All-time net · Position · Settled by, "Pays Sam ₹1,060.00 and Priya ₹420.00")
─────────────────
Payments: date and time · from → to · amount · note · recorded by
```

On one column (a phone), Record payment comes straight after Settle up. Record on a suggested
payment fills the form in and moves focus to its amount.

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
/groups/abc123/balances?paidTo=<id>     → Balances, Record payment filled in: you pay them (Home's Record)
/groups/abc123/balances?paidBy=<id>     → Balances, Record payment filled in: they pay you
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
- `QuickAddExpense` (Expenses tab, above the list's toolbar: Quick add, #320)
- `ExpenseListView` (Expenses tab)
- `BalancesView` (Balances tab — balances _and_ simplified debts in one component)
- `ActivityView` (Activity tab)

Which header renders is decided by `theme.header`, and the month bar by
`theme.signature === 'monthCycle'` — never by switching on the raw category
string. See [`../v4/README.md`](../v4/README.md).
