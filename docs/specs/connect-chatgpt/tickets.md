# Connect ChatGPT — proposed ticket breakdown

Status: Approved and published on 11 October 2026. See [publication record](publication.md).

1. **Guide members through read-only ChatGPT beta setup**
   - Blocked by: None within this feature; use the existing MCP foundation.
   - Delivers: Public responsive guide, Settings entry, environment-aware setup values, text instructions, copy controls and troubleshooting, with browser verification.
   - [Ticket draft](tickets/01-guided-beta-setup.md)
2. **Show ChatGPT authorization and verify the complete setup journey**
   - Blocked by: Ticket 1, whose guide hosts the status flow.
   - Delivers: Signed-in authorization check, accurate permission display, refresh/error/account-change handling, links to existing management, browser coverage and the real ChatGPT walkthrough.
   - [Ticket draft](tickets/02-authorization-and-verification.md)

Each ticket includes its own relevant tests. There is no separate horizontal backend, UI or test-only ticket. Published plugin distribution is a later spec, not a blocker.

The user approved the assembled scope, ticket size and dependency. Published with ready-for-agent labels and native parent/blocking links. Implementation remains separate.
