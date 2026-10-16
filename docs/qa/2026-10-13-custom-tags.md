# Custom Tags verification — 13 October 2026

The owner confirmed the [design](../specs/2026-10-13-custom-tags-design.md) for local implementation. The tested application commit is `294de5cf9401e9e4c2120f4b80f64e0be350b702`, based on `697441707a583338d02351a10fbbad0b9653c1b9`. Subsequent changes in this report's commit are documentation only.

## Result

Android admins can create, rename, archive and restore Group Tags from Group options. Web management uses the same authorization, version, last-active and durable action-receipt rules. Lost replies remain explicitly recoverable without duplicate effects or overwriting a later change. Ordinary members retain read access and can check their own earlier actions after losing admin permission.

| Verification                           | Result                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final frozen gate                      | All 17 steps passed in 169.1 seconds: lint, types, formatting, unit tests, existing render/request ceilings, backend setup and ten authenticated HTTP verifiers     |
| Workspace unit tests                   | 4,690 passed: shared 1,503; tooling 122; Android 2,133; web 932                                                                                                     |
| Real MongoDB integration               | 481 tests across 42 files passed using isolated MongoDB 7 replica-set and standalone instances                                                                      |
| Authenticated production browser suite | 243 passed with no retries, including financial, permission, recurring and Tag journeys                                                                             |
| Final browser accessibility            | Two focused Axe journeys passed: light desktop and dark mobile                                                                                                      |
| Builds                                 | Next.js production build and final Android production Hermes export passed                                                                                          |
| Independent reviews                    | Standards and Spec: zero outstanding findings; final application commit reviewed                                                                                    |
| Frozen emulator                        | Create, stale rename, archive/restore, restart recovery, current membership, Expense picker, Back, light/dark and narrow large-text checks passed as detailed below |

The full browser run used commit `91673c8`; subsequent web application changes were limited to the Delete button's semantic text color, verified by both final accessibility journeys. The database run used the earlier integrated backend, whose application implementation was unchanged in the final source. All final Android/controller changes were included in the frozen gate and emulator source. The emulator backend ran the frozen `91673c8` application against its own disposable database.

## Recovery and concurrency evidence

- Authenticated HTTP verifies all five actions: create, rename, archive, restore and existing web deletion. Check is read-only; same-command Retry returns the original receipt after another admin changes the Tag, without reapplying its effect. Request identities are scoped to the original actor.
- The HTTP suite also runs the real Android controller through a lost reply, disposal, restored request storage, Check, exact Retry and current Tag selection for an Expense.
- Public controller/rendered-client regressions cover persistence failure before submission, account and Group isolation, late responses, stale input, dirty-close confirmation, role-only denials, membership loss and no automatic writes on reconnect.
- Concurrent archive/delete requests cannot remove the last active Tag. Historical missing or empty Tag collections remain readable and support explicit repair. Legacy writes missing the required request/version preconditions fail safely.
- A potentially committed request retires old saved copies before submission. Startup distrust based on the durable request prevents stale copies returning after process death or a failed cleanup marker. Expense entries remain intact.

## Frozen emulator observations

Only `emulator-5554` and the existing `com.splitbook.app.dev` installation were used. Metro served frozen final application source. All actions used a fictional Group in a disposable loopback database.

1. Alex created `Villa` from Group options. Back on changed, unsubmitted text asked for confirmation; Keep editing preserved the entry. No Android Delete or picker-management control appeared.
2. Alex entered `General ours` while Sam renamed the same Tag to `Shared costs`. The stale save returned a conflict, retained Alex's text, showed Sam's current value and disabled submission until explicit review. Explicit review/reapply is additionally covered by rendered-client tests.
3. Archive explained saved Expense history, unfinished Drafts and recurring generation before confirmation. Attempted creation of `shared costs` offered explicit restoration of the archived `Shared costs`; restoring kept the original identity.
4. A local proxy held the successful `Cabin` creation reply after server commit. The app was force-stopped and restarted. Sam renamed that Tag to `Mountain cabin` and demoted Alex to an ordinary member. Group options exposed Check Tag action; Retry was disabled. Check confirmed the original `Create Cabin` action and displayed the current `Mountain cabin` state separately. The proxy recorded one creation POST and no automatic resubmission after restart or Check.
5. The Expense picker showed `Villa` and `Mountain cabin` with named selection controls and no creation entry. No Expense was submitted during this native journey.
6. Light and dark views were visually inspected. At 360 dp width and 200% font scaling, recovery text wrapped and the continuation, input, Create and Cancel controls remained reachable by scrolling. Named controls and disabled states were inspected through the native accessibility hierarchy.

The emulator used its existing floating handwriting input panel. Focus and Back were exercised, but a full docked keyboard was not verified. A physical phone, signed staging APK acceptance and spoken TalkBack are separate checks and are not claimed here. The production Hermes export is a bundle check, not a signed APK release test.

## Corrections found during verification

Independent review identified invalidation lost after web navigation, inaccessible Android recovery after demotion, stale saved copies after process death and inconsistent classification of definitive rejections. Each was corrected with public-seam regression coverage. The HTTP verifier was also corrected to inspect a receipt using its original actor and to assert another actor cannot read it.

Combined verification found closed Group options content increasing existing render counts; conditional content rendering fixed it without raising ceilings. Axe found insufficient Delete text contrast in light mode; the existing semantic negative-status color fixed it. Browser fixtures now share the isolated database URI and send the required legacy-write preconditions. An initial tooling fixture used an ambient pnpm version; pinning the local runner to the repository's pnpm version resolved that environment failure. Final runs passed after these corrections.

## Rollout and resource boundary

Tag writes require MongoDB transactions and fail closed on a standalone database. Publish/deploy the backend and web contract before distributing an Android build that exposes the new controls. Existing Tags retain their identities; historical revisions are treated as zero until changed. No historical purge or automatic Tag substitution is part of this change.

All temporary emulator settings were restored: Light app preference, font scale 1.0, original 1080×2400 resolution/density 420, original keyboard preference and empty reverse mappings. The dev app was stopped and the initially stopped emulator was shut down. Owned Metro, proxy and backend processes were stopped; the marked fictional database and both disposable Mongo containers/anonymous volumes were removed. No app install or data clear, staging/production mutation, physical phone action, GitHub publication, merge or deployment occurred.

Machine-local logs, final gate JSON, independent review summaries and thirteen native screenshots are retained under `.claude/orchestrator/drafts/QA/2026-10-13-custom-tags/` in the primary checkout.
