# API Endpoints

All endpoints return JSON. Auth required unless marked 🔓 (public).

Responses under `/api/` carry `Cache-Control: private, no-store` to prevent browsers, phones and shared caches from storing them.

Successful responses use `{ "data": { ... }, "status": 200 }` unless the route
states its own success format.

## Error contract

Every refusal Splitbook writes carries a code, with `{ error, status, code, …data }`. `error` is the words
shown to the member, `status` matches the HTTP status, and `code`
is the stable machine-readable refusal code. Clients match `code` to select
behaviour. The vocabulary in `packages/shared/src/refusals.ts` supplies statuses
and words. Services throw `new Refusal(code, data?)`, and HTTP routes hand a
caught value to `serverError(cause)`. The Draft family applies its private policy
through `draftError` below. A `Refusal` remains an `Error` with its code as its
`message` for existing callers.

```json
{
  "error": "This record changed while you were editing. Reload the latest version before saving.",
  "status": 409,
  "code": "STALE_REVISION"
}
```

The direct `unauthorized()`, `forbidden()` and `notFound(resource)` helpers
answer `401` `UNAUTHORIZED`, `403` `FORBIDDEN` and `404` `NOT_FOUND`.
The proxy's anonymous API answer, the notification routes and the rates cron
use the same coded unauthorized body. A missing resource keeps its resource's
words. The signed-out example is
`{ "error": "Unauthorized", "status": 401, "code": "UNAUTHORIZED" }`.

Demoting or removing the last admin carries `LAST_ADMIN`, removing yourself
carries `SELF_REMOVE`, and invitation refusals carry `INVITATION_NOT_PENDING`,
`INVITATION_EXPIRED` or `ALREADY_INVITED`. Their statuses and words are kept.
Both payment routes answer `422` `FORBIDDEN_SETTLEMENT` with
"Only the payer or recipient can record this payment".

A changed or missing Group deletion request answers `409`,
"This Group changed. Reload and try again.", with `GROUP_DELETION_CHANGED` or
`GROUP_DELETION_NOT_REQUESTED`. Notification registration answers
`NOTIFICATION_SETTINGS_CHANGED` (`409`) and `NOTIFICATION_TOKEN_REQUIRED`
(`400`) in its existing words.

Notification registration answers `503` `NOTIFICATIONS_UNAVAILABLE` with
"Notifications are not available yet." and its private response headers.
Android notification controls keep the offline state and its existing banner for this code.
Older Android APKs show the error state for this answer until they update.
Better Auth and the MCP transport keep their own protocol answers.

Some refusals add data. Money rules supply their own words and, when present,
a `field` path. A schema refusal supplies `details` with issue paths and
messages. Tag commands can carry the current Tag `snapshot` and an
`existingTagId`. Currency removal can carry a `use` summary. Leaving a Group or
removing a member can carry `balances` with major-unit `amount` and `currency`,
or `recurringExpenses` with `id` and `description`. Route sections describe when
each field is present. Bulk Tag-change item outcomes inside a successful `200`
answer and Connected assistant tool results keep their own result protocols.

### Codes and statuses

This list includes the money codes whose words come from the rule that refused.
A test compares every code and all of its statuses with the vocabulary.

<!-- refusal-codes:start -->

| Code                                   | HTTP status |
| -------------------------------------- | ----------- |
| `ACCOUNT_CHANGED`                      | 419         |
| `ACTIVITY_BACKLOG_FULL`                | 503         |
| `ALREADY_INVITED`                      | 409         |
| `AMBIGUOUS_TAG`                        | 409         |
| `CURRENCY_IN_USE`                      | 409         |
| `CURRENCY_IS_MAIN`                     | 409         |
| `CURRENCY_LOCKED`                      | 409         |
| `CURRENCY_MISMATCH`                    | 422         |
| `CURRENCY_NOT_LISTED`                  | 404         |
| `DATABASE_UNAVAILABLE`                 | 503         |
| `DRAFT_GROUP_LIMIT`                    | 409         |
| `DRAFT_NOT_FOUND`                      | 404         |
| `DRAFT_TRANSACTIONS_REQUIRED`          | 503         |
| `DRAFT_UNCONFIRMED`                    | 503         |
| `DRAFTS_DISABLED`                      | 404         |
| `DUPLICATE_PARTICIPANTS`               | 422         |
| `EMPTY_PARTICIPANTS`                   | 422         |
| `EXPORT_TOO_LARGE`                     | 413         |
| `FORBIDDEN`                            | 403         |
| `FORBIDDEN_SETTLEMENT`                 | 422         |
| `GROUP_ARCHIVED`                       | 409         |
| `GROUP_DELETION_CHANGED`               | 409         |
| `GROUP_DELETION_CONFIRMATION_REQUIRED` | 409         |
| `GROUP_DELETION_NOT_REQUESTED`         | 409         |
| `GROUP_DELETION_UNAVAILABLE`           | 409         |
| `HEADER_SCENES_DISABLED`               | 404         |
| `IDEMPOTENCY_CONFLICT`                 | 409         |
| `INVALID_AMOUNT_RANGE`                 | 422         |
| `INVALID_COMPARE`                      | 400         |
| `INVALID_CROSS_CURRENCY_SETTLEMENT`    | 422         |
| `INVALID_CURRENCY`                     | 400         |
| `INVALID_GROUP_CURRENCIES`             | 422         |
| `INVALID_ID`                           | 400         |
| `INVALID_IDEMPOTENCY_KEY`              | 422         |
| `INVALID_JSON`                         | 400         |
| `INVALID_MEMBERS`                      | 422         |
| `INVALID_MONEY`                        | 422         |
| `INVALID_MONEY_PRECISION`              | 422         |
| `INVALID_MONEY_RANGE`                  | 422         |
| `INVALID_MONEY_VERSION`                | 422         |
| `INVALID_MONTH`                        | 400         |
| `INVALID_MONTHS`                       | 400         |
| `INVALID_PARTY`                        | 422         |
| `INVALID_PAYER_AMOUNT`                 | 422         |
| `INVALID_PERCENTAGE`                   | 422         |
| `INVALID_SETTLEMENT_BATCH`             | 422         |
| `INVALID_SHARES`                       | 422         |
| `INVALID_SPLIT`                        | 422         |
| `INVALID_TAG`                          | 422         |
| `INVALID_TAG_COMMAND`                  | 400         |
| `INVALID_TIME_ZONE`                    | 400         |
| `INVALID_WINDOW`                       | 422         |
| `INVITATION_EXPIRED`                   | 410         |
| `INVITATION_NOT_PENDING`               | 400         |
| `LAST_ACTIVE_TAG`                      | 409         |
| `LAST_ADMIN`                           | 409         |
| `LEAVE_CONFLICT`                       | 409         |
| `MISSING_SPLIT_AMOUNT`                 | 422         |
| `MONEY_REPRESENTATION_MISMATCH`        | 422         |
| `NO_SETTLEMENT_DEBT`                   | 422         |
| `NOT_A_TRIP`                           | 409         |
| `NOT_FOUND`                            | 404         |
| `NOT_HOUSEHOLD`                        | 422         |
| `NOTIFICATION_SETTINGS_CHANGED`        | 409         |
| `NOTIFICATION_TOKEN_REQUIRED`          | 400         |
| `NOTIFICATIONS_UNAVAILABLE`            | 503         |
| `OPEN_BALANCE`                         | 409         |
| `PAYER_TOTAL_MISMATCH`                 | 422         |
| `PERCENTAGE_TOTAL_MISMATCH`            | 422         |
| `QUERY_TOO_LONG`                       | 422         |
| `RECURRING_EXPENSE_PROBLEM`            | 409         |
| `RECURRING_EXPENSES_OFF`               | 409         |
| `REMOVAL_CONFLICT`                     | 409         |
| `REQUEST_KEY_REUSED`                   | 409         |
| `REQUEST_TOO_LARGE`                    | 413         |
| `REVISION_REQUIRED`                    | 428         |
| `SAME_PARTY`                           | 422         |
| `SELF_REMOVE`                          | 400         |
| `SETTLEMENT_TRANSACTIONS_REQUIRED`     | 503         |
| `SPLIT_TOTAL_MISMATCH`                 | 422         |
| `STALE_REVISION`                       | 409         |
| `TAG_ADMIN_REQUIRED`                   | 403         |
| `TAG_CHANGED`                          | 409         |
| `TAG_EXISTS`                           | 409         |
| `TAG_IN_USE`                           | 409         |
| `TAG_PRECONDITION_REQUIRED`            | 428         |
| `TAG_TRANSACTIONS_REQUIRED`            | 503         |
| `UNAUTHORIZED`                         | 401         |
| `UNBALANCED_LEDGER`                    | 422         |
| `UNBALANCED_TEMPLATE`                  | 422         |
| `UNSAFE_MONEY`                         | 422         |
| `UNSUPPORTED_CURRENCY`                 | 422         |

<!-- refusal-codes:end -->

### Validation and money

A body or query the route's schema refuses answers `VALIDATION_ERROR`, with
status **422** except the dispatch job's **400**. Schema validation normally
supplies each problem in `details` as `{ path, message }`, the shape the Draft APIs
use too (#538):

```json
{
  "error": "Validation error",
  "code": "VALIDATION_ERROR",
  "status": 422,
  "details": [{ "path": ["category"], "message": "Invalid category" }]
}
```

An Expense create refused only for the total amount’s precision uses
`INVALID_MONEY_PRECISION` instead, retaining the same `details` shape (#748).

Three hand-written schema refusals carry `VALIDATION_ERROR` and their own words,
without `details`. An invite's email (`Invalid email address`) and an invitation's
action (`Invalid action`) answer **422**. The dispatch job (`Invalid request`)
answers **400**. `VALIDATION_ERROR` is separate from `RefusalCode`. Tag commands
answer **400** `INVALID_TAG_COMMAND`.

### Authentication and faults

**Unauthenticated `/api/*` requests get `401` JSON, never a redirect.** Route
protection lives in `src/proxy.ts` (rules in `src/lib/auth/proxy-rules.ts`); for
API paths without a session cookie it answers `{ "error": "Unauthorized", "status": 401, "code": "UNAUTHORIZED" }`,
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

### Unreachable database

**A database Splitbook can't reach answers `503` `DATABASE_UNAVAILABLE` (#826).**
Before a request opens a connection on a pool that went idle, the server pings
the database, and tries once more 1 s later if it gets no answer, so a blip of
about a second goes unseen (#862). The ping writes nothing, so a save still runs
once, after the database answered. A request that still can't reach it, or whose
database drops mid-request, answers within about 5 s, never after the driver's
old 30 s or as "Internal server error":
`{ "error": "Couldn’t reach Splitbook. Try again.", "code": "DATABASE_UNAVAILABLE", "status": 503 }`.
Every route answers it, Better Auth's under `/api/auth/*` included. A write that
answers it may or may not be recorded, since its connection can drop mid-save:
the client keeps its `Idempotency-Key` or revision and sends the same request
again, which records it once. A web page that can't reach the database shows the
same words with Try again; Android shows them as Splitbook's own error, never as
being offline. `apps/web/src/app/api/database-unavailable.integration.test.ts`
pins each against a database it interrupts.

### Draft uncertainty

**A Draft request the server can't confirm answers `503` `DRAFT_UNCONFIRMED`, in
its own words (#861).** A To review save (`POST /api/groups/[id]/drafts/save`)
says "Save not confirmed. Everything is still in To review. Check again to finish
saving."; a Draft's creation keeps its own "Draft request not confirmed. Reload
before retrying; reuse the original creation request.". Either keeps the Drafts,
and the same request sent again records once (ADR 0008).

`draftError` answers schema failures as validation, invalid JSON as
`INVALID_JSON`, a typed refusal as itself, and an unreachable database as
`DATABASE_UNAVAILABLE`. Every other thrown value answers with the creation or
save uncertainty words above and is never logged, since it may hold submitted
values. This includes plain `GROUP_NOT_FOUND`, money errors, version errors and
raw timeouts.

The former set of 24 hidden typed refusals was made from cross-family census
injections. None reaches the Draft HTTP error policy through an admitted
request. Participant and Tag checks become review problems, and invalid
currency is also a review problem before saving. Per-Draft save outcomes keep
their existing classification. The synthetic cross-family answers and the
hidden-code set have been removed.

## Group writes

**An archived Group takes no more changes (#578).** Once an admin archives a
Group (`DELETE /api/groups/[id]`), every write to its ledger answers **409**
`GROUP_ARCHIVED` ("This Group was archived, so nothing more can be saved in
it.") and changes nothing: an Expense's create, edit, restore and delete, a
payment, a To review save (`POST /api/groups/[id]/drafts/save`), and an
assistant's `create_drafts` and `replace_draft`. The check is made inside the
write's own Group fence, so an archive that commits first stops a racing save.
The final Group read also enforces archive on a database without transactions, including restoring or moving an Expense's currency: an archive seen there refuses **409 `GROUP_ARCHIVED`** before the record is saved.

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

## Suggested exchange rates

### GET /api/groups/[id]/rates?from=EUR&to=INR

Requires the app session and current Group membership. An MCP bearer token alone is not an
app session. Anonymous requests answer **401**; non-members (including nonexistent Groups)
answer **403**. Invalid path ids answer **400**; missing or unsupported currency codes answer
**422** `VALIDATION_ERROR`. Both codes must be in the supported 30-currency registry.

The server reads its daily cache only; this request never calls a provider. Rates are units
of `to` per one unit of `from`, as a decimal string rounded half up to 12 decimal places.
No ledger amount is converted or changed. Example:

```json
{
  "data": {
    "suggestion": {
      "from": "EUR",
      "to": "INR",
      "rate": "112.5",
      "source": "mixed",
      "asOf": "2026-10-20",
      "fetchedAt": "2026-10-21T18:00:00.000Z",
      "ageDays": 1,
      "attributionRequired": true,
      "attribution": {
        "text": "Rates By Exchange Rate API",
        "url": "https://www.exchangerate-api.com"
      },
      "components": [
        {
          "currency": "EUR",
          "source": "frankfurter",
          "asOf": "2026-10-20",
          "fetchedAt": "2026-10-21T18:00:00.000Z"
        },
        {
          "currency": "INR",
          "source": "exchange-rate-api",
          "asOf": "2026-10-21",
          "fetchedAt": "2026-10-21T18:00:00.000Z"
        }
      ]
    }
  },
  "status": 200
}
```

`source` is `frankfurter`, `exchange-rate-api`, or `mixed`. Headline dates are the oldest of
the legs used; `ageDays` counts UTC calendar days since `asOf`. USD is the common base, so
USD pairs have only one component. A primary-only rate has `attributionRequired: false`
and `attribution: null`. If either leg is fallback, the client must display the returned
attribution text and link wherever the suggested rate appears. These rates must never be
passed to an assistant or exposed by another rate read.

No suggestion is a normal **200**, for example:

```json
{ "data": { "suggestion": null, "reason": "unavailable" }, "status": 200 }
```

Reasons: `unavailable` (no usable table or unrepresentable cross rate),
`currency_unavailable` (a supported currency has no quote), `stale` (a required cached quote
is older than three UTC days or invalid), or `same_currency` (no exchange is needed).
Exactly three days old is usable. A provider outage preserves the previous table without
changing its source or timestamps, but age is checked on every read. Responses, including
refusals, use `Cache-Control: private, no-store`.

### GET /api/cron/exchange-rates

A server job, **not a member API**. Requires `Authorization: Bearer <CRON_SECRET>`; a missing
server setting or incorrect/missing header answers **401**. It fetches one primary USD table
and, only when needed, one fallback table. A Mongo day claim deduplicates concurrent runs.
The **200** reply contains `data.refreshed` (whether this invocation obtained fresh provider
quotes), and, when true, `data.availableCurrencies` (usable cached non-USD
quotes). A previously claimed day answers **200** with `data.refreshed: false` without fetching.
If neither provider supplies any fresh supported quotes, the attempt answers **502** with
`data: { refreshed: false, reason: "providers_unavailable", availableCurrencies }`. The job logs
zero fresh currencies and the count of usable saved currencies, never rates. Saved suggestions
keep their source and timestamps and remain readable within the freshness limit. The day stays
claimed; the next daily invocation retries. Database faults answer **500**. All cron responses
use `Cache-Control: no-store` and never return rates.

The schedule is `0 18 * * *` UTC in `apps/web/vercel.json`. Production needs the owner to set
`CRON_SECRET` and deploy that configuration. Provider keys are not needed. See
[ADR 0010](adr/0010-exchange-rate-suggestions.md) for source terms, freshness and isolation.

---

## User

| Method | Path                         | Description                                           |
| ------ | ---------------------------- | ----------------------------------------------------- |
| GET    | `/api/user/profile`          | Get current user                                      |
| PATCH  | `/api/user/profile`          | Update profile                                        |
| GET    | `/api/user/balances`         | Cross-group balances by currency                      |
| GET    | `/api/user/assistant-groups` | The member's Groups as an assistant's page lists them |

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

### GET /api/user/assistant-groups

The member's Groups, as the approval page and an assistant's own page list them
(#620), for the Group checklist and Settings' "N of M Groups":

```json
{
  "data": {
    "groups": [
      {
        "id": "…",
        "name": "Maple House",
        "currency": "INR",
        "currencies": ["INR", "EUR"],
        "theme": "home",
        "archived": false,
        "rule": "not_allowed",
        "ruleSetBy": { "id": "…", "name": "Priya Shah" }
      }
    ]
  }
}
```

Archived Groups are listed, since assistants reach them too. `ruleSetBy` names the
admin who set Not allowed while they are still an admin, else `null`. It answers
**404** where assistants can't connect. The Groups an assistant leaves out come with
its connection (`GET /api/auth/mcp/connections`, runbook `mcp-connections.md`).

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

A Group with any deletion marker is refused on every direct API read (403
`FORBIDDEN`), even if its members are still stored. Across-Group lists, totals,
search and Activity omit it. Page titles use their generic denied metadata and
the statement renders its existing refusal view. Assistant tools retain their
inaccessible-Group result. Archive inclusion, admin-only assistant reach, list
ordering and selected export admission keep their established rules (#1126).

Every authenticated Group read answers **403** `FORBIDDEN` when the Group does not exist, exactly as when the member cannot read it (#1126). This includes Group detail, invite-link and admin-only assistant reach. Expense-not-found responses remain 404. Assistant tools retain their protocol-level “Group not found” result.

| Method | Path                                 | Description                               |
| ------ | ------------------------------------ | ----------------------------------------- |
| POST   | `/api/groups`                        | Create group                              |
| GET    | `/api/groups`                        | List user's groups                        |
| GET    | `/api/groups/[id]`                   | Get group detail                          |
| PATCH  | `/api/groups/[id]`                   | Update group                              |
| DELETE | `/api/groups/[id]`                   | Archive group (soft delete)               |
| GET    | `/api/groups/[id]/currencies`        | The Group's currencies and what uses them |
| POST   | `/api/groups/[id]/currencies`        | Add an extra currency (any member)        |
| DELETE | `/api/groups/[id]/currencies/[code]` | Remove an extra currency (admins)         |
| PUT    | `/api/groups/[id]/assistant-rule`    | Set the Assistant rule (admins)           |
| GET    | `/api/groups/[id]/assistant-reach`   | Whose assistants reach it (admins)        |

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

`alternateCurrencies` holds the Group's **extra currencies** (#719): at most 4
supported codes, none twice and none equal to `defaultCurrency`, the **main
currency**; anything else is refused with 422 `VALIDATION_ERROR`, saying why.
An Expense, a Settlement or a Draft may be in the main currency or any extra
currency; a recurring Expense stays in the main currency for now. `startDate` / `endDate` are validated together
(end must not precede start).

Creating a group seeds theme-appropriate default tags.

### Quick add and assistant Draft currencies (#732)

Quick add's shared `readQuickAdd(text, context)` accepts the main currency as
`context.currency` and the extra list as `context.alternateCurrencies`. Its read
returns `currency`, `currencyListed` and `currencyCandidates` alongside exact
`amountMinor` and the original `amountText`. A bare number uses the main currency.
A listed code or symbol uses that currency's minor units (JPY/KRW are whole units).
An unlisted currency produces `amount-currency`, keeps its code and amount text,
and leaves `amountMinor` null; it is never reinterpreted as the main currency.
An ambiguous symbol returns `currency: null` and the candidate codes, asking for a
code. `quickAddDraftValues` carries the read currency into the full Expense form.

The MCP `list_groups` and `group_context` replies keep `currency` as the main
currency and add `alternateCurrencies`, the normalised extra list. `create_drafts`
and `replace_draft` retain any supported explicit currency without conversion.
Listed currencies can be ready to save; an unlisted one is stored for correction,
with `currency` in `missingFields`, even when other facts are still missing.

`GET /api/user/to-review` includes each Group's main `currency` and
`alternateCurrencies`. Both it and `POST /api/groups/[id]/drafts/review` report
`CURRENCY_NOT_LISTED` in the item's `problems` when its currency is unlisted.
The shared `parseToReviewResponse` / `buildToReview` path used by web and Android
keeps the item readable, sets `state: "needs-details"` and gives the need
`{ field: "currency", reason: "currency-not-listed" }`; it is excluded from Ready
counts and totals. The save route refuses it on the server as well. Adding that
currency to the Group or changing the Draft to a listed currency removes the
problem on the next read. A changed currency list requires a fresh review before
saving. Preparing or correcting a Draft never changes Balances (ADR 0008).

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

Each Group also carries `latestExpenseCurrency`: the currency of the **viewer's**
latest non-deleted Expense in it by creation time (not one a recurring Expense added), or `null`. A new
Expense starts in it while the Group still lists it, else in the main currency
(#719). It is read from the Expenses; nothing is stored for it. An older Group's
`alternateCurrencies` is read as the rule allows: unsupported codes, repeats and
the main currency dropped, and the first 4 kept.

### GET /api/groups/[id]

Returns the populated group. **Side effect:** the Group ledger read module adds
due recurring Expenses after admitting the member and before reading the ledger,
so this read can create Expenses while recurring Expenses are switched on (see
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

`alternateCurrencies`, when sent, is checked against the main currency the Group
will have: one that includes the stored main currency, or a new `defaultCurrency`
that is already one of the extra currencies, is refused with 422
`INVALID_GROUP_CURRENCIES` (`field: ["alternateCurrencies"]`). The answer
carries `latestExpenseCurrency` like the reads.
An older Group's list is saved as the rule reads it, so a settings save never
fails on old data. Dropping an extra currency that something still uses is
refused as `DELETE /api/groups/[id]/currencies/[code]` refuses it (409
`CURRENCY_IN_USE`, below).

**The main currency's lock:** changing `defaultCurrency` once money is recorded
(any Expense, Settlement or recurring Expense, ever) is 409:

```json
{
  "error": "Currency cannot change after this Group has financial records.",
  "status": 409,
  "code": "CURRENCY_LOCKED"
}
```

### GET /api/groups/[id]/currencies

A Group's currencies as its settings show them (#721): the main currency and
whether it is locked, then each extra currency with what uses it and who added
it. Members only (403 otherwise).

```json
{
  "data": {
    "mainCurrency": { "code": "INR", "locked": true },
    "extraCurrencies": [
      {
        "code": "JPY",
        "use": {
          "expenses": {
            "count": 24,
            "items": [{ "_id": "...", "description": "Ramen at Ichiran" }]
          },
          "settlements": 0,
          "toReview": { "yours": 0, "others": 2 }
        },
        "added": {
          "by": { "_id": "...", "name": "Sam Chen" },
          "at": "2026-10-05T09:12:00.000Z"
        }
      }
    ]
  }
}
```

- `use.expenses` counts the Expenses in the currency, deleted ones aside, and
  lists up to 100 of them, latest first by date.
- `use.settlements` counts the Settlements that clear a Debt in the currency or
  were paid in it (#727).
- `use.toReview` counts the active To review items (Drafts) in the currency:
  the viewer's own, and other members', which are only counted, never shown.
- `added` is the latest recorded change that added the currency. One no
  recorded change added was there when the Group was created, so it names the
  Group's creator. It is null when that person no longer exists.

### POST /api/groups/[id]/currencies

Any member adds an extra currency: `{ "currency": "CHF" }`. 201 with the
currencies read above. The Group's currency rule refuses, with 422
`INVALID_GROUP_CURRENCIES` (`field: ["currency"]`), an unsupported code, the
main currency, a currency already on the list ("CHF is already one of this
Group’s currencies.") and a fifth extra currency. Two members adding the last
place at once: one is added, the other refused. Activity records a
`group_updated` event whose `changes.alternateCurrencies` holds the list before
and after, with `groupName` and `currencies` as described under Activity Feed.

### DELETE /api/groups/[id]/currencies/[code]

An admin removes an extra currency (403 for anyone else). 200 with the
currencies read. A code that isn't one of the Group's extra currencies is 404
`CURRENCY_NOT_LISTED`. The main currency is 409 `CURRENCY_IS_MAIN` ("INR is the
main currency, so it can’t be removed."), a conflict with the Group's state like
`CURRENCY_LOCKED`.

While any Expense (not deleted), Settlement or To review item uses the currency,
removing it is refused, saying what uses it in the read's `use` shape:

```json
{
  "error": "JPY can’t be removed while Lisbon & Tokyo uses it.",
  "status": 409,
  "code": "CURRENCY_IN_USE",
  "use": {
    "expenses": { "count": 24, "items": [{ "_id": "...", "description": "Ramen at Ichiran" }] },
    "settlements": 0,
    "toReview": { "yours": 0, "others": 2 }
  }
}
```

The check and the removal are one Group mutation, as is each Expense and
Settlement write's check that its currency is listed, so no Expense or
Settlement in the currency arrives in between. A Draft may still arrive in it
afterwards; saving it as an Expense is refused while its currency is unlisted. A deleted Expense comes back in its currency while the Group lists it, or while another live
Expense or a Settlement still uses it (an older Group's currency). Otherwise restoring it is 422
`CURRENCY_MISMATCH`, "Add GBP to the Group’s currencies to restore it." Activity records the removal like an addition.

### PUT /api/groups/[id]/assistant-rule

Sets whether members' Connected assistants may reach the Group (#621).

**Body:** `{ "rule": "allowed" | "not_allowed" }`. Any other value answers **422**.

**Authorization:** Only group admins; anyone else gets **403**. A change takes
effect on every assistant's next call. It records one `assistant_rule_changed`
Activity event (`metadata: { rule }`) in the same write. Setting the rule the
Group already has records nothing. **Response:** `{ "data": { "rule": … } }`.

### GET /api/groups/[id]/assistant-reach

The members' Connected assistants that reach the Group, for its admins (#621):

```json
{
  "reach": [
    {
      "member": { "id": "…", "name": "Sam Chen" },
      "assistant": "Claude",
      "lastUsedAt": "2026-10-20T09:30:00.000Z"
    }
  ]
}
```

A connection appears while it is live (not disconnected or expired, #618) and its
member hasn't left this Group out. The list is empty when the Group is Not allowed or assistants are off.
**Authorization:** Only group admins; anyone else gets **403**.
`apps/web/src/app/api/groups/[id]/assistant-rule/route.integration.test.ts`
covers both routes.

---

### Group header (#1201)

Group reads include `header: { style, scene, time }`. Style is `classic` or `scene`;
scene is `beach`, `sakura`, `eco-city` or `mountain-village`; time is `auto`,
`morning`, `day`, `sunset` or `night`. A Group with no stored header reads as
`{ "style": "classic", "scene": "beach", "time": "auto" }`. Switching to Classic
keeps the scene and time. Older Saved copies without the field are still accepted.
An unknown or malformed header is read as absent, so a newer scene or time never
prevents a Group, its list or a Saved copy from opening; the shared rule supplies
the Classic default. Stored headers are preserved during unrelated admin edits.

`PATCH /api/groups/[id]/header` accepts that three-field object directly and returns
`200 { "data": { "header": { "style": "scene", "scene": "sakura", "time": "sunset" } }, "status": 200 }`.
The app session is required (401 without one); any current member may save, and a
non-member, including one who left or was removed, is refused (403). The ordinary
Group PATCH stays admin-only. Invalid choices answer 422 `VALIDATION_ERROR`.
This is a preference write: no revision header, ledger revision or currency lock.
It uses the existing Group mutation fence and records a `group_updated` Activity
with `changes.header.old` and `.new` together. A no-op records nothing. Activity
names the actor and the choice, for example “Sam changed the header to Sakura, at
Sunset”, with the previous header in its detail.

The off-by-default environment switch is `NEXT_PUBLIC_HEADER_SCENES_ENABLED`
(web and server), and `EXPO_PUBLIC_HEADER_SCENES_ENABLED` in the Android build.
Only the literal `true` enables it. While off, header writes answer **404**
`HEADER_SCENES_DISABLED` (“Header scenes are not enabled”), as disabled Drafts
do: nothing is stored and no Activity is recorded. Earlier settings remain stored.
Group reads mask the style as
`classic` while off and keep the stored choice; settings/renderers use the same switch.
Android keeps the wire header in the existing Saved copy, without a migration.
`auto` follows the viewer's local hour when opening or returning: Morning [5,10),
Day [10,17), Sunset [17,20), Night otherwise. It runs on no timer.

## Members

| Method | Path                                | Description                 |
| ------ | ----------------------------------- | --------------------------- |
| PATCH  | `/api/groups/[id]/members/[userId]` | Change member role          |
| DELETE | `/api/groups/[id]/members/[userId]` | Remove from group           |
| POST   | `/api/groups/[id]/leave`            | The signed-in member leaves |

PATCH and DELETE are admin-only. **Body** for PATCH is `{ "role": "admin" | "member" }`.
Demoting or removing the last admin returns **409**; removing yourself returns
**400** `You cannot remove yourself. Use leave group instead.`

### DELETE /api/groups/[id]/members/[userId]

An admin removes another member, with no body. The member is removed only when they
could leave themselves (#875), so their Debts never stay in Balances with nobody able
to record them, and a broken recurring Expense's missed months never fall on the
others:

- **Settled up first.** The member's balance must be zero in every currency.
  Otherwise **409** with `code: "OPEN_BALANCE"`, a readable `error` such as
  `Priya Shah owes ₹300.00 in this Group. Settle up before removing them.`
  (`is owed` for a positive balance; `Priya Shah owes €12.50 and is owed ₹600.00`
  across currencies), and `balances` as for leaving.
- **Due recurring Expenses count.** The recurring Expenses already due are added
  first, as for leaving, so this month's Rent is part of the settle-up. If adding them
  doesn't finish, **409** `code: "REMOVAL_CONFLICT"` with
  `This Group changed while you were removing this member. Try again.`, and trying
  again adds what is still missing. The same answer comes when the members change
  while the removal is checked, such as the admin losing their role.
- **No recurring Expense in its problem state includes them (#257)**, as for leaving:
  **409** `code: "RECURRING_EXPENSE_PROBLEM"` with `recurringExpenses` and a readable
  `error` such as
  `Rent (recurring) still includes Priya Shah. Remove them from it before removing them from the Group.`
  It is checked before the balance.

**Response:** `{ "data": { "message": "Member removed" } }`. Activity records
`member_left` with `{ userId, userName, method: "removed" }`: `userName` is the
removed member's name at the time, which Activity shows ("Alex removed Priya Shah
from the group"). A removal recorded before #875 has no `userName` and reads
"removed a member". A member who isn't an admin, or someone outside the Group, gets
**403**; a `userId` who isn't a member gets **404**.

### POST /api/groups/[id]/leave

Any member may leave. The body is empty, or `{ "deleteIfLastMember": true }` from the
last member (below). While other members remain, the rules are:

- **Settled up first.** The member's balance must be zero in every currency.
  Otherwise **409** with `code: "OPEN_BALANCE"`, a readable `error` such as
  `Settle up before you leave: you owe ₹150.00 in this Group.`, and
  `balances: [{ "currency": "INR", "amount": -150 }]` (negative: they owe;
  positive: they are owed).
- **Due recurring Expenses count.** The recurring Expenses already due are added
  first, as every Group read does, and only then is the balance checked. A Rent that
  fell due this month is therefore part of the settle-up. If adding them doesn't
  finish, the leave is refused with **409** `code: "LEAVE_CONFLICT"`; trying again
  adds what is still missing. An archived Group adds none, and neither does any Group
  while recurring Expenses are switched off.
- **No recurring Expense in its problem state includes them (#257).** A template in
  its problem state (its Tag archived, a member it names gone, or its currency or
  money unreadable) adds nothing, and its missed months are added once it is
  repaired, shared by whoever it includes then. So while one includes the member, as
  a payer or in its split, the leave is refused with **409**
  `code: "RECURRING_EXPENSE_PROBLEM"`, a readable `error` naming it, such as
  `Rent (recurring) still includes you. Ask an admin to remove you from it, then leave.`
  (an admin reads `Remove yourself from it, then leave.`; several are named together,
  `Rent (recurring) and Wi-Fi (recurring) still include you.`), and
  `recurringExpenses: [{ "id": "…", "description": "Rent" }]`. Once an admin repairs
  it, its missed months are added with the member's share, and the settle-up covers
  them; once they remove the member from it, the leave goes ahead. It is checked
  before the balance, and only where recurring Expenses run: not while they are
  switched off, outside a Household, or in an archived Group. Before #257 such a
  template didn't hold up the leave.
- **The last admin hands over first.** The only admin gets **409**
  `code: "LAST_ADMIN"`, `Make someone else an admin before you leave.`

**The last member deletes the Group.** Nobody would be left to reach it, so the last
member's leave permanently deletes the Group and its history: its Expenses,
Settlements, Activity, recurring Expenses, invitations, Drafts and Tag actions. It
needs their consent: without `{ "deleteIfLastMember": true }` it is refused with
**409** `code: "GROUP_DELETION_CONFIRMATION_REQUIRED"` and nothing changes. Where the
database can't run transactions it is refused with **409**
`code: "GROUP_DELETION_UNAVAILABLE"`, and the member stays. Balances and recurring
Expenses aren't checked: no member would remain to settle with.

**Response:** `{ "data": { "message": "Left group", "archived": false } }`, and
Activity records `member_left` with `{ userId, method: "left" }`. For the last member
the Group is emptied and hidden at once, then its records are deleted in batches:
`{ "data": { "message": "Left group", "archived": true, "deleted": true, "deletionPending": false } }`
once everything is gone, or `"deleted": false, "deletionPending": true` while the
rest is still being deleted, which the server finishes in the background and a retry
with the same body resumes. `archived: true` means only that the Group is already out
of reach; nothing of it is kept, and no Activity is recorded.
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

Tag refusals use the [error contract](#error-contract). Every `409` and
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

An Expense retry uses its immutable original Tag alias to recognise the recorded submission, including a duplicate race after that name is reused. Both a duplicate-race response and an ordinary retry show the recorded Tag identity's current label; neither creates another Expense. Creation retries use the actor/receipt/new-save order described under Settlements.

An edit, delete or restore checks the actor's current membership again at each write, including legacy revision initialization and the financial save. If the actor left after admission, it answers **403 `FORBIDDEN`** and does not apply the change. A financial edit or restoration also rechecks its resulting payers and split participants at commit; a departed participant answers **422 `INVALID_MEMBERS`**. Notes-only and Tag-only edits keep historical money naming former members.

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
- `currency` — must be **one of the Group's currencies**: its main currency or an
  extra currency (`CURRENCY_MISMATCH`, "Currency is not one of this Group’s
  currencies"). An edit may change it to another of them. Amounts are kept in
  their own currency, never converted; JPY and KRW take whole amounts.
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

A create answers **422** with each path and message in `details`, a refusal about
the total at `["amount"]`. When the sole issue is the total amount's precision,
its code is `INVALID_MONEY_PRECISION`, and `error` carries the precision message,
matching edit. This is identified by a Zod issue's `moneyCode` parameter and path,
never by its wording. Mixed problems and precision refusals on other fields stay
`VALIDATION_ERROR`. An edit answers **422** with the money code above and the path
as `field`; a refusal about the total itself, such as its decimals, has no `field`.
Android treats `INVALID_MONEY_PRECISION` on an initial create or edit as a definite
refusal: the draft stays editable and shows the message, with no reconciliation or
uncertain save. A retry still retains its earlier unconfirmed submission.

Reads check stored Expenses too. When an Expense's stored allocations don't
equal its amount (`assertStoredExpenseMoney`), or a Group's contributions don't
net to zero (`simplifyDebtsMinor`), the Expense list, balances, spending,
insights, trip summaries and export answer **500** with the standard
[server-error body](#authentication-and-faults) (#547). The fault is in stored data, not in the request, so
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
&includeUserByCurrency=1       // opt-in; adds summary.userByCurrency (#759)
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
  another listed or historical currency is compared by its own amount, without conversion.
- `limit` is capped at 100 (`EXPENSE_PAGE_MAX_LIMIT` in
  `@splitbook/shared/expense-page-read`), and `pagination.limit` says what was
  used. A zero, negative or unreadable `limit` is the default 20.
- `includeRecurringCount=1` adds `summary.recurringCount`, how many of the
  filtered Expenses recurring Expenses added. It is left out while recurring
  Expenses are switched off (#289), even when asked for.
- `includeUserByCurrency=1` adds `summary.userByCurrency`: for each currency
  the filtered Expenses are in, `{ currency, userOwes, userGetsBack }` for the
  signed-in member, worked out as `userOwes` and `userGetsBack` always are for
  the main currency, in that currency's own amounts. Nothing is converted. The
  order is the Group's: the main currency, its extra currencies, then any other
  currency the Expenses are still in, alphabetically. Without it, the response
  is unchanged; `userOwes` and `userGetsBack` stay the main currency's (#759).
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

**A currency Splitbook no longer supports (#810).** Stored money outlives today's
currency list, as in Activity (#779). An Expense in such a currency, such as a
legacy row in `DEM`, is listed with its stored `amount`, `currency` and
allocations, unchecked and never converted. It counts in `count` and
`pagination.total`, and Spent includes it as its own line: `totalsByCurrency`
ends with one entry per such currency, summed from the stored minor units at 2
places (`readUnsupportedAmountMinor`), after the Group's currencies and any it
no longer lists, alphabetically. Positions and per-currency views don't include it: it stays
out of `totalAmount`, `userOwes`, `userGetsBack`, `userByCurrency` and
`byMember`. The apps show its amount with its code (`DEM 40.00`), last in Spent,
and no position.

**The other reads, Delete and edits (#820).** The rule holds everywhere else. Export
lists such an Expense and its allocations, and a payment in such a currency, as
stored, at 2 places (the CSV's amounts, the backup's `amountMinor`), and the statement gives its currency a
section with Spent, the Expense count and the Expenses, but no one's figures and
no Suggested payment. Home's spending (`GET /api/user/spending`), a Group's
Insights and the Trip summary leave it out entirely, and Insights doesn't start a
Group's Months at it. Deleting it works, keeping its money as stored. Any edit of
it, its description alone or nothing new included, and a restore, is refused with
**422** `UNSUPPORTED_CURRENCY`, "This Expense is in DEM, which Splitbook no longer
supports. It can’t be changed, only deleted.", and nothing stored changes; a Tag
change refuses it with that code and those words. On the Balances tab, Payments mark a
payment in such a currency "Not in Balances" and count only the others as in the
balances above. Android lists it, and says why it can't open it.

### GET /api/groups/[id]/expenses/check-duplicate

**Query params:** `?description=...&amount=...&date=...&excludeId=...`

Returns `{ "isDuplicate": false }` when any of the first three are missing.
Day bounds are computed in the **server process's local timezone**, unlike the
UTC convention used by the list filter.

### PATCH /api/groups/[id]/expenses/[expenseId]

Accepts any subset of the create body, plus `isDeleted: false` to restore a
soft-deleted expense. Each edit appends a diff to the expense's `editHistory`.
An archived Group refuses an edit, a restore and a `DELETE` of its Expenses
with **409** `GROUP_ARCHIVED`. An Expense in a currency Splitbook no longer
supports refuses every edit and a restore with **422** `UNSUPPORTED_CURRENCY`
(see the Expenses read).

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
- `refused`: it couldn't change, for `reason`, such as the Group archived, the
  Tag archived while the request ran, or the Expense in a currency Splitbook no
  longer supports (`UNSUPPORTED_CURRENCY`). `code` names a known cause.

---

## Recurring expenses

Recurring generation recognises an already recorded template/Month before refusing new work on a drifted template. It confirms that record and can publish its pending Activity without another Expense or currency lock. For a new Month on a replica set, its currency lock and Expense commit together: a failed insertion leaves neither. Ordinary standalone writes retain ADR 0007’s lack of transaction rollback; a failed insert there can leave the currency locked.

Generation rechecks that the Group is open at the Expense commit. If an archive wins that race, the triggering read still answers normally, adds no Expense for that Month and leaves its marker unchanged so a later eligible read can retry it. The template's creator remains the recorded actor and receives no alert for that Expense. Payers and split participants are checked again at commit. If a participant leaves before that point, the read still succeeds without that Expense or a marker advance; a later eligible read can add the Month.

Household-themed Groups only (`category: "home"`).

Every ledger read brings due recurring Expenses up to date through the read module.
The owner clarified assistant money-tool parity on 12 November 2026.

| Read                                                                       | Recurring generation                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Member Group detail, Expenses and one Expense                              | Yes                                                        |
| Member Balances, Insights and Trip summary                                 | Yes, with the Theme's existing eligibility                 |
| Group Activity and Home Activity                                           | Yes                                                        |
| Search                                                                     | Yes                                                        |
| Duplicate warning when adding an Expense                                   | Yes                                                        |
| Draft review and To review                                                 | Yes, before comparing saved Expenses                       |
| Payments list                                                              | Yes                                                        |
| Debt for a new batch or cross-currency single payment                      | Yes, after receipt lookup and before its write transaction |
| Same-currency single payment and a confirmed payment receipt               | No Debt calculation                                        |
| Home balances and member spending                                          | Yes                                                        |
| Export and statement                                                       | Yes                                                        |
| Rate suggestion                                                            | Metadata admission                                         |
| Invite link                                                                | Metadata admission                                         |
| Admin assistant reach                                                      | Metadata admission                                         |
| Tags and Tag-action receipt                                                | Metadata admission                                         |
| Currency settings                                                          | Metadata admission                                         |
| Recurring-template settings                                                | Metadata admission                                         |
| Private Draft list                                                         | Metadata admission                                         |
| Page titles                                                                | Metadata admission                                         |
| Groups list                                                                | Metadata admission                                         |
| Assistant approval list                                                    | Metadata admission                                         |
| Assistant `group_balances` and `group_spending`                            | Yes                                                        |
| Assistant `list_groups` and `group_context`                                | Metadata admission                                         |
| Assistant `list_drafts`, `create_drafts`, `replace_draft`, `discard_draft` | Metadata admission, followed by each Draft operation       |
| Assistant `connection_status`                                              | No Group read                                              |

The two assistant money tools may cause the usual notifications to other involved
members. Generation attributes the Expense and Activity to the template creator and
applies the no-self-alert rule. The Groups list's latest manual-Expense currency
explicitly excludes recurring Expenses. Metadata operations use `readGroupMetadata`
and `readGroupsMetadata` for actor admission and delivery checks.

The across operations support exclusive-id `page`, `fields` projections and
bounded refill after revocation. Assistant `list_groups` still queries 51
projected Groups to deliver 50 with its existing `next` cursor. The module runs
one due check per operation, once per newly admitted page Group; nothing due
costs one schedule aggregate including the product-switch record. A switch
transition still performs its durable bookkeeping. Empty refill batches do not
run generation again.

Generation also runs on template creation/edit and before a member's leave or removal is checked. An archived Group materializes
nothing. A template in its problem state that includes a member keeps them in the
Group until it is repaired or they are taken out of it (#257, see
[leaving](#post-apigroupsidleave)).

**Off by default (#289).** The whole feature sits behind the server's
`RECURRING_EXPENSES_ENABLED` switch, on only when it is `true`. While it is off:

- POST, PATCH (edit, pause or resume) and DELETE answer **409**
  `{ "error": "Recurring Expenses are turned off.", "status": 409, "code": "RECURRING_EXPENSES_OFF" }`
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
(422 `INVALID_MEMBERS`, `INVALID_TAG`, `CURRENCY_MISMATCH`); a recurring Expense
is in the Group's main currency.

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
state, though its client-side check does not cover currency drift. While it
includes a member, they can't leave or be removed (#257).

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

Payment and Expense creation retries first admit the current actor, then recognise the matching stored receipt, before checking a new save. A named party's departure or a later archive does not refuse an already recorded payment: the retry confirms it with **201** and its original IDs. A departed actor still answers **403 `FORBIDDEN`**. For new saves, archive refusal precedes participant validation; for an existing key, a changed body answers **409 `IDEMPOTENCY_CONFLICT`** before participant validation.

A Group that disappears after route admission is refused with **403 `FORBIDDEN`**, including a single payment; it is not a server fault.

A new single payment rechecks the current actor and both parties at commit: **403 `FORBIDDEN`** if the actor left, or **422 `INVALID_MEMBERS`** if its payer or recipient left. Nothing is recorded when that final check refuses.

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
be one of the Group's currencies (`CURRENCY_MISMATCH`). An archived Group refuses a new
payment with **409** `GROUP_ARCHIVED`; a retry of one recorded before the
archive is still confirmed.

Settlements have `createdAt` but **no `date` field**, so they cannot be
back-dated or attributed to a past month.

### POST /api/groups/[id]/settlements/batch (#734)

Record one payment that clears Debts in several currencies between the same two
members. Requires a signed-in Group member who is the payer or recipient, and an
`Idempotency-Key` (the same printable 8–128 character format as a single save).
`paidBy` defaults to the signed-in member. `paidCurrency` is the common paying
currency and must be the Group's main currency or a listed extra currency.

```json
{
  "paidBy": "samId",
  "paidTo": "alexId",
  "paidCurrency": "INR",
  "settlements": [
    { "currency": "INR", "amount": 500 },
    {
      "currency": "EUR",
      "amount": 20,
      "amountPaidMinor": 185000,
      "appliedRate": "92.5",
      "rateKind": "custom",
      "suggestedRate": "92.1",
      "rateSource": "frankfurter",
      "rateAsOf": "2026-10-20",
      "rateFetchedAt": "2026-10-21T00:15:00.000Z"
    }
  ]
}
```

`settlements` contains 1–32 rows, with each cleared `currency` appearing once.
Each `amount` is the amount **cleared**, in major units of that row's currency;
`note` is optional per row. Cross-currency rows carry the same paid amount and
rate fields as a single Settlement, except that `paidCurrency` comes from the
payment. A row in the paying currency omits all cross-currency fields. The
single-Settlement precision, rate validation, historical cleared-currency,
partial-payment and overpayment rules apply to each row.

The payer must currently owe the recipient in each row's currency, either as a
Debt before simplifying or as a Suggested payment. A missing or reversed Debt
refuses the entire batch with **422** `NO_SETTLEMENT_DEBT`; reload the latest
Debts before starting a new submission. Non-members get **403**; a recording
member who is neither payer nor recipient gets **422** `FORBIDDEN_SETTLEMENT`.
Invalid fields are **422** `VALIDATION_ERROR` with per-field details; an unlisted
paying currency or unused historical cleared currency is **422** `CURRENCY_MISMATCH`.

All currency and Debt checks and every Settlement insert run sequentially inside
**one transaction under the Group mutation fence**. An Expense save, membership
change, archive or deletion serializes against the whole payment. If any row
fails, no Settlement or Activity event is committed. A database without
transactions returns **503** `SETTLEMENT_TRANSACTIONS_REQUIRED`, without writes.

**201 response:** `{ "status": 201, "data": { "paidCurrency": "INR",
"totalPaidMinor": 235000, "settlements": [ ... ] } }`. The `settlements` array
contains the normal populated Settlement records in request order, including
`_id`, canonical `amountMinor`, immutable paid/rate fields, and
`pairDebtBeforeMinor` / `pairDebtAfterMinor` on **every** row, including same-currency
rows. Pair figures use the before-simplifying Debt in that row's cleared currency,
from the payer's side, immediately before and after its write within the batch.
The paid total adds the separately rounded paid amounts in **one currency only**;
each ledger moves solely by its own row's cleared amount.

One key identifies the **whole ordered request**. Concurrent or later retries
return the same saved records and figures, even when the Debts have since cleared
or the Group has been archived. A changed row, rate, payer, payee, paying currency
or row order with the same key returns **409** `IDEMPOTENCY_CONFLICT`. Single saves
and batches share the key namespace for this recording member and Group. Never
retry individual rows from an unconfirmed batch with new keys. Nothing retries
a write without the member's explicit action.

Activity uses **one `settlement_recorded` event per Settlement**, with that row's
cleared amount, paid amount, rate provenance and immutable pair figures. Each event
also carries `metadata.batchId` (the first Settlement's id as a non-empty string)
and `metadata.batchSize` (the number of Settlements, an integer of at least 1),
including a one-row batch. The Group and user Activity reads retain both fields.
A single `POST /settlements` event carries neither; older events remain valid.
Clients collect events with the same batch reference and show **one payment** in
Activity, including when a page boundary splits the batch. Events are committed to each row's recoverable outbox with the ledger and published only
after the whole transaction commits. A retry cannot duplicate them.

`groupSettlementBatches(events)` from `@splitbook/shared/settlement-batch-activity`
is the shared, word-free projection for both clients. It takes events in feed
order and returns `{ kind: 'event', event, complete: true }` for an event without
a full batch reference or with `batchSize: 1`. A multi-row batch becomes
`{ kind: 'batch', batchId, batchSize, events, complete }` at its first supplied
event's position, with its events still in their supplied order. `complete` is
true when all `batchSize` events are present; a page-split batch is incomplete.
Call it again on the concatenated raw pages to join the batch. It does not mutate
the events or keep state between calls, and supplies no display wording.

The shared module `@splitbook/shared/settlement-batch` exports:

```ts
calculateSettlementBatch(input: SettlementBatchCalculation): SettlementBatchAmounts;
```

`SettlementBatchCalculation` is `{ debts: readonly { currency: string;
amountMinor: number }[]; paidCurrency: string; rates: Readonly<Record<string,
SettlementBatchRate | undefined>> }`. Debts belong to one directed pair. Rates are
keyed by cleared currency; the paying currency itself needs none.
`SettlementBatchRate` is one of:

- `{ rateKind: 'entered'; rate: string }` when no suggestion is available;
- `{ rateKind: 'suggested'; suggestedRate; rateSource; rateAsOf; rateFetchedAt }`;
- `{ rateKind: 'custom'; rate: string; suggestedRate; rateSource; rateAsOf; rateFetchedAt }`.

The provenance types and meanings match a single Cross-currency Settlement.
The result has `paidCurrency`, `totalPaidMinor`, and `settlements` ready to combine
with `paidBy` / `paidTo` for the request above. Each cross-currency row also includes
its `paidCurrency`; the batch validator derives it from the top-level field.
The helper calls `calculateCrossCurrencySettlement` for each cross-currency row,
rounding half up to that paying currency's minor unit (whole JPY/KRW), then sums
those rounded minor units exactly. Each row's `appliedRate` is its rate as chosen:
the suggested rate, or the member's own (#870). A missing rate, duplicate currency, invalid amount/rate, zero
rounded result or unsafe total is refused. No ledger conversion occurs.
`createSettlementBatchSchema` and `CreateSettlementBatchInput` are exported from
`@splitbook/shared/validators/settlement-batch` for both clients.

### Cross-currency Settlements (#727)

`amount` (major units), canonical `amountMinor`, and `currency` always mean the
**amount cleared**, in the Debt's currency. Balances, Debts and Suggested payments
use only that side. `POST` accepts the existing `amount` field; clients must not
replace it with the amount paid. A same-currency payment omits all fields below.

For a Cross-currency Settlement, send these fields with the existing body:

```json
{
  "paidBy": "userId1",
  "paidTo": "userId2",
  "amount": 20,
  "currency": "EUR",
  "amountPaidMinor": 185000,
  "paidCurrency": "INR",
  "appliedRate": "92.5",
  "suggestedRate": "92.1",
  "rateSource": "frankfurter",
  "rateAsOf": "2026-10-21",
  "rateFetchedAt": "2026-10-21T00:15:00.000Z",
  "rateKind": "custom"
}
```

- `amountPaidMinor`: a positive safe integer, in the paying currency's minor units
  (JPY and KRW use whole units).
- `paidCurrency`: a supported main or listed extra currency, different from
  `currency`. An unlisted paid currency is **422** `CURRENCY_MISMATCH`.
- The cleared `currency` may also be a historical currency already used by an
  live Expense (`isDeleted: false`) or Settlement in this Group, so legacy Debts
  remain settleable. Settlements have no deletion state. An
  unlisted currency with no such record is **422** `CURRENCY_MISMATCH`. This applies
  to both same-currency and cross-currency Settlements; only the cleared currency's
  ledger moves.
- `appliedRate`: a positive decimal string meaning **1 cleared = X paid** in major
  units: the rate the member applied, as they chose it (#870). It must give the
  amount paid, applied to the amount cleared and rounded half up in the paying
  currency, or equal the rate derived from the two stored amounts, rounded half
  up to 18 decimal places, as clients before #870 send it. Trailing zeroes do not
  change its meaning.
- `rateKind`: `suggested`, `custom`, or `entered`. The first two require all of
  `suggestedRate`, `rateSource`, `rateAsOf` and `rateFetchedAt`; `entered` omits all
  four and means no suggestion was available. `suggested` also requires that the
  suggested rate produces the recorded paid amount after rounding. `custom` keeps
  the original suggestion beside the member's chosen rate.
- `suggestedRate`: a positive decimal string. Rates accept up to 18 integer and
  18 fractional digits, without exponent notation.
- `rateSource`: `frankfurter`, `exchange-rate-api`, or `mixed`, as returned by the
  Group's rate read. `rateAsOf` is the provider's `YYYY-MM-DD` calendar date;
  `rateFetchedAt` is an ISO timestamp with an offset.

The paid side and rate provenance are immutable snapshots of what the member
records, not a new lookup or a server certification of a provider quote. The
current cache never changes a saved payment or its retry. All supplied fields
participate in `Idempotency-Key` comparison: the same body returns the same record;
a changed paid amount or rate with the same key is **409** `IDEMPOTENCY_CONFLICT`.
Incomplete or inconsistent cross-currency fields are **422** validation errors.
Partial payments and paying more than the Debt retain the existing rules.

`POST` and `GET /api/groups/[id]/settlements` return these fields unchanged.
For cross-currency payments, `settlement_recorded` metadata in both Group Activity
and Home's latest Activity also carries `amountMinor`, `currency`, and all supplied cross-currency fields.
The member-facing reads retain fallback provenance; assistant reads continue to
expose only ledger amounts, never the rate snapshot.

The shared module `@splitbook/shared/cross-currency-settlement` exports:

```ts
calculateCrossCurrencySettlement(
  input: CrossCurrencyCalculation,
): CrossCurrencyAmounts;
```

`CrossCurrencyCalculation` has `currency` and `paidCurrency`, plus **exactly two**
of `amountClearedMinor`, `amountPaidMinor`, and `rate`. Both amounts are minor-unit
integers. The result has `amountClearedMinor`, `amountPaidMinor`, and `appliedRate`.
The missing amount rounds half up in its own currency (including an inferred
cleared amount); the result's rate is always derived from the resulting amounts,
not copied from the entered rate. Zero or unsafe results are refused. No floating
point multiplication or division is used. Callers retain the user's rate separately
while editing. They send the rate the member applied when it gives the amount paid
(the suggestion, or the member's own as typed) and otherwise the helper's
`appliedRate`, with the two resulting amounts (#870).

Cross-currency Settlement reads also include server-computed `pairDebtBeforeMinor`
and `pairDebtAfterMinor`: signed safe integer minor units in the cleared `currency`,
from the payer's side (owing is negative, receiving is positive). They snapshot the
**Debt between these two people before simplifying**, immediately
before and after this Settlement, inside its Group mutation. They are immutable,
returned in Group/Home Activity metadata, and retained unchanged on idempotent retry.
Client-supplied values are ignored. Old records omit both fields; clients leave that
line out rather than recomputing it from today's ledger. A €20 Debt paid fully gives
`-2000 → 0`; paying €5 gives `-2000 → -1500`.

The figures use the same pair ledger as Balances' “Before simplifying” view, not
Suggested payments. With Sam owing Alex €20 and Alex owing Priya €20, Sam paying
Alex €20 gives `-2000 → 0` for Sam–Alex. Sam instead paying Priya €20 gives
`0 → 2000` for Sam–Priya: the payment creates a receiving position in that pair,
while the Group's simplified Debts become zero. These are pair figures, not the
payer's overall balance across all members.

`formatCrossCurrencySettlement(record, viewerId?: string): string` takes the stored
cross-currency fields, `amountMinor`, `currency`, and optional `paidBy`, `paidByName`,
`paidTo`, `paidToName` strings. It uses Activity's `memberLabel`: the viewer becomes
“You” (or “you” as recipient), blank names are omitted, and a missing payer gives
“Paid to {recipient}”. It formats both amounts and the stored rate, for example:
“You paid Sam ₹1,850.00 to clear €20.00 at ₹92.50 per €, suggested ₹92.10 (20 Oct)”.
The suggestion date is `rateAsOf`, never `rateFetchedAt`. With `entered`, it says “no rate suggested”. For
`exchange-rate-api` or `mixed`, it appends “Rates By Exchange Rate API”; callers
must link that text to `EXCHANGE_RATE_API_ATTRIBUTION.url` from the same module.
It never recomputes or looks up the historical amounts or rate.
The same module, `@splitbook/shared/cross-currency-settlement`, exports
`decimalMoney(decimal: string, currency: string): string` for nonnegative plain
decimal strings and `minorMoney(minor: number, currency: string): string` for
positive safe integer minor amounts. Both preserve exact digits without a
floating-point conversion; the sheet can reuse them for rates and amounts.

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

**A currency Splitbook no longer supports (#812).** Balances are positions, and
no position includes money in such a currency, such as a legacy `DEM` Expense or
Settlement: it has no bucket in `byCurrency`, no Balance, Debt or Suggested
payment, and nothing can be settled in it. The read answers as it would without
that money, never converting it. The Expenses read still lists it and gives it
its own Spent line (#810); Home (`GET /api/user/balances`) and the open balances
checked before a member leaves follow the same rule, so such money never stops a
member leaving. Instead, when the Group holds money in such a currency that
involves the signed-in member (an Expense they paid or share, or a Settlement
they paid or were paid), the response adds `unsupportedCurrencies`: those codes,
alphabetically (`["DEM", "FRF"]`). The Leave Group dialog names them and says
leaving doesn't settle that money. The field is left out when there are none,
so every other response is unchanged.

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

`hasMixedCurrencies` is true when the Group's Expenses and Settlements are in
more than one currency, whatever its main currency is (#724): euros alone in a
rupee Group are not mixed. `GET /api/user/balances` uses the same meaning for each
Group. Each currency has its own `byCurrency` entry, the main currency always
among them; amounts are never combined or converted across currencies.

---

## Trip summary

| Method | Path                                    | Description                                   |
| ------ | --------------------------------------- | --------------------------------------------- |
| GET    | `/api/groups/[id]/trip-summary?tz=IANA` | A Trip's whole-trip summary, its Insights tab |
| GET    | `/api/groups/[id]/insights?tz=IANA`     | A Group's Month against the Months before it  |

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
- `currency` (optional, #729) picks the currency every figure is in; anything
  but a supported code is `400` `INVALID_CURRENCY`. Without it, the summary
  opens on the currency with the most Expenses on the whole trip. A tie goes to
  the main currency if it is tied for most, otherwise the first in switch order
  (`@splitbook/shared/spending-currencies`). Nothing is
  converted and no rate is used.
- **Side effect:** due recurring templates are generated first, as the Group's
  other reads do, respecting the product-wide switch (#289) and the Theme; a
  Trip's Theme has none, so on a Trip nothing is added either way.

Amounts are exact minor units of the summary's `currency`. The response holds:

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
  exactly the payments Balances suggests in the summary's selected `currency`;
- `otherCurrencies` (every other currency spent in: listed, never converted)
  and `hasExpenses` (any Expense at all);
- `currencies`, last: what the whole trip spent in each currency
  (`currency`, `expenseCount`, `spentMinor`), the main currency first, then the
  Group's extra currencies in order, then any other, for the currency switch.

The Insights read (`GET /api/groups/[id]/insights?month=&compare=&tz=`) takes
the same `currency`, opens on the currency with the most Expenses in the Month
without it, and ends with the same `currencies` for that Month. The fields it
sent before #315 are unchanged.

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

Activity captures its names and occurrence time inside the ledger commit, for payment and Expense recording, edits, deletion, restoration and recurring generation. Waiting for a write does not freeze an earlier Activity time or payment name. Expense history and deletion timestamps keep their existing meaning.

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

A `group_updated` event whose only change is `alternateCurrencies` (an extra currency added or
removed, #721) reads as "Sam added JPY to the Group’s currencies" or "Alex removed GBP from the
Group’s currencies" on the web and on Android. Its metadata also keeps `groupName` and
`currencies`, the Group's name and its currencies (main first) as they were after the change,
so the line under an addition ("Lisbon & Tokyo now uses INR, EUR and JPY") never changes
later. Under a removal recorded with them the line is "Nothing used it", since removing a
currency in use is refused. An entry without them, added or removed, shows no such line: a
removal before #721 could drop a currency still in use.

Activity writes are on the critical path — every mutation `await`s the log.
Most log after their write has committed, so a logging failure fails the request
after the primary write has already committed. Adding or removing an extra
currency (#721) logs inside the same Group mutation as the change.

### GET /api/user/activity

Home's "Latest changes" (#309): the latest Activity across the Groups the
member belongs to today, newest first (`createdAt`, then `_id`). A Group the
member has left or never joined, and an archived Group, contributes nothing.

**Query params:** `?limit=10`. 10 when absent and at most 50: a larger number
is cut to 50, and anything but a whole number of at least 1 is a 422
validation error.

People appear by name only: `actor` is `{ _id, name }`, or `null` when the
account no longer exists, a payment's sides are `paidByName` and
`paidToName`, and a member an admin removed is `userName` (#875). `metadata`
carries only what the card uses; an Expense edit keeps only its money `changes`
(`amount`, `amountMinor`, `currency`), before and after. `currency` is the currency of the event's amounts: the recorded one, or,
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
(#318). Refusals and failures use the [error contract](#error-contract).

An Expense in a currency Splitbook no longer supports is exported as stored, never
converted (#820; see the Expenses read).

**Query params:**

| Param      | Required | Value                                                                                                 |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `groups`   | yes      | Group ids joined by commas, 1–50; repeats are ignored and the files follow this order                 |
| `from`     | no       | First day of the window, `YYYY-MM-DD`, inclusive                                                      |
| `to`       | no       | Last day of the window, `YYYY-MM-DD`, inclusive. Give both `from` and `to`, or neither for all time   |
| `include`  | no       | Any of `payments`, `shares`, `deleted`, `history`, joined by commas                                   |
| `format`   | no       | `csv` (default), `json` (all-time backup), or `statement` (one Group, preview only)                   |
| `preview`  | no       | `1` returns a bounded JSON preview instead of an attachment                                           |
| `tz`       | no       | The viewer's IANA time zone, `UTC` by default: the calendar payments, edits and deletions are read in |
| `expenses` | no       | Just these Expenses of the one Group, by id, joined by commas (#613)                                  |

A query it can't read (no Groups, an id that isn't one, half a window, a window
that ends before it starts, a day that doesn't exist, an unknown include, format
or time zone, or a window with `format=json`) is a 422 validation error.

**Just these Expenses (#613).** `expenses` names up to 100 Expenses
(`EXPORT_MAX_SELECTED_EXPENSES`) of the one Group in `groups`. The answer is one
Expenses CSV with each member's share, whatever `include` says, all time, with
the same columns as the Group's own CSV with `shares`. It is named for the Group
and the day in `tz`: `<group>-<YYYY-MM-DD>-selected-expenses.csv`. An Expense
that is deleted, or isn't the Group's, is left out. With `expenses`, two Groups,
a window, `format` other than `csv`, or an include other than `shares` is a 422
validation error. The
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
  `editHistoryEntries`). `currencyGroups` names each Group with its main `currency` and
  `alternateCurrencies`, projected from the same backup. Counts come from the built backup object in one pass;
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
  `suggestedPayments`, up to five first `payments` with stored cross-currency fields
  and the shared payment `description`, and up to five first `expenses` including the stored
  `category` key with the `tag` (#918), and `paidBy` and `splitBetween` allocations. Currency buckets remain separate; current all-time
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

| #   | Column                    | Value                                                      |
| --- | ------------------------- | ---------------------------------------------------------- |
| 1   | `Date`                    | The day it was recorded, in `tz`                           |
| 2   | `Recorded at`             | When it was recorded, in `tz`                              |
| 3   | `From`                    | Who paid                                                   |
| 4   | `To`                      | Who was paid                                               |
| 5   | `Amount`                  | Exact decimal                                              |
| 6   | `Currency`                | ISO code                                                   |
| 7   | `Note`                    |                                                            |
| 8   | `Recorded by`             | Who recorded it                                            |
| 9   | `Payment ID`              | The Settlement's id                                        |
| 10  | `Amount paid`             | Exact paid-side decimal for a cross-currency Settlement    |
| 11  | `Paid currency`           | Paid-side ISO code                                         |
| 12  | `Rate (paid per cleared)` | Stored `appliedRate`: 1 cleared = X paid                   |
| 13  | `Rate attribution`        | Required fallback provider credit and URL, otherwise blank |

`Amount` and `Currency` always describe the amount cleared. The added paid-side
and rate cells are blank for same-currency records; old columns retain their positions.
Each amount is immediately followed by its currency. Neither side is converted or
recalculated during export.

The zip is made with [`fflate`](https://github.com/101arrowz/fflate) (MIT).

**JSON backup.** With `format=json`, the download is one
`splitbook-<n>-groups-backup.json` in the versioned `splitbook-backup/1`
format: exact minor units, stable ids and names, never an email (an address
typed into a description, note or name reads `[redacted]`). Payers, shares and Group `alternateCurrencies`
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

## Android notification device controls

`GET /api/notifications/device?installationId=<uuid>` reads this phone's confirmed controls.
It requires `X-Installation-Key`, the private installation ownership proof.
`POST /api/notifications/device` accepts `installationId`, `installationKey`, the last
confirmed integer `revision`, `enabled`, optional `expenseUpdates` and `payments`,
and a direct Android `token` when enabling. Account, session and environment are derived
on the server; caller-selected identity fields are refused.

New installations and new account/session bindings start off. Explicit opt-in defaults both
categories on. Each enabling or category off-to-on transition confirms a new activation
generation and server cutoff; preferences are independent per installation across Groups.
Responses contain `available`, `enabled`, `expenseUpdates`, `payments`, `revision`,
`binding`, `activation`, `expenseActivation`, `paymentActivation` (#842), `expenseCutoff` and `paymentCutoff`. They never contain tokens or ownership
proofs. A previous account's binding is returned as off to another account on the same
installation. Installation ownership proof is still required; revisions remain monotonic
across binding changes so older updates cannot overwrite newer bindings.

Every response is `Cache-Control: private, no-store`. Authentication bypasses the signed
cookie cache and writes fence against live persisted session revocation. An invalid session
gets 401, a mismatched installation proof gets 403, a stale revision gets 409, and invalid
schema input gets the standard 422 validation envelope. Opt-in requires the off-by-default
`ANDROID_NOTIFICATIONS_ENABLED=true` server switch; turning off remains permitted.
A registration lives exactly as long as its session. Better Auth sessions last 30 days and are
renewed after a day of use; each renewal moves the session's registrations to the new expiry
(a `session.update.after` hook, `src/lib/notifications/session-renewal.ts`), so a member who
keeps using the app keeps getting alerts and keeps seeing their controls on. Reads, writes and
dispatch refuse a registration whose stored expiry has passed, without waiting for the TTL index
to delete it, and dispatch also rechecks the persisted session, so a revoked session sends nothing.
These endpoints write only notification/session control state, never financial records.

**Registration maintenance (#844).** A phone keeps its registration current with
`POST /api/notifications/device` and the body `installationId`, `installationKey`, `revision`,
`enabled: true`, the phone's current `token` and `maintenance: true`, and nothing else (a
category field, or no token, is a 422). Android sends it after a native token change and after
restoring the same session. It applies only to this account's live session on this installation
while that binding is on; any other installation state (never opted in, turned off, another
account, a new session of the same account) and a stale revision get 409, and nothing changes.
It is allowed while `ANDROID_NOTIFICATIONS_ENABLED` is off, since it grants nothing. It keeps
the binding, `activation`, `expenseActivation` and both cutoffs, so it never replays older
events or moves a cutoff. A new token replaces the stored one and advances `revision`; the same
token again changes no control and returns the same revision. An accepted maintenance also
records, on the registration and never in a response, that this installation maintains itself;
an Enable, a Settings change, a sign-out or a new session on the installation keeps that record,
and no other request sets it. Accepted and uncertain deliveries
keep their identities (event, installation, binding, Expense activation), so a new token gets no
accepted or uncertain event again, and a pending one keeps its event's original 24-hour expiry.

The availability switch is separate from confirmed consent: a previously enabled binding
still returns its persisted preferences with `available: false` while the feature is paused.
Clients must not interpret `enabled` alone as effective delivery permission. Disabling remains
permitted while paused. Once its read answers `available: false`, Android Settings says
"Notifications aren’t available yet." in place of Enable, the category switches and Turn off,
for an opted-in phone as for any other (`notification-settings.tsx`); an opted-in phone keeps
"Open Android notification settings". Its preferences stay stored and return when sending resumes.

The shared `activation` changes on any category off-to-on transition. It is an authorization
generation, not an instruction to replay another category. Later delivery slices must use
`expenseCutoff` for Expense events and `paymentCutoff` for Payments; the unchanged category
keeps its existing cutoff. Rechecking or replacing older-generation work must retain accepted
event/installation history so a new preference generation cannot resend an accepted event.
The Expense delivery generation `expenseActivation` changes only when Expense alerts are enabled
or re-enabled. An unrelated Payments transition cannot resend an accepted Expense alert.

## First Expense-added Android alert

Manual Expense creation and saving a reviewed Draft capture the validated involved members,
excluding the actor, in the financial commit's private recoverable Activity intent. Activity
publication copies that immutable context and acknowledges the intent independently of FCM.
Preparing or reviewing Drafts sends nothing. Legacy Activity without captured context is
ineligible; public Activity, financial reads and exports omit the private context.

Both `ANDROID_NOTIFICATIONS_ENABLED=true` and
`ANDROID_NOTIFICATION_SENDS_ENABLED=true` are required to send. Both remain off until owner
acceptance. The direct FCM adapter sends through an explicitly configured `FCM_PROJECT_ID`
and gets its Google credentials from `src/lib/notifications/google-credentials.ts`. No
service-account key is stored anywhere (owner decision, 2026-11-07):

- **On Vercel:** the function's Vercel OIDC token is exchanged through Google Workload Identity
  Federation for a short-lived token of the sender service account, scoped to
  `https://www.googleapis.com/auth/firebase.messaging`. This mode is on when all four of these
  are set:
  - `GCP_PROJECT_NUMBER`: the Google Cloud project number that holds the pool;
  - `GCP_WORKLOAD_IDENTITY_POOL_ID`: the Workload Identity pool;
  - `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`: the pool's OIDC provider for Vercel;
  - `GCP_SERVICE_ACCOUNT_EMAIL`: the sender service account it impersonates.
- **Locally and in dev:** with none of the four set, it uses Google Application Default
  Credentials, as before. On Vercel (`VERCEL` set), none set is a configuration error instead.
- **With only some set, one malformed, or none on Vercel:** nothing is sent and there is no
  fallback to Application Default Credentials. Each send logs one configuration error that
  names the missing or malformed settings, never their values, and the delivery is
  `operational`.

The credential lookup (the Vercel token and both Google exchanges) ends with the invocation's
deadline, like the send. No token is logged. The setup is in
[`docs/runbooks/android-notifications.md`](runbooks/android-notifications.md); scheduler setup and
rollout remain the owner's.

Pausing sending (either switch off) delays alerts rather than dropping them (owner decision,
2026-11-07: deliver late). While paused, a dispatch writes no delivery and keeps its cursor.
Once both switches are on again, the next explicit `POST /api/notifications/dispatch` sends the
alerts for events from the last 24 hours, each with what remains of its 24-hour lifetime; the
dispatch after a new event covers only that event. Older events have expired and are never sent.

Newly published events schedule bounded post-response dispatch. An explicit
`POST /api/notifications/dispatch` also runs one bounded pass; it requires
`Authorization: Bearer <NOTIFICATION_DISPATCH_SECRET>` with a dedicated secret of at least
32 bytes. No request body or query parameters are accepted. Responses contain only
`considered`, `accepted`, `skipped` and `failed` counts. It creates no financial writes.
Every dispatch run, explicit or after a new event, logs one counts-only line, such as
`Notification dispatch: considered=2 accepted=1 skipped=0 uncertain=1 failed=1`, with no ids,
tokens or names, so production checks need no database read. `failed` counts every provider
outcome other than accepted, as in the response; `uncertain` is the part of it never resent.
The pass considers at most 100 events and 100 deliveries, sends sequentially within 20 seconds,
and starts no FCM request with fewer than ten seconds of invocation budget remaining.
Provider work, including credential lookup, is capped at 15 seconds and the remaining budget.
An environment cursor prevents already considered older pages from starving newer work.
An indexed identity lookup excludes terminal and in-flight device deliveries before the device
limit, so an accepted prefix cannot starve a later installation. Pending work and expired claims
remain eligible.
Budget exhaustion before provider I/O preserves pending work. Accepted and uncertain outcomes
are never resent. Autonomous recovery and retries of definite temporary failures run only while
the recovery kill switch is on ("Autonomous 24-hour alert recovery (#843)" below).

Immediately before FCM, the server rechecks current membership, persisted session, binding,
Expense preferences, activation cutoff, kill switches and event expiry. Eligible delivery
identity includes event, environment, installation, binding and Expense activation.

A permanent FCM `UNREGISTERED` answer depends on whether the installation maintains its
registration (#844). An installation whose app has never had a maintenance accepted (the
2a0b065b Android app, which sends a token only on an explicit Enable) is switched off exactly as
before: `enabled`, `expenseUpdates` and `payments` become false and `revision` advances, so that
app's Settings shows off and the member can enable again. An installation that maintains itself
has the token disabled, not the member's consent: the registration keeps its controls, revision,
binding and activations, and nothing more is sent to that token. The phone's next token, registered by maintenance, receives later alerts and any
eligible event not yet delivered to it within its 24 hours; the event that failed is not sent
again, and the same refused token presented again stays disabled. Dispatch sends to the
installation's current token at the time of the send, so a token rotated during a pass still
gets that pass's event.

Messages are data-only (#968): there is no FCM `notification` block, and FCM data holds only
`body`, a JSON version-2 envelope. The envelope carries event, recipient, Group and record
identities, environment, binding, activation, occurrence and expiry. It contains no names,
amounts, descriptions or credentials. With a `notification` block Android would show the alert
itself, without the app's checks; a data `title` or `message` would make Expo SDK 58 show it in
the background the same way, so neither is sent. `android.priority` is `high`, so a message can
start a stopped app, and `collapse_key` is the event. The remaining FCM TTL never extends the
event's 24-hour lifetime.

The Android app shows the alert itself, only after its checks pass: the signed-in account,
this build's environment, the confirmed binding and Expense activation, Expense alerts on, and
not expired. Its text is fixed and generic, "Splitbook" / "An Expense was added.". Expo SDK 58
gives data-only messages to no foreground handler, so the app receives them in an
expo-task-manager notification task (expo-notifications `registerTaskAsync`), which runs in the
foreground, in the background and with no app running (`apps/mobile/README.md`). Android allows
at most 30 seconds of occurrence clock skew, while checking the exact 24-hour envelope lifetime
and strict expiry.

Delivery caveat: Android delivers a high-priority data message to a stopped app, but a device
in Doze, an app in the restricted App Standby bucket, or a manufacturer's battery optimisation
can delay or drop it, and Android may lower the priority of an app whose high-priority messages
seldom show a notification. A force-stopped app receives nothing until it is opened again.

## Expense updated, deleted and recurring Android alerts (#841)

Edits, restoration, soft deletion and recurring Expense generation capture the same private,
immutable notification context as Expense-added alerts, inside their own financial commit:

| Event                | Kind              | Audience captured at the commit                                                        |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| Edit, restoration    | `expense_updated` | Payers and split participants before **and** after, without the editor                 |
| Soft deletion        | `expense_deleted` | The deleted Expense's recorded payers and split participants, without the deleter      |
| Recurring generation | `expense_added`   | The template's payers and split participants, without its creator (the Activity actor) |

Each audience is intersected with the Group's members at the commit, so a member removed from an
Expense who is still in the Group hears about the edit, and a member who joins later is never a
recipient of an earlier event. A later edit records its own event and cannot change an earlier
one's audience. Dispatch rechecks current membership, session, binding, the Expense updates
switch, its cutoff and the 24-hour expiry before every provider request, as for Expense-added
alerts. Restoration is the existing `expense_updated` event (`metadata.action: "restored"`), not
a new financial operation. A refused save (stale revision, invalid participants), a repeated
deletion, Draft preparation/edit/discard and suggested payments record no event and send
nothing. All three kinds use the device's Expense updates switch, the same versioned envelope,
delivery identities and deduplication. The app shows "An Expense was added.", "An Expense was
updated." or "An Expense was deleted."; a tap opens the current authorized Group Activity, also
for a deleted Expense, and never writes.

**Rollout switch.** These four paths need `ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED=true`,
besides `ANDROID_NOTIFICATIONS_ENABLED` and `ANDROID_NOTIFICATION_SENDS_ENABLED`. It is **off by
default** and stays off in production until the owner accepts the feature. While it is off,
these events capture no notification context (exactly as before #841), so turning it on later
sends no backlog; turning it off again also stops sends of events captured while it was on.
Manual and reviewed-Draft Expense-added alerts never depend on it.

## Payment Android alerts (#842)

Recording a Settlement through any existing path captures the same private, immutable
notification context as Expense alerts, inside that Settlement's own financial commit:

| Path                                                                 | Kind                  | Audience captured at the commit                           |
| -------------------------------------------------------------------- | --------------------- | --------------------------------------------------------- |
| Single (`POST /api/groups/:id/settlements`), Cross-currency included | `settlement_recorded` | The payer and the recipient, without the member recording |
| Batch (`POST /api/groups/:id/settlements/batch`)                     | `settlement_recorded` | The same, once per committed Settlement of the batch      |

The audience is intersected with the Group's members at the commit; dispatch rechecks current
membership, session, binding, the device's **Payments** switch, `paymentCutoff`, the Payments
generation and the 24-hour expiry before every provider request. A batch keeps one event and one
delivery identity per committed Settlement; there is no batch-level event or alert. An idempotent
retry (single or batch, same key and body) returns the committed Settlement(s) and adds no record,
event or delivery. A refused or uncommitted recording (including a batch refused part-way, which
records none of its rows), reading Suggested payments, and any Draft step record nothing and send
nothing. There is no Settlement-deletion operation and no deletion alert. The envelope is the same
data-only version-2 envelope, with no names, amounts, rates, currencies or notes. The app shows
"Splitbook" / "A payment was recorded."; a tap opens the current authorized Group Activity and
never records a payment.

The Payments switch is independent of Expense updates on each device. Its delivery generation
`paymentActivation` (in the device response, next to `expenseActivation`) changes only when
Payments is enabled or re-enabled, so turning Expense updates off and on cannot resend an accepted
Payment alert. A registration from before #842 keeps its shared `activation` as its Payments
generation until its next settings change pins it.

**Rollout switch.** Payment alerts need `ANDROID_NOTIFICATION_PAYMENTS_ENABLED=true`, besides
`ANDROID_NOTIFICATIONS_ENABLED` and `ANDROID_NOTIFICATION_SENDS_ENABLED`, and independently of
`ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED`. It is **off by default** and stays off in
production until the owner accepts the feature. While it is off a recording captures no
notification context (exactly as before #842), so turning it on later sends no backlog; turning
it off again also stops sends of payments captured while it was on. Expense alerts never depend
on it, and Settlement recording, its answers and the recorded money are the same either way.

## Autonomous 24-hour alert recovery (#843)

If a change's Activity publication or its post-commit dispatch is interrupted, an eligible member
can still get its alert later, with no client open and no Group read. The protected trigger is the
existing `POST /api/notifications/dispatch` (empty body, no query,
`Authorization: Bearer <NOTIFICATION_DISPATCH_SECRET>`). It takes no event, Group, account or
token from the caller: each pass works globally, in this order, within one 20-second budget.

1. **Unpublished Activity.** It publishes the recoverable pending Activity intents of every Group
   (Expenses and Settlements, oldest first, at most 100 events and 100 records), exactly as a Group
   Activity read would. Publication copies the immutable notification context and acknowledges
   each intent on its own, so no delivery outcome can hold a financial pending intent open or use
   up its cap. A partial index (`pendingActivity_recovery`) keeps this lookup to records that have
   pending intents.
2. **Lost sends.** A delivery left `sending` past its lease may have reached Google: it becomes
   `uncertain` and is never resent.
3. **Due work.** Retries whose wait is over, `claimed` rows whose lease expired before any
   provider I/O, and deferred `pending` rows, wherever the dispatch cursor is.
4. **Just-published events,** which may sit behind the cursor; then the usual cursor pass.

Every attempt is the same atomic claim with a 20-second lease on one event, installation, binding
and activation identity, so overlapping invocations, crashes and replays cannot send one delivery
twice or repeat an accepted send. Before each provider request it rechecks current Group
membership, the persisted session, the token binding, the device switch for that kind, its
activation cutoff and generation, the rollout and send switches, and expiry.

| Provider outcome                                          | State           | Retried?                                                                                                                                                   |
| --------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2xx                                                       | `accepted`      | Never. Acceptance by Google only: not a display.                                                                                                           |
| 429 or 5xx                                                | `temporary`     | Yes, up to 5 attempts: from 1 minute, doubling, capped at 30 minutes, with jitter over the upper half, never sooner than `Retry-After` (seconds or a date) |
| 404/400 `UNREGISTERED`                                    | `invalid-token` | Never; the binding is disabled.                                                                                                                            |
| Other 4xx, credential or configuration errors             | `operational`   | Never; an operational failure for the owner to look at.                                                                                                    |
| Timeout or connection loss after dispatch; lost `sending` | `uncertain`     | Never: Google may have accepted it.                                                                                                                        |

An event expires 24 hours after its recorded change. A retry is scheduled only if it falls inside
that window; queries enforce expiry before the TTL index removes rows (seven days after expiry),
and the FCM TTL of every attempt is what remains of the 24 hours. Android also drops an expired
envelope. FCM may deliver a message twice; the app's bounded per-event deduplication suppresses a
repeat, but there is no exactly-once display promise.

Bounds per invocation: 20 seconds (the route's `maxDuration` is 30), at most 100 published
events and 100 deliveries considered, sequential provider requests (fewer than the four allowed),
each capped at 15 seconds and the remaining budget, none started with under ten seconds left, and
500 ms per MongoDB operation.

The response holds only counts: `considered`, `accepted`, `skipped`, `failed`, `recovered`
(intents published) and `retrying` (temporary failures scheduled again). The log line stays one
counts-only line; while recovery is on it ends with ` recovered=<n> retrying=<n>`.

**Kill switch.** All of this needs `ANDROID_NOTIFICATION_RECOVERY_ENABLED=true`, besides
`ANDROID_NOTIFICATIONS_ENABLED` and `ANDROID_NOTIFICATION_SENDS_ENABLED`. It is **off by default**
and stays off in production until the owner decides (#845). While it is off, the trigger runs
exactly the pass described in "First Expense-added Android alert": no global publication, no
retries, the same response counts (`recovered` and `retrying` are 0) and the same log line. A
temporary failure still records its next attempt time, so turning recovery on within the 24 hours
retries it. Unsetting `ANDROID_NOTIFICATION_SENDS_ENABLED` pauses every send, recovery included,
and keeps the work for later; neither switch changes any financial save. Scheduling is external
(`docs/runbooks/android-notifications.md`, "Recovery trigger").
