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

This table reflects **what the code enforces today**, which is not the same as
what it ideally should.

| Action               | Admin | Member | Enforced where |
| -------------------- | ----- | ------ | -------------- |
| View group           | ✅    | ✅     | `isMember` |
| Add expense          | ✅    | ✅     | `isMember` |
| Edit own expense     | ✅    | ✅     | `isMember` |
| Delete own expense   | ✅    | ✅     | `isMember` |
| Edit others' expense | ✅    | ✅ ⚠️  | **nothing** |
| Delete others' exp.  | ✅    | ✅ ⚠️  | **nothing** |
| Record settlement    | ✅    | ✅     | payer or recipient only |
| Edit group settings  | ✅    | ❌     | `assertAdmin` |
| Manage tags          | ✅    | ❌     | `assertAdmin` |
| Manage recurring     | ✅    | ❌     | `assertAdmin` |
| Invite members       | ✅    | ✅     | `isMember` |
| Generate invite link | ✅    | ✅     | `isMember` |
| Remove members       | ✅    | ❌     | `assertAdmin` |
| Change member roles  | ✅    | ❌     | `assertAdmin` |
| Archive group        | ✅    | ❌     | `assertAdmin` |

> ⚠️ **Expense mutation is membership-gated only.** No route or service checks
> who created an expense, so any member can edit or delete any other member's
> expense in the group. Restricting this was noted as a future option in
> [`../v2/edit-expense.md`](../v2/edit-expense.md).

---

## API Endpoints

See [api.md](../api.md#groups) for full endpoint documentation.

---

## Edge Cases

Enforced today:

- Cannot demote or remove the last admin — but the error currently surfaces as a
  **500** with a generic message, not a clear 4xx
- Cannot remove yourself (same caveat)
- An invite code resolves to at most one group (unique partial index)

**Not implemented** — described in earlier drafts, no code behind them:

- Leave group — there is no leave endpoint at all, so "creator cannot leave
  unless they transfer admin" is moot
- Blocking archive when balances are unsettled
- Group name uniqueness per user
- A maximum member count
- A separate "Archived" section — `GET /api/groups` takes no `archived` param
