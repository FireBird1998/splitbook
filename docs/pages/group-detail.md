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
│         │                                                │
│         │                              [+ Add Expense]   │
│         │                              (FAB button)      │
└─────────┴────────────────────────────────────────────────┘
```

---

## Tab: Expenses (Default)

Full expense dashboard with filters. See [dashboard.md](../features/dashboard.md) for details.

```
Quick Filters: [All] [This Week] [Last Week] [This Month] ...
Advanced Filters: Date range, category, tags, search
Expense list: Paginated, grouped by date
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

## Add Expense FAB

- Floating action button in bottom-right corner
- Always visible regardless of active tab
- Opens expense form modal (desktop) or full-page (mobile)
- See [add-expense.md](./add-expense.md) for the form spec

---

## URL Structure

```
/groups/abc123                          → Expenses tab (default)
/groups/abc123?tab=balances             → Balances tab
/groups/abc123?tab=activity             → Activity tab
/groups/abc123?quickFilter=thisWeek     → Expenses with filter
```

Tab state stored in URL for deep linking and back-button support.

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
- `BalancesView` (Balances tab — balances *and* simplified debts in one component)
- `ActivityView` (Activity tab)
- MUI `Fab` for add expense button

Which header renders is decided by `theme.header`, and the month bar by
`theme.signature === 'monthCycle'` — never by switching on the raw category
string. See [`../v4/README.md`](../v4/README.md).
