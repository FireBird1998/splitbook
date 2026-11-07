# Expense-added Android alert verification

Status: implementation, automated seams and real Android FCM receipt/tap scenarios verified locally with fictional accounts.

## Scope

Manual Expense creation and saving a reviewed Draft capture their validated involved members in the recoverable financial commit intent. The actor is excluded. Publication persists the immutable private context with Activity, then acknowledges the financial intent independently of delivery. Legacy events remain ineligible.

The direct-FCM version-2 payload contains fixed generic text and identity/expiry hints only. A generic FCM notification accompanies the data envelope because Expo SDK 58 skips its foreground handler for data-only messages. Android accepts up to 30 seconds of occurrence clock skew, without changing strict expiry or the exact 24-hour envelope lifetime. Delivery checks current membership, persisted session, binding, preferences, activation cutoff, expiry and the kill switches. Accepted and uncertain outcomes are not resent. Explicit dispatch is bounded; autonomous recovery and scheduling remain outside this slice.

Android validates account, environment, binding, activation and expiry. Receipts retire saved copies and quietly refresh an affected Group already being read. Taps read current authorized Group Activity and never write money. Forms, To review and other protected sheets retain a valid tap for explicit later opening.

## Automated evidence

- The complete web integration run executed 90 files and 931 tests: 89 files and 928 tests passed. The three failures were maintenance CLI child processes using a broken local package-manager launcher. The same CLI file then passed all 14 tests with the repository-pinned package manager; no repository workaround was introduced.
- The final alert HTTP suite passed 21 tests against real MongoDB with authenticated requests and only the Google boundary substituted. It covers manual creation, reviewed Draft conversion, immutable historical participants after a later Expense edit, replay, privacy in Group/Home/financial/backup reads, current membership/session/preferences/cutoff/expiry, overlap, expired pre-I/O and sending leases, zero eligible work, uncertain outcomes, permanent invalid-token revision changes, legacy exclusion and dispatch authorization.
- Two provider-boundary tests passed: stalled credential lookup respects the invocation signal, and delayed Google authorization reduces the final FCM TTL instead of extending expiry.
- The protected-task controller and affected App/native/render-profile checks passed 223 tests. They cover an actual unfinished Expense, To review, forms opened while asynchronous receipt/tap work is pending, authorization denial, explicit retry, warm/cold native response callbacks, restoration rejection and bounded native response identities.
- The final repository gate passed all 19 steps against its own replica-set backend: lint, typecheck, formatting, 7,201 unit tests across 347 files, render ceilings and all Android HTTP verifiers. The affected notification controller/native checks also passed all 25 tests. An earlier run exposed a fixture that sampled occurrence and expiry separately; it now derives both from one instant, preventing a one-millisecond lifetime mismatch.

Named checks written before their fixes include credential deadline, accepted-event page starvation, accepted-device prefix starvation, pre-send budget deferral, form navigation races, protected To review, final TTL after delayed authorization, rejected restoration, bounded native response identities and stale preferences after invalid-token disable. The initial audience-capture seam also failed under controlled removal of the new context capture; that is a regression-removal proof, not a chronological test-first claim.

## Actual Android observations

The dedicated API 35 Google APIs emulator used fictional Sam against the actual local Next.js/MongoDB backend. Actual HTTP Expense saves by fictional Alex produced the events; Google Application Default Credentials authenticated real FCM sends. Provider acceptance was checked separately from device arrival.

- SDK 58 APK compilation succeeded with the development project's public client configuration. Permission remained ungranted until the explicit Enable notifications action opened Android's dialog. The granted permission and native FCM registration were privately confirmed.
- Real manual Expense saves persisted one Expense and one Activity event, released the pending Activity intent and captured only involved recipients, excluding the actor. Native token equality with the persisted binding was checked without exposing either value.
- The first accepted messages did not refresh foreground Activity. Native investigation found SDK 58 intentionally skips foreground handlers for data-only messages. A regression failed before adding the generic notification section and passed afterward. A second observed rejection came from a server timestamp 149 ms ahead of the emulator clock; the bounded skew regression failed before its fix. Exact 30-second, beyond-boundary, strict-expiry and lifetime checks passed in the complete unit run.
- With the corrected payload, a real foreground receipt refreshed the affected Group Activity without a tap. The new event appeared and the notification shade contained no Splitbook alert. Elsewhere in the foreground and in the background, real Android alerts displayed only “Splitbook” and “An Expense was added.”
- A real warm notification tap opened current authorized Group Activity. A self-contained locally signed APK, using native release configuration with a bundled development-mode JavaScript build for fictional accounts, verified true cold navigation: the app process was absent, the real alert remained in the shade, and tapping it started a new process directly in the correct Activity. No development-launcher selection or ordinary Group navigation was used for that cold proof. This is not a production-release acceptance claim.
- Real alert taps preserved typed unfinished Expense descriptions. A separate protected-form tap was observed as held; after leaving the protected task, the explicit Open update action appeared. Selecting it opened current Group Activity. No automatic financial write came from receipt or tap.
- Replaying the same actual HTTP save returned the original Expense, with one Expense, one Activity and one accepted delivery. A subsequent dispatch considered zero work and accepted zero sends. Already accepted events were never resent.
- An actual save by Sam produced no recipients. An Alex save involving only Priya captured only Priya and produced no Sam delivery.
- For access loss, a real alert was delivered first, then Sam's membership was removed only in the fictional local database fixture. The tap did not expose the Group. Refreshed Home excluded it and its To review items; explicit retry showed “This Group isn’t available” and “You no longer have access to this group.” Expense, Activity and accepted-delivery counts remained one. The fixture membership was restored afterward.

## Environment and scope

Initially accepted messages lacked visible receipt; reconnecting the emulator network was followed by a real background alert. Distinct fresh fictional events were used for subsequent scenarios. Provider acceptance alone was never counted as arrival.

Reviewed Draft conversion, detailed authorization exclusions and delivery recovery boundaries are covered by the real-Mongo HTTP suite described above. The device journeys above used manual Expense saves. Autonomous retry scheduling remains outside this slice.

The dedicated device was explicitly signed out, and the backend confirmed zero live sessions for its registration. Its emulator, task-owned app servers, diagnostic receiver and two task-owned MongoDB containers were stopped; the unrelated emulator and containers were left alone.

Temporary diagnostics were removed. Screenshots, APKs, logs, public client configuration and credentials remain outside Git. No IAM, external-service, billing, merge or deployment changes were made. Production remains off.
