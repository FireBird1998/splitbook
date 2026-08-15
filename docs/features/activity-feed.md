# Feature: Activity Feed

## Overview

Every significant action in a group is logged as an activity. The activity feed provides a chronological timeline of everything that has happened, giving group members transparency and context.

---

## User Stories

1. **As a user**, I can see a timeline of all actions in the group.
2. **As a user**, I can see who did what and when.
3. **As a user**, I can click on an activity to see more details (e.g., navigate to the expense).

---

## Activity Types

| Type                  | Trigger                | Display Example                                                 |
| --------------------- | ---------------------- | --------------------------------------------------------------- |
| `expense_added`       | New expense created    | "**John** added **Dinner at restaurant** — €120.00"             |
| `expense_updated`     | Expense edited         | "**John** updated **Dinner at restaurant** — amount: €120→€130" |
| `expense_deleted`     | Expense soft deleted   | "**John** deleted **Dinner at restaurant**"                     |
| `settlement_recorded` | Settlement recorded    | "**Jane** paid **John** €30.00"                                 |
| `member_joined`       | New member joined      | "**Bob** joined the group via invite link"                      |
| `member_left`         | Member left or removed | "**Bob** left the group"                                        |
| `group_created`       | Group created          | "**John** created the group"                                    |
| `group_updated`       | Group settings changed | "**John** updated group name to **Summer Trip**"                |

---

## Activity Feed UI

```
┌──────────────────────────────────────────────────┐
│ Activity                                         │
├──────────────────────────────────────────────────┤
│                                                  │
│ Today                                            │
│ ●─ 🧾 John added "Dinner at restaurant" €120.00│
│ │     10:30 PM                                   │
│ │                                                │
│ ●─ 💰 Jane paid John €30.00                    │
│ │     9:15 PM · "Paid via UPI"                  │
│ │                                                │
│ Yesterday                                        │
│ ●─ 🧾 Bob added "Taxi to airport" €45.00       │
│ │     3:20 PM                                    │
│ │                                                │
│ ●─ ✏️ John updated "Hotel booking"              │
│ │     amount: €200 → €220                       │
│ │     1:00 PM                                    │
│ │                                                │
│ Feb 8                                            │
│ ●─ 👤 Bob joined the group via invite link      │
│ │     11:00 AM                                   │
│ │                                                │
│ ●─ 🎉 John created the group                   │
│       10:00 AM                                   │
│                                                  │
│           [Load More]                            │
└──────────────────────────────────────────────────┘
```

---

## Activity Item Component

Each activity item includes:

- **Icon**: Based on activity type
- **Actor avatar + name**: Who performed the action
- **Description**: Human-readable summary of what happened
- **Timestamp**: Relative time (e.g., "2 hours ago") or absolute date
- **Metadata**: Additional details (amount, changes, etc.)
- **Clickable**: Expense activities link to the expense detail

### Icons per Type

```typescript
const ACTIVITY_ICONS = {
  expense_added: '🧾',
  expense_updated: '✏️',
  expense_deleted: '🗑️',
  settlement_recorded: '💰',
  member_joined: '👤',
  member_left: '👋',
  group_created: '🎉',
  group_updated: '⚙️',
};
```

---

## Generating Activities

Activities are created by the **service layer**, not the API route directly.

```typescript
// In expense.service.ts
async createExpense(data, userId) {
  const expense = await Expense.create(data);

  // Log activity
  await Activity.create({
    group: data.group,
    type: "expense_added",
    actor: userId,
    metadata: {
      expenseId: expense._id,
      description: expense.description,
      amount: expense.amount,
      currency: expense.currency,
    },
  });

  return expense;
}
```

---

## Pagination

- Default: 20 items per page
- **Not implemented.** The endpoint paginates (`?page=&limit=`), but
  `ActivityView` requests `page=1&limit=50` once and renders the result — there
  is no Load More button and no infinite scroll.
- Sorted by `createdAt` descending (newest first)
- Grouped by date in the UI (Today, Yesterday, Feb 8, etc.)

---

## API Endpoints

See [api.md](../api.md#activity-feed) for full documentation.

---

## Performance

- Activity collection is append-only → good for performance
- Index on `{ group: 1, createdAt: -1 }` for fast paginated queries
- Expense and settlement metadata **is** denormalized (description, amount and
  currency are stored inline), so that text stays accurate even if the expense is
  later edited or deleted
- Member events are **not** — `member_joined` / `member_left` store `userId` and
  `method` only, with no `userName`. Display names come from populating `actor`
  and from the group's member list
- Logging is synchronous and on the critical path: every mutation awaits the
  activity write, and there are no transactions, so a failed log fails the
  request after the primary write has already committed

---

## Edge Cases

- Deleted expense activity: Still shows in feed (with strikethrough or "deleted" label)
- Very old activity: Show full date instead of relative time (e.g., "Jan 1, 2026" vs "2 hours ago")
- Empty activity feed: Show "No activity yet" with friendly illustration
- Bulk actions: If 10 expenses are added at once, show 10 individual activities (not batched)
