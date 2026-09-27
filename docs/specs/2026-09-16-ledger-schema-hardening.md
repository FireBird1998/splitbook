# Ledger schema hardening

Status: approved for publication and implementation on 2026-09-16.

## Problem Statement

Splitbook's collection structure fits shared expenses, but a ledger can currently accept amounts whose payer and split totals disagree, lose a minor unit through rounding, lose Tag identity on rename, and duplicate a financial entry when a request is retried after a partial failure. Long-running Household groups also load more historical data than their balance screens need. Users need reliable balances, stable categorization, and safe retries without losing their existing data.

## Solution

Keep the existing Group, Expense, Settlement, recurring template and Activity model. Strengthen money representation and validation, preserve Tag identity, make financial writes retry-safe, reject stale edits, and reduce unnecessary history reads. Introduce compatible fields before migrating existing records. Supply a repeatable migration audit and verification workflow; never silently repair ambiguous historical financial data.

## User Stories

1. As a member, I want every Expense's paid total to equal its amount, so that balances reflect actual payments.
2. As a member, I want every Expense's split total to equal its amount, so that no money is created or lost.
3. As a member, I want equal splits to distribute every minor unit, so that an indivisible amount still balances.
4. As a member, I want shares-based splits to preserve the total, so that weighted participation remains accurate.
5. As a member, I want percentage splits to require a complete allocation, so that missing percentages cannot erase debt.
6. As a member, I want exact and unequal splits validated on the server, so that every client follows the same rules.
7. As a member, I want duplicate payer or participant entries rejected, so that totals and summaries agree.
8. As a member, I want currency-appropriate precision, so that the app does not create fractional units my currency does not support.
9. As a member, I want changes validated against the complete resulting Expense, so that a partial edit cannot corrupt it.
10. As a member, I want useful validation messages, so that I can correct a rejected entry.
11. As a Household admin, I want recurring templates to obey the same money rules, so that every generated Expense balances.
12. As a Household admin, I want invalid legacy templates identified, so that they do not keep generating corrupt Expenses.
13. As a member, I want Settlement amounts and balances to use the same exact units, so that settling clears the intended debt.
14. As a member, I want each currency kept separate, so that different currencies are never added together.
15. As an admin, I want renaming a Tag to preserve its relationship to Expenses, so that historical entries remain filterable.
16. As a Household admin, I want Tag renames to preserve recurring templates, so that future generation continues correctly.
17. As an admin, I want Tag deletion blocked while Expenses or recurring templates reference it, so that links remain valid.
18. As a member, I want to edit an Expense that retains an archived Tag, so that archiving does not prevent unrelated corrections.
19. As a member, I want a failed-response retry to return the original Expense or Settlement, so that one action creates one entry.
20. As a member, I want changed requests to be distinguished from retries, so that an old retry key cannot record the wrong amount.
21. As a member, I want concurrent changes detected, so that my edit does not silently overwrite another person's work.
22. As a member, I want the Activity feed to recover after a temporary logging failure, so that successful financial writes remain auditable.
23. As a member, I want access restrictions to apply to retries and stale edits, so that a replay cannot bypass removed membership.
24. As a Household member, I want balances and lists to avoid downloading unrelated edit history, so that the app stays responsive as records accumulate.
25. As an operator, I want a dry-run migration report, so that I can review incompatible amounts and unresolved Tags before changing data.
26. As an operator, I want migration to be repeatable and preserve legacy fields, so that rollout and recovery are controlled.
27. As an operator, I want the full regression suite and adversarial request tests to pass, so that schema changes preserve existing journeys.

## Implementation Decisions

- Preserve the pnpm workspace and pure shared-domain package decisions. The web app remains the backend; no database-engine or authentication replacement.
- Introduce currency-aware integer minor-unit conversion and deterministic allocation in the shared domain module. Reject unsupported precision and unsafe numeric ranges. Record supported currency precision explicitly.
- Add canonical minor-unit fields for amounts and participant allocations while retaining existing major-unit fields and response compatibility during rollout. All new writes must derive compatible fields from one validated result; clients cannot independently set conflicting representations.
- Use staged expansion and migration rather than a destructive field-type replacement. Read compatible legacy records deterministically; flag incompatible financial data and require explicit resolution rather than rounding it silently.
- Enforce conservation of money on every manual and generated Expense. Validate percentage totals, positive total shares, unique participants, and exact allocations. Revalidate merged state for partial edits.
- Maintain per-currency balances and use exact units for arithmetic. Legacy mixed-currency groups must not combine currencies into one debt calculation. Lock the Group currency after its first Expense, Settlement or recurring template, including soft-deleted Expenses; coordinate the first financial write and currency update so a race cannot evade the lock.
- Add stable Tag references alongside the existing display fallback. Accept legacy name requests only when they resolve unambiguously in the Group; new UI selections and filtering use identity. Renames change display without breaking identity.
- Migration resolves unambiguous Tag names only. Unresolved or ambiguous historical names require a reviewed mapping; no guessed relationship or automatic merging. Archived Tags may remain attached to historical Expenses, but cannot be newly selected.
- Preserve standalone MongoDB support in development and CI. Financial records persist a durable activity event with their write; Activity publication is idempotent and recoverable after interruption. Do not require cross-document transactions silently.
- Scope create-request idempotency to the actor, Group and operation. Repeating the same key and normalized payload returns the original result; conflicting payload reuse is rejected. The web form retains its key for retries of the same submission and starts a new key for a new action.
- Use explicit record revisions and atomic conditional updates for concurrent Expense and recurring-template changes. Return a useful conflict response and preserve user input so the UI can reload current data before retrying.
- Keep current authorization checks before mutation and replay. No idempotency record may expose another member's or Group's data.
- Add targeted projections and indexes for current list and balance queries. Retain the complete audit trail; do not silently truncate embedded edit history. Separating that history or introducing materialized balance caches is a later decision backed by measurements.
- Provide an explicit, idempotent migration audit/apply command and controlled index creation. Default to dry run, preserve legacy values, and test reruns and interrupted progress. Production migration and deployment are separate rollout actions.

## Testing Decisions

- The primary seam is authenticated HTTP requests against a real, uniquely named local test database and isolated app. Assert responses and subsequent authorized reads of Expenses, balances, templates, Tags and Activity. Reuse the existing expense-access harness.
- Tests should establish externally observable behavior and invariants, not private helper call counts or implementation structure.
- Extend existing pure domain tests for minor-unit conversion, exact total preservation, deterministic remainders, invalid precision, duplicate participants and currency separation. Include repeated/randomized valid allocations with reproducible inputs.
- Use existing database integration seams for migration audit/apply/rerun, indexes, legacy fixtures and controlled interruption/recovery where HTTP cannot express the required setup.
- Exercise simultaneous creates with a shared retry key, conflicting payload reuse, lost responses, stale edits, removed membership and activity-publication recovery.
- Add browser journeys for validation errors, corrected submissions, Tag rename/filter behavior, recurring Tag continuity, retry/conflict feedback and currency-appropriate input, at desktop/mobile widths in both themes.
- Run workspace lint, TypeScript, formatting, design policy, unit/integration tests, authenticated request tests, production build, all core/demo/Google/production-exclusion suites, and Linux visual/accessibility suites. Investigate regressions and report unrelated known QA defects explicitly.
- Keep production data untouched during development and rehearse migrations on synthetic isolated data. Back up and restore local persistent demo databases around existing suites that reset them.

## Out of Scope

- Replacing MongoDB, introducing a separate backend or changing authentication.
- Foreign-exchange conversion, payment processing or bank-grade double-entry accounting.
- Removing legacy storage fields before a separately verified production cutover.
- Guessing corrections to existing invalid amounts or ambiguous historical Tag names.
- Event sourcing, materialized balance caches, separate audit-history storage or a new background-job platform.
- The previously reported Settings and color-contrast defects, except where changes here directly affect the same behavior.
- A broader membership/invitation concurrency redesign; existing authorization remains mandatory for all ledger commands.
- Production deployment, production migration execution, or claiming real Google-provider verification from simulated tests.

## Further Notes

The preceding QA run passed 482 automated tests but did not cover the newly reproduced conservation and rounding failures. Those cases must become regressions before this work is declared complete. Existing domain vocabulary remains: Theme shapes a Group; Category classifies an Expense; Tag is a Group-scoped label; Month is a read-only view rather than a ledger boundary.
