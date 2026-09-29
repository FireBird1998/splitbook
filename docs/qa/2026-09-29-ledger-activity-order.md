# Ledger publication ordering and final verification

Implements #78 and records #79 verification under unchanged parent #73. Characterization and accepted baseline evidence are in [the #77 report](2026-09-29-ledger-characterization.md). PRs are stacked for review; none is merged by this task.

## Change and consolidation decision

Fresh Settlement creation now attempts bounded, recoverable Activity publication before response population, matching fresh Expense creation and both writers' normal replay and collision recovery. The financial record and its pending intent still commit atomically in one document. Activity failures remain recoverable; response preparation can still fail after commit and a same-key retry recovers the original record.

Retain two explicit writers. Expense must look up replay before preparing the normalized command because immutable historical Tag identity affects that preparation; it checks current actor access before replay but other participant eligibility only for a new write. Settlement normalizes and validates both parties and recording authorization before replay. Expense prepares historical/display Tags, while Settlement defaults its payer and obtains party names for its Activity payload. Their record shapes, normalization and population paths also differ.

A shared coordinator would need callbacks/adapters for command preparation, eligibility, lookup/insertion, event construction and response preparation, or leave those sequencing decisions with both callers. That moves code without reducing the knowledge needed to maintain either writer. Existing shared modules already own immutable fingerprints/intent construction, currency locking, index readiness and bounded idempotent publication/acknowledgement. No new coordinator or caller interface is introduced. The only application change is the approved ordering correction.

## Red before green

The #77 baseline test was first changed to require one published Activity even when fresh response preparation fails. On the original implementation it failed only for Settlement (expected1, observed0); the other9 creation fault cases passed. After moving publication ahead of population, all10 creation recovery and6 existing outbox tests passed. These use real standalone Mongo commits and isolated infrastructure failures, including concurrent insert races, outages and failed acknowledgement. No production fault routes or mocked successful financial commits were added.

## Final verification

Final revision, workspace/regression/browser/client results, independent review and exact limitations will be recorded here after completion. No UI or visual baseline changes are part of this slice.
