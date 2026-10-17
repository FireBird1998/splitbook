# PR #248 native Back verification — 2026-10-09

PR: https://github.com/FireBird1998/splitbook/pull/248
Tested head: f9c009fbaf58a07846a2e8169e35cd6a3c9b8e1e
Base/current main: e0d9d0c712f749699b58e1ac542ed744ac61598f

## Result

The Android 15 control reproduced the reported defect. The fixed build passed the native Back checks on Android 15 (API 35) and Android 16 (API 36). Full CI and Vercel preview passed. PR remains open.

These were rebuilt development APKs using fictional personas and an isolated production-mode local backend. The control uses the same rebased JavaScript and native sources as the fixed build, with only the generated manifest flag switched to true. It is a controlled native-flag comparison, not the historical signed staging APK requested in the owner's release plan.

## Automated checks

Fresh worktree, frozen offline install; pnpm swarm gate --mongo-port 27018 --base origin/main --vitest-workers 2 passed in 188.6 seconds. Lint, typecheck, formatting and ceilings passed. 4,440 unit tests passed: shared 1,480; swarm 122; mobile 2,024; web 814. All nine mobile HTTP verifiers passed using the gate's own fictional database; it was subsequently dropped.

CI run 37959278602: PR checks, verify, Playwright and all three timezone suites passed. Vercel preview passed. The intentionally disabled Nightly gate was skipped.

## Native checks

Both AVDs used Pixel 6 profiles (1080×2400), one at a time on emulator-5556. The shared emulator-5554 and staging login were untouched. Only com.splitbook.app.dev was installed and operated.

| Check | API 35 | API 36 |
|---|---|---|
| Control flag true: Group Back exits to launcher (bug) | Reproduced | Not needed |
| Fixed flag false: Group Back returns Home | Passed | Passed |
| Expense Back keeps draft and returns Group | Passed | Passed |
| Members Back returns its Group | Passed | Passed |
| Date, Tag and Group-menu Back dismiss only sheet | Passed | Passed |
| Invitation Back cancels to Home without joining | Passed | Passed |
| Back during Save stays on form until confirmation | Passed | Passed |
| Confirmation returns Group with Expense saved | Passed | Passed |
| Home Back exits to launcher | Passed | Passed |

The delay proxy held each Expense POST response for eight seconds. Back did not leave the saving form. Proxy logs show one POST per save; database-results.txt confirms one record per fictional description (INR 120 and INR 90). The invitation Group still had only Sam as its member after both cancellation checks.

Screenshots and UI hierarchy snapshots accompany this report. Native Back was exercised with adb keyevent 4; a physical gesture-nav session was not performed. Each sheet test was validated with an open-sheet snapshot, avoiding animation/keyboard timing assumptions.

APK SHA256:
- control (manifest true): 0568c9d6f21ed9c879fd1f7d5166e58882aaecc9478e6768f4ef1a19c706d7a2
- fixed (manifest false): e39ae1775cfc87020d753a12ddae13739ca3fe6b93aeb2477362317e96a79def

## Rebase

Rebased the PR's own head onto current main. The sole conflict was the app.test.tsx import block: retained main's GroupExpensesView and GroupActivity imports and added backListenerCount to the shared native mock import. No financial/controller path conflicted. Pushed only the PR head with the exact fetched SHA in force-with-lease. All branches retained.

## Remaining gates

Signed staging APK and physical-phone/normal-gesture testing from #193/#109 remain unperformed. API 33/34 were not separately tested. No staging Google OAuth or real-account release approval is implied.

GraphQL closingIssuesReferences is empty because the PR deliberately says Refs #197 and keeps the issue open for the release report. This does not meet the owner's batch merge rule requiring exactly #197; no merge was attempted.

## Isolation and cleanup

Backend: http://127.0.0.1:4248, fictional database splitbook_mobile_swarm_a3c835bce0_91e1ff3c. Metro 8248; delay proxy 4249. During each Save check only our emulator's 4248 reverse was temporarily routed to 4249, then restored. The app's development-overlay preference was recorded before disabling it and restored afterwards. No shared emulator setting changed.
