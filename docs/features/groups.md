# Feature: Groups

## Overview

Groups are the core organizing unit. Every expense, settlement, and activity belongs to a group. A user can be in multiple groups, and each group has its own currency settings, members, and balances.

---

## User Stories

1. **As a user**, I can create a new group with a name, description, category, and currency settings.
2. **As a group admin**, I can edit group details (name, description, category), change the main currency until money is recorded, and remove an extra currency nothing uses. Any member can add an extra currency, up to 4 (#721).
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
   - Main currency (dropdown, defaults to user's preferred currency; locked once money is recorded)
   - A Trip only: "Spending abroad?", its extra currencies (optional, up to 4, never the main
     currency). Other themes add them later in the Group's settings (#723)
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

Admins see everything below. Members see the Currencies section, where they can add an
extra currency, and Tags and Leave Group.

```
- Edit name, description
- Change category
- Change the main currency, until money is recorded (then it shows as Locked)
- Remove an extra currency nothing uses; one still in use is refused with what uses it
- View/manage members (remove member, change role)
- Generate/revoke invite link
- Archive group (with confirmation dialog)
```

---

## Roles & Permissions

This table reflects **what the code enforces today**, which is not the same as
what it ideally should.

| Action               | Admin | Member | Enforced where          |
| -------------------- | ----- | ------ | ----------------------- |
| View group           | ✅    | ✅     | `isMember`              |
| Add expense          | ✅    | ✅     | `isMember`              |
| Edit own expense     | ✅    | ✅     | `isMember`              |
| Delete own expense   | ✅    | ✅     | `isMember`              |
| Edit others' expense | ✅    | ✅ ⚠️  | **nothing**             |
| Delete others' exp.  | ✅    | ✅ ⚠️  | **nothing**             |
| Record settlement    | ✅    | ✅     | payer or recipient only |
| Edit group settings  | ✅    | ❌     | `assertAdmin`           |
| Manage tags          | ✅    | ❌     | `assertAdmin`           |
| Manage recurring     | ✅    | ❌     | `assertAdmin`           |
| Invite members       | ✅    | ✅     | `isMember`              |
| Generate invite link | ✅    | ✅     | `isMember`              |
| Remove members       | ✅    | ❌     | `assertAdmin`           |
| Change member roles  | ✅    | ❌     | `assertAdmin`           |
| Archive group        | ✅    | ❌     | `assertAdmin`           |

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

- Leaving a Group (`POST /api/groups/[id]/leave`, web Group settings and Android
  Members and Group details): the member must be settled up in every currency,
  counting the recurring Expenses already due, which are added before the check
  (if adding them doesn't finish, the leave is refused with `LEAVE_CONFLICT`; a
  template in its problem state doesn't hold up the leave, and its missed periods
  are not generated for the departing member);
  the last admin must make someone else an admin first; the last member's leaving
  archives the Group
- Cannot demote or remove the last admin (**409** with the reason)
- Cannot remove yourself (**400**, pointing to leaving instead)
- An invite code resolves to at most one group (unique partial index)

**Not implemented** — described in earlier drafts, no code behind them:

- Blocking archive when balances are unsettled
- Group name uniqueness per user
- A maximum member count
- A separate "Archived" section — `GET /api/groups` takes no `archived` param
