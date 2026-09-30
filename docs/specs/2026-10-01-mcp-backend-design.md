# MCP backend design

**Date:** 2026-10-01
**Status:** Proposed. Not ticketed; implementation waits until the Android private beta work settles.
**Decision record:** [ADR 0005](../adr/0005-mcp-server-in-web-app.md).
**Product spec:** [Splitbook MCP server](2026-10-01-mcp-server.md).
**Baseline:** `main` at `6159385`. Recheck the checkout before implementation; the route inventory in §2 goes stale quickly.

## 1. Verdict: no new backend

Splitbook already has a backend: the Next.js app in `apps/web`. It serves the web UI, the HTTP API the Android client uses, Better Auth, and the Mongoose services over MongoDB, deployed as Vercel functions. The MCP server becomes one more route in that app.

A separate service would earn its cost only if one of these appeared. None applies today:

| Trigger for a separate service                 | Splitbook today                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Scheduled or long-running jobs                 | None. Recurring Expenses materialize lazily on read.               |
| Persistent connections (WebSockets, streaming) | None. MCP runs stateless over plain POST.                          |
| Heavy server compute                           | None. Receipt OCR is being evaluated on-device (#90–#95).          |
| A second runtime or language                   | None. TypeScript end to end; shared domain in `@splitbook/shared`. |
| Independent scaling or release cadence         | None at private-beta scale.                                        |

What the backend does need is a structural fix. Some authorization and read-time behavior lives in route handlers instead of the layer below them. A second entry point would have to copy it or risk disagreeing with the app. §3 fixes that before any MCP code exists.

## 2. Where the rules live today

```
Web (SWR) ─┐                                   ┌─ services/*.service.ts ─ Mongoose ─ MongoDB
Android ───┼─ proxy.ts ─ app/api/**/route.ts ──┤
           │  (cookie    (getAuthUser, isMember,└─ @splitbook/shared (money, splits, validators)
           │   present?)  lazy recurring, error maps)
           └─ /api/auth/** ─ Better Auth (sessions)
```

An audit of all 34 route methods under `app/api/**` (excluding `api/auth`) found that the services own most rules. The following live **only** in route handlers, so a second entry point that called the services directly would miss them. Paths are relative to `apps/web/src/`.

**Membership checked only in the route.** The service method takes no actor or ignores it:

| Route                                      | Service call                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `GET groups/[id]`                          | `groupService.getById(groupId)`                                                                         |
| `GET groups/[id]/balances`                 | `balanceService.getGroupBalances(groupId)`                                                              |
| `GET groups/[id]/expenses`                 | `expenseService.getGroupExpenses(groupId, filters, userId?)`; `userId` only shapes owe/get-back figures |
| `GET groups/[id]/expenses/check-duplicate` | `expenseService.checkDuplicate(groupId, …)`                                                             |
| `GET groups/[id]/settlements`              | `settlementService.getGroupSettlements(groupId)`                                                        |
| `GET groups/[id]/activity`                 | `activityService.getGroupActivity(groupId, …)`                                                          |
| `GET groups/[id]/recurring`                | `recurringExpenseService.list(groupId)`                                                                 |
| `GET groups/[id]/invite-link`              | no service method; the route reads the Group and builds the response                                    |
| `POST groups/[id]/invite`                  | `invitationService.create(groupId, email, invitedById)` checks only that the Group exists               |

Expense, settlement, recurring, member, Tag and Group-settings **commands** already check membership or admin role inside their services. Where the route also checks, it is a preflight that keeps 403 ahead of body validation.

**Read-time behavior in the route.** `GET groups/[id]` and `GET groups/[id]/expenses` call `recurringExpenseService.generateDueExpenses(groupId)` before reading. `GET …/balances` and `GET user/balances` do not, so Balances can lag behind due recurring Expenses until someone opens the Group or its Expense list.

**HTTP parsing in the route (stays there).**

- `If-Match` goes through `requestRevision`; a missing or malformed header becomes `NaN` and then `428 REVISION_REQUIRED`.
- `Idempotency-Key` goes through `parseIdempotencyKey`.
- Query strings are parsed with defaults and no bounds. Activity `page`/`limit` can reach MongoDB as `NaN`. Expense `limit` has no maximum.

**Response shaping in the route.** Three routes build their own payloads:

- `GET invite-link` builds `inviteUrl`, duplicating `group.service.ts`.
- `GET join/[code]` builds the public preview DTO.
- `DELETE expense` builds `{ message, revision }`.

Separately, `GET groups/[id]` returns the Group including its `inviteCode`.

**Serialization in the models.** `Expense` and `Settlement` `toJSON` transforms strip `creationRequest` and `pendingActivity`, and default `revision`. Creates and replays return hydrated documents with those fields selected, so any non-HTTP presenter must serialize through `toJSON` as well.

**Error mapping, duplicated and inconsistent.** Each route has its own error-string → status table. `serverError` has a shared table: FORBIDDEN 403, IDEMPOTENCY_CONFLICT 409, STALE_REVISION 409, REVISION_REQUIRED 428, CURRENCY_LOCKED 409, ACTIVITY_BACKLOG_FULL 503, INVALID_MONEY 422, `MoneyValidationError` 422, Mongoose `VersionError` 409. The inconsistencies:

- A FORBIDDEN caught in a route has no `code`; one that falls through to `serverError` does.
- Tag routes return raw `Response` bodies without `status`.
- `INVALID_TAG` from Tag routes is unmapped and becomes 500.
- Recurring 422s carry no `code`.

**No service at all.** `user/profile` GET and PATCH use the `User` model directly; GET lazily creates the document.

**Callers outside routes.** No page, server component or server action calls a service. The only non-route caller is `lib/demo/seed.ts`.

**Activity** is written only inside services: directly for Group and member events, and through the pending-activity outbox for Expenses, Settlements and recurring generation. Tag changes, invitations, invite links, recurring-template edits and profile changes produce no Activity. Nothing sends email.

Inconsistencies found here (unbounded pagination, invitation create relying on the route for membership, uneven error bodies, `invitations/[id]` decline not checking status) are recorded, not fixed, by this design. The refactor in §3 preserves HTTP behavior byte-for-byte except where §3.2 says otherwise; fixes go in separate, visible changes.

## 3. Change 1: the ledger operations module

### 3.1 Shape

One actor-scoped module is the only way into ledger reads and commands, for both route handlers and MCP tools.

```ts
// apps/web/src/lib/ledger/operations.ts (sketch; names are provisional)
export interface LedgerActor {
  userId: string;
  /** How the call arrived. Used for Activity attribution, never for authorization. */
  channel: { kind: 'app' } | { kind: 'assistant'; clientId: string; clientName: string };
}

export function ledgerFor(actor: LedgerActor): LedgerOperations;

interface LedgerOperations {
  // reads
  listGroups(opts?: { includeArchived?: boolean }): Promise<GroupSummary[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  myBalances(): Promise<CurrencyBuckets>;
  groupBalances(groupId: string): Promise<GroupBalances>;
  listExpenses(groupId: string, filters: ExpenseFilters): Promise<ExpensePage>;
  getExpense(groupId: string, expenseId: string): Promise<ExpenseDetail>;
  listSettlements(groupId: string): Promise<Settlement[]>;
  listActivity(groupId: string, page: PageRequest): Promise<ActivityPage>;
  checkDuplicate(groupId: string, probe: DuplicateProbe): Promise<DuplicateResult>;
  // commands
  createExpense(
    groupId: string,
    input: CreateExpenseInput,
    requestKey?: string,
  ): Promise<ExpenseDetail>;
  updateExpense(
    groupId: string,
    expenseId: string,
    input: UpdateExpenseInput,
    expectedRevision: number, // required from adapters; see §3.2
  ): Promise<ExpenseDetail>;
  deleteExpense(groupId: string, expenseId: string, expectedRevision: number): Promise<void>;
  recordSettlement(
    groupId: string,
    input: CreateSettlementInput,
    requestKey?: string,
  ): Promise<Settlement>;
  // …group, member, Tag, invitation and recurring commands follow the same pattern
}
```

Failures become one typed error carrying the codes the services already throw. The codes are kept verbatim because several already appear in HTTP `code` fields:

```ts
export type LedgerErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NOT_HOUSEHOLD'
  | 'INVALID_MEMBERS'
  | 'INVALID_TAG'
  | 'CURRENCY_MISMATCH'
  | 'CURRENCY_LOCKED'
  | 'SAME_PARTY'
  | 'FORBIDDEN_SETTLEMENT'
  | 'INVALID_WINDOW'
  | 'TAG_EXISTS'
  | 'AMBIGUOUS_TAG'
  | 'TAG_CHANGED'
  | 'TAG_IN_USE'
  | 'LAST_ADMIN'
  | 'SELF_REMOVE'
  | 'ALREADY_INVITED'
  | 'INVITATION_NOT_PENDING'
  | 'INVITATION_EXPIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'REVISION_REQUIRED'
  | 'STALE_REVISION'
  | 'ACTIVITY_BACKLOG_FULL'
  | MoneyValidationCode; // from @splitbook/shared/exact-money

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}
```

The module translates the services' string errors (including `TAG_IN_USE:<expenses>:<templates>`, `'Group not found'` and Mongoose `VersionError`) into `LedgerError` at its boundary. The services themselves do not have to change in the first pass.

### 3.2 What moves where

| Concern                                  | Today                                                                     | After                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session → user id                        | `getAuthUser()` in each route                                             | Unchanged. Routes build `LedgerActor` from it; MCP builds it from token claims.                                                                                                                                                  |
| Membership and role checks               | Nine read routes check in the route only (§2); commands check in services | Operations module, for every call. Services keep their own write checks as defense in depth.                                                                                                                                     |
| Lazy recurring materialization           | Group GET and Expense list GET                                            | Operations module, before every read of Expenses **and Balances** (Group, cross-group). Adding it to Balances is the one deliberate behavior change: Balances stop lagging behind due recurring Expenses. Call it out in the PR. |
| Filter defaults and page-size bounds     | Route query parsing, unbounded                                            | Operations module validates a typed filter object (page ≥ 1, limit 1–100; MCP caps at 50). Routes only parse query strings into it. A request that would have sent `NaN` now gets the default.                                   |
| Invite-link read, profile read/update    | Route or model directly                                                   | Operations module methods, so every ledger read and write has one path.                                                                                                                                                          |
| Revision on commands                     | HTTP always passes a number (or `NaN` → 428)                              | The module requires `expectedRevision` from every external adapter. `undefined` ("trusted in-process caller") stays reserved for recurring generation and the demo seed.                                                         |
| Error string → status and message tables | Duplicated per route                                                      | One `LedgerError` → HTTP mapping helper for routes; one → tool-error mapping for MCP.                                                                                                                                            |
| `Idempotency-Key`, revision headers      | Route                                                                     | Stay in the route (HTTP concern). The module takes plain `requestKey` / `expectedRevision` arguments.                                                                                                                            |
| Response envelope `{ data, status }`     | `api-response.ts`                                                         | Unchanged.                                                                                                                                                                                                                       |
| Activity logging                         | Services                                                                  | Unchanged, plus the actor's `channel` is passed through for attribution (§7.3).                                                                                                                                                  |

### 3.3 Rules for the refactor

- Behavior-preserving: request and response bodies, status codes, `code` fields and headers stay byte-compatible. The existing HTTP, integration and Playwright suites are the acceptance evidence.
- Keep the forbidden-before-invalid-body ordering some routes guarantee today (the Expense `PATCH` preflight comments on it).
- Move one route family at a time (Groups, Expenses, Settlements, Balances, Activity, Tags, members, invitations, recurring). Each move deletes the route-level logic it replaces; a module that just forwards while routes keep their checks is not the goal.
- No page or server component calls a service today; keep it that way. New server-side reads go through the module.
- Keep each route's current status and body for every error, including the inconsistent ones listed in §2, and pin them with tests before moving the route. Normalizing them is a separate change.
- New tests only where behavior was previously untested, such as a non-member reading a Group's Balances or Settlements, and invitation create by a non-member.

## 4. Change 2: Better Auth as the MCP authorization server

### 4.1 Packages and plugins

- `better-auth` `1.7.3` → `^1.7.7` (peer range of `@better-auth/mcp` and `@better-auth/cimd`). Run the full auth suites (`test:e2e`, `test:e2e:google`, auth-recovery, mobile-session) on the bump alone before adding plugins.
- Add `@better-auth/mcp`, `@better-auth/cimd`, `@modelcontextprotocol/server` (v2).
- In `buildAuthOptions`, register when `MCP_ENABLED=true`, keeping `nextCookies()` last:

```ts
plugins: [
  ...(demoPlugin ? [demoPlugin] : []),
  ...(mcpEnabled
    ? [
        jwt(),
        mcp({
          loginPage: '/login',
          consentPage: '/consent',
          resource: `${appUrl}/api/mcp`,
          scopes: ['ledger:read', 'ledger:write', 'offline_access'], // option name: verify against McpOptions
          // access-token TTL ≤ 1 h; refresh tokens rotate (plugin default overlap 30 s)
        }),
        cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
      ]
    : []),
  nextCookies(),
],
```

- Dynamic client registration stays off. Turn it on only if a target assistant is verified to lack Client ID Metadata Document support.
- `fetchClientMetadataResource` fetches a URL the client supplies. Confirm the Node implementation refuses private and loopback addresses outside development before enabling on a shared deployment.

### 4.2 Data

The plugins add their own collections through the existing MongoDB adapter (plural names: JWKS keys, OAuth clients, access and refresh tokens, consents; exact names come from the plugin schema). No application collection changes. Add the new names to `lib/auth/collections.ts` if any script or test reset needs them. `transaction: false` stays; verify the plugins do not require transactions on a standalone `mongod`.

### 4.3 Discovery and pages

| Path                                               | Served by                                               | Notes                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth/oauth2/*`, `/api/auth/jwks`             | Better Auth catch-all (existing)                        | Already public via proxy rule 1.                                                                                                                                                  |
| Protected-resource metadata (RFC 9728)             | `mcp()` plugin                                          | Confirm the URL in the 401 `WWW-Authenticate` challenge; add a root `/.well-known/oauth-protected-resource/api/mcp` route only if the plugin's URL is not reachable.              |
| `/.well-known/oauth-authorization-server/api/auth` | New route using `oauthProviderAuthServerMetadata(auth)` | Path-inserted form for the `/api/auth` issuer. `/.well-known/*` already bypasses the proxy (the matcher skips paths containing a dot).                                            |
| `/login`                                           | Existing page                                           | Must resume a pending authorization after Google redirect and demo persona sign-in. The Google redirect case is the risky one; test it first.                                     |
| `/consent` (new, `(auth)` group)                   | New page                                                | Client name and logo from its metadata document; scopes in plain language; Allow / Deny through the auth client's consent call. Requires a session (proxy redirects to `/login`). |
| Settings → Connected assistants (new section)      | New component                                           | Lists consents, revokes one. Uses the OAuth provider's consent list/delete endpoints.                                                                                             |

### 4.4 Token semantics

- Access tokens are JWTs signed by the app's JWKS, audience-bound to `${appUrl}/api/mcp`. `requireMcpAuth` verifies signature, issuer, audience, expiry and `ledger:read`.
- Revoking consent ends refresh. An access token already issued survives until expiry, hence the short TTL. Every tool call re-resolves the user and re-checks membership (§3), so leaving a Group is immediate.
- Allowlist removal behaves as it does for web sessions today: it blocks the next sign-in, not existing grants. Revoking a person's grants on removal is an operator step to document, not new code.

## 5. Change 3: proxy rules

`proxy-rules.ts` rule 4 answers every cookie-less `/api/*` request with a plain 401. That blocks MCP: its requests carry a bearer token and no cookie, and discovery needs the route's own 401 with a `WWW-Authenticate` header. Add, before rule 4:

```ts
// MCP authenticates by bearer token inside the route; it must answer 401 itself.
const isMcp = pathname === '/api/mcp';
if (isMcp) return NextResponse.next();
```

Unit-test it in `proxy-rules.test.ts` next to the join-preview exception. No other path changes.

## 6. Change 4: the MCP route and tools (phase 1)

### 6.1 Files

```
apps/web/src/
├── app/api/mcp/route.ts        # POST only; 404 when MCP_ENABLED is off
└── lib/mcp/
    ├── server.ts               # createMcpHandler({ legacy: 'reject' }) → McpServer per request
    ├── actor.ts                # token claims → LedgerActor (sub → user; client id → name)
    ├── tools/                  # one file per tool family: groups, balances, expenses, settlements, activity
    ├── present.ts              # ledger DTOs → tool output (money as decimal strings, member text fenced)
    └── errors.ts               # LedgerError → tool error result
```

### 6.2 Request flow

```
MCP client ──POST /api/mcp (Bearer JWT)──▶ proxy (passthrough)
  ▶ requireMcpAuth(auth, handler, { resource, requiredScopes: ['ledger:read'] })
      ├─ invalid/missing token → 401 + WWW-Authenticate (client starts OAuth)
      ├─ missing scope         → 403 insufficient_scope
      └─ ok → handler(request, claims)
           ▶ actor = toLedgerActor(claims)        // user must still exist
           ▶ mcpServerHandler.fetch(request)      // McpServer built with `actor` bound
               ▶ tool → ledgerFor(actor).… → present(…)
```

Build the `McpServer` per request so the actor is closed over and never global. Node runtime, not edge (Mongoose).

### 6.3 Tool catalogue

| Tool                 | Scope        | Operation                   | Annotations                 |
| -------------------- | ------------ | --------------------------- | --------------------------- |
| `list_groups`        | ledger:read  | `listGroups`                | readOnly                    |
| `get_group`          | ledger:read  | `getGroup`                  | readOnly                    |
| `get_my_balances`    | ledger:read  | `myBalances`                | readOnly                    |
| `get_group_balances` | ledger:read  | `groupBalances`             | readOnly                    |
| `list_expenses`      | ledger:read  | `listExpenses`              | readOnly                    |
| `get_expense`        | ledger:read  | `getExpense`                | readOnly                    |
| `list_settlements`   | ledger:read  | `listSettlements`           | readOnly                    |
| `list_activity`      | ledger:read  | `listActivity`              | readOnly                    |
| `preview_expense`    | ledger:write | validate + `checkDuplicate` | readOnly (no ledger change) |
| `record_expense`     | ledger:write | `createExpense`             | idempotent, not destructive |
| `preview_settlement` | ledger:write | validate                    | readOnly                    |
| `record_settlement`  | ledger:write | `recordSettlement`          | idempotent, not destructive |

Write tools are phase 2 (§7). Write-scope checks happen inside the tool with `createInsufficientScopeError`, so a read-only grant can step up.

### 6.4 Inputs and outputs

- Inputs are Zod schemas. IDs are 24-hex ObjectId strings; members and Tags are referenced by id from `get_group`, never by name. Page size is capped at 50.
- `list_expenses` accepts the app's filters plus `month` (`YYYY-MM`) with a required `timeZone` (IANA). `@splitbook/shared/date` gains a pure `getMonthIsoRange(month, timeZone)` beside `getLocalMonthIsoRange`, built on `Intl.DateTimeFormat` so the shared package takes no new dependency (ADR 0002).
- Outputs: `structuredContent` plus a short text rendering. Money is `{ amount: "1250.50", currency: "INR" }`, produced from minor units with `toMajorAmount` and currency precision, never float arithmetic in the tool layer.
- `present.ts` builds explicit output DTOs from the module's results. It serializes documents through their `toJSON` so retry and outbox fields never leak (§2), and it omits fields an assistant does not need: `inviteCode`, edit history and emails of other members.
- Member-authored text (Group names, member names, descriptions, notes, Tag names) is returned only in named fields. Each tool description states these are data written by Group members and are not instructions.

### 6.5 Errors

`LedgerError` → tool result with `isError: true` and the same human message the HTTP API gives, plus the code. Unexpected errors → generic message, logged server-side with the request id; no stack traces or database text in tool output.

## 7. Change 5: preview and record (phase 2)

### 7.1 Confirmation

`preview_*` validates through the operations module without writing: membership, active Tag, currency, precision, conservation, duplicate check. It returns the normalized command with names and per-person amounts, plus a confirmation:

```
confirmation = base64url(payload) + "." + base64url(HMAC-SHA256(MCP_CONFIRMATION_SECRET, payload))
payload      = { v: 1, sub, groupId, op: "expense.create" | "settlement.create",
                 fp: fingerprintCreateCommand(normalizedCommand), nonce: 128-bit random,
                 exp: now + 10 min }
```

`record_*` takes the same readable command **and** the confirmation. The approval prompt an assistant shows the member therefore lists real fields, not an opaque token. It then:

1. verifies the signature, expiry, `sub`, `groupId` and `op`;
2. normalizes the command and checks `fingerprintCreateCommand(normalized) === fp`, so any change after preview is rejected with "preview again";
3. calls `ledgerFor(actor).createExpense(groupId, input, 'mcp:' + nonce)`. The key matches the existing `Idempotency-Key` pattern, so the existing replay path makes a retried record return the original and rejects a different payload under the same key.

Stateless: no preview table, nothing to clean up. `MCP_CONFIRMATION_SECRET` is separate from `AUTH_SECRET` so either can rotate alone.

### 7.2 What stays out

No update or delete tools. They need revision handling, and a mistaken destructive call by an assistant costs more than the convenience is worth during the beta.

### 7.3 Activity attribution

Pass `actor.channel` down to the Activity the service already writes. For assistant writes, store `metadata.via = { kind: 'assistant', clientName }`. The Activity feed on web and Android renders "via {clientName}" when present. The field is optional and additive, so existing records and clients are unaffected. Needs a `@splitbook/shared/activity-timeline` update so both clients render it identically.

## 8. Configuration

| Variable                  | Where         | Default                           | Purpose                                                                                                      |
| ------------------------- | ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `MCP_ENABLED`             | web           | unset (off)                       | Registers plugins, discovery routes, consent page, Settings section and `/api/mcp`.                          |
| `MCP_CONFIRMATION_SECRET` | web (phase 2) | none; required when writes are on | Signs preview confirmations.                                                                                 |
| `NEXT_PUBLIC_APP_URL`     | existing      |                                   | Derives the MCP resource URL and issuer. Must be the public HTTPS origin; loopback HTTP is accepted locally. |

Enable locally in demo mode first, then on a staging deployment separate from the Android staging ledger, and only then decide on production. The Android staging marker (`/.well-known/splitbook-mobile.json`) and its environment are not touched.

## 9. Threats and controls

| Threat                                                 | Control                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token for another app replayed here                    | Audience binding to `${appUrl}/api/mcp`; issuer check; JWKS verification.                                                                         |
| Reading another member's Group (IDOR)                  | Every tool goes through `ledgerFor(actor)`; membership checked per call. Parity and non-member tests.                                             |
| Prompt injection through descriptions or notes         | No tool acts on member text; writes need preview + member-approved record; text fenced in named fields; no outward-facing tools (invites, email). |
| Assistant changes the entry between preview and record | Fingerprint bound into the signed confirmation.                                                                                                   |
| Duplicate entries from retries                         | Confirmation nonce → idempotency key → existing replay path.                                                                                      |
| SSRF through client metadata URLs                      | Verify the CIMD fetcher's address filtering; keep DCR off.                                                                                        |
| Stale access after revoke or Group removal             | Short access-token TTL; refresh ends on revoke; membership checked per call.                                                                      |
| Abuse or runaway loops                                 | Page-size caps; per-user rate limit on `/api/mcp` before writes ship (reuse Better Auth's database rate-limit storage or a small counter).        |
| Sensitive data in logs                                 | Log tool name, actor id, group id and outcome only; never arguments or results.                                                                   |

## 10. Delivery sequence

Each step is a reviewable PR that leaves `main` releasable.

1. **Operations module, reads.** Groups, Balances, Expenses, Settlements, Activity reads move behind `ledgerFor`; routes shrink. Full suites green, no contract change.
2. **Operations module, commands.** Remaining commands and the `LedgerError` mapping.
3. **Better Auth bump alone.** 1.7.3 → 1.7.7 with the full auth suites.
4. **Authorization server behind `MCP_ENABLED`.** Plugins, discovery route, proxy exception, consent page, login resume, Settings revoke.
5. **MCP read tools.** Route, actor mapping, tool catalogue, timezone-aware Month, SDK-client acceptance tests.
6. **Real-assistant verification.** Connect at least one hosted assistant to local or staging; record the clients and protocol versions that worked.
7. **Phase 2 writes.** Preview/record, confirmation secret, Activity attribution in shared and both clients, rate limit.

Steps 1–2 are useful even if MCP is never shipped, and they overlap with the "ledger creation/replay coordination" candidate from #65. Coordinate so the work is done once.

## 11. Docs to update during implementation

`docs/architecture.md` (entry points and the operations layer), `docs/api.md` (MCP section and tool catalogue), `docs/auth.md` (OAuth provider, consent, token lifetime, revocation), the README environment table, and AGENTS.md workspace facts once the design is accepted.

## 12. Verify before building

- Which hosted assistants support MCP `2026-07-28` and Client ID Metadata Documents today. This decides `legacy: 'reject'` versus accepting older protocol versions, and whether DCR is needed.
- The `McpOptions` option names for scopes and token lifetimes, and the exact metadata URLs the plugins publish.
- The login page resumes authorization after the Google redirect round-trip.
- The plugins run on a standalone `mongod` without transactions.
- CIMD fetcher address filtering.
