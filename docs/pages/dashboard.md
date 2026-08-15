# Page: Dashboard

**Route**: `/dashboard`
**Auth**: Required

---

## Purpose

The main home page after login. Shows an overview of the user's groups, overall balance, and pending invitations.

---

## Layout

```
┌──────────────────────────────────────────────────────────┐
│ Sidebar │  Dashboard                                     │
│         │                                                │
│         │  Good morning, John! 👋                        │
│         │                                                │
│         │  ── Your Balance ──                            │
│         │  ┌────────────────────────────────────────┐   │
│         │  │ 🟢 Overall: You are owed               │   │
│         │  │                                        │   │
│         │  │ Europe Trip:    +€50.00                │   │
│         │  │ Home Expenses:  -₹1,200.00            │   │
│         │  │ Work Lunch:     +₹150.00              │   │
│         │  └────────────────────────────────────────┘   │
│         │                                                │
│         │  ── Pending Invitations (1) ──                 │
│         │  ┌────────────────────────────────────────┐   │
│         │  │ 📩 "Weekend Trip" by Jane              │   │
│         │  │ [Accept]  [Decline]                    │   │
│         │  └────────────────────────────────────────┘   │
│         │                                                │
│         │  ── Your Groups ──              [+ New Group]  │
│         │  ┌──────────────┐ ┌──────────────┐           │
│         │  │ ✈️ Europe     │ │ 🏠 Home      │           │
│         │  │ Trip 2026    │ │ Expenses     │           │
│         │  │ 3 members    │ │ 4 members    │           │
│         │  │ +€50.00      │ │ -₹1,200.00  │           │
│         │  └──────────────┘ └──────────────┘           │
│         │  ┌──────────────┐                             │
│         │  │ 💼 Work       │                             │
│         │  │ Lunch        │                             │
│         │  │ 6 members    │                             │
│         │  │ +₹150.00    │                             │
│         │  └──────────────┘                             │
│         │                                                │
└─────────┴────────────────────────────────────────────────┘
```

---

## Sections

### 1. Greeting

- "Good morning/afternoon/evening, {firstName}!"
- Based on local time

### 2. Overall Balance

- Summary of net balance per group
- Colored: green for positive (owed), red for negative (owes)
- Grouped by currency (since groups can have different currencies)

### 3. Pending Invitations

- Show if user has any pending group invitations
- Accept/decline buttons inline
- Badge count in sidebar nav item

### 4. Your Groups

- Grid of group cards
- Each card shows: category icon, group name, member count, user's balance
- Click → navigate to group detail page
- "New Group" button to create a group

There is no archived-groups toggle: `GET /api/groups` accepts no query params and
returns all of the user's groups.

---

## Data Fetching

`DashboardView` is a **client component** driven by three SWR calls, not a server
component with pre-fetched props:

```typescript
// src/components/dashboard/DashboardView.tsx
const { data: groups } = useSWR('/api/groups', fetcher, { refreshInterval: 30_000 });
const { data: balances } = useSWR('/api/user/balances', fetcher, { refreshInterval: 30_000 });
const { data: invitations } = useSWR('/api/invitations', fetcher, { refreshInterval: 30_000 });
```

(The service method for pending invitations is `getPendingByEmail`, not
`getPendingInvitations`.)

---

## Empty States

| State          | Message                                          |
| -------------- | ------------------------------------------------ |
| No groups      | "You haven't joined any groups yet. Create one!" |
| No invitations | Section hidden (not shown at all)                |
| All settled    | "All settled up! 🎉"                             |

---

## Components Used

- `DashboardView` — the whole page (client component)
- `GroupCard` — Group grid cards; branches on the group's theme
- `InvitationCard` — Pending invitation card with accept/decline
- `MoneyText` — Balance figures
- `Sidebar` — Navigation sidebar
- `Navbar` — Top navigation bar

There are no `BalanceSummary` or `EmptyState` components — balances are rendered
inline by `DashboardView`, and empty states are inline JSX.
