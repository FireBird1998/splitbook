# Spec: deepen Expense money edits and draft recovery

Status: approved and published on September 28, 2026. GitHub: https://github.com/FireBird1998/splitbook/issues/65

## Problem Statement

Members need to trust that editing an Expense will preserve what each person already owes unless they deliberately change the financial definition. Manual Expense edits, recurring-template edits and recurring previews currently reconstruct that decision separately. The participant-reordering defect fixed during ledger hardening showed how an apparently harmless edit could redistribute a historical minor unit. The defect is fixed, but the duplicated policy makes future changes unnecessarily risky.

Members also need their unfinished Expense entry to survive background refresh, validation failure, lost responses and stale-edit conflicts predictably. Today the web rendering module coordinates editable fields, the saved Expense, retry identity, duplicate checking, submission ordering and reload behavior. Adding another input or recovery path requires understanding those interactions together, and much of their verification needs a full browser.

## Solution

Concentrate the money-edit decision in a deep, pure Expense money-edit module used by the existing editing and preview flows. Concentrate web Expense draft and submission recovery in a deep Expense draft module, leaving rendering and platform interactions with the web adapter. Deliver the money-edit module first, then use it while simplifying the draft lifecycle.

Preserve the established ledger rules, request formats and user journeys. Users should see consistent previews, unchanged historical allocations for metadata edits, retained input after recoverable failures, one Expense for a retried submission, and explicit recovery when another edit wins. Keep development on the local full stack; production Google configuration remains deferred.

## User Stories

1. As a member, I want a description-only Expense edit to preserve every person's allocation, so that correcting a description cannot change a Balance.
2. As a member, I want changing notes, Category, date or Tag to preserve the financial allocation, so that organizing an Expense does not redistribute money.
3. As a member, I want participant display order to be irrelevant to an unchanged financial definition, so that reordering people cannot move a historical minor unit.
4. As a member, I want unchanged payer amounts recognized regardless of row order, so that a form refresh does not create a financial change.
5. As a member, I want a deliberate amount change to recalculate using the supported split method, so that the resulting Expense still balances.
6. As a member, I want deliberate payer changes distinguished from metadata edits, so that recorded contributions match my correction.
7. As a member, I want deliberate changes to participants, percentages or shares validated together, so that the complete Expense remains consistent.
8. As a member, I want equal, exact, unequal, percentage and shares-based edits handled consistently, so that changing input method cannot bypass money rules.
9. As a member, I want currency-specific precision preserved when editing historical Expenses, so that whole-unit and fractional-unit currencies remain correct.
10. As a member, I want compatible legacy amounts interpreted without silently changing their historical allocation, so that old records remain trustworthy.
11. As a member, I want invalid stored money to block unsafe editing with a useful explanation, so that the app does not silently repair an ambiguous record.
12. As a member, I want the displayed allocation preview to agree with the allocation that saving will preserve or calculate, so that I can review the actual result before saving.
13. As a Household admin, I want metadata-only recurring-template edits to preserve the template's stored allocation, so that future generation does not unexpectedly change shares.
14. As a Household admin, I want deliberate financial template changes to affect eligible future generation only, so that already generated Expenses remain unchanged.
15. As a Household admin, I want recurring previews and saved templates to interpret the same financial definition, so that the preview is dependable.
16. As a member, I want unfinished fields retained when Group members or Tags refresh, so that background reads do not erase my Expense draft.
17. As a member, I want a selected Tag to retain its identity when renamed, so that refresh can update its display without changing my selection.
18. As a member, I want invalid input to remain editable after validation fails, so that I can correct it without re-entering unrelated fields.
19. As a member, I want a cancelled duplicate warning to preserve my draft, so that I can review the entry before deciding what to do.
20. As a member, I want a lost create response to preserve both my editable draft and the attempted submission identity, so that retrying the same action creates no duplicate Expense.
21. As a member, I want an unchanged retry to reuse its attempted payload and key, so that the server can recognize the original action.
22. As a member, I want a changed create payload distinguished from an unchanged retry, so that a prior retry key is never reused with different submitted content.
23. As a member, I want a retry of the same attempted create to avoid an unnecessary duplicate warning, so that recovery does not mistake the original commit for a new action.
24. As a member, I want a successful save to refresh the affected views and complete the draft once, so that the screen reflects the saved Expense.
25. As a member, I want stale edits rejected while retaining my fields and conflict feedback, so that newer work is not silently overwritten.
26. As a member, I want the base revision retained until I explicitly reload the latest saved Expense, so that background refresh cannot silently rebase my changes.
27. As a member, I want explicit reload to load the newest saved Expense and its revision, so that I can review it before editing again.
28. As a member, I want a failed reload to retain my current draft and recovery context, so that a connection problem does not discard work.
29. As a member, I want switching the Expense being edited to initialize the correct record, so that fields from a previous Expense cannot leak into another one.
30. As a member, I want Group and account identity to remain part of the draft's context, so that unfinished data is not reused for another Group or person.
31. As a member, I want restored Expenses validated under the existing ledger rules, so that restoration cannot bypass money or access restrictions.
32. As a member, I want the same authorization and stable Tag rules on edits and retries, so that recovery cannot bypass access restrictions.
33. As a maintainer, I want money-edit policy expressed once behind a shared interface, so that a correction reaches all existing consumers.
34. As a maintainer, I want draft transitions testable without rendering every field, so that recovery combinations are inexpensive to verify.
35. As a maintainer, I want real app and database tests to remain the acceptance evidence, so that isolated tests cannot hide integration mistakes.
36. As a future mobile contributor, I want proven pure behavior reusable without web dependencies, so that Android Expense entry can adopt it without inheriting browser-specific state.

## Implementation Decisions

- Preserve the accepted workspace, shared-domain, Better Auth and Expo decisions. The Next.js application remains the backend; pure shared modules remain independent of React, Next.js, Mongoose, native SDKs and platform storage.
- Deepen two modules: Expense money edits and Expense draft recovery. Deliver money edits first; the draft module delegates money policy rather than creating another financial implementation.
- The Expense money-edit module owns interpretation of stored money, financial-equivalence detection and the decision to preserve allocation or recalculate. Its inputs and results are plain data. Existing exact-money arithmetic remains the authority for precision, conservation and deterministic allocation.
- Compare participants by normalized identity rather than presentation order. Compare the actual split definition: participant identity for equal splits, percentages for percentage splits, shares for shares-based splits, and entered allocations for exact or unequal splits. Do not treat derived allocations for the other methods as independent instructions to redistribute money.
- Validate stored money before relying on it. Preserve canonical historical payer and participant amounts for metadata-only edits, including compatible legacy representations. Do not replace an old allocation with today's deterministic tie-breaking result merely because it can be recomputed.
- For financial changes, merge the partial change with the existing financial definition and normalize the complete result. Preserve rejection of invalid precision, unsafe amounts, duplicate participants and unbalanced totals.
- Manual Expense edits, recurring-template edits and their allocation previews consume the common decision. An explicit preview error must not be presented as a plausible zero allocation. Keep supported form capabilities, including existing recurring-form limitations, unchanged.
- Keep authorization, current-member eligibility, Group currency locking, Tag resolution, persistence, revisions and Activity outside the pure money-edit decision. Manual metadata edits and recurring generation retain their intentionally different eligibility rules.
- Keep request-fingerprint equivalence distinct from money-edit equivalence. Participant reorder being harmless to a metadata edit does not authorize changing the existing idempotency fingerprint or replay rules.
- Preserve historical currencies where current editing permits them. Preserve recurring scheduling, pause/resume progress, template-period identity and the immutability of already generated Expenses.
- The Expense draft module owns its initialization context, editable financial and descriptive values, base saved Expense and revision, attempted create payload and retry identity, and recovery state. Rendering no longer coordinates these concerns through a collection of independent setters.
- Keep the editable Expense draft distinct from the snapshot of an attempted submission. An unchanged retry uses the same payload and key; changed submitted content starts a distinct action under the existing web behavior. Do not silently replay changed content under an old identity or automatically submit an edited draft.
- Preserve the current web dialog lifetime. This refactor does not add browser-restart persistence or promise recovery after closing and reopening a dialog. Native durable attempts and one persisted draft per account and Group remain part of the separate Android scope.
- Group refresh may update available members and Tag display data but must not silently reset entered values, resolve a stale-edit conflict or adopt a newer base revision. Identity changes initialize a separate draft context.
- Keep the existing explicit Reload latest action as the deliberate replacement of the edit draft by current saved data. A failed reload preserves the prior draft and conflict. Do not introduce automatic merging of money fields.
- Keep duplicate checking advisory and preserve explicit cancellation. Skip re-prompting for an unchanged attempted create retry; server idempotency remains authoritative.
- Keep the browser transport, duplicate confirmation, rendering, accessibility and read invalidation in app-specific adapters. Share only actual pure behavior; do not create a hypothetical native transport or generic persistence abstraction.
- Preserve existing request and response formats, revision headers, idempotency headers, status meanings, authentication gates and schema. No migration or production data operation is required by this specification.
- Settlement retains its own lifecycle. Similar request-key handling is not sufficient reason to fold it into an Expense draft. Group response deepening and ledger creation/replay coordination are separate exploratory candidates.
- Acceptance requires deleting the replaced caller policy and lifecycle coordination. A forwarding module that exposes every prior setter or leaves each caller responsible for the same ordering does not provide the intended depth.

## Testing Decisions

- Primary acceptance seam: existing authenticated HTTP requests and browser journeys against the isolated real application and a uniquely named local MongoDB test database. Assert responses, visible form behavior and subsequent authorized reads of Expenses, recurring templates, Balances and Activity.
- Use the same module interfaces in focused tests that production callers use. Assert values, outcomes and invariants; do not assert private helper calls, the number of state variables, internal file layout or implementation ordering.
- Keep supplementary pure tests for the Expense money-edit decision and Expense draft transitions. These concentrate combinations that are expensive in a browser; they do not replace real app/database acceptance coverage or create new outward-facing seams solely for tests.
- Money-edit cases include every split method, reordered payers and participants, changed amount or payer, metadata changes, historical rounding, compatible legacy floating tails, invalid canonical representations, populated and plain participant identities, and supported currency precision.
- Verify that manual and recurring preview, save and authorized read-back agree. Verify recurring metadata edits preserve allocation and that financial edits leave previously generated Expenses unchanged.
- Draft cases include initialization, Expense/Group/account changes, background refresh, Tag rename, invalid input, duplicate cancellation, lost response, unchanged retry, changed submitted content, successful completion, conflict, failed reload and explicit reload.
- Retain the existing real lost-response journey: let the server commit, lose the response, retry through the form, then verify one Expense and one creation Activity. Do not mock the successful financial commit.
- Retain the existing conflict journey: another authenticated change wins, the stale save is rejected, the draft survives Group refresh, and explicit reload adopts current saved data.
- Prior art includes historical-allocation and participant-reorder regressions, recurring stored-money checks, the isolated expense-access harness, draft-preservation journeys, retry journeys and Activity recovery integration tests. Extend those existing seams instead of creating a second acceptance harness.
- Use real local MongoDB fixtures for historical records and corruption cases that supported requests cannot create. Keep this setup internal to the test harness and isolated from the user's persistent local ledger.
- Remove superseded implementation-coupled tests only after equivalent behavior is covered through the deeper interface. Preserve distinct arithmetic, authorization, database failure and browser integration tests.
- Run workspace lint, type checking, formatting, design-policy checks, focused pure/integration tests and affected authenticated browser journeys during delivery. Finish with the existing full regression and production-build checks, including responsive, accessibility and visual coverage. Report exact outcomes and remaining limitations.
- Production Google sign-in is not needed for this work. Existing deterministic authentication tests remain valid regression checks; they do not claim verification of the live provider configuration.

## Out of Scope

- Production Google credentials, live-provider verification, deployment or production database changes.
- Database migrations, a replacement backend, replacing Better Auth, changing the accepted workspace layout or introducing a new persistence engine.
- Offline financial writes, automatic synchronization, automatic financial-field merging or browser-restart draft persistence.
- Implementing Android Expense screens, native durable storage or the rest of the Android private beta; those have existing tickets and may later consume the pure modules.
- A redesign of Settlement entry, Group response contracts, ledger creation/replay coordination, recurring scheduling or Activity recovery.
- Changing money rounding rules, idempotency fingerprint rules, authorization policies, existing ledger response formats or historical financial data.
- Generic request frameworks, speculative adapters, moving every test to a new framework or rewriting the form's visual design.

## Further Notes

This specification covers the two Strong recommendations from the September 28 architecture review: Expense money-edit policy and Expense draft recovery. Group response deepening and ledger creation/replay coordination remain separate exploration, not implicit implementation scope.

The architecture review examined main at f07206f. Ledger hardening was merged in PR #62; the allocation-reordering defect is already fixed. This work concentrates the rules that remain duplicated and improves their test surface rather than asserting that the previous defect is still open.

Existing Android specifications and Expense-entry tickets remain authoritative for native persistence and mobile delivery. Coordinate adoption at their implementation seam instead of duplicating their feature scope. The local full stack is the working environment, and Google configuration is deliberately deferred.

The user approved the test surface and five-ticket implementation breakdown on September 28, 2026. Publish with the ready-for-agent label. The user will start a separate implementation agent; this planning task does not start implementation.
