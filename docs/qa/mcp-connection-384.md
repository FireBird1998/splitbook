# MCP connection verification — #384

Historical connection-slice evidence. Subsequent ledger/Draft implementation and current checks are recorded in [MCP and Draft implementation](mcp-drafts-implementation.md).

11 October 2026. Local implementation verified; hosted acceptance remains pending. No deployment, DNS, GitHub issue state, commit or production data was changed.

## Delivered

- Reused the SDK v2 connection prototype and mounted a feature-gated Next.js MCP route with the synthetic `connection_status` tool only.
- Added canonical resource configuration, including separate staging/production MCP hostnames, and Better Auth well-known discovery forwarding.
- Integrated OAuth PKCE, refresh, CIMD and an explicitly enabled DCR compatibility option using the installed Better Auth packages.
- Added browser login continuation, permission review with optional Draft access, and paginated connection Settings with disconnect.
- Persisted owner/client authorization generations. Disconnect invalidates old access tokens, refresh credentials and unfinished authorization codes even after reconnecting.
- Added current-account eligibility checks, per-connection scope checks, owner-scoped management, explicit same-origin write protection and stale-page account protection.
- Kept the prior Draft prototype and unrelated landing work outside this ticket's edits.

## Evidence

| Check                                                             | Result                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| MCP/auth targeted suite                                           | 54 passed across five files, including real MongoDB and real OAuth/SDK HTTP calls |
| Web typecheck                                                     | Passed                                                                            |
| Targeted ESLint                                                   | Passed                                                                            |
| Changed MCP files Prettier check and diff whitespace check        | Passed                                                                            |
| Full web unit suite                                               | 897 passed; 2 failed in the unrelated landing-page brand expectations             |
| Isolated production-style Next.js build                           | Passed with HTTPS app/MCP configuration, MCP enabled and DCR disabled             |
| Browser sign-in → consent → callback                              | Passed using the synthetic persona and real authorization server                  |
| Official SDK against mounted Next.js route after browser approval | Listed only `connection_status`; returned `connected: true`                       |
| Browser Settings disconnect → retry original unexpired token      | Passed; token rejected with HTTP 403                                              |
| Light desktop / narrow light and dark Settings                    | Inspected screenshots; no browser console errors during the journey               |

The two full-suite failures are the landing page footer-logo and feature-icon expectations in `brand-surfaces.test.ts`, against independently modified landing content already present before this ticket. Those files were not changed to force the tests green.

The browser fixture used an isolated MongoDB database and a temporary app copy because another dev server was already using the workspace build directory. The production build used no real Google client credentials; the expected missing-provider-credentials warning means it proves compilation, not Google login interoperability. Browser login used the existing demo persona solely on loopback. Font preload warnings appeared during dev navigation; no browser errors occurred.

The authorization suite covers both protocol eras, bearer-only MCP authentication, discovery, login continuation, optional scopes, malformed consent, cross-owner and cross-origin refusal, stale account headers, durable reads through a new auth instance, eligibility removal, refresh, revocation, reconnect and old pending-code rejection. Both memory and MongoDB adapters run the same public HTTP cases.

## Browser artifacts

- [Consent, desktop](../../output/mcp384/consent-desktop.png)
- [Connected Settings](../../output/mcp384/settings-connected.png)
- [Disconnected Settings, phone width](../../output/mcp384/settings-disconnected-mobile.png)
- [Disconnected Settings, dark phone width](../../output/mcp384/settings-disconnected-dark.png)

## Remaining acceptance gate

The user selected `mcp.staging.splitbook.in` and `mcp.splitbook.in` and confirmed neither is set up. The local implementation supports those hostnames, but it is not reachable there yet. Actual ChatGPT and Claude accounts, public HTTPS discovery, hosted CIMD/client registration and Google consent must be verified on staging before closing #384.

Follow [the deployment runbook](../runbooks/mcp-connections.md). Provision a separate staging app/data environment, configure the app and MCP domain aliases with the exact DNS records Vercel supplies, configure staging Google callbacks and eligible testers, then run the host acceptance checklist. Production remains disabled by default. This is a connection-only slice; it grants no working ledger or Draft tools yet.
