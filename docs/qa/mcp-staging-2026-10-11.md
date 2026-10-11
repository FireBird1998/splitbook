# Staging MCP connection checks — 2026-10-11

## Deployment

- Vercel team: `ankit-das-projects`; project: `splitbook-staging`.
- Deployment: `dpl_CqqNhFMGZUoHSRmWpGNknpsns3PR`, READY.
- Application commit: `1059bb5f5a1257311720ca73151b4e2f190268f1`.
- MCP: `https://mcp.staging.splitbook.in/api/mcp`.
- App and OAuth issuer origin: `https://splitbook-staging.vercel.app`.
- `MCP_ENABLED=true` and `MCP_RESOURCE_URL` persisted on the staging project.
- DCR and persistent Draft flags remain off. Existing staging authentication, database configuration and Google callback were retained; no production configuration was changed.
- Hostinger CNAME `mcp.staging` points to the staging project's Vercel target; Vercel verified configuration and HTTPS serves successfully.

## Observed results

- Protected-resource and OAuth authorization-server metadata return HTTP 200 publicly, without Vercel login interception.
- Anonymous MCP initialization returns HTTP 401, `Cache-Control: no-store`, and the correct protected-resource metadata challenge.
- Both actual clients detected CIMD. No DCR fallback or client secret was needed.
- User explicitly approved `ledger:read` plus `offline_access` for both clients. Draft access was not granted.
- Claude used `https://claude.ai/oauth/mcp-oauth-client-metadata`, completed PKCE authorization through the existing signed-in staging session, and listed five read-only tools: connection status, Group list, context, balances and spending. No Draft or save tool was listed.
- Claude's requested connection-status tool call was blocked before execution by the account's exhausted usage credits. The UI reports reset on October 13 at 8:30 PM; no credits were purchased.
- ChatGPT used `https://chatgpt.com/oauth/client.json`, completed PKCE authorization, and installed the private SplitBook Staging plugin. An actual chat connection-status test returned `connected: true`, `mode: connection-test`, `message: Connection verified`.
- Runtime request summaries show successful OAuth consent/token requests and MCP requests; the observed 401 challenges and OIDC-probe 404s are expected. No 5xx was present in the sampled requests.

- ChatGPT post-expiry check passed: after the five-minute token lifetime, the second connection-status call succeeded without re-consent. Vercel recorded HTTP 200 for `/api/auth/oauth2/token` at 15:51:45 UTC and `/api/mcp` at 15:51:50 UTC, more than five minutes after the preceding observed token issuance at 15:46:20 UTC.

## Remaining acceptance

- Further Claude testing is deferred at the user’s request; its OAuth connection remains configured.
- Fresh Google sign-in, denied consent, revocation/reconnection, allowlist removal, optional Draft consent, and hosted web/native Draft save checks remain separate acceptance work. These initial connection checks do not close #384 or approve production rollout.

## CI correction

The full GitHub verifier exposed three stale five-entry zero-count assertions in the Group cleanup HTTP script after `expensedrafts` joined the cleanup collections. Commit `99a7248` derives the expected zero counts from the owned collection list. All seven authenticated cleanup HTTP checks passed against an isolated local replica set, including Draft cleanup, bounded recovery and lost-response replay. This correction changes verification only; staging application code is unchanged.
