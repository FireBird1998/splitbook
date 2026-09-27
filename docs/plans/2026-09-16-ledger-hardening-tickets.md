# Proposed ledger-hardening tickets

Status: approved and published. Parent specification: https://github.com/FireBird1998/splitbook/issues/39.

- Ticket 1: [Introduce exact-money compatibility and audit tools](https://github.com/FireBird1998/splitbook/issues/40)
- Ticket 2: [Keep manual and recurring Expenses balanced](https://github.com/FireBird1998/splitbook/issues/41)
- Ticket 3: [Keep Settlements and balances exact by currency](https://github.com/FireBird1998/splitbook/issues/42)
- Ticket 4: [Preserve Tag identity across renames and recurring use](https://github.com/FireBird1998/splitbook/issues/43)
- Ticket 5: [Make Expense creation retry-safe with recoverable Activity](https://github.com/FireBird1998/splitbook/issues/44)
- Ticket 6: [Make Settlement retries and recurring Activity recoverable](https://github.com/FireBird1998/splitbook/issues/45)
- Ticket 7: [Protect Expense and recurring-template edits from stale writes](https://github.com/FireBird1998/splitbook/issues/46)
- Ticket 8: [Reduce unnecessary reads for long-running ledgers](https://github.com/FireBird1998/splitbook/issues/47)
- Ticket 9: [Rehearse migration and verify the complete ledger](https://github.com/FireBird1998/splitbook/issues/48)

Primary test seam: authenticated requests through the real app into an isolated MongoDB database, verified by subsequent authorized reads. Existing pure arithmetic tests and migration integration tests cover behavior below that seam; browser tests cover the user-facing flows.

## 1. Introduce exact-money compatibility and audit tools

**Blocked by:** None.

**What it delivers:** Existing ledgers remain readable while currency-aware exact amounts and a dry-run audit identify data that cannot be migrated safely. This is the expansion step of a wide representation change.

- [ ] Currency precision and safe ranges are explicit, conversion is exact, and incompatible amounts fail visibly.
- [ ] New canonical fields coexist with legacy values without changing existing callers prematurely.
- [ ] Audit reports are repeatable and never silently repair money.
- [ ] Shared tests and synthetic legacy migration fixtures cover valid and invalid data.

## 2. Keep manual and recurring Expenses balanced

**Blocked by:** 1.

**What it delivers:** Creating or editing an Expense or recurring template preserves every minor unit and shows actionable validation errors.

- [ ] Payer and split totals equal the amount; duplicate participants and invalid allocations are rejected.
- [ ] Equal, shares, percentage, unequal and exact methods conserve money.
- [ ] Partial edits validate the resulting record; generation follows the same rules.
- [ ] Forms preview the same allocation as the server and respect currency precision.
- [ ] Request and browser regressions cover the reproduced failures.

## 3. Keep Settlements and balances exact by currency

**Blocked by:** 1.

**What it delivers:** Recording a Settlement changes the intended currency balance exactly, including zero-decimal currencies and legacy-compatible reads.

- [ ] Settlement validation, persistence, rendering and balance arithmetic share exact units.
- [ ] Group and dashboard balances never combine different currencies; Group currency cannot change after financial records exist, including a race with the first write.
- [ ] Successful settlement clears the intended amount with no rounding residue.
- [ ] Read-back and browser tests cover supported precision and invalid amounts.

## 4. Preserve Tag identity across renames and recurring use

**Blocked by:** None.

**What it delivers:** Renaming or archiving a Tag keeps Expenses, filters and recurring templates linked correctly, with safe migration of existing names.

- [ ] New UI selections and filters use stable identity; compatible old name requests resolve safely.
- [ ] Unchanged archived Tags remain editable; new assignments require active, Group-owned Tags.
- [ ] Referenced Tags cannot be deleted, including recurring-template references.
- [ ] Migration reports unresolved names and requires an explicit mapping rather than guessing.
- [ ] Request and browser tests demonstrate rename, archive, filter and recurring behavior.

## 5. Make Expense creation retry-safe with recoverable Activity

**Blocked by:** 2.

**What it delivers:** Retrying one Expense submission creates one record, and a temporary Activity failure cannot lose the successful write's audit event.

- [ ] Same-key same-payload creates return the original result; changed payloads conflict.
- [ ] Authorization is rechecked for retries, including removed members.
- [ ] Forms retain the key for a failed submission and rotate it for a new action.
- [ ] Activity intent is stored atomically with the Expense and published once, with bounded recovery.
- [ ] Simultaneous requests and interrupted publication are tested on standalone MongoDB.

## 6. Make Settlement retries and recurring Activity recoverable

**Blocked by:** 3, 5.

**What it delivers:** Retried Settlements record one payment, and recurring Expenses retain one recoverable Activity event for every generated period.

- [ ] Settlement retries reuse the original record and preserve balances and authorization.
- [ ] Changed payload reuse returns a conflict without another payment.
- [ ] Recurring retries preserve unique template/period generation and recover missing Activity.
- [ ] Form, request and failure-recovery tests cover both paths.

## 7. Protect Expense and recurring-template edits from stale writes

**Blocked by:** 2, 4, 5.

**What it delivers:** Concurrent editing, deletion or restoration returns a recoverable conflict instead of silently overwriting a newer version.

- [ ] Expected revisions are checked and advanced atomically with changes and audit intent.
- [ ] Invalid or stale changes leave money, history and Activity unchanged.
- [ ] Forms retain entered values and offer a way to reload current data.
- [ ] Tag identity and valid unchanged archived references survive metadata edits.
- [ ] Concurrent and removed-member request tests cover edit, delete, restore and template changes.

## 8. Reduce unnecessary reads for long-running ledgers

**Blocked by:** 1.

**What it delivers:** Lists and balances retain their results while avoiding unrelated edit-history payloads and using indexes aligned with current queries.

- [ ] Balance and summary reads load only required contribution fields, including compatible amount representations.
- [ ] List history is omitted where unused while detail history stays available.
- [ ] Index creation is explicit and tested on synthetic data.
- [ ] Existing totals, filters, pagination and audit-detail behavior are preserved.
- [ ] Before/after synthetic query evidence is recorded without claiming a production benchmark.

## 9. Rehearse migration and verify the complete ledger

**Blocked by:** 1, 2, 3, 4, 5, 6, 7, 8.

**What it delivers:** A documented migration rehearsal and complete regression report demonstrate that existing and new ledgers remain correct across clients and failure scenarios.

- [ ] Audit, apply, rerun and interrupted-progress scenarios are verified on isolated fixtures.
- [ ] Legacy fields remain available and incompatible data has a clear resolution path.
- [ ] Required indexes are checked before write guarantees are claimed.
- [ ] All appropriate automated, browser, visual and access-control suites complete; regressions are fixed.
- [ ] Known unrelated defects and deployment limits are stated; local demo data is restored.
