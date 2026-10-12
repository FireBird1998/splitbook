# Connect ChatGPT — design interview

Status: Assembled scope and ticket breakdown approved for publication on 11 October 2026. Implementation remains separate.

## Confirmed decisions

- Reuse the existing MCP backend and Connected assistants management.
- Start with guided beta setup. A published ChatGPT plugin listing link is a later phase.
- Provide a public explanation/setup guide, linked from Settings → Connected assistants. Authorization and connection management require sign-in.
- Guide users through read-only access to Groups, balances and spending. This feature does not activate Draft access.
- Show authorization from existing consent records and provide a manual ChatGPT test prompt. Do not add test receipt tracking or claim an automatic test pass.
- Keep the public explanation visible when MCP is disabled, but make setup unavailable. Enabled staging shows its environment clearly and uses its configured endpoint; production never sends members to staging.
- Display actual permissions for existing connections, including Draft access where already granted. Reuse Settings controls to disconnect and reconnect; viewing the guide changes no permissions.
- Use numbered text instructions, copy buttons, expandable OAuth/CIMD details and troubleshooting. Screenshots are deferred.
- Verify the SplitBook journey with browser tests at desktop and mobile widths, reuse backend authorization/revocation tests, and complete a real ChatGPT walkthrough before declaring the guide verified. Claude and production rollout remain separate.
- Prepare the spec and ticket breakdown after the design interview; review them before publication or implementation.

## Existing foundation

- The connections endpoint supplies the configured MCP resource URL and paginated current consent records, including client identity and scopes.
- Existing revocation and stale-account protection must be reused.
- A current consent record proves authorization. The connection-test tool does not persist evidence that a ChatGPT test succeeded.
- Use the existing glossary term **Connected assistant**. No new domain term or architectural decision record is needed for these decisions.

## Approval

- The user approved the [spec](../specs/connect-chatgpt/spec.md) and [two-ticket breakdown](../specs/connect-chatgpt/tickets.md) for GitHub publication.

## References

- [Research](chatgpt-connection-onboarding.md)
- [Staging evidence](../qa/mcp-staging-2026-10-11.md)
- [Previous spec publication](../specs/mcp-drafts-review/publication.md)

All seven interview questions have been answered. The browser-first testing seam was approved in Q7. The user subsequently approved the assembled documents and ticket granularity.
