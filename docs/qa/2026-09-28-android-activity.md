# Android Group Activity (#57)

The feature follows #57 and parent #49. Review baseline is `f81856b`, the completed payment implementation. New payment fixes `b5c4805` and merged main `c457d0a` were integrated without conflict; no unrelated user checkout changes were modified.

## Automated verification

- Full workspace unit suite passed before the newer payment fixes: shared 257, web 137, mobile 170. After integration, all 174 mobile tests passed, including four additional payment regressions. Combined final coverage: 568 unit tests.
- All 130 database integration tests passed, including the existing Activity outbox recovery fixtures. Total: 698 tests.
- Workspace typecheck and lint passed; mobile typecheck/lint passed again after integration and visual adjustments. Changed-file formatting passed.
- `MOBILE_VERIFY_URL=http://127.0.0.1:4143 pnpm mobile verify:activity` passed mixed-event pagination, original snapshot money, deleted-target status, stale/error recovery, and foreground membership denial through the real controller and authenticated backend.
- The existing `verify:settlements` committed-response-loss/restart/retry fixture passed and now checks the recovered payment appears once in the native Activity controller after refresh.
- Twelve Activity controller tests cover refresh/pagination reconciliation, current membership, expired sessions, stale/offline reads, unavailable records, historical deleted targets, malformed/cross-Group events, and late responses after sign-out.

## Standards

Independent review: zero documented violations and zero actionable heuristic findings. Follow-up review of the optional descriptive Button accessibility label, reachable Refresh control, and documentation also found none.

## Spec

Independent review: zero actionable findings. Historical snapshots, separate current record checks, authoritative refresh, account isolation, and current membership matched #57. Follow-up review of the visual refinements found no regressions.

## Native environment and results

The dedicated disposable `SplitBook55` AVD (`emulator-5556`) used Metro 8084 and isolated backend 4143/database `splitbook_mobile_57`. All data was fictional, with a uniquely named owned QA57 Household. Existing user emulators and services were untouched. A compatible existing debug APK was reused; no native dependency changed. This does not claim a fresh Gradle build or staging verification.

- Opened the Household Activity timeline as Sam. Expense deletion, payment recording, and expense update events showed their backend actors and timestamps. The payment displayed INR 5 and Sam → Alex.
- Opened the deleted Expense event. Android identified the historical snapshot and separately confirmed that the linked Expense is currently deleted. No Expense editor or financial mutation was opened.
- Opened the payment event. Android showed the payer/recipient context, amount/currency, payment reference, and the explanation that SplitBook did not transfer funds.
- The visual walkthrough prompted two small refinements: Refresh moved above the long timeline, and visible event controls became **View details** while preserving distinct full event descriptions for accessibility.

- Verified the final timeline in system dark mode with Android text scale 1.3. Labels, amounts, wrapping, and controls remained readable; event accessibility labels retained their full context.
- Backgrounded the app, removed fictional Sam from the owned QA57 Group through authorized HTTP, then brought the same app task forward. Android showed access denial and removed all timeline events/detail controls.

Screenshots are local artifacts in `/Users/ankitdas/Documents/Codex/2026-09-27/splitbook-android-design/outputs/`: `qa57-timeline-light.png`, `qa57-deleted-detail.png`, `qa57-dark-large-text.png`, and `qa57-access-denied.png`. The light timeline capture predates the concise-button/Refresh-position refinement; the dark capture shows the final controls.

## Boundaries

Activity is read-only and memory-only in this ticket. Refresh can reveal backend-recovered history; missing events never prove that a ledger write failed. Current-record checks do not treat an event snapshot as current editable financial data. Failure retains explicitly stale history; denied access removes it. Persistent offline caching remains separate work.

The real HTTP verifier covers pagination and recovered-payment visibility. Existing backend integration fixtures exercise pending-event publication recovery. Native checks exercise rendering and controls; they do not claim a separate native outbox fault-injection test.
