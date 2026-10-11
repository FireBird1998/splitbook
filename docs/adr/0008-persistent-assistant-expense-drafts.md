---
status: accepted
date: 2026-10-11
---

# Connected assistants prepare persistent expense Drafts for review in SplitBook

Connected assistants may prepare multiple Expense Drafts that remain available after the chat closes. Each Draft is independently editable or discardable, and a Draft collection belongs to exactly one Group. In the first release, members review and save these Drafts in SplitBook; preparing a Draft does not change Balances.

This replaces the temporary, stateless expense preview approach proposed for phase 2 in `docs/specs/2026-10-01-mcp-backend-design.md`, section 7, for this workflow. A temporary confirmation token avoids storage but cannot support returning tomorrow to review several unfinished expenses. Persistent Drafts require storage and lifecycle management, which we accept to support that experience. The existing proposed design documents remain unchanged as historical proposals; this decision does not accept their other unsettled choices or authorize implementation before the readiness interview is complete.

## Ownership and review

Draft collections are private to the member who prepares them and accessible to that member's Connected assistant only within its granted permissions. Other Group members see the resulting saved Expenses, not unfinished Drafts. Incomplete Drafts are retained with missing information identified; an assistant must not invent missing facts, and saving requires complete, valid expense data.

Review and saving must be available in both the responsive web app and native Android at launch. Web-only review does not meet the agreed first-release scope.

## Saving several Drafts

Saving a selection succeeds independently for each Draft. Valid Drafts become Expenses; invalid or failed Drafts remain available for correction, and the member sees each outcome. Retrying must never create a second Expense from a successfully saved Draft. This deliberately favors progress and correction over an all-or-nothing collection save, so clients must represent mixed outcomes and uncertain replies explicitly.

## Scope confirmation

The interview choices below are recorded; final confirmation of the assembled scope is pending before implementation. Settlement tools are not approved by this decision. The implementation readiness brief is `docs/specs/2026-10-11-mcp-draft-readiness.md`.

## Editing and manual entry

Both manual entry and Connected assistants use persistent Expense Draft collections. Manual entry offers an explicit Keep as Draft action, online only. Android retains its existing device-local form recovery; reconnection never uploads automatically.

Authorized Connected assistants may edit unsaved Drafts. An edit based on an old version must fail rather than overwrite a newer change made on web, Android or by another authorized assistant. The assistant must fetch the current Draft before proposing another change. Saving as an Expense remains exclusive to SplitBook review.

There is one private Draft collection per member per Group. Manual entries and successive assistant requests add to that collection; members do not manage multiple named collections within a Group. Members can select any subset for saving.

## Connection permissions

Connections cover all Groups the member currently belongs to and Groups they join in the future, with membership checked on each operation. Consent must explicitly describe this continuing scope. A separate Draft permission allows reading, creating, revising and discarding that member's manual and assistant-prepared Drafts. Ledger-only permission does not expose private Drafts. Neither permission authorizes saving a Draft as an Expense from chat.

Revocation keeps the member's prepared Drafts and blocks further requests from the revoked connection immediately, rather than waiting for access-token expiry. Completed operations are not undone. Implementation must enforce current grant status in addition to verifying token signatures; the short-lived-token-only proposal in ADR 0005 is insufficient for this requirement. Treatment of requests already in flight needs an explicit enforcement boundary in the implementation design.

## Retention and membership

Drafts do not expire automatically: retain them until saved or discarded, subject to account or Group deletion. Losing Group membership blocks access to and saving of its Drafts, but does not discard them while the Group exists. Rejoining requires fresh review before saving. Group deletion removes its Drafts.

The shared Draft collection requires connectivity to load or change in the first release; offline shared-collection access is out of scope. Existing Android device-local recovery remains separate. Access checks cannot erase information previously delivered to a client or assistant.

Discard is permanent, whether initiated by the member or an authorized Connected assistant. There is no recoverable Discarded view or 30-day recovery window. Consent and tool descriptions must state that the Draft permission includes permanent discard.

## Hard capacity limits

At most 10 Drafts may be created per request and at most 100 active Drafts may exist in a member's private collection for a Group. The latter interprets the user's answer, "100 per group", in the per-member collection scope of the question; final scope confirmation must make this interpretation explicit. These are hard maxima, not the larger adjustable defaults suggested during the interview. Reaching a limit must return a clear error without removing existing work.

## Duplicate handling

A Draft resembling another Draft or saved Expense produces a possible-duplicate warning requiring explicit member acknowledgment before saving. Similar entries are not merged automatically or permanently blocked, because repeated expenses can be legitimate. Exact retries of the same Draft-creation request return the original Draft; this is separate from similarity detection.
