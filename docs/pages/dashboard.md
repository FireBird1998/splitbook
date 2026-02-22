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
- Show archived groups behind a toggle (collapsed by default)

---

## Data Fetching

```typescript
// Server component
export default async function DashboardPage() {
  const session = await auth();

  // Parallel data fetching
  const [groups, balances, invitations] = await Promise.all([
    groupService.getUserGroups(session.user.id),
    balanceService.getUserBalances(session.user.id),
    invitationService.getPendingInvitations(session.user.email),
  ]);

  return <DashboardView groups={groups} balances={balances} invitations={invitations} />;
}
```

---

## Empty States

| State          | Message                                          |
| -------------- | ------------------------------------------------ |
| No groups      | "You haven't joined any groups yet. Create one!" |
| No invitations | Section hidden (not shown at all)                |
| All settled    | "All settled up! 🎉"                             |

---

## Components Used

- `GroupCard` — Group grid cards
- `BalanceSummary` — Overall balance display
- `InviteCard` — Pending invitation card with accept/decline
- `EmptyState` — For no-groups state
- `Sidebar` — Navigation sidebar
- `Navbar` — Top navigation bar
