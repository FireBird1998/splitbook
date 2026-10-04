## Problem Statement

Members must be able to recover an Expense or Settlement after a lost response without recording the financial action twice. The two writers repeat retry, collision and Activity coordination but have different authorization and Tag rules. Those differences are easy to erase during consolidation. Settlement creation currently prepares its response before its first Activity publication attempt, leaving recovery to a later retry or feed read if response preparation fails after commit.

## Solution

Characterize current creation and failure behavior first. Preserve each writer’s policies and make fresh creation, replay and collision recovery consistently attempt bounded Activity publication after financial commit and before preparing the response. Consolidate the common retry protocol behind two explicit creation operations only if it reduces caller knowledge and preserves all observed guarantees.

## User Stories

1. As a Group member, I want to retry an Expense after losing its response, so that one submission records one Expense.
2. As a Group member, I want to retry a Settlement after losing its response, so that one recorded payment affects my Balance once.
3. As a Group member, I want to receive a conflict when reusing a request key with different content, so that an accidental retry cannot silently save a different action.
4. As a Group member, I want to have simultaneous matching submissions converge, so that double submission does not duplicate records.
5. As a Group member, I want to have request keys scoped to my account and Group, so that another account or Group cannot claim my operation.
6. As a Group member, I want to have current actor access checked before replay, so that a removed member cannot regain access through a retry.
7. As a Group member, I want to retain existing Expense retry eligibility after another participant leaves, so that a refactor does not change the existing recovery rules.
8. As a Group member, I want to retain Settlement membership and recording permissions on replay, so that retry handling cannot bypass payment-recording authorization.
9. As a Group member, I want to retry an Expense after its Tag is renamed, so that display-name changes do not break a previously submitted action.
10. As a Group member, I want to retry an Expense after its original Tag is retired, so that historical identity remains usable for recovery.
11. As a Group member, I want to retry an Expense after the saved Expense is assigned another Tag, so that immutable creation identity remains authoritative.
12. As a Group member, I want to receive the current saved record on a valid replay, so that recovery preserves the existing read-back behavior.
13. As a Group member, I want to retain currency enforcement for new records, so that creation cannot introduce incompatible ledger currencies.
14. As a Group member, I want to have financial data and recoverable Activity intent saved together, so that an interruption cannot lose the record of what happened.
15. As a Group member, I want to have Activity publication attempted before response preparation, so that a response-preparation failure does not prevent the first publication attempt.
16. As a Group member, I want to keep a committed financial record when Activity storage is unavailable, so that publication trouble does not invalidate the financial save.
17. As a Group member, I want to eventually see one Activity after publication recovery, so that retries do not produce duplicate history.
18. As a Group member, I want to recover after publication succeeds but acknowledgement fails, so that the same Activity is not added again.
19. As a Group member, I want to retry after response preparation fails following commit, so that the saved financial action can be recovered without duplication.
20. As a Group member, I want to have unrelated persistence collisions reported as failures, so that the app does not falsely claim a successful replay.
21. As a Group member, I want to retain the existing meaning of participant order in creation fingerprints, so that retry identity does not change with money-edit refactoring.
22. As a legacy client user, I want to continue submitting without a request key under existing behavior, so that compatibility is preserved without a false deduplication promise.
23. As a Group member, I want to retain existing recurring Expense generation, so that manual retry consolidation does not change template-period behavior.
24. As a Group member, I want to complete Expense and Settlement recovery journeys in the UI, so that backend guarantees hold through actual user actions.
25. As a maintainer, I want to verify failures against real committed records before refactoring, so that the module preserves observed behavior rather than assumptions.
26. As a maintainer, I want to keep two explicit creation operations with shared internal coordination only where useful, so that policy differences remain understandable and repeated retry knowledge is reduced.

## Implementation Decisions

- Scope is manual Expense and Settlement creation/replay. Existing command inputs, optional request keys, routes, response formats and error mappings remain compatible, apart from the approved internal publication ordering.
- Characterization must use the accepted, verified Expense implementation from #70 as its baseline. An open blocker must not be bypassed merely because some implementation commits exist locally.
- Keep two explicit creation operations. Callers provide the authenticated actor, Group, validated input and optional request key; callers do not configure authorization, normalization, insertion, publication or response callbacks.
- Keep Expense and Settlement preparation explicit inside the server-only module. Concrete persistence adapters and any shared retry/commit protocol remain internal. No database behavior moves into the pure shared package.
- Expense checks current actor membership before replay; a matching historical replay can use immutable creation Tag identity before current active-Tag validation. Current participant eligibility is checked for new creation. Preserve legacy Tag aliases after rename, retirement and later reassignment.
- Settlement checks current actor and both parties’ membership and payer/recipient authorization before replay lookup. Preserve this deliberate eligibility difference from Expense.
- Request identity stays scoped to actor and Group. Compare immutable creation fingerprints, preserving normalization and defaults, version handling and participant array-order significance. Do not import order-insensitive money-edit equivalence into creation identity.
- Check and lock currency for new creation after replay lookup. A valid replay returns the current stored record, not a durable snapshot of the original response. Unkeyed legacy creation retains existing behavior without a deduplication guarantee.
- Commit the financial record with pending Activity intent atomically in the same document on standalone MongoDB. Recover duplicate-key insert races only through the exact scoped key and matching immutable fingerprint; rethrow unrelated collisions.
- Fresh creation, normal replay and collision recovery attempt Activity publication before response preparation. Reuse existing bounded publication, idempotent upsert, acknowledgement and feed recovery. Publication failure preserves intent and does not convert a committed financial write into a publication-related request failure.
- Response preparation may itself fail after commit. Preserve retry recovery of the existing record with a single financial effect and eventual single Activity; do not promise that every postcommit failure returns a successful response.
- Consolidation is conditional: demonstrate that repeated protocol knowledge leaves both callers while policy remains local and explicit. If the design requires a callback for every step or merely adds pass-through layers, retain explicit writers, ship the approved ordering improvement and tests, and document the evidence for deferral. Do not force a generic writer to satisfy a refactor checklist.
- Existing arithmetic, fingerprints, indexes, currency locking and Activity modules retain their responsibilities. Characterization tests precede changes; final tests assert the approved behavior rather than permanently pinning the old Settlement ordering.

## Testing Decisions

- Primary seam: authenticated creation requests through the existing isolated app with real MongoDB, followed by authorized record, Balance and Activity reads. Keep full browser lost-response/retry journeys.
- Supplement that seam with real-Mongo creation-interface tests for faults that cannot reliably be induced over HTTP, such as population failing after commit or an unrelated unique collision. Inject infrastructure faults only in isolated tests, never through production routes or public flags.
- Good tests assert saved financial effects, access, returned identity, conflict outcomes and eventual Activity. Do not assert private helper sequences except where ordering is the explicit externally meaningful failure guarantee.
- Before refactoring, characterize simultaneous same-key writes, conflicting payloads, removed actors, Expense versus Settlement participant departure, legacy Tag replay after rename/retirement/reassignment, current-record replay, unkeyed compatibility and creation fingerprint array order.
- Capture current postcommit response-preparation failure behavior for both writers. After the change, verify an Activity attempt occurs even when response preparation fails, then retry and assert one record, one Balance effect and eventual single Activity.
- Reuse existing ledger-money, Expense lost-response UI, Settlement recovery UI and Activity outbox integration coverage. Preserve outages, publication-before-ack crashes, deadlines and bounded recovery behavior.
- Final verification includes real client retries, conflicts, authorization, exact-money regressions, recurring non-regression, responsive/accessibility checks for touched UI, required workspace checks and builds. Report tested revision, exact commands/results and remaining limitations; preserve persistent and production data.

## Out of Scope

Recurring creation identities and progress cursors; financial edits; rounding changes; auth/Google provisioning; new retry eligibility policy; database migrations or transaction requirements; durable original-response snapshots; offline financial synchronization; Group response work; implementation of separate Android feature tickets; parent issue edits or closure.

## Further Notes

Existing Expense verification #70 is the external baseline gate. Group response work can run independently. A justified decision to defer consolidation is an accepted outcome only when characterization, the approved Activity ordering improvement and regression checks are delivered, with evidence explaining why the proposed module fails the depth test. The user approved the testing seam and six-ticket breakdown for publication. This specification does not claim fresh tests or implementation.
