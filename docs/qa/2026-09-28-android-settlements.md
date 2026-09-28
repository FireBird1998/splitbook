# Android actual payment recording (#56)

The implementation follows #56 and parent #49, starting from `5e52308` (merged PR #83). Work stayed in the existing managed checkout on `codex/android-settlements`; unrelated user checkout changes were preserved.

## Automated verification

- 552 unit tests passed: shared 257, web 137, mobile 158.
- 130 database integration tests passed against disposable local test databases.
- Workspace typecheck and lint passed.
- `MOBILE_VERIFY_URL=http://127.0.0.1:4141 pnpm mobile verify:settlements` passed real authenticated HTTP verification: partial/full payments, explicitly acknowledged overpayment, changed balances, committed-response loss, disk-backed restart, identical explicit retry, one Settlement and Activity, third-party denial, revoked membership, and sign-out cleanup. The verifier creates and archives only its fictional Group.
- Controller regression tests cover offline prevention, storage failure before POST, current party authorization, exact precision, acknowledgment reset, interrupted review/navigation, immutable recovery, and late responses after sign-out. The first-attempt validation rejection after warm navigation was reproduced before its fix.

## Review

Independent Standards and Spec reviews completed. All findings were resolved and rechecked: definite validation rejection cleans its matching pending attempt even after navigation; the UI explicitly states payments do not close Household Months; and Expense/Settlement persistence shares one fixed-configuration SQLite implementation while retaining the existing database/table names. No unresolved actionable findings remain.

## Native environment

A dedicated disposable `SplitBook55` AVD on `emulator-5556` used Metro 8083, isolated backend 4141/database `splitbook_mobile_56`, and a loopback response-loss proxy on 4142. Only owned fictional personas and a uniquely named QA56 Group were used. Existing user emulators and development services were untouched.

The compatible existing debug APK was reused; no native dependency changed. These checks do not claim a fresh Gradle build, staging validation, or verified App Links.

## Native results

- Sam opened Payments, reviewed payer/recipient and INR 10 against a refreshed INR 30 suggestion, and recorded a partial payment. Authorized backend read-back showed one Settlement, one Activity, and INR 20 remaining.
- Sam submitted INR 5 with note `Native recovered`. The proxy received the backend's successful response, deliberately destroyed the client response, and interrupted subsequent non-authentication requests. Android displayed the immutable uncertain attempt and explicit retry control. Backend read-back showed the committed payment and INR 15 remaining.
- The app process was force-stopped, connectivity restored, and the app restarted. Opening Payments restored the exact INR 5 amount and note from native SQLite without resending it. **Retry same payment record** confirmed the original record. Authorized read-back retained the same two Settlement IDs, two Activity entries, and INR 15 balance; no duplicate appeared.

- Sam reviewed INR 16 against the remaining INR 15 suggestion. **Record payment** was disabled until the separate actual-amount acknowledgment. After acknowledgment and recording, Android and authorized backend read-back showed three payments/Activity entries and a reverse INR 1 debt from Alex to Sam.

Screenshots are local artifacts under `/Users/ankitdas/Documents/Codex/2026-09-27/splitbook-android-design/outputs/`: `qa56-uncertain.png`, `qa56-recovered.png`, and `qa56-overpayment-review.png`.

## Boundaries

Recording describes an actual payment that already occurred; it does not transfer funds, confirm provider status, close a Household Month, or guarantee the displayed debt remains unchanged until commit. New payments are online-only; reconnect/foreground/restart never submits automatically. Unresolved attempts remain immutable and sign-out purges them through the account cleanup boundary.

Confirmed success reloads payment history, suggestions, and Home. Opening the Group reloads its ledger. Backend Activity is verified through authorized reads; native Activity rendering remains #57.
