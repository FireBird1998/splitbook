# Android Google beta implementation checkpoint

Status: staged implementation with a signed ARM64 QA candidate and verified Android App Links. Real native Google/account and ledger acceptance remain pending. Read the final checkpoints below; earlier sections record intermediate states.

Branch: `codex/android-google-beta`. Baseline: `c082b91` from canonical `origin/main`. Worktree: `/Users/ankitdas/.codex/worktrees/pr81-merge/SplidBook`. The primary checkout and its existing local work were preserved.

## Implemented

- Expo 57 / React Native 0.86 native Credential Manager dependency compatibility: `react-native-nitro-google-signin` 2.3.0 and Nitro Modules 0.37.1.
- Explicit HTTPS staging configuration with demo disabled, separate package identity, and Google web audience validation.
- Native branded Google button; explicit account chooser; fresh cryptographic nonce; ID-token exchange through the existing Better Auth endpoint.
- Existing controller retains exclusive ownership of app sessions, signed cookies, expiry, request invalidation and account storage cleanup. Google SDK identity clears after each attempt and joins logout/account-change cleanup.
- Session restoration works with demo disabled. Cancellation, provider failure, allowlist denial, late chooser results, late response cookies and raw-token-only responses are handled.
- Public staging handshake at `/.well-known/splitbook-mobile.json`. No session cookie is sent or adopted for this read. Login/restoration/logout reject a missing or mismatched staging marker/audience before transmitting credentials. Operators must still verify isolated database configuration.
- Existing web provider, accepted audience and trusted origins are unchanged. Direct native ID-token exchange uses the configured backend HTTPS Origin and does not introduce a second Expo auth session store.

## Verification completed

- Android ARM64 debug native build: `:app:assembleDebug -PreactNativeArchitectures=arm64-v8a` passed (380 tasks). Native modules autolinked and compiled. This is a compatibility debug artifact, not the signed staging release.
- Workspace unit run: shared 259, web 146, mobile 211 passed (616 total).
- Final mobile rerun after logout guard and branded-button changes: 212 passed; mobile TypeScript and lint passed. Shared/web unit counts plus latest mobile count total 617.
- Workspace TypeScript and lint passed before final UI/logout refinements; final mobile checks passed afterward.
- Better Auth handler tests use synthetic Google tokens explicitly and exercise approved/denied login, secure cookie restoration, session revocation and no-account provisioning on denial. These do not prove live Google behavior.
- Production-mode Android JS export passed with deliberately non-live placeholder HTTPS configuration. Export: `/tmp/splitbook-google-beta-export`. No Google secret or database credential is bundled.
- Diff whitespace validation passed.

## Blocked or not yet verified

- Android Studio screen capture failed, preventing native UI/visual interaction. Emulator started, but no native screen, chooser, accessibility, light/dark or large-text result is claimed.
- No physical Android phone was connected at the device check. The request to connect one remains pending.
- Separate staging Vercel deployment, least-privilege staging database user, Google Android package/certificate registration, release signing key, verified App Links and signed distributable remain to be provisioned/verified.
- Real approved and denied Google accounts, native process restart/expiry/offline/invitation/account-switch behavior, and full staging Group/Expense/balance/Settlement smoke remain release gates.
- No production environment, domain, database or deployed version was changed by this implementation.

## Next work

1. Restore computer-use access and run the native SDK/button smoke before committing the dependency choice.
2. Provision the isolated staging backend on this reviewed baseline. Set `AUTH_MODE=google`, `MOBILE_APP_ENV=staging`, the allowlist and dedicated database/session secrets; never enable test-token or demo overrides.
3. Register the actual staging package and signing SHA-1 in the Google project; use the staging server's web client as token audience. Configure public Android App Links with the actual signing SHA-256.
4. Build, sign and test the internal APK with real approved/denied accounts and the integrated ledger journey. Record the release-source revision and evidence before distribution.
5. Reconcile issues #35/#36 with the direct native token transport and existing controller. They describe older production-package/iOS/browser-plugin assumptions. Do not close them, or #60, using this checkpoint alone.

Domain connection is a separate handoff: `/Users/ankitdas/AnkitPersonalProjech/SplidBook/docs/plans/2026-09-30-hostinger-vercel-domain-handoff.md`.

## Staging provisioning checkpoint

- Created Vercel project `splitbook-staging` (`prj_UYPtL2qI4Fei7yl0cUTjdHQupFRa`) under `ankit-das-projects`; framework Next.js, Root Directory `apps/web`, Node 24.x, source files outside root enabled. No deployment exists yet; default deployment protection remains enabled.
- Vercel assigned and verified `splitbook-staging.vercel.app`; configured `NEXT_PUBLIC_APP_URL` accordingly.
- Created Production-target settings **on this separate staging project only**: `AUTH_MODE=google`, `MOBILE_APP_ENV=staging`, the owner's approved email in `AUTH_ALLOWED_EMAILS`, and a freshly generated independent `AUTH_SECRET`. The secret was sent through stdin and not printed or saved to source files. Verified key metadata afterward.
- `MONGODB_URI` and Google provider credentials are not yet configured on staging. No Atlas database/user has been created, and no live data was copied or modified.
- Web/backend build completed; because the isolated local build had no deployment credentials, Better Auth reported missing-base-URL/default-secret diagnostics. This is compilation evidence, not a configured backend health check.
- Atlas connector reports MCP access disabled in both account organizations. The browser path is also blocked by an open Chrome extension UI. User was asked to dismiss the extension panel; after their later continue message, Chrome still reported the same blocker. Do not retry the blocked browser operation until the user clears it.
- Next: inspect the intended Atlas project/cluster, arrange authorized access, create a dedicated user restricted to `splitbook_staging`, provision the empty database/schema/indexes, install staging-only credentials, deploy and verify isolation before real Google/native testing. Preserve production project and settings.

## Atlas staging provisioned (2026-09-30)

- User approved creation of restricted staging database access and storage in the staging Vercel project.
- Existing Atlas project `Splitbook` (`6a8b8648ce3f87ee21bcec1b`), existing free cluster `splitbook`; no cluster upgrade or new paid resource.
- Created `splitbook_staging_app`, SCRAM authentication, exactly `readWrite @ splitbook_staging`, scoped to the existing `splitbook` cluster. Atlas database-user table verifies this role. Production users were not modified.
- Created `splitbook_staging` with an empty `users` collection. Data Explorer confirms zero documents. Only the default `_id` index exists at this point; required auth/domain index initialization is still pending. No production records were copied.
- Generated password via Atlas, transferred by browser clipboard directly into Vercel Secret field, verified URI prefix/database suffix/password presence and URI-safe character shape without outputting the secret, then cleared the clipboard. Browser redacts password extraction; no local secret file was written.
- Saved `MONGODB_URI` as a sensitive/non-revealable Secret, Production target within **staging project only** (`prj_UYPtL2qI4Fei7yl0cUTjdHQupFRa`). Vercel success notification and metadata verify the key/type/scope.
- Changed the unused staging `AUTH_SECRET` to a fresh non-revealable Secret through the Vercel API. No deployment or sessions existed.
- Configured permission isolation is verified; real runtime connection and negative cross-database access checks have **not** run.
- Prepared (not submitted) Google `Splitbook Staging Web` client in project `splitbook-5471`: origin `https://splitbook-staging.vercel.app`, callback `https://splitbook-staging.vercel.app/api/auth/callback/google`. Awaiting required at-action confirmation for this separate new OAuth credential. Production OAuth client is unchanged.
- Deployment, Google staging env values, auth/domain indexes, staging endpoint access policy, Android OAuth package/signature registration, signed release APK and real-device QA remain pending.

### Staging email index initialized

Created the canonical unique ascending `{ email: 1 }` index `users_email_uidx` on the empty `splitbook_staging.users` collection, matching `src/lib/auth/migrate-auth.ts`. Atlas shows `UNIQUE` and `READY`. This supersedes the earlier checkpoint that only `_id` existed. Domain/session/account indexes and runtime connection verification remain to be checked with the deployment.

## Staging Google credentials installed (2026-09-30)

The user created the prepared `Splitbook Staging Web` client in Google project `splitbook-5471`. Public client ID: `454607327176-0fhsf0u4l3r1e41qf7l2svc6av8eqofr.apps.googleusercontent.com`. Saved `AUTH_GOOGLE_SECRET` as a sensitive/non-revealable Secret and `AUTH_GOOGLE_ID` as config in the staging Vercel project, target Production in that separate project. Verified key metadata through the CLI; no production credentials were read or altered. Cleared temporary credential variables and clipboard after transfer.

Initiated deployment from the isolated dirty implementation worktree on base `c082b91`, branch `codex/android-google-beta`, including the public staging handshake route. Deployment URL: `https://splitbook-staging-hs37u5tbe-ankit-das-projects.vercel.app`; inspect URL: `https://vercel.com/ankit-das-projects/splitbook-staging/Et61cbo2sKKX96VFX6DXbEdsgurC`. This is a staging deployment, not a main merge or live-production release. Runtime outcomes will follow after build completion.

### Staging deployment and unauthenticated smoke verification

- Deployment `dpl_Et61cbo2sKKX96VFX6DXbEdsgurC` is READY; alias `https://splitbook-staging.vercel.app`. Remote Next.js compilation and TypeScript checks passed.
- Handshake returns 200 with `environment: staging` and the exact new public Google web client ID. Also verified 200 without Vercel bypass or owner cookies; no change to deployment protection was needed.
- Authenticated Vercel request tool checks: get-session returns 200/null; ledger `/api/groups` returns 401; synthetic invalid Google token returns 401/INVALID_TOKEN; demo-persona sign-in route returns 404.
- Staging login page loads and displays Google sign-in. No real Google sign-in completed yet; its terms acceptance is waiting for user confirmation in the open browser.
- First CLI requests failed due to argument forwarding (`--scope` was forwarded to curl); corrected by relying on explicit Vercel project/team environment IDs. These were tooling failures, not app responses.
- Error-level log query for this deployment returned no logs; this is a point-in-time check, not full operational assurance.

- Repeated all four auth/access checks with plain unauthenticated HTTPS (no Vercel owner cookies or protection bypass): same 200/null, 401, 401/INVALID_TOKEN, 404 results.
- Atlas database tree now contains `splitbook_staging.rateLimits` alongside `users`, after the deployed Better Auth requests; the database originally contained only empty `users`. This provides runtime database-write evidence for the staging connection. The users collection still has zero documents before real login. Cross-database denial has not been tested; assigned Atlas role remains restricted to staging.

## Real staging web Google sign-in verified (2026-09-30)

The user completed real Google sign-in. Browser verification confirms `https://splitbook-staging.vercel.app/dashboard` renders the authenticated Ankit Das account, empty staging groups, settled balance and no pending activity. Reloaded the page and confirmed the authenticated dashboard finished loading successfully again. This clears the pending real staging **web** Google sign-in check and basic page-reload session persistence; no further sign-in approval is needed for this completed action. Screenshot: `/tmp/splitbook-staging-google-verified.png`.

Android package/signing-certificate registration, signed beta APK, native Google sign-in and device/session/recovery/financial-journey QA, final review and merge remain pending. This web session check does not establish native Android login success.

## Native continuation and signed APK (30 September 2026)

- Reconciled earlier incomplete status against this checkpoint: the separate staging database/backend and real staging web Google login were already completed. Android registration is distinct; Google Cloud showed only the Production Web and Staging Web clients.
- Independent Standards review found no violations. Spec review reproduced a saved-cookie leak into an invitation preview after a rejected staging handshake. Added a failing public-controller regression, then guarded every ordinary request with staging verification. Re-review found no remaining finding.
- Current automated results: shared 259, mobile 213, web 284 tests passed (756 unique). Web tests ran serially using the available local disposable-test database server on port 27018. An initial run using default port 27017 failed because no server was listening there; all 40 web files passed after correcting the test URI. Workspace typecheck/lint passed; final mobile checks rerun after UI/build-script changes.
- Native compatibility smoke passed on API 36.1 ARM64 emulator: login UI, native Google button, opening Google account setup, cancellation with a retryable message, light/dark rendering and 1.5x font scale. No Google account was installed on the emulator; no identity token or real native session success is claimed. Original emulator font scale and light theme were restored.
- Corrected the signed-out badge and ledger footer to identify staging instead of calling it fictional local development.
- Added `pnpm mobile build:staging` with explicit public environment and external signing inputs. Missing configuration fails before generating/building. It disables dotenv auto-loading, checks the deployed staging handshake and ensures the resulting package is `com.splitbook.app.staging`.
- Created a dedicated staging PKCS12 signing key under the owner's private `~/.config/splitbook/android-staging/` directory, with owner-only key/password files. Neither the key nor password is in Git. Preserve a secure backup of both for future upgrades; ignored worktree build output is not their storage location.
- ARM64 release build passed (632 tasks). `apksigner verify --print-certs` passed with the intended dedicated certificate. Installed and launched the standalone release APK on the emulator; it renders the STAGING login without Metro or a development-persona entry.
- Public signing SHA-1: `DB:ED:35:13:B3:F8:66:B8:BC:06:56:3D:48:93:38:60:D7:64:BE:58`.
- Public signing SHA-256: `DD:96:E7:AB:03:04:76:8F:EC:77:D9:05:3C:7E:9E:F0:F2:57:02:EA:15:8B:83:38:AC:7A:E3:6A:B4:CC:A0:E9`.
- Prepared the exact Android OAuth form for this package/certificate, awaiting the browser tool's required at-action user confirmation before Create. A physical-device connection request is also pending.
- Real native approved/denied account tests, authenticated process/session recovery and the full signed-staging ledger journey remain release gates. This APK is a QA candidate, not an accepted beta release.

### Registration and App Links completed

- After user confirmation, created `Splitbook Staging Android` in Google project `splitbook-5471` for `com.splitbook.app.staging` and the verified release SHA-1 above. Public Android client ID: `454607327176-k6jo9gnq6v05c4n7vi9mpjt6ncva2c92.apps.googleusercontent.com`. The token audience stays the staging **web** client ID; no expanded server audience is needed.
- Set `ANDROID_APP_LINKS_ENV=staging` and the release SHA-256 on the separate `splitbook-staging` Vercel project only. Redeployed its existing source as `dpl_6dwyBaB7gPfmQ7HrkSsHzsJsRHj1`; READY at `https://splitbook-staging.vercel.app`. Public HTTPS `/.well-known/assetlinks.json` returns the exact package/certificate association.
- Android `pm get-app-links com.splitbook.app.staging` reports `splitbook-staging.vercel.app: verified`, with the matching signing certificate. Production was not changed.
- Preserved QA candidate APK: `/Users/ankitdas/Documents/Codex/2026-09-27/splitbook-android-design/outputs/splitbook-staging-0.1.0.apk`. SHA-256: `368fefd01b308abdbb2f8f605c14092532631293ec7040b69ad77f6d1c3cca37`.
- Evidence: `/tmp/splitbook-staging-release.png`, `/tmp/splitbook-google-dark.png`, `/tmp/splitbook-google-large-text.png`, `/tmp/splitbook-android-oauth-created.png`; build log `/tmp/splitbook-staging-release-build.log` and web regression log `/tmp/splitbook-google-web-tests.log`.
- Auth changes received independent Standards/Spec reviews, including the corrected invitation regression. Follow-up review agents hit their usage limit before reviewing the final build scripts and labels; those additions were reviewed by the implementing agent and exercised by the successful signed build, package/certificate checks and emulator launch. No independent final-script review is claimed.
- Final mobile typecheck/lint and supported-file formatting passed. The release APK's app code matches this branch; only release-script lint formatting and documentation changed after assembly. Staging server code remains the previous implementation deployment plus App Link environment configuration; the client-side request guard is included in the APK.
- No physical device is connected. The next acceptance step is real approved/denied Google sign-in on this candidate, followed by authenticated restart, invitation continuation and the Group/Expense/balance/Settlement journey. Keep #35/#36/#60 open until their applicable criteria and changed native architecture are reconciled with actual evidence.

## PR #97 build-cache QA follow-up

Independent QA found that changing a public Google audience could leave Gradle's JavaScript bundle task `UP-TO-DATE`. Reproduced on baseline `c21e57d` by setting a non-live probe audience, running the real `:app:createBundleReleaseJsAndAssets` task and inspecting the generated Hermes bundle. The task skipped and the new audience was absent (`/tmp/splitbook-pr97-cache-red.log`). No server configuration or distributed APK was changed for the probe.

The staging build command now requests `:app:createBundleReleaseJsAndAssets --rerun` before `:app:assembleRelease`. Gradle's installed task help confirms task-scoped `--rerun`; the React Native bundle task passes `--reset-cache` to Metro. This rebuilds inlined public configuration on every staging invocation while retaining incremental native compilation.

Verification:

- The same real Gradle task with `--rerun` ran and produced a Hermes bundle containing the probe audience and excluding the old audience (`/tmp/splitbook-pr97-cache-green.log`).
- The full updated staging script was then run with the real staging configuration. Verification examines `assets/index.android.bundle` inside the signed APK, requiring the actual staging audience and absence of the probe. Build log: `/tmp/splitbook-pr97-real-rebuild.log`.
- Mobile lint, changed-script formatting and syntax checks pass. Independent Standards and Spec follow-up reviews each report zero findings.
- The original APK already uploaded to Google Drive was separately inspected and contains the correct real staging audience, with no probe. The change fixes future rebuilds; it does not require replacing that uploaded candidate.
- Real Android approved/denied login and authenticated device journeys remain pending. No merge is performed by this follow-up.
