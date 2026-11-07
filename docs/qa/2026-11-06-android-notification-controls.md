# Android notification controls (#839)

## Scope and environment

Verified the device-control slice on a dedicated Android 16 Google APIs ARM64 AVD,
running the actual Expo SDK 58 development binary and the fictional local backend.
The shared emulator and the existing unrelated AVD were not used. The existing
Firebase development Android app remained on Spark; only its public Android SDK
configuration was downloaded. No administrative credentials were transferred, and
no cloud service settings, billing, deployment or production flags were changed.

The first ARM64 debug build succeeded with 409 tasks in seven minutes. Adding the
existing Firebase client resources to ignored generated native output produced an
incremental successful build in six seconds. APKs, configuration, screenshots and
logs remain outside Git.

## Actual native observations

| Journey                           | Observed result                                                                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First launch and Settings         | No notification permission prompt. Android permission remained denied; Settings offered Enable notifications.                                                                                                                                        |
| Explicit Enable, deny             | The actual Android permission dialog appeared only after the tap. Denial kept opt-in off and showed the permission refusal and Android settings link.                                                                                                |
| Explicit Enable, allow            | Android allowed notifications; a real FCM device token registered through the normal authenticated transport. The backend confirmed both categories on at revision 1. No token was displayed.                                                        |
| Independent categories            | Payments off kept Expense updates on. Re-enabling Payments changed only its cutoff. Expense updates off kept Payments on; native switches matched persisted revisions.                                                                               |
| Android settings                  | The app link opened actual app notification settings. Disabling the OS notification switch left confirmed preferences intact, and opening Splitbook Settings showed the Android-blocked message.                                                     |
| Offline update                    | Removing only the dedicated emulator-to-backend connection showed Connect to confirm notification settings and Retry. The attempted Payments change stayed unapplied at revision 4. Restoring the connection and tapping Retry confirmed revision 5. |
| Real backend failure              | Stopping only the owned MongoDB replica set showed pending state with disabled switches and unchanged values, followed by the distinct backend-error message and Retry. After MongoDB recovered, Retry confirmed the intended change at revision 6.  |
| Master off and on                 | Off confirmed revision 7. Explicit re-enable restored both categories and established fresh cutoffs at revision 8.                                                                                                                                   |
| Sign-out and account change       | Alex sign-out returned to the persona screen and revoked the persisted session. Sam started off on the same installation despite Android permission still being granted.                                                                             |
| Separate explicit account consent | Sam's Enable action confirmed a single current account binding at revision 9. No consent was transferred before that action. Sam was signed out at the end; the binding had zero live sessions.                                                      |

Read-only checks compared 13 stages. Expense, Settlement and Activity counts stayed
exactly **84, 5 and 104** throughout. The real device token was absent from Metro,
backend and device logs. Category cutoff comparisons and unconfirmed revision
checks passed without printing the token or ownership proof.

No notification producer or remote alert was introduced. Actual foreground/background
delivery, tray presentation and taps were not exercised in this control slice.
Native dismissal and scheduled-alert cleanup are covered at the controller/Expo
boundary; no previously delivered alert existed during this device journey.
Two-installation independence also passed through the real authenticated HTTP
controller verifier; the actual platform journey used one dedicated AVD.

## Named red-first checks

These exact tests were added before their implementation or reproduced the stated
regression before its fix:

- `starts off, confirms opt-in and keeps two phones independent without financial writes`:
  the initial authenticated HTTP suite failed because its route did not exist.
- `explicit enable waits for backend confirmation, keeps tokens private and switches categories independently`:
  the initial controller run failed because the public notification commands did not exist.
- `keeps anonymous notification registration refusals private and non-cacheable`:
  failed on the missing proxy no-store header.
- `distinguishes an offline update from a backend refusal without displaying unconfirmed preferences`:
  the repeated-offline Retry case failed when the intended preference was lost.
- `confirms category preferences while Android blocks display without registering another token`:
  failed when OS blocking prevented category confirmation.
- `waits for previous native alert cleanup before registering a replacement session`:
  failed when a replacement registration raced the held previous-session cleanup.

Each passed after its corresponding implementation or correction.

## Automated verification

- Repository gate: all **19 steps passed** on Node 22.23.4, including **7,177 unit
  tests across 345 files**, lint, typecheck, formatting, unchanged render/request
  ceilings and all **12 authenticated backend verifiers**.
- Full web integration suite: **89 files, 913 tests passed** against real MongoDB.
- Final notification HTTP acceptance file: **11 tests passed**.
- Controller, rendered Settings and Expo boundary acceptance: **15 tests passed**.
- Render profiler: **16 tests passed**; proxy rules: **12 tests passed**.
- The slow retiring-account native cleanup race was reproduced red and fixed before
  the successful final gate. Replacement-session token work now waits for cleanup.

Production notifications remain off by default. Nothing was pushed, merged or deployed.
