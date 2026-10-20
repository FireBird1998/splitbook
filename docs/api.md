# API Endpoints

All endpoints return JSON. Auth required unless marked 🔓 (public).

Standard response format:

```json
// Success
{ "data": { ... }, "status": 200 }

// Error
{ "error": "Human-readable message", "status": 400 }
```

Helpers in `src/lib/utils/api-response.ts` produce this shape. Many errors add a
`code`, and the Tag routes add the current Tags too (see [Tags](#tags)).

A body or query the route's schema refuses answers **422** `VALIDATION_ERROR`,
with each problem in `details` as `{ path, message }`, the shape the Draft APIs
use too (#538):

```json
{
  "error": "Validation error",
  "code": "VALIDATION_ERROR",
  "status": 422,
  "details": [{ "path": ["category"], "message": "Invalid category" }]
}
```

Two routes refuse with a message of their own instead: an invite's email
(`Invalid email address`) and an invitation's action (`Invalid action`), both
**422** without `details`. Tag commands answer **400** `INVALID_TAG_COMMAND`.

**Unauthenticated `/api/*` requests get `401` JSON, never a redirect.** Route
protection lives in `src/proxy.ts` (rules in `src/lib/auth/proxy-rules.ts`); for
API paths without a session cookie it answers `{ "error": "Unauthorized", "status": 401 }`,
the same shape the route helpers use, so browser and native clients can detect
an expired session.
Pages still redirect to `/login?callbackUrl=…`. The web client's SWR `fetcher`
sends a 401 to `/login` with the current page as `callbackUrl`.

**Common status codes:** `400` input the route can't read: an id in the path
that isn't one (`INVALID_ID`) or a required body that isn't JSON
(`INVALID_JSON`), `401` unauthenticated (from a route's own `getAuthUser`
guard), `403` not a group member or not an admin, `404` not found, `422` Zod
validation failure or a service invariant (`CURRENCY_MISMATCH`, `INVALID_TAG`,
`INVALID_MEMBERS`, …), `500` a fault on the server's side, logged, with
`{ "error": "Internal server error", "status": 500 }`. Stored data a read
can't use is one such fault, never the request's (#547). The Draft routes answer
an id that isn't one with `422` `VALIDATION_ERROR`, and the Tag routes answer
both with `400` `INVALID_TAG_COMMAND`.

**An archived Group takes no more changes (#578).** Once an admin archives a
Group (`DELETE /api/groups/[id]`), every write to its ledger answers **409**
`GROUP_ARCHIVED` ("This Group was archived, so nothing more can be saved in
it.") and changes nothing: an Expense's create, edit, restore and delete, a
payment, a To review save (`POST /api/groups/[id]/drafts/save`), and an
assistant's `create_drafts` and `replace_draft`. The check is made inside the
write's own Group fence, so an archive that commits first stops a racing save.
Reads are unchanged, a member's own Drafts and discards still work, and a retry
of an Expense, payment or To review save recorded before the archive is still
confirmed. `apps/web/src/app/api/groups/[id]/archived-group-writes.integration.test.ts`
pins each.

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

| Method | Path                                       | Description                                               |
| ------ | ------------------------------------------ | --------------------------------------------------------- |
| GET    | `/api/groups/[id]/tag-actions`             | The Group's Tags, as Tag management shows them            |
| POST   | `/api/groups/[id]/tag-actions`             | Create, rename, archive, restore or delete a Tag          |
| GET    | `/api/groups/[id]/tag-actions/[requestId]` | Whether the action with this `requestId` was applied      |
| POST   | `/api/groups/[id]/tags`                    | Create a Tag (older form; answers the Group)              |
| PATCH  | `/api/groups/[id]/tags/[tagId]`            | Rename, archive or restore a Tag (older form; the Group)  |
| DELETE | `/api/groups/[id]/tags/[tagId]`            | Delete a Tag nothing uses (older form; answers the Group) |

A Tag is a Group-scoped label, and every Expense carries exactly one. Any member
reads the Group's Tags; only an admin changes them
([ADR 0009](adr/0009-shared-tag-management-safety.md)). Each change is a command
with a `requestId`, a UUID the client makes once per action and keeps for its
retries. Every change but a create also names the Tag's `expectedRevision`: the
revision the member reviewed. A Tag starts at revision 0, and each rename,
archive, restore or delete adds one. The original design is
[`v3/tag-management.md`](v3/tag-management.md).

**POST `/tag-actions` body:**

```json
{
  "requestId": "7b0b0e43-6d61-4d55-9c43-1f4c3a2b9e01",
  "intent": { "action": "create", "name": "Snacks" }
}
```

`intent` is `{ action: "create", name }`, `{ action: "rename", tagId,
expectedRevision, name }`, or `{ action: "archive" | "restore" | "delete", tagId,
expectedRevision }`. A name is 1–50 characters once trimmed.

It answers **200** with the receipt and the Tags as they are now:

```json
{
  "data": {
    "state": "applied",
    "requestId": "7b0b0e43-6d61-4d55-9c43-1f4c3a2b9e01",
    "receipt": {
      "intent": { "action": "create", "name": "Snacks" },
      "tagId": "…",
      "appliedAt": "2026-10-18T09:30:00.000Z"
    },
    "snapshot": {
      "canManage": true,
      "tags": [
        {
          "id": "…",
          "name": "Snacks",
          "revision": 0,
          "isArchived": false,
          "isDeleted": false
        }
      ]
    }
  },
  "status": 200
}
```

The same `requestId` and intent again answers the same receipt and changes
nothing. `GET /tag-actions/[requestId]` answers that receipt too, or
`{ "state": "not-applied", "requestId", "snapshot" }` when the action never
applied; a check never applies anything. `GET /tag-actions` answers the
`snapshot` alone.

**The older forms** take the same identity in a flat body and answer the Group
(`{ "data": <Group> }`):

- POST `/tags`: `{ "requestId": "<uuid>", "name": "Groceries" }`.
- PATCH `/tags/[tagId]`: `{ "requestId", "expectedRevision": 0, "name": "Meals" }`
  to rename, or `{ "requestId", "expectedRevision": 0, "isArchived": true }` to
  archive (`false` restores). Exactly one of `name` and `isArchived`.
- DELETE `/tags/[tagId]`: `{ "requestId", "expectedRevision": 0 }`.

A command without `requestId`, or a change without `expectedRevision`, answers
**428** `TAG_PRECONDITION_REQUIRED` on every route, before the member's role or
the Tag is checked, and changes nothing. Any other field, or a body that doesn't
match, answers **400** `INVALID_TAG_COMMAND`.

**Refusals** carry `error`, `status` and `code`, and every `409` and
`TAG_ADMIN_REQUIRED` also carries the current `snapshot`, so the client can
show what changed:

| Status | Code                        | When                                                                                                         |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 400    | `INVALID_TAG_COMMAND`       | The body isn't JSON or doesn't match the command, or a Group id, Tag id or `requestId` in the path isn't one |
| 403    | `TAG_ADMIN_REQUIRED`        | A member who isn't an admin (`snapshot.canManage` is `false`)                                                |
| 403    | `FORBIDDEN`                 | Someone outside the Group                                                                                    |
| 409    | `TAG_CHANGED`               | The Tag's revision isn't `expectedRevision`, or the Tag is deleted or gone                                   |
| 409    | `TAG_EXISTS`                | Another Tag, archived ones included, has the name ignoring case; `existingTagId` names it                    |
| 409    | `LAST_ACTIVE_TAG`           | Archiving or deleting the Group's last active Tag                                                            |
| 409    | `TAG_IN_USE`                | Deleting a Tag an Expense, a deleted one included, or a recurring template uses                              |
| 409    | `AMBIGUOUS_TAG`             | Renaming a name two Tags share while an Expense or template still refers to it by name alone                 |
| 409    | `REQUEST_KEY_REUSED`        | The `requestId` was already used for a different intent                                                      |
| 428    | `TAG_PRECONDITION_REQUIRED` | No `requestId`, or a change without `expectedRevision`                                                       |
| 503    | `TAG_TRANSACTIONS_REQUIRED` | The database can't run the change in a transaction                                                           |

Archiving hides a Tag from new Expenses but keeps it on saved ones and keeps its
name taken; restoring brings back the same Tag. Deleting is only for a Tag
nothing uses, and frees its name.

**Names and identity.** An Expense or recurring template refers to its Tag by
`tagId`, and a rename keeps the Tag's identity (#402). Expense reads, the
Expense list, recurring Expenses, Insights, trip summaries and export all show
the Tag's current name; the Expense's own `tag` text is only a fallback for a
reference no Tag answers. A rename also links Expenses and templates that still
refer to the old name with no `tagId`, from before #402, to the Tag, unless two
Tags share that name (`AMBIGUOUS_TAG`).

The HTTP layer is `apps/web/src/lib/tag-management-http.ts`, the rules
`apps/web/src/lib/services/tag-management.service.ts`, and the command shapes
`packages/shared/src/tag-management.ts`. Over HTTP,
`apps/web/src/app/api/groups/[id]/tags/route.integration.test.ts` and
`…/tags/[tagId]/route.integration.test.ts` pin the older forms (428 included,
and a rename the saved Expense follows),
`…/tag-actions/route.integration.test.ts` the commands, receipts, recovery,
`REQUEST_KEY_REUSED` and `LAST_ACTIVE_TAG`,
`apps/web/src/lib/services/tag-identity.integration.test.ts` name-only
references and `AMBIGUOUS_TAG`, and
`apps/web/src/lib/group-cleanup-standalone.integration.test.ts` the 503 on a
database without transactions. In the browser,
`apps/web/playwright-expense-access/tag-identity.spec.ts` and
`tag-management-recovery.spec.ts` cover the same.

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
| POST   | `/api/groups/[id]/expenses/tag-change`      | Move Expenses to one Tag   |
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

An archived Group refuses a new Expense with **409** `GROUP_ARCHIVED` (see above).

- `amount` — positive, at most 10,000,000.

`category` defaults to `"other"` and must be one of the Category ids in
`packages/shared/src/categories.ts`; any other answers **422**
`VALIDATION_ERROR` at `["category"]` ("Invalid category"), on create and edit.

`receiptUrl` is present on the model but absent from both expense schemas, so no
API path can set it.

**Notes on split calculation:**

- `equal`: Server calculates equal amounts. Client just sends user IDs. Any
  smallest units left over go one each to the participants whose user ids sort
  first.
- `unequal` / `exact`: Client sends `amount` for each user, **passed through
  untouched**. A row without one is refused as a missing amount, "Enter an amount
  for each person in the split", pointing at that row (#497): a create answers
  **422** `VALIDATION_ERROR` with the issue at
  `["splitBetween", <i>, "amount"]`, and an edit answers **422**
  `MISSING_SPLIT_AMOUNT` with `field: ["splitBetween", <i>, "amount"]`.
- `percentage`: Client sends `percentage` for each user.
- `shares`: Client sends `shares` for each user. Server calculates proportional
  amounts; for shares and percentages, leftover smallest units go to the largest
  remainders, ties by user id.

**The server checks that the money adds up (#545).** Every save runs the shared
`normalizeExpenseMoney`
([`packages/shared/src/exact-money.ts`](../packages/shared/src/exact-money.ts))
on the whole Expense: a create on its body, an edit that touches the money on
the stored Expense with the change applied. No API call can store an Expense
whose payers or split don't add up to its amount. Before it, the schema refuses
an amount that isn't positive or is over 10,000,000, a negative row amount, a
percentage outside 0–100, shares that aren't whole and non-negative, and an
Expense without a payer or a split row. The money module then refuses:

| Refusal                                                 | Code                        | Path                                                                           |
| ------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| Payers that don't add up to the amount                  | `PAYER_TOTAL_MISMATCH`      | `["paidBy"]`                                                                   |
| The same person twice among the payers, or in the split | `DUPLICATE_PARTICIPANTS`    | `["paidBy"]` or `["splitBetween"]`                                             |
| An exact or unequal split that doesn't add up           | `SPLIT_TOTAL_MISMATCH`      | `["splitBetween"]`                                                             |
| A share left out of an exact or unequal split           | `MISSING_SPLIT_AMOUNT`      | `["splitBetween", <i>, "amount"]`                                              |
| Percentages that don't make 100                         | `PERCENTAGE_TOTAL_MISMATCH` | `["splitBetween"]`                                                             |
| Shares or percentages that are all zero                 | `INVALID_SHARES`            | `["splitBetween"]`                                                             |
| An amount with more decimals than the currency has      | `INVALID_MONEY_PRECISION`   | `["amount"]`, `["paidBy", <i>, "amount"]` or `["splitBetween", <i>, "amount"]` |
| A percentage with more than 2 decimals                  | `INVALID_MONEY_PRECISION`   | `["splitBetween"]`                                                             |

A create answers **422** `VALIDATION_ERROR` with each path and message in
`details`, a refusal about the total at `["amount"]`. The codes above appear
only on an edit, which answers **422** with the code and the path as `field`; a
refusal about the total itself, such as its decimals, has no `field`.

Reads check stored Expenses too. When an Expense's stored allocations don't
equal its amount (`assertStoredExpenseMoney`), or a Group's contributions don't
net to zero (`simplifyDebtsMinor`), the Expense list, balances, spending,
insights, trip summaries and export answer **500** with the standard
server-error body (#547). The fault is in stored data, not in the request, so
the server logs it once with the route, the code (`UNBALANCED_LEDGER`, or
another stored-money code) and the ids that find the record (its Group, Expense
or payment) as far as they are known, never member data. An edit of such an Expense still refuses with **422** and the code.

The shared module's tests pin these rules (`exact-money.test.ts`,
`split-calculation.test.ts`). Over HTTP,
`apps/web/src/app/api/groups/[id]/expenses/missing-split-amount.integration.test.ts`
pins a missing share (#497),
`apps/web/src/app/api/groups/[id]/expenses/validation-details.integration.test.ts`
the `details` shape (#538),
`apps/web/src/app/api/groups/[id]/drafts/review/route.integration.test.ts` a
split that doesn't add up, as To review reports it (#506), and
`apps/web/src/app/api/stored-data-faults.integration.test.ts` each read's 500
for stored money that doesn't add up (#547).

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
An archived Group refuses an edit, a restore and a `DELETE` of its Expenses
with **409** `GROUP_ARCHIVED`.

### POST /api/groups/[id]/expenses/tag-change

Moves several of the Group's Expenses to one Tag (#610). Any member may, as
for a single edit.

```json
{
  "tagId": "<an active Tag of the Group>",
  "expenses": [{ "id": "<Expense id>", "revision": 3 }]
}
```

`expenses` lists 1 to 100 Expenses (`EXPENSE_TAG_CHANGE_MAX`), each once, with
the revision the member last saw. A non-member gets **403**. A Tag that isn't
an active Tag of the Group gets **422** `INVALID_TAG`, and an archived Group
**409** `GROUP_ARCHIVED`; a list that is empty, too long or names an Expense
twice gets **422** `VALIDATION_ERROR`. Each of these changes nothing.

Otherwise each Expense changes on its own, under a single edit's rules: it
gets its own `editHistory` entry and `expense_updated` Activity event, and one
that can't change doesn't stop the rest. Nothing is retried. The reply lists
an outcome for each, in the order asked:

```json
{
  "status": 200,
  "data": {
    "tagId": "<the Tag>",
    "results": [
      { "expenseId": "<id>", "outcome": "changed", "revision": 4 },
      { "expenseId": "<id>", "outcome": "unchanged", "revision": 2 },
      { "expenseId": "<id>", "outcome": "changed-elsewhere" },
      { "expenseId": "<id>", "outcome": "unavailable" },
      {
        "expenseId": "<id>",
        "outcome": "refused",
        "code": "GROUP_ARCHIVED",
        "reason": "<member words>"
      }
    ]
  }
}
```

- `changed`: it is on the Tag now, at `revision`.
- `unchanged`: it was already on the Tag, so it wasn't edited. Sending the
  same request again reports each Expense it changed this way.
- `changed-elsewhere`: its revision isn't the one sent, so it was left as it is.
- `unavailable`: it was deleted, or isn't the Group's.
- `refused`: it couldn't change, for `reason`, such as the Group archived or
  the Tag archived while the request ran. `code` names a known cause.

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
The same member, active-tag and currency invariants as manual expenses apply
(422 `INVALID_MEMBERS`, `INVALID_TAG`, `CURRENCY_MISMATCH`).

### PATCH /api/groups/[id]/recurring/[recurringId]

Accepts any subset of the create body plus `isPaused: boolean`, and refuses with
the create codes except `NOT_HOUSEHOLD`. **Edits apply to
future periods only** — expenses already generated are ordinary expenses and are
never rewritten. Resuming a paused template skips the on-hold window rather than
backfilling it.

**Revision.** Send the `revision` the template was read with in
`X-Splitbook-Revision`; a template stored before revisions has none, so send
`0`. An edit, pause or resume answers the template with its `revision` one
higher. A revision that is no longer current answers **409** `STALE_REVISION`,
and a missing or malformed one **428** `REVISION_REQUIRED`; neither changes the
template. Older clients that send the revision only in `If-Match` are still
read; when both headers are sent, `X-Splitbook-Revision` decides. Don't send
`If-Match` yourself: a host may treat it as an HTTP precondition and answer 412
after the change was saved ([ledger migration](operations/ledger-migration.md)).

### DELETE /api/groups/[id]/recurring/[recurringId]

Hard-deletes the template. Expenses it already generated are never touched.

Send the template's current `revision` in `X-Splitbook-Revision`, as for PATCH:
a stale revision answers **409** `STALE_REVISION`, a missing or malformed one
**428** `REVISION_REQUIRED`, and the template stays.

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
equal the group default (`CURRENCY_MISMATCH`). An archived Group refuses a new
payment with **409** `GROUP_ARCHIVED`; a retry of one recorded before the
archive is still confirmed.

Settlements have `createdAt` but **no `date` field**, so they cannot be
back-dated or attributed to a past month.

---

## Balances

| Method | Path                        | Description                                               |
| ------ | --------------------------- | --------------------------------------------------------- |
| GET    | `/api/groups/[id]/balances` | Balances, Suggested payments and Debts before simplifying |

There is no `/balances/simplified` route — the single endpoint returns both the
per-member balances, Suggested payments and pairwise Debts.

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
      {
        "user": {
          "_id": "...",
          "name": "John"
        },
        "balance": -30.0
      },
      {
        "user": {
          "_id": "...",
          "name": "Jane"
        },
        "balance": 50.0
      },
      {
        "user": {
          "_id": "...",
          "name": "Bob"
        },
        "balance": -20.0
      }
    ],
    "debts": [
      {
        "from": {
          "_id": "...",
          "name": "John"
        },
        "to": {
          "_id": "...",
          "name": "Jane"
        },
        "amount": 30.0
      },
      {
        "from": {
          "_id": "...",
          "name": "Bob"
        },
        "to": {
          "_id": "...",
          "name": "Jane"
        },
        "amount": 20.0
      }
    ],
    "currency": "EUR",
    "hasMixedCurrencies": false,
    "debtsBeforeSimplifying": [
      {
        "from": {
          "_id": "...",
          "name": "John"
        },
        "to": {
          "_id": "...",
          "name": "Jane"
        },
        "amount": 30.0
      },
      {
        "from": {
          "_id": "...",
          "name": "Bob"
        },
        "to": {
          "_id": "...",
          "name": "Jane"
        },
        "amount": 20.0
      }
    ],
    "byCurrency": [
      {
        "balances": [
          {
            "user": {
              "_id": "...",
              "name": "John"
            },
            "balance": -30.0
          },
          {
            "user": {
              "_id": "...",
              "name": "Jane"
            },
            "balance": 50.0
          },
          {
            "user": {
              "_id": "...",
              "name": "Bob"
            },
            "balance": -20.0
          }
        ],
        "debts": [
          {
            "from": {
              "_id": "...",
              "name": "John"
            },
            "to": {
              "_id": "...",
              "name": "Jane"
            },
            "amount": 30.0
          },
          {
            "from": {
              "_id": "...",
              "name": "Bob"
            },
            "to": {
              "_id": "...",
              "name": "Jane"
            },
            "amount": 20.0
          }
        ],
        "currency": "EUR",
        "debtsBeforeSimplifying": [
          {
            "from": {
              "_id": "...",
              "name": "John"
            },
            "to": {
              "_id": "...",
              "name": "Jane"
            },
            "amount": 30.0
          },
          {
            "from": {
              "_id": "...",
              "name": "Bob"
            },
            "to": {
              "_id": "...",
              "name": "Jane"
            },
            "amount": 20.0
          }
        ]
      }
    ]
  }
}
```

Balances are **running and cumulative** — never reset by Month. **`debts` is the
legacy wire name for Suggested payments** and is unchanged for older Android builds
and Connected assistants. It is not the pairwise Debt ledger.

Each `byCurrency` entry contains `currency`, `balances`, `debts` and the additive
**`debtsBeforeSimplifying`** list. The top-level currency/figures repeat the Group's
default-currency entry. Both lists have rows shaped as
`{ from: { _id, name, image? }, to: { _id, name, image? }, amount }`, with positive
major-unit amounts exactly representable in that currency's minor units.

Debts divide each Expense's shares among its payers in proportion to their paid
amounts. Largest-remainder rounding is reconciled within each Expense so every
share and every payer's total remains exact; a cell stays at the floor or ceiling
of its exact proportion. Payer-own shares take precedence when reconciling ties,
then stable member-ID order. Self-debts are omitted. A Settlement from A to B
reduces A's Debt to B, or increases B's Debt to A. Opposite Debts are netted per
pair and currency, and zero pairs are omitted. Each member's net of Debts equals
their balance. Suggested payments still use the existing simplifier.

For example, Sam paying INR 1,060 split as Alex 880 / Priya 180, and Priya paying
600 for Alex, returns three `debtsBeforeSimplifying` rows: Alex → Sam 880,
Alex → Priya 600, Priya → Sam 180. The unchanged `debts` list suggests two payments:
Alex → Sam 1,060 and Alex → Priya 420.

The shared parser accepts replies **with or without** `debtsBeforeSimplifying`.
Missing means unavailable, not an empty list; web keeps Suggested and hides the
switch for older replies. When present, the list validates people and positive
finite amounts. Older clients can ignore it. No write or Settlement contract changes.

People who left or were removed stay in the ledger. A settled former member is
left out of `balances`; one who still has a balance appears under their own
account name. Former members named by a pairwise Debt retain their name even when
their overall balance is zero.

`hasMixedCurrencies` is true when any expense or settlement differs from the
group default. The write path forbids that, so it can only arise from legacy
data. Each currency has its own `byCurrency` entry; amounts are never combined or
converted across currencies.

---

## Trip summary

| Method | Path                                    | Description                                   |
| ------ | --------------------------------------- | --------------------------------------------- |
| GET    | `/api/groups/[id]/trip-summary?tz=IANA` | A Trip's whole-trip summary, its Insights tab |

### GET /api/groups/[id]/trip-summary

What a whole Trip cost (#316), built by `@splitbook/shared/trip-summary` and
decoded by `@splitbook/shared/trip-summary-read` (path and query key in
`api-paths` and `query-keys`, in the `ledger` scope).

- **Members only**, with the Group reads' refusal: `403` for a non-member, a
  member who has left, or a Group that isn't there, before the query is read.
- `tz` is **required**: days are calendar days in the viewer's named IANA zone,
  never the server's. A missing, unknown or fixed-offset zone is `400`
  `INVALID_TIME_ZONE`.
- **Only a Trip has one.** A Group of another Theme is `409` `NOT_A_TRIP`
  (`Only a Trip has a Trip summary.`), before anything is generated.
- **Side effect:** due recurring templates are generated first, as the Group's
  other reads do, respecting the product-wide switch (#289) and the Theme; a
  Trip's Theme has none, so on a Trip nothing is added either way.

Amounts are exact minor units of the Group's currency. The response holds:

- `spentMinor`, `expenseCount`, `yourShareMinor`, `youPaidMinor`,
  `yourExpenseCount`, `peopleCount` (everyone with a share), and
  `perPersonPerDayMinor` (Spent ÷ (people × days), rounded half up);
- `tripDates` (`start`, `end`: the Trip's own days in the zone), `window` (the
  days the series covers), `dayCount`, and `days`: each day's `spentMinor`,
  `expenseCount`, `yourShareMinor` and its two `biggest` Expenses (largest, then
  latest, then highest id);
- `dailyAverageMinor`: Spent on the window's days ÷ its days, rounded half up;
- `beforeTrip` / `afterTrip`: Expenses dated outside the window, summed;
- `byTag`: each Tag (by identity; `tagId` is null for a legacy name no Tag
  matches) with `spentMinor`, `expenseCount`, `yourShareMinor` and `percent`
  of the Trip's Spent (whole percents that total 100, by largest remainder);
- `suggestedPayments`: `{ from, to, amountMinor }`, people as `{ id, name }`,
  exactly the payments Balances suggests in the Group's currency;
- `otherCurrencies` (legacy Groups only: listed, never converted) and
  `hasExpenses` (any Expense at all).

**Expenses outside the Trip's dates** count in every whole-trip figure (Spent,
shares, per person per day, By Tag), as the trip strip's total and the Expenses
tab do, but are never drawn as days: they are summed in `beforeTrip` and
`afterTrip`, and the daily average covers only the Trip's own days.

**The window:** the Trip's first to last day; without an end date, the first day
to the last day an Expense falls on; without a start date, the first Expense's
day to the last day; without either, the days its Expenses fall on. A window
longer than 120 days is counted but not listed (`tooManyDays`, `days: []`).

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

| Method | Path          | Description                                                          |
| ------ | ------------- | -------------------------------------------------------------------- |
| GET    | `/api/export` | The member's Groups as CSV files, one zip, or one JSON backup (#318) |

### GET /api/export

The Export page's download (#317). It answers with a file: one CSV, a zip when
there are several, or with `format=json` one JSON backup of every chosen Group
(#318). Refusals and failures use the standard JSON error shape.

**Query params:**

| Param     | Required | Value                                                                                                 |
| --------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `groups`  | yes      | Group ids joined by commas, 1–50; repeats are ignored and the files follow this order                 |
| `from`    | no       | First day of the window, `YYYY-MM-DD`, inclusive                                                      |
| `to`      | no       | Last day of the window, `YYYY-MM-DD`, inclusive. Give both `from` and `to`, or neither for all time   |
| `include` | no       | Any of `payments`, `shares`, `deleted`, `history`, joined by commas                                   |
| `format`  | no       | `csv` (default), `json` (all-time backup), or `statement` (one Group, preview only)                   |
| `preview` | no       | `1` returns a bounded JSON preview instead of an attachment                                           |
| `tz`      | no       | The viewer's IANA time zone, `UTC` by default: the calendar payments, edits and deletions are read in |

A query it can't read (no Groups, an id that isn't one, half a window, a window
that ends before it starts, a day that doesn't exist, an unknown include, format
or time zone, or a window with `format=json`) is a 422 validation error. The
shared path builder is
`exportPath`; `parseExportQuery` and `planExportFiles` are in
`@splitbook/shared/export-request`, and the CSV builders in
`@splitbook/shared/export-csv`.

**Preview (#611).** Add `preview=1` to the same request. The response is `200`
JSON with `Cache-Control: no-store` and no `Content-Disposition`. The shared
`exportPreviewSchema` in `@splitbook/shared/export-preview` defines the reply:

- All formats carry `format`, `groupNames`, `generatedAt`, `from`, `to`,
  `timeZone` and `empty`.
- CSV carries `fileName` and `files`: each file has `name`, `kind`, `header`,
  at most five `rows`, `totalRows`, and `text` with the complete CSV file, including
  its UTF-8 BOM and CRLF line endings, for a file of up to 256 KB in UTF-8
  (`EXPORT_PREVIEW_TEXT_BYTES`), while the reply's files stay within 1 MB of `text`
  together (`EXPORT_PREVIEW_TEXT_TOTAL_BYTES`), in file order. A larger file has no
  `text` and takes none of that total; from the first file that would pass it, no later
  file has `text` either. A file without `text` says in its Text view to download it. Table / Text selects the sample or raw file. Cells match parsed download cells,
  including the leading apostrophe protecting spreadsheet formulas. Queries,
  column order, exact money formatting and row order use the download builders.
- JSON carries `fileName`, approximate `sizeBytes`, `earliestMonth`,
  `historyIncluded`, `paymentsIncluded`, `deletedExpensesIncluded` and exported
  `counts` (`members`, active `expenses`, `payments`, `deletedExpenses`,
  `editHistoryEntries`). Counts come from the built backup object in one pass;
  its bytes are serialized once for the download and size. Members are unique
  account ids across selected Groups. `earliestMonth` is the first active
  Expense Month, or null. Include flags control which lines the preview shows.
  The owner accepted the existing backup scope. The preview states:
  "Not included: recurring Expense templates and Activity history."
  Optional Expense edit history remains supported; the file format is unchanged.
- Statement requires `format=statement&preview=1` and exactly one Group. It
  projects the canonical printable statement builder into `statement`, with
  its header and currency buckets: `spentMinor`, `expenseCount`,
  `paymentTotalMinor`, `paymentCount`, named `people` (Paid, Share, Net in
  minor units for the period, plus current all-time `balanceMinor`),
  `suggestedPayments`, and up to five first `expenses` including `paidBy` and
  `splitBetween` allocations. Currency buckets remain separate; current all-time
  balances and Suggested payments are not period contributions.
  The existing printable page still supplies print/save as PDF.

Preview uses the same membership check and real row limit as its download or
printable statement. No Groups remains 422, a missing session 401, nonmembership
403, and too many rows 413 with `EXPORT_TOO_LARGE`. Statement row limits include
its all-time inputs, as the printable statement does. A JSON backup with Group
metadata has contents even when there are no Expenses.

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
  several, `application/json; charset=utf-8` for a backup.
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

**JSON backup.** With `format=json`, the download is one
`splitbook-<n>-groups-backup.json` in the versioned `splitbook-backup/1`
format: exact minor units, stable ids and names, never an email (an address
typed into a description, note or name reads `[redacted]`). Payers and shares
are always in it; `payments`, `deleted` and `history` work as for CSV, and
`shares` changes nothing. The schema, `backupSchema` in
`@splitbook/shared/export-backup`, is described in
[JSON backup and printable statements](export-backup.md).

### Printable statement page

`/groups/[id]/statement?from=…&to=…&tz=…` (or `scope=trip` for a Trip's whole
trip, which the Trip's Share wrap-up opens) is a server-rendered page, not an
API route: it adds no JSON read or query key. It has the same members-only
check as the Group reads, before anything is read; a Group the member never
joined, has left, or that doesn't exist answers a real `403` with the app's
"Group not found" page, and a signed-out visitor is redirected to `/login`.
See [JSON backup and printable statements](export-backup.md).

A whole-trip statement lists every recorded Payment of the Group, including those before
and after the Trip's stored dates, oldest first with recorder names. Outside Payments are
marked "Before the trip" or "After the trip" using days in the viewer's time zone, as for
Expenses. The Payment count and total cover that complete list. Period statements still
filter Payments by their date window; Settlements are never attributed to a Month.
Current balances and suggested payments remain all-time.

---

## Not implemented

Documented in earlier drafts but absent from the codebase:

- **Receipt upload** (`POST`/`DELETE .../receipt`). `Expense.receiptUrl` exists in
  the model and `ExpenseDetails` links to it, but the field is not in
  either Zod schema, so no request can populate it. See
  [`features/receipts.md`](features/receipts.md).
- **`GET /api/groups/[id]/balances/simplified`** — folded into `/balances`.
