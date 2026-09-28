# Group read contract verification

## Scope and revisions

Implements Group tickets #74–76 under approved spec #72. The shared `group-read` module validates complete HTTP envelopes and Group data; web keeps string IDs/timestamps, and the native adapter projects to its existing ID/Date presentation model. Server serialization, persistence models and write policies are unchanged.

Base: `2d6db3e2ee84c19d6fe4de8a8ceb744a6826c818`.

Implementation: `d31582bc2e10a40249f4470122d0b5a633084cab`; browser coverage: `7610800`; reviewed settings cache fix: `ee3aeb5cc2a81be0b6eb5548c0fbbd38ff00b163`; final denial-body fix: `6a15f13`; final tested source/test revision: `0d1df881e2d6647a55db4c54495a23b29164057b`. The later QA-only commit does not change application code.

Ledger #77–79 were not started. GitHub #70 remained **OPEN**, with no completion comments, when rechecked on 2026-09-28. Its existing report in main does not override the explicit open-issue gate. No ledger consolidation decision was made; the two existing creation operations remain unchanged. Parent specs #72/#73 were left open and unmodified.

## Isolation

Work took place in the managed `group-read-contract` checkout on `codex/group-read-contract`. The original checkout's uncommitted plans, specifications, CONTEXT and environment files were preserved. Mongo tests used the disposable container `splitbook-group-read-test-74` at loopback port 27017; the existing Mongo container at 27018 was untouched. Authenticated app runs used separate source snapshots, random loopback ports and newly minted `splitbook-test-access-*` databases, dropped on teardown. Core UI tests used an independent UUID database and never reset the user's demo database. No production credentials, OAuth configuration or deployment were changed.

The installed pnpm launcher could not locate its requested auto-managed 10.23.0 binary. Commands used the installed pnpm 10.3.0 with `npm_config_manage_package_manager_versions=false`; `pnpm install --frozen-lockfile` succeeded without lockfile changes.

## Automated checks

Commands below ran from the managed repository unless noted.

| Check                               | Command                                                                                                                                                                                   | Result                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Workspace lint                      | `env npm_config_manage_package_manager_versions=false pnpm -r lint`                                                                                                                       | Passed, all three packages                                                                              |
| Workspace types                     | `env npm_config_manage_package_manager_versions=false pnpm -r typecheck`                                                                                                                  | Passed, all three packages                                                                              |
| Formatting                          | `env npm_config_manage_package_manager_versions=false pnpm exec prettier --check .`                                                                                                       | Passed                                                                                                  |
| Complete workspace tests            | `env npm_config_manage_package_manager_versions=false pnpm -r test`                                                                                                                       | 589 passed on `0d1df88`: shared 243, web 260, mobile 86; includes real-Mongo integration tests          |
| Authenticated production regression | `env CI=1 npm_config_manage_package_manager_versions=false pnpm --dir apps/web exec playwright test --config playwright.expense-access.config.ts`                                         | 138 passed in 2.9 minutes, before the final settings/denial follow-ups                                  |
| Production settings roundtrip       | `env CI=1 npm_config_manage_package_manager_versions=false pnpm --dir apps/web exec playwright test --config playwright.expense-access.config.ts --grep 'saving Group settings'`          | 1 passed in 34.6 seconds including a fresh production build on `0d1df88`                                |
| Final denial regression             | `env npm_config_manage_package_manager_versions=false pnpm --dir apps/web exec vitest run src/lib/group-read.test.ts src/lib/utils/fetcher.test.ts`                                       | 16 passed on `6a15f13`; includes null-body 403 handling                                                 |
| Final changed-file lint/types       | `pnpm --dir apps/web exec eslint src/lib/utils/fetcher.ts src/lib/group-read.test.ts` and `pnpm --dir apps/web exec tsc --noEmit`, with the same pnpm environment override                | Passed                                                                                                  |
| Core browser regression             | In a temporary snapshot: `node node_modules/next/dist/bin/next build --webpack`, then `CI=1 node node_modules/@playwright/test/cli.js test --config playwright.config.ts --reporter=list` | Production build passed; 48/48 passed in 1.4 minutes on `ee3aeb5`, across desktop/mobile and light/dark |

Core snapshot configuration changed only its temporary port, database, direct Node CLI command and server-reuse setting. Its app source matched `ee3aeb5`. Evidence was retained under the temporary snapshot `splitbook-core-group-97kx10rs`; its UUID database was dropped successfully.

## Behavior demonstrated

- Real authenticated list/detail JSON goes through both actual adapters. IDs, names, Theme, currency, populated members and dates agree; the native presentation model converts timestamps to `Date` only after validation.
- Full settings data, producer extras, stable historical Tag identities and retired flags survive. Historical alternate currency codes are readable without applying current write restrictions. Optional legacy fields receive only their documented defaults.
- Invalid required currency, identity, member, timestamp or envelope fails the complete response. A valid row beside an invalid row cannot become a partial account. Initial errors have safe Retry UI and never masquerade as an empty account.
- Malformed refreshes retain previously verified same-account data with freshness copy. HTTP 401/403/404 replaces cached success; a later outage cannot restore revoked data. A null denial body preserves the denial status.
- Browser journeys cover Groups, dashboard, detail and settings at 1280px and 390px, accessible alerts, keyboard Retry, requested-ID mismatch, foreign-account responses, logout and late responses. Error/Retry controls have no axe WCAG A/AA violations in these checks.
- Creation remains 201-compatible, and invitations add members through the existing authenticated routes. Group detail denies nonmembers before recurring generation; repeated authorized reads produce a single due recurring Expense.
- Existing financial regression coverage remains green, including one financial effect after lost responses/concurrent retries, conflicts, historical Tags, participant departure and access isolation. These are nonregression checks, not implementation of the gated ledger follow-up.

## Review and investigations

Independent Standards review: **0 actionable findings**. Independent Spec review found a settings invalidation predicate still using old string keys; it was fixed to include account-scoped Group keys, and re-review reported **0 unresolved findings**. Integration review also fixed a misplaced detail refresh warning and preserved HTTP denial status for a null error body, with red/green regression coverage.

Initial development snapshots intermittently hit Next's `headers()` outside request scope or cold route compilation delays. Final browser assertions wait for the actual response rather than assuming a cold route completes within a render assertion timeout. The production build initially failed in the existing Next Google font loader (`loader.js:122`, null regex match); a fresh unmodified production build succeeded. No font mocks, altered assertions or production fault endpoints were used.

A historical-read fixture initially tried to generate an invitation after injecting three alternate currencies; the existing write validator correctly rejected that fixture setup. Invitation/write compatibility is now tested before introducing historical read-only data. No write policy was relaxed.

The expanded production run on `ee3aeb5` passed the other 138 cases but the newly added settings journey initially timed out at a test locator: the actual accessible name is `Category 🏠 Household`, not exactly `Category`. The locator was corrected to the observed label, without weakening the saved-value assertions. Its full roundtrip then passed separately on the final revision. Thus 139 distinct authenticated browser/API cases passed across the recorded runs; there is no claim of a single all-green 139-case run. The broad 48-case core run predates only the null-body denial fix; that fix has focused transport coverage and the final fresh production build.

## Native verification

The existing native HTTP suites (`verify:api`, `verify:groups`, `verify:settings`, `verify:financial`) passed together against an isolated actual backend and disposable Mongo, in both development and a fresh production snapshot. `verify:groups` reported seven creation/invitation/recovery checks. Financial smoke used its required `TZ=Asia/Kolkata`. These exercise the real controller/transport, including session restore, denied access, server sign-out, invitation/create lost-response recovery, settings and financial reads. They are distinguished from the Android UI evidence below.

Android bundle export passed (1,145 modules, 3.2 MB Hermes bundle, six assets). The generated, ignored Android project completed offline `assembleDebug` successfully (459 tasks, 1m48s). A new disposable Android 36.1 arm64 AVD ran as `emulator-5580`; the existing `emulator-5554` and its data were untouched. The initial attempt to share the existing AVD in read-only mode was refused by emulator locking, so the fresh AVD used independent userdata.

On that emulator, the development APK connected through Metro to this task's loopback backend. Sam sign-in, two Group cards, Household detail, malformed Theme refresh, retained verified detail with safe error and Try again, and successful recovery after repair were observed. The error/recovered native screenshots were inspected, including the retained currency and member information. No physical Android device or live production Google OAuth flow was tested.

Native screenshots are retained in `apps/mobile/output/playwright/group-read/`; web verification logs are in `apps/web/output/playwright/group-read/`. These local artifacts are ignored by Git; automated tests and this report are committed.

Native list refresh was also exercised on the emulator: an invalid required Theme produced a visible error while retaining both verified cards; repairing the fixture and pressing Try again restored the list and cleared the error. Android UI Automator exposed the Retry label and bounds. This was a targeted emulator check, not an exhaustive native accessibility audit, iOS check or physical-device test.

Exact native commands used:

```sh
npm_config_manage_package_manager_versions=false pnpm --dir apps/web exec tsx \
  --tsconfig scripts/tsconfig.json \
  /private/tmp/splitbook-group-read-mobile-production-smokes.ts
```

The temporary runner invoked `startIsolatedApp('demo', undefined, true)`, inserted isolated synthetic fixtures, then ran each existing verifier with `TZ=Asia/Kolkata`, `MOBILE_VERIFY_URL` set to its owned random loopback origin, and `node --import <resolved-tsx>`.

```sh
EXPO_PUBLIC_APP_ENV=development \
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4138 \
EXPO_PUBLIC_AUTH_ORIGIN=http://127.0.0.1:4138 \
npm_config_manage_package_manager_versions=false \
pnpm --dir apps/mobile exec expo export \
  --platform android --output-dir dist/group-read-android

EXPO_PUBLIC_APP_ENV=development \
npm_config_manage_package_manager_versions=false \
pnpm --dir apps/mobile exec expo prebuild --platform android --no-install

# In apps/mobile/android:
ANDROID_HOME="$HOME/Library/Android/sdk" EXPO_PUBLIC_APP_ENV=development \
./gradlew assembleDebug --offline --no-daemon
```

The initial export/Metro setup used `EXPO_PUBLIC_API_BASE_URL`, while this client actually reads `EXPO_PUBLIC_API_URL`. The resulting setup screen was investigated and the runtime configuration corrected **before** UI assertions. No app setup screen is counted as an authenticated UI pass. The inspected UI used:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first \
EXPO_PUBLIC_APP_ENV=development \
EXPO_PUBLIC_API_URL=http://127.0.0.1:60053 \
EXPO_PUBLIC_AUTH_ORIGIN=http://127.0.0.1:60053 \
EXPO_PUBLIC_INVITE_ORIGIN=http://127.0.0.1:60053 \
npm_config_manage_package_manager_versions=false \
pnpm --dir apps/mobile exec expo start \
  --dev-client --localhost --port 8183 --clear
```

APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, package `com.splitbook.app.dev`. All native code in that build is unchanged from the final tested revision. The owned emulator, Metro and backend were stopped, the native test database was confirmed removed, and the owned Mongo test container was stopped after all verification. The existing emulator, port 4138 server, Mongo at 27018 and concurrently created unrelated containers were preserved.
