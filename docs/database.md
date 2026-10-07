# Database Schema

All models use MongoDB via Mongoose. Timestamps (`createdAt`, `updatedAt`) are auto-managed.

> **Enforcement note.** This document distinguishes what the _schema_ enforces
> from what a _service_ enforces from what nothing enforces. Constraints marked
> **(service)** live in `src/lib/services/` and apply only to writes that go
> through the API; constraints marked **(unenforced)** are conventions that no
> code checks. See §Invariants at the end.

---

## User

Better Auth's user model (plural collection name) + app-specific fields.

```typescript
{
  _id: ObjectId,
  name: string,                       // Required, trimmed
  email: string,                      // Required, lowercased, unique
  image: string,                      // Optional avatar URL
  emailVerified: boolean,             // Better Auth field (Google reports verified emails)
  preferredCurrency: string,          // Default: "INR"
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**: `{ email: 1 }` (unique, named `users_email_uidx` — the name Better
Auth's adapter generates, declared on the Mongoose schema so both agree)

**Notes**:

- Better Auth creates users on their first Google sign-in and manages the
  `sessions`, `accounts`, `verifications` and `rateLimits` collections (below).
- We extend the `users` collection with `preferredCurrency` (also declared to
  Better Auth as an additional field with the same default).
- Demo-mode personas are ordinary `users` rows seeded by `pnpm web demo:seed`.

---

## Group

```typescript
{
  _id: ObjectId,
  name: string,                       // Required, 1-100 chars
  description: string,                // Optional, max 500
  image: string,                      // Optional group image URL
  createdBy: ObjectId (ref User),     // Group creator
  members: [{                         // Subdocument, _id: false
    user: ObjectId (ref User),
    role: "admin" | "member",         // Default: "member"; creator is admin
    joinedAt: Date
  }],
  tags: [{                            // Group-scoped expense labels
    _id: ObjectId,
    name: string,                     // Required, trimmed, max 50
    isArchived: boolean,              // Default: false
    createdAt: Date
  }],
  defaultCurrency: string,            // Required, e.g. "INR"
  alternateCurrencies: [string],      // Max 2 items — persisted but unused
  category: "trip" | "home" | "couple" | "work" | "other",   // Default: "other"
  startDate: Date | null,             // Default: null
  endDate: Date | null,               // Default: null
  isArchived: boolean,                // Default: false
  inviteCode: string | null,          // 8-char hex code for invite links
  inviteCodeExpiresAt: Date | null,   // Optional expiry
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:

- `{ "members.user": 1 }` — fast lookup of user's groups
- `{ createdBy: 1 }`
- `{ inviteCode: 1 }` — **unique partial**, `partialFilterExpression: { inviteCode: { $type: 'string' } }`

  Partial, **not sparse**: `inviteCode` has `default: null`, and a sparse unique
  index still indexes explicit nulls, so every null-coded group would collide on
  the second insert.

**Validation**:

- `name`: required, trimmed, 1-100 chars
- `alternateCurrencies`: max 2 items (schema); each must be a valid ISO 4217 code (Zod)
- `startDate` / `endDate`: end must not precede start (Zod `superRefine`)
- `members`: the array defaults to `[]` — "at least one member" is a **(service)**
  guarantee of `groupService.create`, not a schema validator

**Notes**:

- `category` is the group's **theme** key. It drives chrome, default tags, date
  semantics and whether recurring expenses are offered. Resolved through
  `packages/shared/src/group-themes.ts`; `"home"` displays as "Household". Note the default
  differs by entry point: the schema defaults to `"other"`, the create validator
  to `"trip"`.
- `tags` are seeded per theme on creation. `Expense.tag` references a tag by
  **name**, not by `_id` — see the caveat under [Expense](#expense).
- `alternateCurrencies` is modelled, validated and accepted by the API, but no
  read or write path consults it.

---

## Expense

```typescript
{
  _id: ObjectId,
  group: ObjectId (ref Group),        // Which group this belongs to
  description: string,                // Required, 1-200 chars
  amount: number,                     // Required, min 0.01, max 10,000,000
  currency: string,                   // Required — must equal group.defaultCurrency (service)
  category: string,                   // Default: "other"; free-form, not enum-checked
  date: Date,                         // When expense occurred (not createdAt)

  // Who paid
  paidBy: [{                          // Subdocument, _id: false; at least 1 entry
    user: ObjectId (ref User),
    amount: number                    // min 0 — sum is NOT checked (unenforced)
  }],

  // How to split
  splitMethod: "equal" | "unequal" | "percentage" | "shares" | "exact",
  splitBetween: [{                    // Subdocument, _id: false; at least 1 entry
    user: ObjectId (ref User),
    amount: number,                   // min 0 — sum is NOT checked (unenforced)
    percentage: number,               // Only for percentage split (optional)
    shares: number                    // Only for shares split (optional)
  }],

  tag: string,                        // Required — exactly one, by tag NAME
  predefinedItem: string | null,      // From predefined items list

  // Set when materialized from a recurring template
  recurringExpense: ObjectId | null,  // ref RecurringExpense, default: null
  period: string | null,              // "YYYY-MM", default: null

  receiptUrl: string | null,          // Modelled but unwritable — see note
  notes: string,                      // Optional, max 500

  createdBy: ObjectId (ref User),
  isDeleted: boolean,                 // Soft delete, default: false
  deletedAt: Date | null,
  deletedBy: ObjectId (ref User) | null,

  // Audit trail for edits
  editHistory: [{                     // Subdocument, _id: false
    editedBy: ObjectId (ref User),
    editedAt: Date,
    changes: object                   // { field: { old, new } }
  }],

  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:

- `{ group: 1, date: -1 }` — list expenses by date
- `{ group: 1, isDeleted: 1 }` — filter out deleted
- `{ group: 1, tag: 1 }` — filter by tag
- `{ group: 1, category: 1 }` — filter by category
- `{ description: "text" }` — **declared but unused**: expense search runs as
  `$regex` with `$options: 'i'`, which cannot use a text index
- `{ recurringExpense: 1, period: 1 }` — **unique partial**,
  `partialFilterExpression: { recurringExpense: { $type: 'objectId' } }`

  Guarantees one expense per (template, period) so recurring generation is
  idempotent under concurrent readers. Partial for the same reason as
  `Group.inviteCode`: most expenses have `recurringExpense: null`.

**Validation**:

- `amount`: 0.01 – 10,000,000 (schema)
- `paidBy`: at least 1 entry (schema)
- `splitBetween`: at least 1 entry (schema)
- `tag`: required, and must name a currently **active** tag on the group **(service)**
- `currency`: must equal `group.defaultCurrency` **(service)** — 422 `CURRENCY_MISMATCH`
- all users in `paidBy` and `splitBetween` must be group members **(service)**
- `paidBy` amounts sum to `amount` — **(unenforced)**
- `splitBetween` amounts sum to `amount` — **(unenforced)**
- `percentage` values sum to 100 — **(unenforced)**

**Notes**:

- **`tag` is a single required string, not an array.** It stores the tag's
  _name_. Renaming a group tag rewrites only the `Group.tags` subdocument, so
  historical expenses keep pointing at the previous name.
- **`receiptUrl` cannot be set through the API.** It is absent from both
  `createExpenseSchema` and `updateExpenseSchema`, and Zod strips unrecognized
  keys, so no request can populate it — despite `ExpenseDetails` linking to it.
- Deletion is soft (`isDeleted`), and `PATCH` with `isDeleted: false` restores.
  Balance and summary queries filter on `isDeleted: false`.

---

## RecurringExpense

Templates that materialize monthly expenses. **Household groups only**
(`Group.category === "home"`), admin-managed.

```typescript
{
  _id: ObjectId,
  group: ObjectId (ref Group),
  description: string,                // Required, 1-200 chars
  amount: number,                     // Required, min 0.01, max 10,000,000
  currency: string,                   // Must equal group.defaultCurrency (service)
  category: string,                   // Default: "other"
  tag: string,                        // Required, must be an active group tag (service)
  paidBy: [{ user, amount }],         // Same shape as Expense
  splitMethod: "equal" | "unequal" | "percentage" | "shares" | "exact",
  splitBetween: [{ user, amount, percentage?, shares? }],
  dayOfMonth: number,                 // 1-31; clamped to last day of short months
  startsOn: Date,                     // Required
  endsOn: Date | null,                // Default: null; must not precede startsOn
  isPaused: boolean,                  // Default: false
  lastGeneratedFor: string | null,    // "YYYY-MM"; advanced monotonically via $max
  createdBy: ObjectId (ref User),
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**: `{ group: 1 }`

**Generation model** — lazy on read. `generateDueExpenses` runs from
`GET /api/groups/[id]`, `GET /api/groups/[id]/expenses` and
`GET /api/groups/[id]/balances`, after the membership check. Leaving a Group
(`POST /api/groups/[id]/leave`) runs the same generation before its settle-up
check, through `materializeDueExpenses`, which also reports whether the run
finished; the leave is refused when it didn't. Safety rests on four things:

1. the unique partial index on `Expense.{recurringExpense, period}`,
2. duplicate-key errors being absorbed as "a concurrent reader already did this",
3. `lastGeneratedFor` advancing only through the unbroken materialized prefix, via `$max`,
4. templates that no longer validate against group state being **skipped
   silently** without advancing their marker.

An **archived Group generates nothing**: every caller (the three reads, leaving,
and creating or updating a template) gets `generated: 0`, and generation moves
no template's `lastGeneratedFor` in an archived Group. Resuming a paused template
through `update()` still advances its marker past the paused months, as it does
in any Group. Nothing is lost while it is archived; if it were ever un-archived,
the next read would catch up the missed periods, as a template whose Tag was
archived and then restored does.

Deleting a template never touches the expenses it already generated; those are
ordinary expenses. Edits apply to future periods only.

**While recurring Expenses are switched off** (`RECURRING_EXPENSES_ENABLED` is
not `true`, the default since #289), generation adds nothing in any Group and
changes no template; it only records the switch as off in
[`ProductSwitch`](#productswitch). The first run that finds the switch on again
records when; templates created before then generate no period before that
month, so the months it was off are never back-filled.

> The index is created by Mongoose `autoIndex`, which is asynchronous and not
> awaited. The integration suite forces `Expense.createIndexes()` first;
> production does not.

---

## ProductSwitch

What the server last saw of a product switch, kept so it survives deployments.
The switch itself is an environment variable; this collection only remembers
that it was off for a while. One document per switch (#289).

```typescript
{
  _id: "recurringExpenses",           // The switch's name
  enabled: boolean,                   // As the server last saw it
  since: Date                         // When that was first seen
}
```

**Indexes**: none beyond `_id`.

The recurring generation run writes it: `enabled: false` the first time it finds
`RECURRING_EXPENSES_ENABLED` off, then `enabled: true` and `since` the first time
it finds it on again. Generation reads `since` as the month existing templates
resume from. A database that has never seen the switch off has no document.

**Access:** the application's database user needs `find`, `insert`, `update` and
`createCollection` on `productswitches`. `readWrite` on the database covers it;
a custom role granted per collection must add it. While it can't be read, the
switch on, a Group with recurring templates generates nothing and reports the
run unfinished, so leaving it is refused until a read works; Groups without
templates are unaffected.

---

## Settlement

```typescript
{
  _id: ObjectId,
  group: ObjectId (ref Group),
  paidBy: ObjectId (ref User),        // Person who paid to settle
  paidTo: ObjectId (ref User),        // Person who received the payment
  amount: number,                     // Required, min 0.01
  currency: string,                   // Must equal group.defaultCurrency (service)
  note: string,                       // Optional, max 500
  createdBy: ObjectId (ref User),     // Who recorded this settlement
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:

- `{ group: 1, createdAt: -1 }`
- `{ group: 1, paidBy: 1 }`
- `{ group: 1, paidTo: 1 }`

**Validation** — all **(service)**: payer and recipient must both be members and
must differ; only the payer or the recipient may record the settlement
(`FORBIDDEN_SETTLEMENT`).

**Note**: there is **no `date` field**. A settlement is timestamped by
`createdAt` only, so it cannot be back-dated or attributed to an earlier month.
This is the reason monthly views are read-only lenses rather than ledger
boundaries — see [`v4/README.md`](v4/README.md) §3.

---

## Activity

```typescript
{
  _id: ObjectId,
  group: ObjectId (ref Group),
  type: "expense_added" | "expense_updated" | "expense_deleted"
      | "settlement_recorded"
      | "member_joined" | "member_left"
      | "group_created" | "group_updated",
  actor: ObjectId (ref User),         // Who performed the action
  metadata: {
    // Flexible based on type — what the code actually writes:
    // expense_added:    { expenseId, description, amount, currency }
    //                   plus { recurring: true, recurringExpenseId, period }
    //                   when generated from a template
    // expense_updated:  { expenseId, changes: { field: { old, new } } }
    // expense_deleted:  { expenseId, description }
    // settlement:       { settlementId, paidTo, amount, currency }
    // member_joined:    { userId, method: "invite" | "link" }
    //                   — via invitation accept, only { method: "invite" }
    // member_left:      { userId, method }
    // group_created:    { groupName }
    // group_updated:    { changes: { field: { old, new } } }
  },
  createdAt: Date                     // updatedAt disabled
}
```

**Indexes**:

- `{ group: 1, createdAt: -1 }` — paginated activity feed

**Notes**:

- Activity records are append-only, never updated or deleted.
- **Names are not denormalized.** Member events store `userId` only; the feed
  resolves display names by populating `actor` and by looking members up in the
  group.
- Logging is on the critical path — every mutation `await`s the write, and there
  are no transactions anywhere in the codebase, so a logging failure fails the
  request _after_ the primary write has committed.

---

## Invitation

```typescript
{
  _id: ObjectId,
  group: ObjectId (ref Group),
  invitedBy: ObjectId (ref User),
  invitedEmail: string,               // Required, lowercased
  status: "pending" | "accepted" | "declined" | "expired",  // Default: "pending"
  token: string,                      // Required, unique — generated, never read
  expiresAt: Date,                    // Required
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:

- `{ token: 1 }` (unique)
- `{ invitedEmail: 1, group: 1 }` — non-unique; does **not** prevent duplicate invites
- `{ status: 1, expiresAt: 1 }` — for expiry sweeps (no sweep job exists)

**Note**: `token` is generated but no route accepts it. Accept and decline are
keyed on the invitation `_id` plus a match against the caller's email; a
mismatch returns 404 rather than 403.

---

## Model registration

Two patterns coexist. `Settlement`, `Activity`, `Invitation`, `ProductSwitch` and `User` use the
conventional `mongoose.models.X || mongoose.model(...)` guard. `Group`,
`Expense` and `RecurringExpense` instead `deleteModel` and re-register so schema
edits are picked up across hot reloads — **note the accompanying comment says
"in development" but the code has no `NODE_ENV` guard and runs everywhere.**

---

## Invariants

| Invariant                                                  | Enforced by                            |
| ---------------------------------------------------------- | -------------------------------------- |
| Expense/settlement currency equals `group.defaultCurrency` | service (422)                          |
| All participants are group members                         | service (422)                          |
| `tag` names an active group tag                            | service (422)                          |
| Only payer or recipient records a settlement               | service (422)                          |
| One expense per (template, period)                         | unique partial index                   |
| One group per invite code                                  | unique partial index                   |
| Recurring writes are admin-only, Household-only            | service (403 / 422)                    |
| No recurring writes or generation while switched off       | route and service (409)                |
| Expense edit/delete restricted to creator or admin         | **nothing** — any member may           |
| Expense scoped to the group in the URL                     | **nothing** — resolved by `_id` alone  |
| `sum(paidBy.amount) == amount`                             | **nothing** — client dialogs only      |
| `sum(splitBetween.amount) == amount`                       | **nothing** — client dialogs only      |
| Percentages sum to 100                                     | **nothing** — client dialogs only      |
| Tag names unique within a group                            | read-then-write check, no index (racy) |

---

## Relationships Diagram

```
User ──────── creates ──────── Group
  │                              │
  │ (member of)                  │ (has many)
  │                              │
  ├──── Expense ◄────────────────┤
  │       ▲   (paidBy, splitBetween)
  │       │                      │
  │       └── generates ── RecurringExpense
  │                              │
  ├──── Settlement ◄─────────────┤
  │     (paidBy, paidTo)         │
  │                              │
  ├──── Activity ◄───────────────┤
  │     (actor)                  │
  │                              │
  └──── Invitation ◄─────────────┘
        (invitedBy, invitedEmail)
```

Tags are not a collection — they are a subdocument array on `Group`.

---

## Better Auth Collections (Auto-managed)

Better Auth's MongoDB adapter (plural names, ObjectId ids, indexes created on
first write) manages:

- **users** — User records (we extend this with `preferredCurrency`)
- **sessions** — `{ userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt }`;
  30-day database sessions, refreshed after a day of use
- **accounts** — `{ userId, providerId: 'google', accountId (Google subject), tokens… }`
- **verifications** — OAuth state during a redirect flow
- **rateLimits** — `{ key, count, lastRequest }` counters (rate limiting is
  stored in the database)

`accounts_authjs_backup` holds the Auth.js account rows parked by
`pnpm web migrate:auth` until the cleanup ticket drops it.
