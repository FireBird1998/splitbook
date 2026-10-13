# Connected assistants and persistent Expense Drafts

Draft for review — 11 October 2026. Published as #383; quota wording updated by #403 on 14 October 2026.

## Problem Statement

Members want to ask ChatGPT or Claude about their SplitBook Balances and spending, and prepare several expenses without entering each one manually. Existing temporary form recovery cannot provide a private collection available tomorrow across chat, web and Android. Assistant mistakes must not silently affect the ledger.

## Solution

Run an authenticated MCP service within the existing Next.js backend. Members connect an assistant with ledger access and optional separate Draft access. They can ask ledger questions and prepare multiple incomplete Expense Drafts, then review and save them in SplitBook on web or native Android. Manual entries use the same persistent collection.

Each member has one private collection per Group. Each member has a maximum of 100 active Drafts in each Group, and each creation request contains at most 10. At capacity, explain that the member reached their limit and ask them to save or delete items; never expose another member's private entries.

## User Stories

1. As a member, I want to connect ChatGPT, so that I can use SplitBook from that conversation.
2. As a member, I want to connect Claude, so that I can choose my assistant.
3. As a member, I want clear consent for all current and future Groups, so that I understand the continuing access I grant.
4. As a member, I want separate Draft permission, so that ledger access alone cannot reveal unfinished work.
5. As a member, I want consent to explain permanent discard, so that I understand the assistant's destructive capability.
6. As a member, I want to see and disconnect my connections, so that I control continued access.
7. As a member, I want revocation to block further requests despite unexpired tokens, so that disconnecting is effective immediately.
8. As a member, I want prepared Drafts retained after disconnecting, so that I keep my work.
9. As a member, I want the assistant to discover my Groups, so that I can choose the correct context.
10. As a member, I want accurate Balances, so that I understand what I owe or am owed.
11. As a member, I want spending answers with clear dates and currencies, so that totals are understandable.
12. As a member, I want current membership enforced, so that former members cannot continue accessing Group data.
13. As a member, I want several Drafts prepared in one request, so that I can capture a day of expenses together.
14. As a member, I want unfinished Drafts to survive closing chat, so that I can review them later.
15. As a member, I want one private collection per Group, so that unfinished work has one predictable home.
16. As a member, I want manual Keep as Draft, so that I can pause entry without saving an Expense.
17. As a member, I want incomplete Drafts retained, so that missing payer or split details do not lose my work.
18. As a member, I want missing facts clearly identified, so that the assistant does not invent them.
19. As a member, I want Drafts to leave Balances unchanged, so that preparation is safe to review.
20. As a member, I want web review, so that I can inspect prepared expenses in a browser.
21. As a member, I want native Android review at launch, so that my normal mobile workflow is supported.
22. As a member, I want each Draft independently editable, so that I can correct one expense without replacing the collection.
23. As a member, I want stale edits rejected across all clients, so that newer corrections survive.
24. As a member, I want authorized assistants to revise my manual and assistant-prepared Drafts, so that corrections work consistently.
25. As a member, I want permanent discard, so that unwanted Draft content is removed.
26. As a member, I want authorized assistants to discard Drafts, so that I can remove mistaken entries from chat.
27. As a member, I want saving restricted to SplitBook review, so that the assistant cannot record an Expense directly.
28. As a member, I want save validation against the exact reviewed revision, so that changed content cannot be saved without review.
29. As a member, I want possible-duplicate warnings, so that I can inspect similar existing entries.
30. As a member, I want to acknowledge legitimate repetition explicitly, so that similar real expenses are still saveable.
31. As a member, I want successful creation retries to return the original Drafts, so that a lost reply does not duplicate work.
32. As a member, I want saved-Draft retries to return the original Expense outcome, so that repeated clicks cannot double-charge the ledger.
33. As a member, I want to select several Drafts to save, so that review is efficient.
34. As a member, I want valid selected Drafts saved while failures remain, so that one incomplete item does not block the rest.
35. As a member, I want explicit per-item outcomes, so that timeouts and failures do not look like success.
36. As a member, I want my per-member Group limit enforced during simultaneous requests, so that my collection cannot grow beyond 100 active Drafts.
37. As a member, I want clear capacity guidance without access to others' Drafts, so that I know why creation is blocked without losing privacy.
38. As a member, I want Drafts retained until saved or discarded, so that unfinished work never expires silently.
39. As a former member, I want my Drafts retained but inaccessible while membership is absent, so that Group access rules are respected.
40. As a rejoining member, I want fresh review before saving retained Drafts, so that old context cannot authorize a new Expense.
41. As a member, I want Group and account deletion to remove related Draft content, so that private work follows the deletion lifecycle.
42. As an Android member, I want existing device-local recovery preserved, so that offline entry remains recoverable.
43. As an Android member, I want uploads only after an explicit online action, so that reconnecting does not unexpectedly create Drafts or Expenses.
44. As a member, I want uncertain earlier saves resolved before uploading recovered content, so that recovery cannot create a second Expense.
45. As a member, I want discarded requests never to resurrect content on retry, so that permanent discard remains permanent.
46. As a member, I want connection errors and unsupported clients explained clearly, so that I know whether setup succeeded.

## Implementation Decisions

- Follow ADRs 0001–0004, 0006 and 0007 for workspace boundaries, pure shared domain logic, Better Auth, mobile behavior and transaction-fenced Group deletion. Use ADR 0008's persistent Draft decision. #403 confirms its per-member quota wording: 100 active Drafts per member per Group. Earlier stateless previews and token-expiry-only revocation proposals in ADR 0005 and the October 1 designs do not satisfy this scope.
- Keep MCP as a thin adapter within the Next.js backend. Reuse actor-aware domain operations across trusted web/mobile requests and MCP; identity comes from the authenticated session or token, never submitted arguments. Extract only the operations needed by each slice; no broad prerequisite rewrite.
- Use the official MCP SDK and Better Auth-compatible authorization integration, verifying supported protocol versions and peer dependencies during the connection slice. Prove public HTTPS discovery, authorization-code flow with PKCE, consent, resource/audience checking and refresh with both actual assistant hosts. Local DCR test fixtures do not prove production client registration or hosted CIMD behavior.
- Maintain authoritative per-connection grant state. Validate current account eligibility, granted scopes and Group membership on operations, with grant checks at write authorization. Revocation blocks requests authorized after its commit, including requests carrying unexpired tokens; already-authorized in-flight operations may finish. Reconnecting creates a distinct authorization generation so old tokens cannot regain access. Completed effects are not undone.
- Consent explicitly covers all current and future Groups and separately enables private Draft access, including permanent discard. Ledger-only connections cannot enumerate Drafts. No assistant-facing save/convert tool exists.
- Group discovery, Balance reads and spending queries reuse canonical ledger semantics and money handling. Define date boundaries, timezone and currency in responses; never add different currencies into a single total. Existing recurring materialization behavior must be separated from assistant reads or explicitly addressed before labeling tools read-only; MCP read tools must not secretly create Expenses.
- Persistent Draft identity includes Group, owner, revision, incomplete expense values and lifecycle state. Group/owner cannot be reassigned through editing. Share pure validators with both clients. Keep incomplete validation distinct from complete Expense validation; missing facts remain unresolved.
- One private collection per member per Group, with a limit of 100 active Drafts for that owner. Retained active Drafts of absent members never consume another member's capacity. Do not provide administrators access to others' private Drafts to clear capacity.
- Creation accepts 1–10 items and an exact retry identity scoped to owner and Group. Validate the whole request before creating anything; malformed or over-capacity batches create nothing. Return indexed validation errors; never silently truncate. The 100-active limit must remain true under concurrency. Existing successful retries do not consume capacity again.
- At capacity return: “You have 100 items waiting in this Group. Save or delete some before keeping more.” Saving and discarding free capacity. Do not delete old work automatically, disclose owners or imply the requesting member can clear another member's collection.
- Edit, discard and save require the reviewed revision. Conflicts require fetching current state and fresh review. Concurrent save/discard produces one coherent terminal outcome. Permanent discard removes content; minimal content-free replay metadata may remain to prevent resurrection and must also follow account/Group deletion.
- Saving uses the existing complete Expense rules, including exact money, valid participants and applicable Tag rules. Convert each Draft transactionally with a durable Draft-to-Expense outcome so lost replies and concurrent clients cannot create a second Expense. No ledger mutation happens before successful member review.
- Similarity checks cover the owner's private Drafts and authorized saved Expenses, never another member's private Drafts. Warnings explain the match; acknowledgment binds to the reviewed revision and currently reported warning set. Similarity never automatically merges items. Exact replay identity is separate from heuristic duplicate detection.
- Selected saves produce per-item saved/failed/unresolved results. Successful items leave the active collection; failures remain. Retry unresolved operations with their original identity. Revalidate current membership and review context, including leave/rejoin, before recording an Expense.
- Web and native Android offer online list, Keep as Draft, edit, permanent discard, duplicate acknowledgment and individual/selected save. Internal slices may land incrementally, but the feature cannot launch until both clients support the full review flow.
- Android device-local recovery remains separate. Explicit upload preserves payload and operation identity until acknowledgment. Resolve uncertain existing Expense saves before any new Draft upload; no automatic upload or merge on reconnect.
- Integrate all writers with the Group deletion fence and account deletion lifecycle. Deleted Groups cannot be recreated through a late Draft write. Changes to cleanup manifests need backward compatibility or a clear safe regeneration path.
- Protect public authorization/tool boundaries with bounded inputs, request limits, no-store private responses and redacted operational diagnostics. Operational setup must support the atomicity needed for quota and conversion; do not silently fall back to unsafe count-then-insert on standalone MongoDB.

## Testing Decisions

Proposed seams awaiting user confirmation:

1. Authenticated public boundary integration: exercise HTTP routes and official MCP client calls against the same application services and an isolated transaction-capable MongoDB. Reuse existing route integration, financial replay, ledger revision and Group deletion test infrastructure. Cover real OAuth discovery/token behavior separately within this boundary; synthetic identities may isolate tests, but hosted interoperability remains a release gate.
2. User journeys: reuse web browser tests and native Android test/build conventions for connect/revoke and manual/assistant Draft review, including cross-client changes and local recovery handoff. Stage real ChatGPT and Claude connections to verify host-specific discovery, consent and tool execution.

Prefer these highest boundaries to new tests of internal collection queries or mocked service wiring. Assert visible outcomes, authorization, resulting ledger state and durable retry behavior. Add pure-domain tests only when money or duplicate rules cannot be covered clearly through the boundary.

Required cases include cross-owner isolation; separate scopes; changed eligibility; revoked and re-granted connections; absent/rejoined membership; 11-item rejection; per-member 95-plus-concurrent-5 capacity race; incomplete values; stale revisions; save/discard races; duplicate acknowledgment invalidation; creation/save retries after lost responses; mixed saves; deletion races; and Android reconnect with no automatic upload. Draft preparation must leave ledger totals and activity unchanged.

## Out of Scope

Assistant creation or modification of saved Expenses, Settlements, Group membership or other ledger writes; automatic chat approval; multiple named collections per member per Group; per-Group grant selection; offline shared-collection synchronization; automatic expiration; recoverable discard; automatic duplicate merging; public directory listing; iOS launch requirements; receipt OCR expansion. Existing unrelated UI changes are outside this work.

## Further Notes

The user stopped implementation and requested specification and tickets first. Existing uncommitted code is an evaluated prototype, not accepted delivery. It demonstrates a local SDK connection harness and parts of the Draft backend, but lacks production connection management, review clients, conversion and several lifecycle protections. It must be reviewed against the approved tickets before reuse.

#403 supersedes this document’s original Group-wide quota and confirms the per-member limit in ADR 0008. Historical plan files are preserved. Product decisions are already collected; the remaining review concerns test boundaries and ticket sizing/dependencies. No implementation resumes merely because these drafts exist.
