# Feature: Groups

## Overview

Groups are the core organizing unit. Every expense, settlement, and activity belongs to a group. A user can be in multiple groups, and each group has its own currency settings, members, and balances.

---

## User Stories

1. **As a user**, I can create a new group with a name, description, category, and currency settings.
2. **As a group admin**, I can edit group details (name, description, currencies, category).
3. **As a group admin**, I can archive a group (soft delete — no more new expenses, but data preserved).
4. **As a user**, I can see all my groups on the groups page.
5. **As a user**, I can view a group's detail page with expenses, balances, and activity.

---

## Group Categories

| Category | Icon | Use Case               |
| -------- | ---- | ---------------------- |
| trip     | ✈️   | Vacation / travel      |
| home     | 🏠   | Roommates / household  |
| couple   | 💑   | Partner expenses       |
| work     | 💼   | Work-related splitting |
| other    | 📋   | Everything else        |

---

## Create Group Flow

```
1. User clicks "+ New Group" button
2. Form opens with:
   - Name (required)
   - Description (optional)
   - Category selector (radio/chips)
   - Default currency (dropdown, defaults to user's preferred currency)
   - Alternate currencies (up to 2, optional dropdown)
3. User submits → API creates group → User becomes admin member
4. Redirect to group detail page
5. Activity logged: "group_created"
```

---

## Group Detail Page Layout

```
┌─────────────────────────────────────────────┐
│ [← Back]  Group Name            [⚙ Settings]│
│ Category badge   3 members                   │
├──────────────────────────────────────────────┤
│ [Expenses] [Balances] [Activity]    ← Tabs   │
├──────────────────────────────────────────────┤
│                                              │
│  Tab content renders here                    │
│                                              │
└──────────────────────────────────────────────┘
```

### Tabs:

- **Expenses** (default): Expense list with filters + "Add Expense" FAB
- **Balances**: Balance summary + simplified debts + "Settle Up" button
- **Activity**: Chronological activity feed

---

## Group Settings Page

Only accessible to group admins.

```
- Edit name, description
- Change category
- Update default currency
- Update alternate currencies
- View/manage members (remove member, change role)
- Generate/revoke invite link
- Archive group (with confirmation dialog)
```

---

## Roles & Permissions

| Action               | Admin | Member |
| -------------------- | ----- | ------ |
| View group           | ✅    | ✅     |
| Add expense          | ✅    | ✅     |
| Edit own expense     | ✅    | ✅     |
| Delete own expense   | ✅    | ✅     |
| Edit others' expense | ✅    | ❌     |
| Delete others' exp.  | ✅    | ❌     |
| Record settlement    | ✅    | ✅     |
| Edit group settings  | ✅    | ❌     |
| Invite members       | ✅    | ✅     |
| Remove members       | ✅    | ❌     |
| Archive group        | ✅    | ❌     |

---

## API Endpoints

See [api.md](../api.md#groups) for full endpoint documentation.

---

## Edge Cases

- Creator cannot leave group unless they transfer admin to someone else
- Cannot archive group if there are unsettled balances (show warning, allow override)
- Group name must be unique per user (prevent confusion)
- Deleting last admin → must promote another member first
- Max group members: 50 (reasonable limit)
- Archived groups appear in a separate "Archived" section
