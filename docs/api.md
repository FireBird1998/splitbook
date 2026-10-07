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
protection lives in `src/proxy.ts` (rules in `src/lib/auth/proxy-rules.ts`); for
API paths without a session cookie it answers `{ "error": "Unauthorized", "status": 401 }`,
the same shape the route helpers use, so browser and native clients can detect
an expired session.
Pages still redirect to `/login?callbackUrl=…`. The web client's SWR `fetcher`
sends a 401 to `/login` with the current page as `callbackUrl`.

**Common status codes:** `401` unauthenticated (from a route's own `getAuthUser`
guard), `403` not a group member or not an admin, `404` not found, `422` Zod
validation failure or a service invariant (`CURRENCY_MISMATCH`, `INVALID_TAG`,
`INVALID_MEMBERS`, …).

---

## Auth

Handled by Better Auth under one catch-all route. The paths a client uses:

| Method | Path                             | Description                                                                                                                           | Auth |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| POST   | `/api/auth/sign-in/social`       | `{ provider: 'google', callbackURL }` starts the redirect flow; `{ provider: 'google', idToken: { token } }` signs a native client in | 🔓   |
| GET    | `/api/auth/callback/google`      | Google redirect target                                                                                                                | 🔓   |
| GET    | `/api/auth/get-session`          | `{ session, user }` or `null`                                                                                                         | 🔓   |
| POST   | `/api/auth/sign-out`             | Revoke the session. Answers 500 `SESSION_NOT_ENDED` when the session can't be ended, and keeps the session cookie for a retry         | 🔓   |
| POST   | `/api/auth/demo-persona/sign-in` | `{ personaId }` — demo mode only; the route is absent otherwise                                                                       | 🔓   |

Google sign-ins are gated by `AUTH_ALLOWED_EMAILS` (rejections carry the code
`email_not_allowed`); `AUTH_MODE` decides whether the persona endpoint exists.
See [`auth.md`](auth.md).

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

Like a Group's own reads, it first adds the recurring Expenses that have fallen
due in each of the member's Groups (one generation run per Group that has a
recurring template, one after another), so Home and the sidebar match each
Group's page. While recurring Expenses are switched off (#289) it adds nothing.

`suggestedPayments` (#306) lists **every** payment the Groups' Balances suggest
where the member pays or receives, across their Groups, in Needs you's order:
what the member pays first, then what they receive; within each, by currency,
largest first. Amounts are exact minor units (paise, cents). The other person is
named from the Group's members, or from their account if they left with a
balance open; never by email. The field is additive: `buckets`, `groups` and
each Group's `settlement` (still only the largest payment per currency) are
unchanged, and Android ignores it.

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
    "hasMixedCurrencies": false,
    "suggestedPayments": [
      {
        "groupId": "...",
        "groupName": "Europe Trip 2026",
        "currency": "EUR",
        "direction": "receive",
        "counterpartyId": "...",
        "counterpartyName": "Jane",
        "amountMinor": 5000
      }
    ]
  }
}
```

`direction` is `"pay"` (the member pays the other person) or `"receive"` (the
other person pays the member). The web reads the field with
`readHomeSuggestedPayments` (`@splitbook/shared/home-balances-read`), apart from
the balances decoder, so a malformed list fails Needs you only.

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
create expenses while recurring Expenses are switched on (see
[Recurring expenses](#recurring-expenses)).

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

| Method | Path                                | Description                 |
| ------ | ----------------------------------- | --------------------------- |
| PATCH  | `/api/groups/[id]/members/[userId]` | Change member role          |
| DELETE | `/api/groups/[id]/members/[userId]` | Remove from group           |
| POST   | `/api/groups/[id]/leave`            | The signed-in member leaves |

PATCH and DELETE are admin-only. **Body** for PATCH is `{ "role": "admin" | "member" }`.
Demoting or removing the last admin returns **409**; removing yourself returns
**400** `You cannot remove yourself. Use leave group instead.`

### POST /api/groups/[id]/leave

Any member may leave, with no body. The rules:

- **Settled up first.** The member's balance must be zero in every currency.
  Otherwise **409** with `code: "OPEN_BALANCE"`, a readable `error` such as
  `Settle up before you leave: you owe ₹150.00 in this Group.`, and
  `balances: [{ "currency": "INR", "amount": -150 }]` (negative: they owe;
  positive: they are owed).
- **Due recurring Expenses count.** While other members remain, the recurring
  Expenses already due are added first, as every Group read does, and only then
  is the balance checked. A Rent that fell due this month is therefore part of
  the settle-up. If adding them doesn't finish, the leave is refused with **409**
  `code: "LEAVE_CONFLICT"`; trying again adds what is still missing. A template in
  its problem state (for example, its Tag archived) doesn't hold up the leave: its
  missed periods are not generated for the departing member. An archived Group
  adds none, and neither does any Group while recurring Expenses are switched off.
- **The last admin hands over first.** While other members remain, the only admin
  gets **409** `code: "LAST_ADMIN"`, `Make someone else an admin before you leave.`
- **The last member archives the Group.** Nobody would be left to reach it, so the
  Group is archived in the same step.

**Response:** `{ "data": { "message": "Left group", "archived": false } }`
(`archived: true` when the last member left). Activity records `member_left`
with `{ userId, method: "left" }`, plus the archive change when it happens.
A stranger gets **403**; a race with another leave or join that can't be
resolved after three tries, or a due recurring Expense that couldn't be added,
gets **409** `code: "LEAVE_CONFLICT"`.

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
templates are materialized on read while recurring Expenses are switched on.

**Query params:**

```
?page=1
&limit=20                      // 1–100; larger is cut to 100, anything else is 20
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
&involvesUser=<userId>         // paid part of it or has a share of it (#310)
&amountMin=500                 // inclusive, major units of the Group's currency (#310)
&amountMax=1249.50             // inclusive (#310)
&includeRecurringCount=1       // opt-in; adds summary.recurringCount (#310)
```

**Added by #310, all additive.** A request that sends none of them answers
exactly as before, byte for byte (the route's integration test compares the
requests Android and the web made with answers recorded before #310):

- `involvesUser` keeps the Expenses the member paid part of or has a share of. A
  row of zero (someone left out of a split by shares) doesn't count.
- `amountMin` and `amountMax` are plain decimal text (`500`, `1249.50`), read
  exactly in the Group's currency. More decimal places than the currency has
  answer **422** `INVALID_MONEY_PRECISION`, a range the wrong way round **422**
  `INVALID_AMOUNT_RANGE`, and anything else that isn't a plain amount **422**
  `VALIDATION_ERROR`, as does an `involvesUser` that isn't an id. An Expense in
  another currency (a legacy Group) is compared by its own amount.
- `limit` is capped at 100 (`EXPENSE_PAGE_MAX_LIMIT` in
  `@splitbook/shared/expense-page-read`), and `pagination.limit` says what was
  used. A zero, negative or unreadable `limit` is the default 20.
- `includeRecurringCount=1` adds `summary.recurringCount`, how many of the
  filtered Expenses recurring Expenses added. It is left out while recurring
  Expenses are switched off (#289), even when asked for.
- Each Expense already carried `recurringExpense` (the template's id, or null);
  the shared decoder now declares it.

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
      ],
      "recurringCount": 3
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
expenses lazily when the group, its expense list or its balances are read, and
before a member's leave is checked. An archived Group materializes nothing.

**Off by default (#289).** The whole feature sits behind the server's
`RECURRING_EXPENSES_ENABLED` switch, on only when it is `true`. While it is off:

- POST, PATCH (edit, pause or resume) and DELETE answer **409**
  `{ "error": "Recurring Expenses are turned off.", "code": "RECURRING_EXPENSES_OFF" }`
  to any signed-in caller, before the body or the caller's role is checked, and
  change nothing. A signed-out caller still gets 401.
- GET answers a member with an empty list (`{ "data": [] }`), not a refusal, so a
  page that still lists templates shows none instead of an error (a 403 from a
  read under a Group means the reader lost it). A non-member still gets 403.
- No read and no leave materializes anything, and no template or Expense is
  changed. Expenses generated earlier stay ordinary Expenses.

When it is turned back on, nothing is added for the months it was off: every
template that existed then resumes from the month it was turned on (see
[Generation semantics](#generation-semantics)).

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

The switch's history is one document in `productswitches`
(`_id: "recurringExpenses"`). The first generation run that finds the switch off
records `enabled: false`; the first that finds it on again records
`enabled: true` with the time. From then on, a template created before that time
skips every period before that month, so the months the switch was off are never
back-filled, as with resuming a paused template. A template created later
catches up from its `startsOn`, as before. A database that has never seen the
switch off has no such document and generates exactly as before.

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

**Side effect:** calls `generateDueExpenses` after the membership check and
before computing, so due recurring templates are materialized on read and the
balances include them, while recurring Expenses are switched on. A non-member
gets `403` and nothing is materialized.

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

People who left or were removed stay in the ledger. A settled former member is
left out of `balances`; one who still has a balance appears under their own
account name.

`hasMixedCurrencies` is true when any expense or settlement differs from the
group default. The write path forbids that, so it can only arise from legacy
data — but note the endpoint still sums those amounts into one number labelled
with the group's default currency.

---

## Activity Feed

| Method | Path                        | Description                                |
| ------ | --------------------------- | ------------------------------------------ |
| GET    | `/api/groups/[id]/activity` | Get activity feed                          |
| GET    | `/api/user/activity`        | Latest Activity across the member's Groups |

### GET /api/groups/[id]/activity

**Query params:** `?page=1&limit=20` (the client requests `limit=50` and renders
a single page — there is no Load More control).

`expenseId` narrows the feed to the events whose `metadata.expenseId` is that
Expense, with the same shape, pagination and membership check. An Expense the
Group doesn't have, including another Group's, returns an empty page. The
Android Expense record reads its history this way.

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

### GET /api/user/activity

Home's "Latest changes" (#309): the latest Activity across the Groups the
member belongs to today, newest first (`createdAt`, then `_id`). A Group the
member has left or never joined, and an archived Group, contributes nothing.

**Query params:** `?limit=10`. 10 when absent and at most 50: a larger number
is cut to 50, and anything but a whole number of at least 1 is a 422
validation error.

People appear by name only: `actor` is `{ _id, name }`, or `null` when the
account no longer exists, and a payment's sides are `paidByName` and
`paidToName`. `metadata` carries only what the card uses; an Expense edit keeps
only its money `changes` (`amount`, `amountMinor`, `currency`), before and
after. `currency` is the currency of the event's amounts: the recorded one, or,
for an edit, the Expense's currency at the time. The shared path, query key
and decoder are `userActivityPath`, `userActivityKey` and
`parseUserActivityResponse` (`@splitbook/shared/user-activity-read`).

The read only reads. Unlike a Group's Activity read, it doesn't publish events
whose publication failed: those appear once that Group's Activity is read, or
the next write to the same Expense or Settlement publishes them.

**Response:**

```json
{
  "data": {
    "activities": [
      {
        "_id": "...",
        "type": "expense_updated",
        "createdAt": "2026-10-06T14:10:00.000Z",
        "group": { "_id": "...", "name": "Maple House" },
        "actor": { "_id": "...", "name": "Priya Shah" },
        "currency": "INR",
        "metadata": {
          "expenseId": "...",
          "description": "Wi-Fi",
          "changes": {
            "amount": { "old": 899, "new": 999 },
            "amountMinor": { "old": 89900, "new": 99900 }
          }
        }
      }
    ],
    "limit": 10
  },
  "status": 200
}
```

---

## Search

| Method | Path                | Description                                                 |
| ------ | ------------------- | ----------------------------------------------------------- |
| GET    | `/api/search?q=...` | Search the member's Groups, the people in them and Expenses |

### GET /api/search

The top bar's search (#321). It reads only the Groups the member belongs to now, the
same Groups as `GET /api/groups` (archived Groups are left out), so a Group they left
or never joined is never searched.

- **Query:** `q`, trimmed and with whitespace collapsed; at most 100 characters
  (422 `QUERY_TOO_LONG` above that). An empty or missing `q` answers empty sections.
- **Matching:** each word of the query must start a word of a Group's name, a
  member's name or an Expense's description, ignoring case, in any script. "din"
  finds "Dinner" and "Seafood dinner"; "ner" finds neither. Rules and the database
  pattern live in `@splitbook/shared/search`.
- **People** are the other members of the member's Groups, by name only; no email
  is read or returned. Each person comes once, with the first Group shared with
  them in the order of the member's Group list, and how many Groups they share.
- **Expenses:** deleted ones are left out; the newest come first. Recurring
  Expenses that have fallen due are not added first, since search totals nothing.
- **Caps:** 5 Groups, 5 people and 8 Expenses (`SEARCH_LIMITS`), with `more`
  saying whether a section had more matches.

**Response:**

```json
{
  "data": {
    "query": "goa",
    "groups": [{ "id": "...", "name": "Goa Friends Trip", "category": "trip", "memberCount": 3 }],
    "people": [
      {
        "id": "...",
        "name": "Sam Chen",
        "groupId": "...",
        "groupName": "Goa Friends Trip",
        "groupCount": 2
      }
    ],
    "expenses": [
      {
        "id": "...",
        "groupId": "...",
        "groupName": "Goa Friends Trip",
        "description": "Goa beach shack dinner",
        "amountMinor": 240000,
        "currency": "INR",
        "date": "2026-09-12T00:00:00.000Z"
      }
    ],
    "more": { "groups": false, "people": false, "expenses": true }
  }
}
```

`amountMinor` is exact minor units, or `null` when the stored amount can't be read
exactly. The shared path, query key (scope `search`) and decoder are `searchPath`,
`searchKey` and `parseSearchResponse`.

---

## Export

| Method | Path          | Description                                  |
| ------ | ------------- | -------------------------------------------- |
| GET    | `/api/export` | The member's Groups as CSV files, or one zip |

### GET /api/export

The Export page's download (#317). It answers with a file, not JSON: one CSV,
or a zip when there are several. Refusals and failures use the standard JSON
error shape.

**Query params:**

| Param     | Required | Value                                                                                                 |
| --------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `groups`  | yes      | Group ids joined by commas, 1–50; repeats are ignored and the files follow this order                 |
| `from`    | no       | First day of the window, `YYYY-MM-DD`, inclusive                                                      |
| `to`      | no       | Last day of the window, `YYYY-MM-DD`, inclusive. Give both `from` and `to`, or neither for all time   |
| `include` | no       | Any of `payments`, `shares`, `deleted`, `history`, joined by commas                                   |
| `format`  | no       | `csv` (the only format; the default)                                                                  |
| `tz`      | no       | The viewer's IANA time zone, `UTC` by default: the calendar payments, edits and deletions are read in |

A query it can't read (no Groups, an id that isn't one, half a window, a window
that ends before it starts, a day that doesn't exist, an unknown include, format
or time zone) is a 422 validation error. The shared path builder is
`exportPath`; `parseExportQuery` and `planExportFiles` are in
`@splitbook/shared/export-request`, and the CSV builders in
`@splitbook/shared/export-csv`.

**Access.** Every Group must be one the member belongs to today, the same check
as the Group reads. If any Group in the request is one they never joined, have
left, or that doesn't exist, the whole request is refused with the Group reads'
`403 { "error": "Forbidden", "status": 403 }`, before anything is read or
generated. A member can export an archived Group.

**Recurring Expenses.** Before reading, the read adds the recurring Expenses
that have fallen due in each Group, as the Group, Expense and Balances reads
do. While recurring Expenses are switched off (#289) it adds none.

**The window.** An Expense is in the window when its date falls on one of the
window's days. Expense dates are calendar days stored at midnight UTC, so the
date is compared, and written, as that UTC day: the day the member picked. A
payment is in the window when the day it was recorded, in `tz`, is one of the
window's days.

**Size.** The files are built in memory, not streamed. An export of more than
50,000 rows across every file (Expenses, deleted Expenses when asked, edit rows
and payments) is refused with `413` and code `EXPORT_TOO_LARGE`, with a message
that says how many rows it would have and to pick fewer Groups or a shorter
period. Nothing is built for a refused export.

**Response.** `200` with:

- `Content-Type: text/csv; charset=utf-8` for one CSV, `application/zip` for
  several.
- `Content-Disposition: attachment; filename="…"`.
- `Cache-Control: no-store`.

**Files.** Each Group has an Expenses CSV, and a payments CSV when `payments`
is included. One file downloads as itself; several come in one zip.

| File                | Example                            |
| ------------------- | ---------------------------------- |
| Expenses            | `maple-house-2026-09-expenses.csv` |
| Payments            | `maple-house-2026-09-payments.csv` |
| Zip, one Group      | `maple-house-2026-09.zip`          |
| Zip, several Groups | `splitbook-3-groups-2026-09.zip`   |

The Group part is the Group's name in lower-case ASCII (accents folded, `group`
if nothing is left); two Groups whose names match get `-2`, `-3`. The window
part is `2026-09` for a whole calendar month, `2026-09-14` for one day,
`2026-09-01-to-2026-09-15` for any other window, and `all-time` without one.

**CSV format.** UTF-8 with a byte-order mark (so Excel reads ₹ and €), CRLF line
ends, and RFC 4180 quoting: a cell with a comma, a double quote or a line break
is quoted, with quotes doubled. A cell that starts with `=`, `+`, `-`, `@`, a
tab or a carriage return gets a leading `'`, so a spreadsheet never runs it as a
formula. Amounts are exact decimals in the currency's minor units, with no
grouping or symbol (`1249.50`; `2400` for JPY), each beside its own currency
code, never converted. People appear by name, never by email; someone whose
account no longer exists is `Former member`. Times are the `tz` wall clock with
its offset: `2026-09-30T10:30:00+05:30`.

**Expenses CSV columns.** Options add columns after the ones that are always
there, so no column moves when another option is turned on. Rows are newest
first (by date, then when they were added).

| #   | Column         | Present   | Value                                                                                                                                                                  |
| --- | -------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Date`         | always    | The Expense's day, `YYYY-MM-DD`                                                                                                                                        |
| 2   | `Description`  | always    |                                                                                                                                                                        |
| 3   | `Category`     | always    | The Category's name (`Food & Drink`)                                                                                                                                   |
| 4   | `Tag`          | always    | The Tag's name today                                                                                                                                                   |
| 5   | `Paid by`      | always    | The payer's name; several payers as `Alex Rivera 600.00, Sam Chen 400.00`                                                                                              |
| 6   | `Split`        | always    | `Equally`, `Exact amounts`, `Percentages` or `Shares`                                                                                                                  |
| 7   | `Amount`       | always    | Exact decimal                                                                                                                                                          |
| 8   | `Currency`     | always    | ISO code                                                                                                                                                               |
| 9   | `Notes`        | always    |                                                                                                                                                                        |
| 10  | `Expense ID`   | always    | The Expense's id                                                                                                                                                       |
| …   | `<Name> share` | `shares`  | One per person: members today in the Group's order, then anyone else with a share, by name. Exact; `0.00` outside the split. Two people with one name: `Sam (2) share` |
| …   | `Deleted at`   | `deleted` | When it was deleted; blank on other rows                                                                                                                               |
| …   | `Deleted by`   | `deleted` | Who deleted it                                                                                                                                                         |
| …   | `Edited at`    | `history` | On an edit row: when                                                                                                                                                   |
| …   | `Edited by`    | `history` | On an edit row: who                                                                                                                                                    |
| …   | `Change`       | `history` | On an edit row: what changed, e.g. `Amount: 2680.00 → 2860.00; Tag: Bills → Utilities`                                                                                 |

With `deleted`, deleted Expenses are rows too, with their amounts; without it
they are left out. With `history`, each edit is a row after its Expense, oldest
first. An edit row has the Expense's `Date`, `Description` and `Expense ID`
and leaves every other Expense column blank, `Amount` and the shares included,
so a total of the `Amount` column counts each Expense once. `Change` names the
description, amount, currency, date, Category, Tag, payers, split, shares and
notes that changed; other stored fields are left out (`Other details` when
nothing else changed).

**Payments CSV columns.** Newest first.

| #   | Column        | Value                            |
| --- | ------------- | -------------------------------- |
| 1   | `Date`        | The day it was recorded, in `tz` |
| 2   | `Recorded at` | When it was recorded, in `tz`    |
| 3   | `From`        | Who paid                         |
| 4   | `To`          | Who was paid                     |
| 5   | `Amount`      | Exact decimal                    |
| 6   | `Currency`    | ISO code                         |
| 7   | `Note`        |                                  |
| 8   | `Recorded by` | Who recorded it                  |
| 9   | `Payment ID`  | The Settlement's id              |

The zip is made with [`fflate`](https://github.com/101arrowz/fflate) (MIT).

---

## Not implemented

Documented in earlier drafts but absent from the codebase:

- **Receipt upload** (`POST`/`DELETE .../receipt`). `Expense.receiptUrl` exists in
  the model and `ExpenseDetails` links to it, but the field is not in
  either Zod schema, so no request can populate it. See
  [`features/receipts.md`](features/receipts.md).
- **`GET /api/groups/[id]/balances/simplified`** — folded into `/balances`.
