# Connect ChatGPT — guided beta setup

Status: Approved and published on 11 October 2026 as [spec #398](https://github.com/FireBird1998/splitbook/issues/398). Implementation remains separate.

## Problem Statement

Members can authorize ChatGPT against SplitBook's existing MCP backend, but the website currently presents a technical URL with little guidance. Members need to understand the access they grant, complete setup in ChatGPT, and distinguish authorization from a successful test. Public visitors also need an explanation before signing in.

## Solution

Provide a public, responsive Connect ChatGPT guide, linked from Settings → Connected assistants. Walk members through the tested manual setup with numbered instructions, copyable values, a ChatGPT link, permission explanations and troubleshooting. Reuse the existing signed-in connection management to report authorization and manage access.

The first guide teaches read-only setup. A published plugin listing is a later distribution improvement using the same MCP backend, not a prerequisite for beta.

## User Stories

1. As a visitor, I want to read the guide without signing in, so I can understand the feature before connecting.
2. As a member, I want to find the guide from Connected assistants, so I can start from Settings.
3. As a member, I want to understand that access covers my current and future Groups, so consent is informed.
4. As a member, I want the guide to explain read-only ledger access, so I know it cannot save Expenses or expose private Drafts under that permission.
5. As a beta tester, I want staging clearly identified, so I do not confuse it with production.
6. As a visitor where MCP is disabled, I want an explanation without an active setup URL, so I am not sent to a nonworking or different environment.
7. As a member, I want to copy the configured server URL, so I can paste it accurately into ChatGPT.
8. As a member whose browser blocks clipboard access, I want selectable text and a helpful fallback, so I can still finish setup.
9. As a member, I want numbered ChatGPT instructions and expandable authentication details, so technical configuration does not overwhelm the main guide.
10. As a member, I want to understand continued access and how to disconnect, so I can control authorization.
11. As a member, I want to check whether ChatGPT is authorized, so I can see what remains after completing consent.
12. As a member, I want other assistants' connections excluded from that result, so the guide does not falsely claim ChatGPT is authorized.
13. As a member with an existing connection, I want its actual permissions shown, so a read-only guide does not misrepresent broader access.
14. As a member, I want to change permissions through the existing disconnect/reconnect process, so I retain control without a second permission editor.
15. As a member, I want a copyable connection-test prompt, so I can check the connection in ChatGPT without requesting ledger data.
16. As a member, I want authorization distinguished from a successful tool test, so I can trust the status shown.
17. As a member who declines consent or encounters a connection error, I want a retry path, so I can continue without false success.
18. As a member who changes accounts or signs out, I want previous-account connection data cleared, so it cannot be mistaken for the current account.
19. As a member on a phone or using a keyboard, I want usable instructions and controls, so setup is accessible.
20. As a member whose ChatGPT account cannot add custom servers, I want a clear explanation and official help link, so I am not promised unavailable functionality.

## Implementation Decisions

- Reuse the existing MCP endpoint, OAuth/CIMD support, scope model, connections listing and revocation. No new database schema, OAuth flow, test receipt or MCP tool is required.
- Use the existing glossary term Connected assistant. Connect ChatGPT is an action label, not a new domain entity. No new ADR is warranted for this reversible onboarding UI.
- Serve the guide without session requirements. Personalized authorization status and management remain authenticated and subject to existing allowlist checks. The public page exposes only intentional public setup configuration, never connections, tokens or account information.
- Obtain enabled state and resource URL from existing server-side deployment configuration through a safe public projection. Do not make the authenticated connections endpoint public. Treat disabled or invalid configuration as unavailable for setup.
- Show explicit environment identity for staging. Never hardcode the staging endpoint into generic production instructions. This work does not enable MCP in a disabled environment or change hosting configuration.
- Main instructions use the currently documented ChatGPT Plugins flow, with OAuth/CIMD details expandable alongside the relevant step. Include the configured server URL, canonical ChatGPT CIMD identity, read-only ledger scope and refresh-access explanation consistent with the tested setup. No API keys or user-supplied client secrets are required. Draft permission is not requested by this guide.
- Link to ChatGPT's documented Plugins destination; do not invent an endpoint-prefilling installer link. Opening an external page, returning focus or marking a step complete never proves authorization or tool success.
- Signed-out visitors see a sign-in action to check their connection. Signed-in members can explicitly refresh status using the existing authenticated API with account-change protection and no shared caching of personalized results.
- Match ChatGPT by its exact recognized client identity, not a display-name substring or the presence of any connection. Account for paginated results before claiming no matching connection. List actual matching grants and scopes without silently combining permissions.
- Distinguish loading, not authorized, authorized, unavailable and failed-to-check states. A failed request is not proof of disconnection. Clear personalized results on account change/sign-out and reject stale responses using existing protections.
- Existing broader access remains unchanged. Explain actual permissions, including Draft access when present, and link to existing Settings controls. Permissions are changed by disconnecting and reconnecting; this page does not mutate consent.
- Offer a manual prompt asking ChatGPT to run the SplitBook connection check. The tool's answer in chat is the test result; the website never displays an automatic test-pass badge.
- Include troubleshooting for missing custom-server controls, clipboard failure, sign-in/eligibility failure, denied consent, setup errors, and stale connection status. Do not claim every ChatGPT plan or workspace supports custom servers.
- Use numbered text instructions, copy feedback/fallbacks, keyboard-accessible controls and responsive layouts. Screenshots, completion persistence and a new onboarding database are unnecessary.
- Keep the future published-listing action replaceable without implementing a dormant or fabricated listing link now.

## Testing Decisions

- Primary seam: browser-visible SplitBook journey, checking outcomes rather than component internals. Cover public access, Settings entry, configured/disabled environments, URL and prompt copying with fallback, external navigation without false success, sign-in, refresh, actual permissions, pagination and non-ChatGPT connections.
- Cover loading, unauthorized, revoked, request-error and stale-account states; ensure personalized information is neither public nor retained after an account change. Check desktop/mobile widths and keyboard operation.
- Reuse existing real-HTTP OAuth/PKCE/MCP authorization and revocation suites. Extend these only if implementation changes a backend contract; do not duplicate protocol coverage for a UI-only change.
- Complete one real staging ChatGPT walkthrough from the finished guide with an eligible sample account: setup, consent, authorization status, successful connection-test prompt, and existing Settings disconnect followed by refreshed status. Record results without credentials or tokens. Do not call the guide verified if this external check remains pending.
- Existing evidence of token refresh remains relevant but does not substitute for the finished onboarding walkthrough. Claude testing and production enablement are separate.

## Out of Scope

- Published plugin packaging, review, directory submission and listing-link activation.
- Draft onboarding or activation; changes to existing grants simply because a member views the guide.
- Claude setup/testing, native Android implementation, embedded AI chat, GPT Actions or Sign in with ChatGPT.
- Backend redesign, automated installation, persistent tool-test receipts, new connection analytics and setup-progress storage.
- Production deployment, DNS changes, changes to sign-in eligibility or provider-plan guarantees.

## Further Notes

Build on approved MCP spec #383 and its implemented connection foundation; this spec does not supersede its access controls. Earlier proposed ADR language must not weaken immediate revocation.

Research: [ChatGPT connection onboarding](../../research/chatgpt-connection-onboarding.md). Interview: [design decisions](../../research/connect-chatgpt-design-decisions.md). Existing evidence: [staging QA](../../qa/mcp-staging-2026-10-11.md).

Current provider references: [manual setup](https://developers.openai.com/plugins/deploy/connect-chatgpt), [authentication](https://developers.openai.com/plugins/build/auth), [later publication](https://developers.openai.com/plugins/deploy/submission). Recheck external UI wording during implementation and the real walkthrough.
