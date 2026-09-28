# Android Expense detail and recovery (#55)

The implementation follows #55 and parent #49. It started at PR #82 head `6fa3537`; when #82 merged externally, `origin/main` (`9e6d9c7`) was integrated, including the shared Group read contract. PR #82's working checkout, Metro, database, and emulator were not modified.

## Automated verification

On the integrated branch:

- 540 unit tests: shared 257, web 137, mobile 146.
- 130 database integration tests, using the disposable test databases on local Mongo port 27018.
- Workspace typecheck and lint passed.
- `MOBILE_VERIFY_URL=http://127.0.0.1:4140 TZ=Asia/Kolkata pnpm mobile verify:expense-edit` passed real authenticated HTTP checks for metadata-only preservation, archived Tags, two editors, stale delete, committed edit/delete response loss, disk-backed controller restart, explicit review, and one deletion Activity.
- Regression tests cover revoked membership, historical missing identities during delete recovery, definite validation rejection, competing drafts, interrupted navigation, and sign-out during failed recovery cleanup. The four review defects were reproduced before their fixes.

## Review

### Standards

No documented-standard violations. Two nonblocking heuristic findings were resolved: shared record edit eligibility replaces duplicate guards; the unused history option was removed.

### Spec

All four actionable findings were resolved: historical missing-member recovery IDs, actionable definite rejection handling, blocked restoration after access denial, and the ownership/view check after asynchronous rejection-cleanup failure. Follow-up review confirmed the fixes.

## Native environment and boundaries

A fresh disposable `SplitBook55` AVD runs on `emulator-5556`, with separate Metro 8082 and backend 4140. Backend database `splitbook_mobile_55` contains only owned fictional fixtures. The previously built compatible development APK was reused; no native dependency changed, and this work does not claim a fresh Gradle build or staging validation.

Device checks use Android controls through ADB, plus authorized HTTP read-back. Fault-injected committed-response loss is verified through the real controller/HTTP boundary and file-backed restart, not by claiming a device network test.

The backend Activity is verified through authorized reads. Native Activity rendering and refresh are tracked by #57; no native Activity cache exists in this branch. Existing Group expense, balance, and Home views refresh after confirmed mutations.

## Native results

- Opened the fixture Expense through the Group ledger. The detail showed INR 10, two payers (600/400 minor units), three allocations (334/333/333), the historical archived Tag, notes, revision, and edit history.
- Edited the description, terminated/reopened the process, and resumed the SQLite draft. Completed description was also retained across the later Metro reload. Android Save produced revision 1; authorized read-back retained exact allocations and `2026-09-28T12:00:00.000Z`.
- Created a second-editor notes change through authenticated HTTP while the native draft remained open. Android Save returned stale; the current record appeared with the other editor’s notes and revision 2. **Keep my draft for review** retained the local fields; explicit Save produced revision 3 with the unchanged allocation.
- Opened Delete, chose **Keep Expense**, reopened Delete, then chose **Confirm delete Expense**. Authorized read-back showed `isDeleted: true`, revision 4, and the preserved allocation/date/history.
- The native walkthrough caught a generic success notice; it now uses the controller’s specific updated/deleted message.

Screenshots are local artifacts in `/Users/ankitdas/Documents/Codex/2026-09-27/splitbook-android-design/outputs/`: `qa55-conflict.png` and `qa55-delete-confirmation.png`.
