---
status: proposed
date: 2026-10-01
revised: 2026-10-04
---

# The MCP server is a route in the web app, authorized by Better Auth

Members want to ask an AI assistant about their ledger ("who still owes me for Goa?", "what did August cost us?") and, later, to record an Expense or Settlement through it. We expose Splitbook as a remote Model Context Protocol server at `/api/mcp` inside `apps/web`, the same Next.js deployment that already serves the web app and the Android client, instead of adding a separate backend service. Better Auth becomes the OAuth 2.1 authorization server for MCP clients through its official `@better-auth/mcp` plugin, so an assistant acts as exactly one signed-in member, subject to the same invite-only allowlist, membership checks, money rules and idempotency as the HTTP API. Both entry points call one actor-scoped ledger operations module, so an MCP tool cannot drift from the route that shows the same data.

## Considered options

- **A separate MCP service (`apps/mcp`) that calls the HTTP API.** Rejected: it adds a deployment, a second auth surface (it would need to hold user sessions or mint its own tokens) and network hops, and it would only proxy logic the web app already owns. Revisit if the MCP workload needs a different runtime or scaling profile from the web app.
- **A separate backend service for all clients (web, Android, MCP).** Rejected: the web app's route handlers, Mongoose services and Better Auth already are that backend, and ADRs 0003 and 0004 build on it. None of the triggers for a split exist today: no long-running or scheduled jobs (recurring Expenses materialize on read), no persistent connections, no heavy server compute, no second runtime. The gap that did exist, authorization and read behavior living in route handlers, is closed by the shared operations module rather than a new service.
- **A local stdio MCP server with a personal API token.** Rejected as the product path: it works only for one technical user on one machine, needs a hand-rolled token system with its own revocation, and cannot serve hosted assistants. It remains acceptable as a throwaway development harness.
- **Hand-rolled OAuth on top of Better Auth sessions.** Rejected: the MCP authorization profile (protected resource metadata, audience-bound tokens, client ID metadata documents, PKCE) is exactly what the maintained plugin implements; owning it would repeat the mistake ADR 0003 moved away from.

## Consequences

- Better Auth moves from 1.7.3 to at least 1.7.7 (the plugin's peer range) and gains the `jwt`, `mcp` and `cimd` plugins plus their collections. MCP access tokens are short-lived JWTs verified against the app's own JWKS.
- Revised 2026-10-04: every MCP call also checks that the member's consent still exists, so disconnecting takes effect immediately rather than when the last access token expires. Connections unused for 90 days expire.
- Revised 2026-10-04: clients identify themselves only with Client ID Metadata Documents; dynamic client registration stays off, so assistants without metadata documents can't connect yet.
- Revised 2026-10-04: an assistant reaches only the member's Groups minus their Excluded Groups and minus Groups whose Assistant rule is Not allowed. The operations module enforces this on every call, and unreachable Groups are indistinguishable from unknown ones.
- Revised 2026-10-04: the first version is read-only, plus insights computed in `@splitbook/shared`. See [Connected assistants: decisions](../connected-assistants/decisions.md).
- `/api/mcp` is authorized by bearer token, not the session cookie. The proxy must let it through so the route can answer 401 with the `WWW-Authenticate` challenge MCP clients need for discovery; every other `/api` path keeps the cookie gate.
- The MCP route is stateless (one request per call, no protocol sessions), which suits Vercel functions and needs no Redis.
- Route handlers stop owning authorization and read-time behavior such as recurring Expense materialization; they parse HTTP, call the operations module and map its errors. This is useful without MCP and is the first delivery step.
- MCP is off unless enabled per deployment; demo personas can authorize an assistant locally, and production keeps demo auth blocked.
- Specification: `docs/specs/2026-10-01-mcp-server.md`. Backend design: `docs/specs/2026-10-01-mcp-backend-design.md`.
