# MCP connections and persistent Drafts — #384–394

The Next.js app serves connection status, Group discovery/context, Balances and spending tools. Separate Draft permission enables list/create/replace/permanent-discard tools when persistent Drafts are enabled. No assistant save tool exists. See [Draft operations and verification](../qa/mcp-drafts-implementation.md) and [staging connection results](../qa/mcp-staging-2026-10-11.md).

Group context and the item tools list the Category choices. An assistant sets a Category only when the member's words make it clear; an item without one is saved as Other, and a lone payer without an amount paid the whole Expense (#425). It sets the Group Tag that clearly matches the member's words and asks when none clearly fits, because a Tag is required.

## Deployment configuration

MCP is disabled by default. Enable it only on the deployment intended for connector testing:

| Variable                   | Staging                                                                            | Production, after acceptance                               |
| -------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `MCP_ENABLED`              | `true`                                                                             | `true`                                                     |
| `MCP_RESOURCE_URL`         | `https://mcp.staging.splitbook.in/api/mcp`                                         | `https://mcp.splitbook.in/api/mcp`                         |
| `NEXT_PUBLIC_APP_URL`      | Canonical staging app HTTPS origin                                                 | Canonical production app HTTPS origin                      |
| `AUTH_MODE`                | `google`                                                                           | `google`                                                   |
| `AUTH_ALLOWED_EMAILS`      | Explicit staging testers                                                           | Approved members                                           |
| `MCP_ALLOW_DCR`            | `false` by default; enable only for a host that requires DCR                       | Same tested policy                                         |
| `MCP_DEPLOYMENT`           | `staging` only for shortened inactivity checks; otherwise unset                    | Unset                                                      |
| `MCP_IDLE_TIMEOUT_SECONDS` | Optional integer 120–7776000 with the staging marker; unset or empty means 90 days | Unset; ignored when `MOBILE_APP_ENV=production`            |
| `MOBILE_APP_ENV`           | `staging`                                                                          | `production`; prevents copied staging inactivity overrides |

A Vercel environment-variable change requires a staging redeploy before it takes effect.

The current staging app origin is `https://splitbook-staging.vercel.app`, retaining its existing Google callback configuration. The optional `https://staging.splitbook.in` app hostname has not been provisioned. Do not point a staging MCP hostname to the production data environment. Give staging its own MongoDB database, auth secret and Google OAuth callback configuration. Never copy production session or signing-key records into staging. MCP requires an explicit canonical app origin; localhost HTTP is permitted only outside production.

Use the Vercel project's `apps/web` root. Attach the staging MCP hostname to the staging deployment/project and its app hostname to that same environment. Attach the production MCP hostname only to production when ready. A hostname does not select an environment merely because it contains “staging”. Obtain the exact CNAME and any verification TXT values from Vercel for the selected project; do not use a guessed universal DNS target. Add those records at the authoritative DNS provider, wait for verification and TLS, and preserve unrelated records.

MCP discovery and tool requests must be reachable by external assistant servers. Vercel login/deployment protection cannot intercept those requests. OAuth and the application allowlist remain mandatory even when the deployment is publicly reachable. The Google callback is on the canonical app origin at `/api/auth/callback/google`; OAuth consent and session cookies stay on that origin. No parent-domain session cookie is required.

## Protocol and authorization

- Official TypeScript SDK v2, currently pinned to 2.3.1, targets protocol revision 2026-07-28; stateless compatibility with older initialization clients is explicitly enabled and tested.
- Better Auth MCP/CIMD/OAuth provider packages are pinned to 1.7.7. CIMD uses the MCP 2026-07-28 profile with the provider's Node transport for SSRF-safe metadata resolution. Real hosted CIMD interoperability remains pending.
- DCR is disabled unless `MCP_ALLOW_DCR=true`. The local compatibility tests explicitly enable it for synthetic clients; this is not evidence that a real host requires it.
- OAuth uses authorization code + PKCE, resource-bound signed access tokens and refresh tokens. Browser session cookies alone cannot call MCP.
- Discovery is served by Better Auth through the well-known route. Check protected-resource metadata at `/.well-known/oauth-protected-resource/api/mcp` on the MCP origin and authorization-server metadata at `/.well-known/oauth-authorization-server/api/auth` on the canonical app origin. Follow returned metadata rather than inventing token endpoints.
- Consent covers all current and future Groups, with a separate unchecked-by-default Draft permission including permanent discard. Ledger-only connections cannot enumerate Draft tools or private Drafts. Conversion remains session-authenticated in Splitbook.
- Each owner/client pair has a durable `mcpConnection` record with a unique key and a random generation. The OAuth consent reference, pending authorization code, refresh lineage and signed access-token claim bind to that generation. Disconnect atomically replaces it. Old access tokens, refresh tokens and unexchanged codes cannot adopt the new generation after reconnection.
- Current account existence, eligibility, generation and scopes are checked on every MCP request and token issuance. Requests authorized after revocation fail. A request authorized before revocation may finish; completed effects are not undone.
- Connection management is session-authenticated and ownership-scoped. Cross-origin writes and stale page/account mismatches are rejected. Generic provider consent update/delete routes are intentionally refused because they do not rotate the application generation; change permissions by disconnecting and reconnecting through Settings.
- MongoDB's Better Auth adapter creates the declared plugin indexes, including the unique owner/client key, on first use. The integration suite uses the real adapter and verifies persistence across fresh auth instances. Do not clear signing keys, connections or OAuth collections on deploy. Connection authorization can use standalone MongoDB. Persistent Draft mutations require a replica set or sharded cluster; there is no unsafe standalone fallback.

To add preparation permission to an existing read-only connection, disconnect and reconnect, then tick “Also let it prepare Expenses for your To review”.

## Local verification

Use a dedicated test database and a separate loopback port. The connection suite uses synthetic users, real OAuth HTTP requests and the official SDK against both memory and MongoDB adapters. The browser check starts at a client authorization request, passes through persona sign-in, displays real consent, approves a ledger-only connection, exchanges the resulting code, calls the mounted Next.js MCP route, then disconnects in Settings and retries the previously valid token.

Commands from the repository root:

```sh
pnpm web typecheck
pnpm web test:unit
TEST_MONGODB_URI='mongodb://127.0.0.1:27029/?directConnection=true' pnpm web exec vitest run src/lib/mcp/connection.integration.test.ts
```

The integration suite only drops its isolated `splitbook-test-mcp-connection` database. For a browser demo, set `MCP_ENABLED=true`, `MCP_ALLOW_DCR=true`, a synthetic auth secret, a localhost app URL and an isolated database. Do not enable demo authentication on public staging.

## Hosted acceptance still required

The staging MCP hostname and deployment are now configured; production remains unchanged. Initial ChatGPT and Claude CIMD connection results are recorded in the staging report. Keep #384 open until the remaining checks pass:

1. Provision the staging app/data environment and both staging hostnames with HTTPS, and verify discovery without a Vercel login screen.
2. From actual ChatGPT and Claude accounts, add the staging MCP URL; record host/account availability and whether each used CIMD or the explicit DCR fallback.
3. Complete Google login and consent. Test ledger-only and optional Draft consent, denial, token refresh and `connection_status`. Confirm the expected ledger tools are listed, and that Draft tools appear only with Draft permission and the Draft feature enabled. Confirm there is no assistant save tool.
4. Disconnect in Settings, retry the connection, then reconnect. Verify previous credentials remain rejected. Remove the test member from the allowlist and verify access is refused.
5. Record results and remaining limitations before promoting production configuration. Complete web and native Android Draft review/save acceptance as well. Public assistant directory publication remains separate.

Disable MCP by setting `MCP_ENABLED=false` and redeploying. This removes the connector and management endpoints; retain durable records so a deployment toggle does not silently erase user grants. Re-enabling restores still-authorized connections, so use Settings revocation when permanent disconnection is intended.

## Persistent Draft switches and storage

Leave all switches off until the complete host/client acceptance is approved:

- Backend: `PERSISTENT_DRAFTS_ENABLED=true` enables private Draft operations and permitted MCP Draft tools.
- Web build: `NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED=true` shows Draft navigation and Keep as Draft. The server switch must also be enabled.
- Android build: `EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED=true` shows the native collection and explicit upload action. Rebuild the application when changing it.

`MCP_ENABLED=false` disables assistant access independently; manual Drafts can remain available. Disabling the Draft switch blocks Draft changes without deleting content or replay receipts. Do not delete `expensedrafts` during rollout or rollback: receipts prevent duplicate conversion and resurrection. Test transactions and unique indexes on the actual staging database before enabling writes.

The cap is 100 active Drafts per member per Group; another member’s Drafts never consume your capacity, including when that member is temporarily absent; requests accept at most 10 creations. Saved/discarded receipts contain no Draft values and do not consume capacity. Group cleanup appends `expensedrafts` after the older collections so in-progress numeric cleanup cursors remain valid. Old reviewed manifests that lack the count mean zero and are refused if the Group now has Drafts; regenerate and review changed manifests. Resume an already claimed deletion using its durable deletion request rather than replacing its manifest fingerprint.

Account deletion invokes the Better Auth user-delete hook, fencing concurrent Draft writes and removing all owned Draft content/receipts. The hook supports the existing account lifecycle; this change does not introduce a new account-deletion UI. Administrative account removals must use that lifecycle rather than bypassing it with raw Mongo deletion.

MCP requests are bounded to 128 KiB and 120 requests per member per minute across application instances. Private responses are no-store. Inputs and failures never log Draft content at the new boundary. Ledger tools read only already-recorded Expenses; they do not materialize recurring Expenses. Spending windows use explicitly reported inclusive UTC calendar days, with full-window totals separated by currency and paginated details.

## Settings connection reads (#615)

`GET /api/auth/mcp/connections` is session-authenticated and owner-scoped. Each connection
includes `id`, `clientId`, `name`, `scopes`, `access` (`Ledger` or `Ledger + To review`) and
`lastUsedAt` (an ISO instant, or `null` for Not used yet), and `excludedGroupIds`: the Groups the
member left out (#617, #620). Pagination and no-store behaviour are unchanged. Android can use
this same reply.

The durable `mcpConnection` adds only optional `name` and `lastUsedAt` fields. New connections
save the cleaned metadata name, and approval refreshes it if the metadata changed. Older
records fall back to the existing metadata-name reader without a migration. Authorized MCP
calls update last use with a generation-scoped database predicate, at most once a minute
across instances. Settings reads, token issuance and rejected credentials do not count as
assistant use. Disconnect clears last use while rotating the generation, so reconnecting
starts at Not used yet. Existing Drafts and the immediate revocation boundary are unchanged.

Settings asks for confirmation before `POST /api/auth/mcp/revoke`. Cancelling makes no
revocation request; confirming explains that access stops at once and To review stays.
The server remains responsible for ownership and live generation checks.

## An assistant's Groups (#620)

`GET /api/auth/mcp/connection?id=` reads one connection in the list's shape, and
`POST /api/auth/mcp/connection-groups` (`{ id, excludedGroupIds }`) replaces the Groups it
leaves out. Both are session-authenticated and act only on the member's own live connection:
another account's, a disconnected or an expired one answers 404, and ids that aren't Group ids
answer 400. The save is held to the generation that was read live. It needs no new consent, and
the assistant's next MCP request reads the new Excluded Groups.

## Inactive connections (#618)

An authorization expires at **90 days without an authorized MCP request**. The server checks
this on every MCP request and on token issuance, including refresh; an unexpired access token
cannot bypass it. Settings omits expired connections. Reading Settings or rotating tokens
alone does not keep a connection active. Reconnecting creates a new generation and requires
consent again; old access tokens, refresh tokens and authorization codes cannot adopt it.
Existing To review items remain untouched.

The last-use timestamp is the `mcpConnection.lastUsedAt` added in #615. A connection never
used by an assistant ages from its current OAuth consent's `createdAt`, falling back to the
durable connection's `createdAt` for legacy consent records. This also gives a never-used
reconnection its own full idle window. No additional connection fields or migration are
introduced. Reconnection rotates `generation` and clears `lastUsedAt` with a compare-and-set
predicate so it cannot overwrite newer activity or another reconnection.

Effective lifetimes:

- Access tokens: **300 seconds**, with live generation, membership, scope and inactivity
  checks at the MCP boundary.
- Refresh tokens: **91 days from each issuance/rotation**, replacing the provider's 30-day
  default. The extra day covers use of a five-minute access token after it was issued, so a
  refresh token cannot end an active connection before 90 days from its last use. The server
  still refuses refresh at 90 idle days; the extra lifetime does not extend permission.
- Consent/grant records: no independent earlier expiry. The server's idle deadline and
  generation control authorization. Browser sign-in sessions keep their existing lifetime;
  expiring a browser session does not expire an assistant's refresh grant.

For a shortened check on an isolated staging deployment, set **both**
`MCP_DEPLOYMENT=staging` and `MCP_IDLE_TIMEOUT_SECONDS=120`. The timeout must be an integer
from 120 through 7776000: last use is written at most once a minute, so shorter timeouts
could expire an active connection. With an unset or empty timeout, even staging keeps 90 days.
Timeout overrides are ignored unless the marker is explicitly staging, and always ignored
when `MOBILE_APP_ENV=production`, even if staging variables were copied. A malformed staging
value logs a clear configuration error once per server instance and disables the MCP plugins
at auth initialization. MCP, its OAuth routes and discovery return 503 with no-store responses;
normal sign-in, session reads and other app routes keep working. Remove both staging variables to restore
90 days, then redeploy staging so the Vercel environment change takes effect. Do not change production settings for
this check. These settings alter server enforcement, not just the displayed list.

The moved-clock real-client suite runs against memory and MongoDB adapters. It covers a
never-used connection at day 90, refresh and use at day 89, another refresh just before day
179, refusal of that still-valid JWT at the idle deadline, disappearance from Settings,
reconnection without reviving old tokens, and the shortened staging deadline.
