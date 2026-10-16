# MCP connections and persistent Drafts — #384–394

The Next.js app serves connection status, Group discovery/context, Balances and spending tools. Separate Draft permission enables list/create/replace/permanent-discard tools when persistent Drafts are enabled. No assistant save tool exists. See [Draft operations and verification](../qa/mcp-drafts-implementation.md) and [staging connection results](../qa/mcp-staging-2026-10-11.md).

Group context and the item tools list the Category choices. An assistant sets a Category only when the member's words make it clear; an item without one is saved as Other, and a lone payer without an amount paid the whole Expense (#425).

## Deployment configuration

MCP is disabled by default. Enable it only on the deployment intended for connector testing:

| Variable              | Staging                                                      | Production, after acceptance          |
| --------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `MCP_ENABLED`         | `true`                                                       | `true`                                |
| `MCP_RESOURCE_URL`    | `https://mcp.staging.splitbook.in/api/mcp`                   | `https://mcp.splitbook.in/api/mcp`    |
| `NEXT_PUBLIC_APP_URL` | Canonical staging app HTTPS origin                           | Canonical production app HTTPS origin |
| `AUTH_MODE`           | `google`                                                     | `google`                              |
| `AUTH_ALLOWED_EMAILS` | Explicit staging testers                                     | Approved members                      |
| `MCP_ALLOW_DCR`       | `false` by default; enable only for a host that requires DCR | Same tested policy                    |

The current staging app origin is `https://splitbook-staging.vercel.app`, retaining its existing Google callback configuration. The optional `https://staging.splitbook.in` app hostname has not been provisioned. Do not point a staging MCP hostname to the production data environment. Give staging its own MongoDB database, auth secret and Google OAuth callback configuration. Never copy production session or signing-key records into staging. MCP requires an explicit canonical app origin; localhost HTTP is permitted only outside production.

Use the Vercel project's `apps/web` root. Attach the staging MCP hostname to the staging deployment/project and its app hostname to that same environment. Attach the production MCP hostname only to production when ready. A hostname does not select an environment merely because it contains “staging”. Obtain the exact CNAME and any verification TXT values from Vercel for the selected project; do not use a guessed universal DNS target. Add those records at the authoritative DNS provider, wait for verification and TLS, and preserve unrelated records.

MCP discovery and tool requests must be reachable by external assistant servers. Vercel login/deployment protection cannot intercept those requests. OAuth and the application allowlist remain mandatory even when the deployment is publicly reachable. The Google callback is on the canonical app origin at `/api/auth/callback/google`; OAuth consent and session cookies stay on that origin. No parent-domain session cookie is required.

## Protocol and authorization

- Official TypeScript SDK v2, currently pinned to 2.3.1, targets protocol revision 2026-07-28; stateless compatibility with older initialization clients is explicitly enabled and tested.
- Better Auth MCP/CIMD/OAuth provider packages are pinned to 1.7.7. CIMD uses the MCP 2026-07-28 profile with the provider's Node transport for SSRF-safe metadata resolution. Real hosted CIMD interoperability remains pending.
- DCR is disabled unless `MCP_ALLOW_DCR=true`. The local compatibility tests explicitly enable it for synthetic clients; this is not evidence that a real host requires it.
- OAuth uses authorization code + PKCE, resource-bound signed access tokens and refresh tokens. Browser session cookies alone cannot call MCP.
- Discovery is served by Better Auth through the well-known route. Check protected-resource metadata at `/.well-known/oauth-protected-resource/api/mcp` on the MCP origin and authorization-server metadata at `/.well-known/oauth-authorization-server/api/auth` on the canonical app origin. Follow returned metadata rather than inventing token endpoints.
- Consent covers all current and future Groups, with a separate unchecked-by-default Draft permission including permanent discard. Ledger-only connections cannot enumerate Draft tools or private Drafts. Conversion remains session-authenticated in SplitBook.
- Each owner/client pair has a durable `mcpConnection` record with a unique key and a random generation. The OAuth consent reference, pending authorization code, refresh lineage and signed access-token claim bind to that generation. Disconnect atomically replaces it. Old access tokens, refresh tokens and unexchanged codes cannot adopt the new generation after reconnection.
- Current account existence, eligibility, generation and scopes are checked on every MCP request and token issuance. Requests authorized after revocation fail. A request authorized before revocation may finish; completed effects are not undone.
- Connection management is session-authenticated and ownership-scoped. Cross-origin writes and stale page/account mismatches are rejected. Generic provider consent update/delete routes are intentionally refused because they do not rotate the application generation; change permissions by disconnecting and reconnecting through Settings.
- MongoDB's Better Auth adapter creates the declared plugin indexes, including the unique owner/client key, on first use. The integration suite uses the real adapter and verifies persistence across fresh auth instances. Do not clear signing keys, connections or OAuth collections on deploy. Connection authorization can use standalone MongoDB. Persistent Draft mutations require a replica set or sharded cluster; there is no unsafe standalone fallback.

To add preparation permission to an existing read-only connection, disconnect and reconnect, then tick “Also let it prepare expenses for your To review”.

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
