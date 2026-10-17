# MCP and Claude platform research

Checked against official sources on 30 September 2026. This is platform research for exposing Splitbook to users' existing assistants, not an implementation or a claim that any connector has been tested or published.

## Current protocol and SDK

The official TypeScript documentation identifies **SDK v2 as the stable release line implementing MCP 2026-07-28**. Its server package is `@modelcontextprotocol/server`; older examples using `@modelcontextprotocol/sdk` are v1 examples. This research verifies the release line, not the latest npm patch version. Pin a verified release when implementation starts. [TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)

The 2026-07-28 core is stateless and negotiates capabilities per request. Tools, resources and prompts remain server features; MCP Apps and Tasks are optional extensions. [Protocol specification](https://modelcontextprotocol.io/specification/2026-07-28)

The SDK supports both protocol eras: modern `server/discover` and legacy `initialize`. `createMcpHandler` creates a server per request and defaults to serving legacy traffic with `legacy: 'stateless'`; `legacy: 'reject'` disables that compatibility. Client mode defaults to legacy, while `auto` probes modern and can fall back. **Recommendation:** support both eras initially and measure actual ChatGPT/Claude behavior; do not copy a modern-only example's rejection setting without interoperability testing. [Protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)

Use remote Streamable HTTP. The latest revision has a POST MCP endpoint, JSON or request-scoped SSE responses, and no protocol session or standalone GET stream endpoint. This differs from both older Streamable HTTP and the original HTTP+SSE transport; avoid describing them as interchangeable. Validate supplied Origin headers. [Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

## Authorization baseline

MCP HTTP authorization is based on OAuth 2.1. The MCP server is the resource server; its authorization server may be separate. Protected Resource Metadata and authorization-server discovery are required when implementing this scheme. The current specification recommends Client ID Metadata Documents (CIMD), while Dynamic Client Registration (DCR) is deprecated compatibility support. Resource indicators bind tokens to the MCP endpoint; tokens must be audience-validated, sent in the Authorization header on every request, and never passed in query strings. Access tokens for another service must not be accepted or forwarded as MCP credentials. [Authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

For Splitbook, the design implication is a per-user delegated OAuth grant mapped to an existing account, with scopes and resource authorization enforced on each tool call. Website session cookies and a successful Google login do not by themselves establish that delegated grant. Prefer one public endpoint with per-user authorization over token-bearing or person-specific URLs.

## Claude custom connections

Official help lists remote custom connectors for Free, Pro, Max, Team and Enterprise; Free is limited to one custom connector. Team/Enterprise owners add the connector before members connect their individual accounts. Users can add a remote URL without a public directory listing. Remote calls originate from Anthropic's cloud, including when using Desktop, so the endpoint must be publicly reachable; localhost access from a user's browser is insufficient. [Custom connector help, updated 11 August 2026](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

Claude supports CIMD and DCR by default. CIMD requires metadata advertising both `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`; otherwise Claude falls back to DCR. It requires S256 PKCE. Initiate discovery with HTTP 401 and `WWW-Authenticate` pointing to resource metadata; the resource must exactly match the MCP URL, and only the first authorization server is used. Hosted Claude uses `https://claude.ai/api/mcp/auth_callback`. Token exchanges use form-urlencoded bodies; discovery, registration and token requests have a 10-second limit, refresh 30 seconds. Static request-header credentials are limited-organization beta and represent the organization rather than the individual. They are unsuitable as the main consumer account connection design. [Claude connector authentication](https://claude.com/docs/connectors/building/authentication)

## Public distribution and UI

On 25 September 2026 Anthropic announced plugins as its primary third-party extension packaging. Developers on paid plans can submit a single remote connector or a GitHub-hosted bundle of MCP servers and skills via the developer portal. Approval precedes publication. The announcement explicitly confirms Claude's support for the latest stateless MCP specification and MCP Apps. Its unified discovery experience is described as rolling out over coming weeks; do not promise that every user already has identical UI. [Plugin announcement](https://claude.com/blog/build-plugins-for-claude)

Remote servers and MCP Apps are submitted at [the developer portal](https://claude.ai/directory/manage). Submission requirements include HTTPS, OAuth for user-account tools, tool titles and safety annotations, testing every tool in Claude, documentation/privacy/support materials, and a populated reviewer account. MCP Apps additionally need screenshots. Publication is a separate launch track from privately testing a custom URL. [Connector submission requirements](https://claude.com/docs/connectors/building/submission)

MCP Apps add interactive HTML resources to tools. A tool refers to a `ui://` resource through `_meta.ui.resourceUri`; the host renders it in a sandboxed frame, with capability-controlled messaging and tool calls. The extension's official page lists Claude and Claude Desktop support and emphasizes that support varies across hosts. A text/structured-data fallback remains useful. [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)

Claude's help says third-party interactive connectors cannot make purchases or financial transactions. Keep expense bookkeeping and recorded settlement status semantically distinct from actually transferring money, and verify policy interpretation before any money-movement feature. [Interactive connectors help](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude)

## Recommended investigation gates

These are engineering recommendations, not additional platform requirements:

1. Prove account connection with two separate test users on a public HTTPS staging endpoint. Test connect, reconnect, refresh, revoke, denied scope and cross-account access rejection.
2. Exercise modern and legacy protocol callers against the same tool set; record the era used by real Claude and ChatGPT clients. Latest SDK support does not prove all product rollouts use it.
3. Begin with read tools for groups, expenses, balances and settlement suggestions. Enforce membership even when the model supplies an otherwise valid group ID.
4. Add writes only with deterministic domain validation, retry-safe idempotency and a review/confirmation design. Marking a transfer as recorded must never imply that money moved.
5. Add an expense-review or balance UI after text tools work. Treat public directory review, listing materials and support as release work rather than an SDK feature.

## Remaining uncertainties

- No real Claude or ChatGPT account flow was executed in this research.
- Exact npm patch versions and runtime/framework integration remain implementation checks.
- Platform plan eligibility, directory policy and rollout UI can change; recheck the cited pages before launch.
- ChatGPT-specific eligibility, distribution and UI compatibility are covered separately in the main integration plan; the MCP Apps overview alone does not establish full ChatGPT compatibility.
