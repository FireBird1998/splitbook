# Splitbook MCP server

Status: draft, 2026-10-01. Written in the spec-issue format so it can be filed as-is later; deliberately **not** filed and not broken into tickets while the Android private beta is in active development.

Decision record: [ADR 0005](../adr/0005-mcp-server-in-web-app.md). Backend design: [MCP backend design](2026-10-01-mcp-backend-design.md).

## Problem Statement

Members keep asking the same questions of their ledger: who still owes whom in a Trip, what a Household Month cost, what they spent on food across Groups. Today each answer means opening the app, finding the Group and reading screens. Members increasingly work inside AI assistants (Claude, ChatGPT) that can answer such questions directly if they can read the member's data, and could record an Expense from a sentence like "dinner ₹2,400, I paid, split with Sam and Priya".

Splitbook has no safe way to give an assistant that access. There is no token an assistant can hold, no way for a member to grant read-only access, and no way to revoke it. The ledger's rules (membership checks, money conservation, currency precision, Tag identity, retry safety) are enforced across the HTTP route handlers and the services together, so a second entry point that called the services directly would skip some of them and could disagree with the app.

## Solution

Expose Splitbook as a remote Model Context Protocol server inside the existing web application. A member connects an assistant through the familiar Google sign-in, sees exactly what the assistant is asking for, and approves read access, write access or neither. The assistant then acts as that member and nobody else; every call is checked against the member's current Group membership, exactly like the app.

Deliver it in two phases. Phase 1 gives assistants read-only access to Groups, Balances, Expenses, Settlements and Activity, and gives members a place in Settings to see and revoke their connected assistants. Phase 2 adds recording an Expense or a Settlement, always as a preview first and then a separate confirmation that records exactly what was previewed, retry-safe. Assistants never edit, delete, invite, change members or archive; those stay in the app.

Before either phase, move authorization and read-time behavior out of the route handlers into one actor-scoped ledger operations module that both the HTTP API and the MCP tools call. That step changes no request or response format and is worth doing on its own.

## User Stories

### Connecting and controlling an assistant

1. As a member, I want to connect an AI assistant by signing in with the same Google account I use for Splitbook, so that I do not manage another password or key.
2. As a member, I want the approval screen to name the assistant and say plainly whether it can only read or can also record entries, so that I know what I am granting.
3. As a member, I want to grant read-only access without granting write access, so that I can ask questions without letting an assistant change the ledger.
4. As a member, I want to decline an assistant's request without side effects, so that a mistaken connection costs nothing.
5. As a member, I want to see my connected assistants in Settings with what each can do, so that I remember what has access.
6. As a member, I want to revoke a connected assistant, so that it loses access without my signing out anywhere else.
7. As an invited tester, I want the invite-only rule to apply to assistant connections too, so that nobody outside the beta can connect one.
8. As a member, I want an assistant to act only as me, so that it can never read or record on behalf of another person.

### Asking questions (phase 1)

9. As a member, I want an assistant to list only the Groups I belong to, with their Theme and currency, so that it starts from the same view I see.
10. As a member, I want an assistant to see a Group's members and active Tags, so that it can describe and filter entries accurately.
11. As a member, I want an assistant to report my Balances across Groups per currency, so that different currencies are never added together.
12. As a member, I want an assistant to report a Group's Balances and simplified debts, so that it can tell me who should pay whom.
13. As a member, I want an assistant to search a Group's Expenses by date range, Category, Tag, text, payer or participant, so that it can answer specific questions.
14. As a Household member, I want an assistant to answer for a Month in my own timezone, so that "what did August cost us" matches the app.
15. As a Household member, I want an assistant's answers to include recurring Expenses that have fallen due, so that they match what the app shows.
16. As a member, I want an assistant to see how an Expense was paid and split, so that it can explain what I owe for it.
17. As a member, I want an assistant to see a Group's Settlements and recent Activity, so that it can explain how a Balance changed.
18. As a member, I want amounts reported exactly, in minor-unit-correct decimals with their currency, so that an assistant never rounds differently from the app.
19. As a member, I want a removed membership to take effect for an assistant immediately, so that I cannot read a Group I have left through an old connection.
20. As a member, I want descriptions, notes, Tag names and member names written by other people to reach my assistant as data, clearly marked, so that a crafted note has the least possible chance of steering my assistant.

### Recording entries (phase 2)

21. As a member, I want to describe an Expense in words and see exactly how it would be paid and split before anything is saved, so that I can catch a wrong amount or person.
22. As a member, I want the preview to use member names, per-person amounts, Category, Tag, date and the Group currency, so that I can check it at a glance.
23. As a member, I want nothing recorded until I confirm, so that an assistant's misunderstanding stays harmless.
24. As a member, I want the recorded Expense to equal the preview exactly, so that an assistant cannot change it between preview and confirmation.
25. As a member, I want changing any detail to require a new preview, so that I always confirm what is actually recorded.
26. As a member, I want an assistant's retried confirmation to return the original entry, so that one confirmation creates one Expense or Settlement.
27. As a member, I want the same validation messages the app gives (non-members, archived Tag, wrong currency, invalid precision, unbalanced split), so that the assistant can help me correct them.
28. As a member, I want a possible-duplicate warning in the preview, so that I do not record the same dinner twice.
29. As a member, I want to record a Settlement with the same preview and confirmation, limited by the existing rule that only the payer or recipient may record it.
30. As a Group member, I want Activity to show that an entry was recorded through a connected assistant, so that the Group can tell how it was entered.
31. As a member, I want assistants unable to edit or delete entries, change members or roles, send invitations or archive Groups, so that irreversible and social actions stay in the app.

### Operating and maintaining

32. As an operator, I want MCP off unless a deployment enables it, so that production exposure is a deliberate step.
33. As a developer, I want to connect an assistant to my local app as a demo persona, so that I can iterate without real Google accounts; production keeps demo auth blocked.
34. As a maintainer, I want the HTTP API and MCP tools to share one authorization and read path, so that they cannot disagree about who sees what.
35. As a maintainer, I want existing HTTP request and response formats unchanged, so that the web and Android clients need no changes.
36. As an Android contributor, I want this work to leave the mobile API contract and staging marker untouched, so that the beta is not disrupted.

## Implementation Decisions

- Preserve the accepted workspace, shared-domain, Better Auth and Expo decisions. The Next.js application remains the only backend; the MCP server is one route in it (ADR 0005). No new database, runtime, queue or service.
- **Step 0, ledger operations module.** Introduce one actor-scoped module through which every ledger read and command passes: it verifies the actor's current Group membership and role, performs read-time behavior such as materializing due recurring Expenses, calls the existing services and reports failures as a closed set of typed outcomes. Route handlers keep HTTP parsing, headers and status mapping only. The services keep their existing write-side checks as defense in depth. Response formats, status codes, error codes and headers do not change. The one intended behavior change is that Balance reads also materialize due recurring Expenses first; today they can lag until someone opens the Group. Delivered and verified before any MCP code.
- **Authorization server.** Upgrade Better Auth to a version satisfying the MCP plugin (at least 1.7.7) and register its JWT, MCP and Client ID Metadata Document plugins behind a deployment flag. Client registration uses metadata documents; dynamic client registration stays off unless a target assistant is verified to need it. Tokens are audience-bound to the deployment's `/api/mcp` resource.
- **Scopes.** Two product scopes: read (Groups, Balances, Expenses, Settlements, Activity) and write (record Expense, record Settlement). Read is required for every tool; write is additionally required by recording tools and requested only when the member opts in. Refresh tokens keep an assistant connected; revoking consent ends refresh.
- **Sign-in and consent.** The existing login page serves the authorization flow and resumes it after Google or demo persona sign-in; the invite-only allowlist applies unchanged. A new consent page names the assistant from its metadata and lists the requested access in plain language. Settings gains a connected-assistants section listing consents with revoke.
- **Token lifetime.** Access tokens are JWTs verified without a database lookup, so they are short-lived (no more than an hour). Every tool call still resolves the member and checks current membership through the operations module, so removal from a Group takes effect on the next call.
- **Transport.** Stateless streamable HTTP, POST only, no protocol sessions. Start with the current MCP protocol version only; accept older protocol versions only if a target assistant is verified to require them.
- **Proxy.** `/api/mcp` bypasses the session-cookie gate so the route can answer unauthenticated calls with the protocol's 401 challenge; OAuth discovery documents are publicly reachable. Every other API path keeps its current behavior.
- **Phase 1 tools (read).** List my Groups; get a Group (members, active Tags, currency, Theme); my Balances across Groups per currency; a Group's Balances and simplified debts; list a Group's Expenses with the app's filters and bounded pagination; get one Expense with its allocation; list a Group's Settlements; list a Group's recent Activity. Every tool is annotated read-only.
- **Month queries.** A Month is always evaluated in an explicit IANA timezone supplied by the assistant; the response states the timezone and date window used. Without one, the tool asks for it rather than guessing, preserving the rule that a Month is the viewer's own calendar month.
- **Output shape.** Tools return structured content plus a short text summary. Amounts are decimal strings with their currency code, derived from minor units by the shared money module, never floating-point arithmetic in the tool. Member-authored text is returned in clearly named fields and each tool description states that such fields are data written by Group members.
- **Phase 2 tools (write).** Preview Expense, record Expense, preview Settlement, record Settlement. Preview validates through the same rules as the app, returns the normalized entry with names and per-person amounts, any duplicate warning and a signed confirmation. Record takes the same readable command plus the confirmation, verifies the confirmation belongs to the actor, Group and exactly this normalized command and has not expired, then records it using an idempotency key derived from the confirmation. A retried record returns the original entry; a changed command needs a new preview.
- **Confirmation integrity.** Confirmations are stateless, signed server-side with a dedicated secret, short-lived and bound to actor, Group, operation and the normalized command's fingerprint. They are not a substitute for membership checks, which run again at record time.
- **Activity attribution.** Entries recorded through an assistant carry the assistant's registered name in their Activity so members can see the channel. The actor remains the member who authorized it.
- **Excluded operations.** No tools for editing or deleting Expenses, recurring templates, Tags, members, roles, invitations, invite links, Group settings or archiving.
- **Configuration.** A single deployment flag enables the plugins, discovery documents, consent page, Settings section and route; when off, the route answers not found and Better Auth runs exactly as today. The flag defaults off in production and staging.

## Testing Decisions

- The operations-module step is a behavior-preserving refactor: the existing authenticated HTTP, integration and browser suites are its acceptance evidence and must pass unchanged. Add focused tests only for behavior that previously had none, such as a non-member reading Balances.
- Primary MCP acceptance seam: a real MCP client from the official SDK, connected over HTTP to the isolated app and a uniquely named local MongoDB test database, authorized as demo personas. Assert tool results and subsequent authorized reads through the HTTP API.
- Parity tests: for each read tool, the same persona's HTTP API read of the same data returns the same figures. This is the guard against the two entry points drifting.
- Authorization tests: no token, expired token, wrong audience, read-only token calling a write tool, non-member Group, removed member, revoked consent (refresh fails), token issued for another deployment.
- Money tests: whole-unit and fractional-unit currencies, multi-currency Balances, Household Month windows across timezone boundaries, preview/record equality for every split method.
- Write safety tests: record without preview, tampered command, expired confirmation, another persona's confirmation, repeated record returns the original, concurrent records with one confirmation create one entry, Activity shows the assistant name.
- Prompt-injection regression: seed an Expense whose notes contain instructions and assert tools return it only in its data field, with no tool behavior depending on it.
- Browser journeys for consent (approve, read-only, decline) and connected-assistant revoke, at desktop and mobile widths in both themes.
- Manual verification with at least one real hosted assistant against a local or staging deployment before enabling the flag anywhere shared. Record which assistants and protocol versions were verified.
- Run workspace lint, type checking, formatting, unit, integration, authenticated request and browser suites plus the production build.

## Out of Scope

- A separate backend or MCP service, a new database or background-job platform.
- Editing or deleting entries, recurring templates, Tags, members, roles, invitations or Group settings through an assistant.
- MCP resources, prompts, subscriptions and server-initiated requests; tools only.
- Receipt images or OCR through an assistant.
- Personal API tokens or a local stdio server as a product feature.
- Changes to existing HTTP request or response formats, the Android client or its staging marker.
- Enabling MCP in production; that is a separate rollout decision after staging verification.
- Public listing in any assistant's connector directory.

## Further Notes

Open questions to settle before filing:

1. **Target assistants and protocol.** Which assistants must work first (Claude desktop or web connectors, ChatGPT, others), and do they speak the current MCP protocol and Client ID Metadata Documents yet? This decides whether older protocol versions or dynamic client registration must be enabled.
2. **Phase 2 timing.** Ship phase 1 alone to the private beta first, or hold for recording?
3. **Activity attribution copy.** Showing the assistant's name to the whole Group is proposed; confirm that is wanted.
4. **Glossary.** This spec introduces **Connected assistant** (added to `CONTEXT.md`). Confirm or rename.

The operations-module step overlaps the "Group response deepening" and "ledger creation/replay coordination" candidates noted as future exploration in the Expense money-edit spec (#65). Coordinate rather than duplicate: this spec needs only the actor-scoped authorization and read path, not a redesign of those contracts.

Existing domain vocabulary applies: Theme shapes a Group; Category classifies an Expense; Tag is a Group-scoped label; Month is a read-only view in the viewer's timezone, never a ledger boundary.
