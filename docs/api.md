# API Endpoints

All endpoints return JSON. Auth required unless marked 🔓 (public).

Standard response format:

```json
// Success
{ "data": { ... }, "status": 200 }

// Error
{ "error": "Human-readable message", "status": 400 }
```

Helpers in `src/lib/utils/api-response.ts` produce this shape. Two exceptions exist
today: the tag handlers hand-roll `new Response(JSON.stringify(...))` for their
`TAG_EXISTS` / `TAG_IN_USE` cases and omit the `status` field.

**Unauthenticated `/api/*` requests get `401` JSON, never a redirect.** Route
protection lives in the `authorized` callback (`src/lib/auth.config.ts`); for API
paths it answers `{ "error": "Unauthorized", "status": 401 }`, the same shape the
route helpers use, so browser and native clients can detect an expired session.
Pages still redirect to `/login?callbackUrl=…`. The web client's SWR `fetcher`
sends a 401 to `/login` with the current page as `callbackUrl`.

**Common status codes:** `401` unauthenticated (from a route's own `getAuthUser`
guard), `403` not a group member or not an admin, `404` not found, `422` Zod
validation failure or a service invariant (`CURRENCY_MISMATCH`, `INVALID_TAG`,
`INVALID_MEMBERS`, …).

---

## Auth

Handled entirely by Auth.js. No custom endpoints needed.

| Method | Path                      | Description       | Auth |
| ------ | ------------------------- | ----------------- | ---- |
| \*     | `/api/auth/[...nextauth]` | Auth.js catch-all | 🔓   |

Two providers are registered simultaneously — Google and a demo-persona
Credentials provider — and `AUTH_MODE` selects which the UI offers. See
[`auth.md`](auth.md).

---

## User

| Method | Path                 | Description                      |
| ------ | -------------------- | -------------------------------- |
| GET    | `/api/user/profile`  | Get current user                 |
| PATCH  | `/api/user/profile`  | Update profile                   |
| GET    | `/api/user/balances` | Cross-group balances by currency |

### GET /api/user/profile

**Response:**

```json
{
  "data": {
    "_id": "...",
    "name": "John Doe",
    "email": "john@gmail.com",
    "image": "https://...",
    "preferredCurrency": "INR"
  }
}
```

### PATCH /api/user/profile

**Body:**

```json
{
  "name": "John Doe",
  "preferredCurrency": "USD"
}
```

### GET /api/user/balances

No query params. Balances are bucketed **per currency and never summed across
currencies** (see [`features/currency.md`](features/currency.md)).

**Response:**

```json
{
  "data": {
    "buckets": [{ "currency": "EUR", "youOwe": 30.0, "youAreOwed": 80.0, "net": 50.0 }],
    "groups": [
      {
        "groupId": "...",
        "name": "Europe Trip 2026",
        "category": "trip",
        "updatedAt": "2026-02-10T19:30:00Z",
        "hasMixedCurrencies": false,
        "balances": [
          {
            "currency": "EUR",
            "balance": 50.0,
            "settlement": { "counterpartyId": "...", "counterpartyName": "Jane", "amount": 50.0 }
          }
        ]
      }
    ],
    "hasMixedCurrencies": false
  }
}
```

---

## Groups

| Method | Path               | Description                 |
| ------ | ------------------ | --------------------------- |
| POST   | `/api/groups`      | Create group                |
| GET    | `/api/groups`      | List user's groups          |
| GET    | `/api/groups/[id]` | Get group detail            |
| PATCH  | `/api/groups/[id]` | Update group                |
| DELETE | `/api/groups/[id]` | Archive group (soft delete) |

### POST /api/groups

**Body:**

```json
{
  "name": "Europe Trip 2026",
  "description": "Summer vacation expenses",
  "category": "trip",
  "defaultCurrency": "EUR",
  "alternateCurrencies": ["USD", "INR"],
  "startDate": "2026-06-01",
  "endDate": "2026-06-14"
}
```

`category` is one of `trip | home | couple | work | other` and **defaults to
`trip`** in the validator. It drives the group's theme — chrome, default tags,
date semantics, and whether recurring expenses are available. See
[`../packages/shared/src/group-themes.ts`](../packages/shared/src/group-themes.ts) and
[`v4/README.md`](v4/README.md).

`alternateCurrencies` accepts up to 2 codes and is persisted, but **no read or
write path currently consults it**. `startDate` / `endDate` are validated
together (end must not precede start).

Creating a group seeds theme-appropriate default tags.

### GET /api/groups

**No query params.** The handler takes no `Request` argument, so any query
string is ignored — there is no archived filter.

**Response:**

```json
{
  "data": [
    {
      "_id": "...",
      "name": "Europe Trip 2026",
      "members": [
        {
          "user": { "_id": "...", "name": "John", "image": "..." },
          "role": "admin"
        }
      ],
      "tags": [{ "_id": "...", "name": "Food", "isArchived": false }],
      "defaultCurrency": "EUR",
      "category": "trip",
      "isArchived": false
    }
  ]
}
```

No balance is included — use `GET /api/user/balances` for that.

### GET /api/groups/[id]

Returns the populated group. **Side effect:** this handler calls
`recurringExpenseService.generateDueExpenses` before responding, so a read can
create expenses (see [Recurring expenses](#recurring-expenses)).

### PATCH /api/groups/[id]

**Body (partial update):**

```json
{
  "name": "New Group Name",
  "defaultCurrency": "USD",
  "alternateCurrencies": ["EUR"]
}
```

**Authorization:** Only group admins can update.

---

## Members

| Method | Path                                | Description        |
| ------ | ----------------------------------- | ------------------ |
| PATCH  | `/api/groups/[id]/members/[userId]` | Change member role |
| DELETE | `/api/groups/[id]/members/[userId]` | Remove from group  |

Both are admin-only. **Body** for PATCH is `{ "role": "admin" | "member" }`.

Three user-error cases — demoting the last admin, removing the last admin, and
removing yourself — currently return **500** with the generic
`"Internal server error"` body, because they are routed through `serverError`.
The intended explanation never reaches the client. There is no leave-group
endpoint.

---

## Tags

| Method | Path                            | Description                 |
| ------ | ------------------------------- | --------------------------- |
| POST   | `/api/groups/[id]/tags`         | Create tag                  |
| PATCH  | `/api/groups/[id]/tags/[tagId]` | Rename or archive/unarchive |
| DELETE | `/api/groups/[id]/tags/[tagId]` | Delete (only if unused)     |

All admin-only. A tag is a group-scoped label; every expense carries **exactly
one, required**. See [`v3/tag-management.md`](v3/tag-management.md).

**POST body:** `{ "name": "Groceries" }` (1–50 chars)
**PATCH body:** `{ "name"?: string, "isArchived"?: boolean }`

Duplicate names return **400** `A tag with this name already exists`; deleting a
tag still referenced by expenses returns **400** with the usage count. Both of
these responses omit the standard `status` field.

Note that `Expense.tag` stores the tag **name**, not the tag id, so renaming a
tag leaves historical expenses pointing at the old name.

---

## Invitations

Two independent mechanisms: per-email invitations, and a shared invite link.

| Method | Path                           | Description             | Auth |
| ------ | ------------------------------ | ----------------------- | ---- |
| POST   | `/api/groups/[id]/invite`      | Send email invitation   |      |
| POST   | `/api/groups/[id]/invite-link` | Generate/refresh link   |      |
| GET    | `/api/groups/[id]/invite-link` | Get current invite link |      |
| GET    | `/api/invitations`             | My pending invitations  |      |
| POST   | `/api/invitations/[id]`        | Accept or decline       |      |
| GET    | `/api/join/[code]`             | Preview a group by code | 🔓   |
| POST   | `/api/join/[code]`             | Join group via link     |      |

No email is actually sent — an invitation is a pending database record the
invitee sees on their dashboard.

### POST /api/groups/[id]/invite

**Body:**

```json
{
  "email": "friend@gmail.com"
}
```

**Response:**

```json
{
  "data": {
    "_id": "...",
    "invitedEmail": "friend@gmail.com",
    "status": "pending",
    "expiresAt": "2026-02-18T00:00:00Z"
  }
}
```

The record carries a unique `token`, but **no endpoint accepts it** — accept and
decline are keyed on the invitation `_id` plus a match against the caller's
email.

### POST /api/groups/[id]/invite-link

**Body:**

```json
{
  "expiresInDays": 7
}
```

`expiresInDays` is read straight from the body with no validation or cap. Any
member — not only an admin — can mint a link. Codes are 8 hex characters.

**Response:**

```json
{
  "data": {
    "inviteCode": "abc12345",
    "inviteUrl": "https://app.com/join/abc12345",
    "expiresAt": "2026-02-18T00:00:00Z"
  }
}
```

`inviteUrl` is built from `NEXT_PUBLIC_APP_URL` with no fallback — if that
variable is unset the URL begins with `undefined/`.

### POST /api/invitations/[id]

**Body:**

```json
{
  "action": "accept" // or "decline"
}
```

An invitation whose email does not match the caller returns **404** (not 403),
deliberately, to resist enumeration.

### GET /api/join/[code] 🔓

**Public by design** — the join page renders its sign-in call to action from
this before the visitor has an account. It is the one documented exception to
the auth-required rule.

**Response:** `{ "_id", "name", "category", "memberCount" }`

### POST /api/join/[code]

No body needed. Adds the current user to the group. Returns `201` on join, or
`200` with `{ "message": "Already a member" }`.

---

## Expenses

| Method | Path                                        | Description                |
| ------ | ------------------------------------------- | -------------------------- |
| POST   | `/api/groups/[id]/expenses`                 | Add expense                |
| GET    | `/api/groups/[id]/expenses`                 | List (with filters)        |
| GET    | `/api/groups/[id]/expenses/check-duplicate` | Pre-submit duplicate check |
| GET    | `/api/groups/[id]/expenses/[expenseId]`     | Get single expense         |
| PATCH  | `/api/groups/[id]/expenses/[expenseId]`     | Update expense             |
| DELETE | `/api/groups/[id]/expenses/[expenseId]`     | Soft delete                |

**Authorization is group-membership only.** No route or service checks who
created an expense, so any member can edit or delete any expense in the group.

### POST /api/groups/[id]/expenses

**Body:**

```json
{
  "description": "Dinner at restaurant",
  "amount": 120.0,
  "currency": "EUR",
  "category": "food",
  "date": "2026-02-10",
  "paidBy": [{ "user": "userId1", "amount": 120.0 }],
  "splitMethod": "equal",
  "splitBetween": [{ "user": "userId1" }, { "user": "userId2" }, { "user": "userId3" }],
  "tag": "Food",
  "predefinedItem": null,
  "notes": "John's birthday dinner"
}
```

**Required invariants, enforced server-side (all 422 on failure):**

- `tag` — a **single required string** that must name a currently **active** tag
  on the group (`INVALID_TAG`). There is no `tags` array.
- `currency` — must **equal the group's `defaultCurrency`** (`CURRENCY_MISMATCH`).
  Per-expense currency selection is not supported.
- every `paidBy.user` and `splitBetween.user` must be a group member
  (`INVALID_MEMBERS`).
- `amount` — positive, at most 10,000,000.

`category` is a free string defaulting to `"other"`; the category list in
`packages/shared/src/categories.ts` is **not** enforced by the validator.

`receiptUrl` is present on the model but absent from both expense schemas, so no
API path can set it.

**Notes on split calculation:**

- `equal`: Server calculates equal amounts (floor plus remainder to the first
  participant). Client just sends user IDs.
- `unequal` / `exact`: Client sends `amount` for each user, **passed through
  untouched**.
- `percentage`: Client sends `percentage` for each user.
- `shares`: Client sends `shares` for each user. Server calculates proportional
  amounts.

> **The server does not verify that money is conserved.** Nothing checks that
> `sum(paidBy.amount)` or `sum(splitBetween.amount)` equals `amount`, or that
> percentages sum to 100. Those checks exist only in the client dialogs. A
> direct API call can therefore create an expense that breaks the group's
> zero-sum property, and because balances are derived rather than stored, every
> later balance read inherits it.

### GET /api/groups/[id]/expenses

**Side effect:** calls `generateDueExpenses` before listing, so due recurring
templates are materialized on read.

**Query params:**

```
?page=1
&limit=20                      // no server-side ceiling
&dateFrom=2026-01-01
&dateTo=2026-01-31             // date-only values are treated as end-of-day
&tag=Food                      // single tag name
&category=food
&search=restaurant             // case-insensitive regex on description
&quickFilter=thisWeek          // thisWeek, lastWeek, thisMonth, lastMonth, last30Days
&paidByUser=<userId>
&owedByUser=<userId>
&sortBy=date                   // date, amount
&sortOrder=desc                // asc, desc
&includeMemberBreakdown=1      // opt-in; adds summary.byMember
```

**Response:**

```json
{
  "data": {
    "expenses": [ ... ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    },
    "summary": {
      "totalAmount": 1240.5,
      "count": 45,
      "userOwes": 120.0,
      "userGetsBack": 60.0,
      "byMember": [
        {
          "user": { "_id": "...", "name": "John" },
          "paid": 400.0,
          "share": 310.0,
          "net": -90.0
        }
      ]
    }
  }
}
```

`summary` is aggregated over the **whole filtered set**, not just the current
page. `byMember` appears only when `includeMemberBreakdown=1`; `net` is
`share - paid`, so positive means under-contributed for the window.

### GET /api/groups/[id]/expenses/check-duplicate

**Query params:** `?description=...&amount=...&date=...&excludeId=...`

Returns `{ "isDuplicate": false }` when any of the first three are missing.
Day bounds are computed in the **server process's local timezone**, unlike the
UTC convention used by the list filter.

### PATCH /api/groups/[id]/expenses/[expenseId]

Accepts any subset of the create body, plus `isDeleted: false` to restore a
soft-deleted expense. Each edit appends a diff to the expense's `editHistory`.

---

## Recurring expenses

Household-themed groups only (`category: "home"`). Templates materialize
expenses lazily when the group or its expense list is read.

| Method | Path                                       | Description     |
| ------ | ------------------------------------------ | --------------- |
| POST   | `/api/groups/[id]/recurring`               | Create template |
| GET    | `/api/groups/[id]/recurring`               | List templates  |
| PATCH  | `/api/groups/[id]/recurring/[recurringId]` | Edit or pause   |
| DELETE | `/api/groups/[id]/recurring/[recurringId]` | Delete template |

**Authorization:** GET requires membership; POST, PATCH and DELETE require
**admin**. Creating one in a non-Household group returns 422 `NOT_HOUSEHOLD`.

### POST /api/groups/[id]/recurring

**Body:**

```json
{
  "description": "Rent",
  "amount": 32000,
  "currency": "INR",
  "category": "other",
  "tag": "Rent",
  "paidBy": [{ "user": "userId1", "amount": 32000 }],
  "splitMethod": "equal",
  "splitBetween": [{ "user": "userId1" }, { "user": "userId2" }],
  "dayOfMonth": 1,
  "startsOn": "2026-08-01",
  "endsOn": null
}
```

`dayOfMonth` is 1–31 and is clamped to the last day of shorter months at
generation time. `endsOn` must not precede `startsOn` (422 `INVALID_WINDOW`).
The same member, active-tag and currency invariants as manual expenses apply.

### PATCH /api/groups/[id]/recurring/[recurringId]

Accepts any subset of the create body plus `isPaused: boolean`. **Edits apply to
future periods only** — expenses already generated are ordinary expenses and are
never rewritten. Resuming a paused template skips the on-hold window rather than
backfilling it.

### DELETE /api/groups/[id]/recurring/[recurringId]

Hard-deletes the template. Expenses it already generated are never touched.

### Generation semantics

Generated expenses carry `recurringExpense` (the template id) and `period`
(`YYYY-MM`), and a unique partial index on that pair makes generation idempotent
under concurrent readers. A template whose configuration no longer validates
against group state — archived tag, removed member, currency drift — is skipped
silently without advancing its marker; the settings list surfaces the problem
state, though its client-side check does not cover currency drift.

---

## Settlements

| Method | Path                           | Description       |
| ------ | ------------------------------ | ----------------- |
| POST   | `/api/groups/[id]/settlements` | Record settlement |
| GET    | `/api/groups/[id]/settlements` | List settlements  |

### POST /api/groups/[id]/settlements

**Body:**

```json
{
  "paidBy": "userId1",
  "paidTo": "userId2",
  "amount": 50.0,
  "currency": "EUR",
  "note": "Paid via UPI"
}
```

`paidBy` is **optional** and defaults to the recording user.

**Authorization:** only the payer or the recipient may record a settlement —
422 `FORBIDDEN_SETTLEMENT` otherwise. Payer and recipient must differ
(`SAME_PARTY`), both must be members (`INVALID_MEMBERS`), and `currency` must
equal the group default (`CURRENCY_MISMATCH`).

Settlements have `createdAt` but **no `date` field**, so they cannot be
back-dated or attributed to a past month.

---

## Balances

| Method | Path                        | Description                             |
| ------ | --------------------------- | --------------------------------------- |
| GET    | `/api/groups/[id]/balances` | Group balances **and** simplified debts |

There is no `/balances/simplified` route — the single endpoint returns both the
per-member balances and the minimum-transaction debt list.

### GET /api/groups/[id]/balances

**Response:**

```json
{
  "data": {
    "balances": [
      { "user": { "_id": "...", "name": "John" }, "balance": -30.0 },
      { "user": { "_id": "...", "name": "Jane" }, "balance": 50.0 },
      { "user": { "_id": "...", "name": "Bob" }, "balance": -20.0 }
    ],
    "debts": [
      {
        "from": { "_id": "...", "name": "John" },
        "to": { "_id": "...", "name": "Jane" },
        "amount": 30.0
      },
      {
        "from": { "_id": "...", "name": "Bob" },
        "to": { "_id": "...", "name": "Jane" },
        "amount": 20.0
      }
    ],
    "currency": "EUR",
    "hasMixedCurrencies": false
  }
}
```

Balances are **running and cumulative** — never reset by month. `debts` is the
simplified (minimum-transfer) set, not the raw pairwise ledger.

`hasMixedCurrencies` is true when any expense or settlement differs from the
group default. The write path forbids that, so it can only arise from legacy
data — but note the endpoint still sums those amounts into one number labelled
with the group's default currency.

---

## Activity Feed

| Method | Path                        | Description       |
| ------ | --------------------------- | ----------------- |
| GET    | `/api/groups/[id]/activity` | Get activity feed |

### GET /api/groups/[id]/activity

**Query params:** `?page=1&limit=20` (the client requests `limit=50` and renders
a single page — there is no Load More control).

**Response:**

```json
{
  "data": {
    "activities": [
      {
        "_id": "...",
        "type": "expense_added",
        "actor": { "_id": "...", "name": "John", "image": "..." },
        "metadata": {
          "expenseId": "...",
          "description": "Dinner at restaurant",
          "amount": 120.0,
          "currency": "EUR"
        },
        "createdAt": "2026-02-10T19:30:00Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 100 }
  }
}
```

Expenses generated from a recurring template log with `recurring: true`,
`recurringExpenseId` and `period` in their metadata.

Activity writes are on the critical path — every mutation `await`s the log, and
there are no transactions, so a logging failure fails the request after the
primary write has already committed.

---

## Not implemented

Documented in earlier drafts but absent from the codebase:

- **Receipt upload** (`POST`/`DELETE .../receipt`). `Expense.receiptUrl` exists in
  the model and `ExpenseCard` renders a chip for it, but the field is not in
  either Zod schema, so no request can populate it. See
  [`features/receipts.md`](features/receipts.md).
- **`GET /api/groups/[id]/balances/simplified`** — folded into `/balances`.
- **Leave group** — no endpoint; members can only be removed by an admin.
