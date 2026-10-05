# SplitBook native client

Expo + React Native, TypeScript, Android first. The foundation implements [ticket #50](https://github.com/FireBird1998/splitbook/issues/50): guarded local persona sign-in, API-backed Group browsing, Theme-specific headers, member lists, session restoration, foreground revalidation, and sign-out. [Ticket #52](https://github.com/FireBird1998/splitbook/issues/52) adds Group creation, Android sharing, invitation preview, and explicit joining. [The approved spec](https://github.com/FireBird1998/splitbook/issues/49) tracks the remaining native app.

Local development uses Metro and fictional personas. The staging configuration supports native Google identity and the existing Better Auth session boundary. A verified staging deployment, registered Android signing identity, signed distributable APK, and real-device Google checks are still required before beta distribution; the implementation alone does not establish those release gates.

## Run locally

Use Node 22.13+ and the root-pinned pnpm version. Install Android Studio with an SDK/emulator and a compatible JDK. The first Gradle build downloads its required SDK components using your installed SDK license records.

From a clean checkout/worktree (do not copy a real web `.env.local`):

```sh
pnpm install --frozen-lockfile
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm mobile backend:seed
pnpm mobile backend:start
```

The [backend helper](scripts/dev-backend/README.md) requires a local Mongo server (default port 27018). Set `SPLITBOOK_NATIVE_MONGO_PORT=27017` on both seed/start commands if your server uses 27017. By default it claims only an empty or already-owned `splitbook_mobile_50` database, seeds fictional personas/Groups, and listens on `127.0.0.1:4138`. It refuses root/web environment files; leave existing application environments untouched and use a clean worktree.

Each worktree can run its own backend: set `SPLITBOOK_NATIVE_ORIGIN_PORT` and `SPLITBOOK_NATIVE_DATABASE` (a name starting with `splitbook_mobile_`) for seed and start, then point the verifiers at it with `MOBILE_VERIFY_URL`. The recipe is in [one backend per worktree](scripts/dev-backend/README.md#one-backend-per-worktree). The steps below use the default port 4138.

Start an Android emulator from Android Studio's Device Manager, then in another terminal:

```sh
adb reverse tcp:4138 tcp:4138
adb reverse tcp:8081 tcp:8081
pnpm mobile android
```

The development build uses `com.splitbook.app.dev`. Subsequent sessions can use `NODE_OPTIONS=--dns-result-order=ipv4first pnpm mobile start --localhost --port 8081`; open SplitBook Dev and connect to `http://127.0.0.1:8081`. A debug APK is generated at `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Generated `android/` and `ios/` projects are ignored and regenerated from `app.config.ts`.

Reapply both `adb reverse` commands after restarting the emulator. The IPv4 option above keeps Metro on the same loopback address as the forwarded connection on macOS.

Choose Sam or Priya for the Trip and Household fixtures; Alex additionally has a private authorization-test Group. Only identity is fictional: the sign-in and Group data travel through the actual backend and database.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm mobile verify:api
pnpm mobile verify:groups
pnpm mobile verify:settings
TZ=Asia/Kolkata pnpm mobile verify:financial
TZ=Asia/Kolkata pnpm mobile verify:all
```

Every `verify:*` script takes its backend from `MOBILE_VERIFY_URL` (default `http://127.0.0.1:4138`) and refuses anything but a plain loopback HTTP origin. `verify:all` runs each of them against that one backend, continues past a failure, and lists the result of each.

CI runs every verifier on each pull request and push to `main`, in the **Mobile HTTP verifiers** job (`mobile-verifiers` in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). The job starts a backend of its own with `pnpm swarm up --server production` on the job's Mongo service, runs `TZ=Asia/Kolkata pnpm mobile verify:all` against it, and stops it with `pnpm swarm down`. A failed verifier fails the job and is named in an annotation, and the backend's log is uploaded as the `mobile-verifier-backend-log` artifact. The verifiers run one after another because several assume they are the only ones using Sam on their backend; their order doesn't matter. To repeat the job locally, run `pnpm swarm up --server production`, then `TZ=Asia/Kolkata pnpm mobile verify:all` with the `MOBILE_VERIFY_URL` it prints, then `pnpm swarm down` (see [tools/swarm](../../tools/swarm/README.md#in-ci)).

`verify:api` uses the actual mobile controller and HTTP server. It checks session creation/restoration, normalized Group/member dates, authorization denial, server logout, local purge, and disabled development authentication. The fictional database may also hold test Groups from earlier runs, so it checks that Sam's list includes the seed Trip and Household and contains only Groups Sam belongs to, not an exact count. It never accepts a remote server or prints session values.

For a native smoke, verify persona → Group list → Trip and Household details → Android Back → app restart → refreshed session/Groups → sign-out → restart. With Sam signed in, the fixture helper can revoke Household membership or expire Sam's sessions before returning to the app:

```sh
node apps/mobile/scripts/dev-backend/control.mjs revoke-member sam household
node apps/mobile/scripts/dev-backend/control.mjs restore-member sam household
node apps/mobile/scripts/dev-backend/control.mjs expire-sessions sam
```

These act on the default backend's `splitbook_mobile_50`. For a per-worktree backend, give them its `SPLITBOOK_NATIVE_DATABASE`, as in the [backend helper](scripts/dev-backend/README.md#fixtures-and-controls). Always restore fictional membership after testing. Confirm denied/expired access removes protected content, errors can be retried, and light/dark headers preserve the Trip-only ornament. These device checks are distinct from Node HTTP tests and do not verify Google OAuth.

### Shared React Native mock

The rendered tests (`src/**/*.test.tsx`) never load React Native itself. `src/test-utils/setup.ts`, registered as `setupFiles` in `vitest.config.ts`, mocks `react-native`, `react-native-safe-area-context` and `@expo/vector-icons/Ionicons` for every test file from `src/test-utils/native.ts`. Components render as host names (`View`, `Pressable`, `Ionicons`, …), so a test reads the props Android receives. Don't mock these three modules in a test file; add a missing stand-in to `native.ts` instead.

Tests change the stand-ins only through the helpers in `native.ts`:

- `setFileWindow(size)`, called at the top of a file, sets the window every test there starts from. The default is 412×915 at 1× text. `setWindow(size)` changes the width or font scale for one test.
- `emitAppState(state)`, `pressBack()` and `backListenerCount()` drive the AppState and BackHandler listeners the App registers.
- `spring` is the `Animated.spring` spy, and `Animated.Value` records its value.

After every test the stand-ins return to the file's defaults and their recorded calls are cleared, so tests pass in any order. This state is per file because Vitest's default `isolate: true` gives each test file its own modules. With isolation turned off, one file's window and listeners would carry into the next.

## Android invitation links

Shared invitations remain canonical web URLs so they can open in a browser when the app is absent. Set `EXPO_PUBLIC_INVITE_ORIGIN` to the backend's `NEXT_PUBLIC_APP_URL` origin; it defaults to `EXPO_PUBLIC_AUTH_ORIGIN`. The app accepts only that origin's `/join/<eight-hex-character-code>` links. Changing a native intent filter requires rebuilding the binary. Local HTTP links are development-only; they do not establish verified Android App Links.

The future staging build uses `EXPO_PUBLIC_APP_ENV=staging`, an explicit HTTPS invitation origin, and the distinct `SplitBook Staging` / `com.splitbook.app.staging` / `splitbook-staging` identity. On that web host, set `ANDROID_APP_LINKS_ENV=staging` and `ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS` to the actual APK signing certificate's SHA-256 fingerprint, or a comma-separated list during certificate rotation. Each fingerprint must contain 32 colon-separated hexadecimal bytes. The public `/.well-known/assetlinks.json` route publishes only the fixed staging package and validated fingerprints; missing or malformed settings return empty 404 JSON.

No real staging domain or certificate is configured here. Ticket [#60](https://github.com/FireBird1998/splitbook/issues/60) must verify that the actual host serves the JSON over HTTPS without redirects, the installed APK uses the matching signing certificate, and Android reports the domain verified. Recheck warm and cold invitation opening plus absent-app browser fallback on that deployment. The manifest and local HTTP smoke alone do not establish domain ownership. See [Expo Android App Links](https://docs.expo.dev/linking/android-app-links/) and [Android domain verification](https://developer.android.com/training/app-links/verify-applinks).

## App icon and splash (#188)

Every environment uses the brand kit's launcher icon, adaptive foreground, themed (monochrome) icon and splash from `assets/brand/`. Regenerate them with the exporter in `tools/brand`, never by hand; see [the brand README](../../docs/design/brand/README.md#mobile-integration). The splash follows the system light/dark setting, not the in-app appearance choice, because it shows before the app starts. Icon and splash changes take effect only after rebuilding the binary. Expo warns that development builds don't show the splash faithfully, so confirm it on a release build too (`pnpm mobile android --variant release`, or `build:staging`).

## Boundaries

- `src/data` owns authentication, JSON validation, dates, transport, and session-local Group state. UI never calls fetch directly. It reuses the shared Group Theme/currency modules; it does not calculate balances from Group-list data.
- `src/runtime.ts` injects native `expo/fetch` and SecureStore. Only the signed session-token cookie is stored, keyed by backend. Better Auth's raw token and cookie-cache payload are not used. Requests disable the native cookie jar and carry the explicit cookie and configured trusted origin.
- Logout invalidates request generations, purges memory and SQLite drafts, serializes account storage cleanup, and attempts server revocation. In-flight responses cannot refill state. Future caches must join this purge boundary.
- Native demo entry requires both `__DEV__` and explicit `EXPO_PUBLIC_APP_ENV=development`; the server independently enforces its existing demo guard. A production bundle cannot use this adapter. Cleartext Android traffic is configured only for the development variant.
- Display tokens live in `@splitbook/shared/design-tokens`; the old web import re-exports that source. Both clients share the semantic light/dark colors and Group Theme registry. Only the required Outfit/IBM Plex Mono weights are bundled.
- Native Google identity uses Android Credential Manager through `react-native-nitro-google-signin`. The controller exchanges the identity token plus nonce through Better Auth and retains only its signed session cookie. Google SDK identity is cleared after each attempt and participates in account cleanup. Staging release and production configuration retain their separate verification gates.

## Home and Group financial views

[Ticket #51](https://github.com/FireBird1998/splitbook/issues/51) adds server-provided Home obligations with **You owe** and **You are owed** shown separately for each currency. It does not combine currencies or replace obligations with a net number. Loading and failed reads remain distinct from a confirmed empty ledger.

Opening a Group loads its expenses and all-time running balances. Expenses show their recorded date, payers, amount, currency, and Tag, with refresh and explicit pagination. Trip keeps its itinerary strip; Household uses the neutral header and a Month selector. Household defaults to the viewer's current Month and supports previous Months and All time.

A Month is only an expense window. The client sends full ISO bounds for local calendar-month start and end, asks for the backend's summary and member contributions, and keeps running balances separate. Monthly contributions are scoped to the Group's default currency; expense totals and running balances preserve every currency returned by the backend. Changing Month neither resets the ledger nor records a Settlement.

The expense read can materialize due recurring entries on the backend, so the controller reads expenses before refreshing Group balances. The native app validates the returned money with shared exact-money helpers but does not compute its own balances. These reads now support the account-scoped offline cache described below and join the existing session/navigation invalidation and sign-out cleanup boundaries.

`verify:financial` exercises the public mobile controller against the real local HTTP backend with uniquely named fictional Groups, known obligations in INR/EUR, local Month boundaries, an empty Month, and more than one expense page. Run it with `TZ=Asia/Kolkata` for a reproducible non-UTC fixture; the app itself follows the device timezone. The verifier archives its own Groups afterward. Native checks separately cover rendering, controls, refresh, light/dark appearance, and enlarged text.

## Create and join a Group

Choose **Create Group**, select a Theme and currency, and enter a name. Optional dates appear only for Trip. Form input survives navigation, recoverable failures, and same-account reauthentication while the process is running; unsent form input does not survive a restart. A submitted Group does: before **Create** sends anything, SQLite stores its key, body and details for the signed-in account, and nothing is sent if that write fails. After a restart the submission reopens as uncertain with its details and is never sent automatically; resubmitting the same details reuses its key, and changed details replace it with a new one. A confirmed create, **Discard** (after a confirmation), sign-out and an account change remove it; if removing it after a confirmed create fails, the Group still opens, and the stale copy reopens as uncertain after a restart, where resubmitting it returns the same Group. A stored submission this version can't read sends nothing until the form is discarded. A confirmed create opens the new Group the way Home opens one: it reads the Group, then its Expenses, then its Balances, and a new Household opens on the current Month. If you moved on before the confirmation, for example to an invitation, the app stays where you are. After an uncertain create, the app refreshes Groups and asks you to check them before explicitly returning to the form. It never automatically repeats the create.

From a Group, get its invite link and use **Share invite link** to open Android sharing. The app reuses a valid link; if generation loses its response, it reads the current link before considering another user-requested generation. Only exact configured-environment web invitations are accepted. A pending invitation is stored separately from the session, survives cold restart and sign-in, and always requires explicit joining. Success, cancellation, and explicit sign-out clear the pending destination. Opening the canonical link without the app retains the existing web join flow.

`verify:groups` uses the real controller, HTTP routes, and isolated backend for creation (a created Household opens with its Expenses and Balances read, without a separate open), sharing, second-persona joining, authentication interruption, committed-response loss, and a restart while a create is uncertain. It archives only its uniquely named test Groups through authorized requests and signs out its sessions. Android verification separately checks the form/keyboard, share sheet, cold/warm link delivery, and appearance. Local HTTP links are unverified on Android: targeting the installed package exercises routing but does not prove staging App Links verification. The staging domain/certificate/device check belongs to #60.

## Settings and account cleanup

[Ticket #58](https://github.com/FireBird1998/splitbook/issues/58) adds Settings from the toolbar. System, Light, and Dark apply through the shared semantic tokens. The appearance preference is saved on this device and survives sign-out; a failed save restores the last confirmed choice and offers recovery. Settings shows the authenticated member and the configured development connection. Web settings open only at the configured public origin (`EXPO_PUBLIC_INVITE_ORIGIN`, falling back to the auth origin), with no native session values in the link. The browser uses its own sign-in session.

Sign-out clears memory and protected session storage, cancels requests, and prevents their late responses from restoring account content. Persistent financial stores added by later tickets must register with the account-local cleanup boundary. Cleanup failures stay visible and are retried before session restoration; the device stores a cleanup marker so restarting cannot bypass an unfinished purge. Unsent Group form input remains memory-only (a submitted Group is stored and registered with this boundary, as described under Create and join a Group), and this ticket does not add financial caches, Expense drafts, or pending financial submissions.

`verify:settings` exercises account details, sign-out, server session revocation, restart/account switching, and delayed response delivery through the real controller and isolated HTTP backend. Native checks separately verify actual SecureStore appearance persistence, system appearance changes, enlarged text, the browser destination, and sign-out/account switching.

## Expense creation and drafts (#53–54)

Open a Group and choose **Add expense**. Equal splits use shared exact-money allocation; the form collects a payer, participants, date, stable Tag identity, and optional category/notes. A past Household Month starts on that Month’s last day. Currency is the Group currency; an outdated draft requires an explicit currency choice and amount review.

SQLite keeps one draft per backend, account, and Group. Every edit is serialized through the account-storage lease. One atomic row holds the exact serialized request together with its UUID before any POST. An uncertain attempt stays immutable across restart and retries with the same body/key. A rejection of a first send frees the draft for correction; a refused retry does not, because the first send may already be recorded. Any definite 4xx on a retry counts as refused, except 401 (the session), 403 and 404 (lost access), and 408 and 429 (passing). The refusal is stored with the attempt, so the form stays locked, even after reopening or a restart, and asks you to check the Group's Expenses. If the Expense is there, discard the save and don't save the draft again; if it isn't, discard the save, then correct and save the draft. Only **Discard unconfirmed save**, after a confirmation, frees the draft, and a later Save is a new submission. An online Group check precedes Save; editing a draft never queues a write. Confirmation removes the record and reloads Group expenses, balances, and Home. Sign-out removes drafts and recovery keys; the confirmation explains checking saved history before recreating an uncertain expense.

Run `TZ=Asia/Kolkata pnpm mobile verify:expenses` against the isolated local development backend. It verifies literal remainder allocation, corrected validation, offline prevention, real response loss after commit, disk-backed controller restart, identical retry, exactly one Expense and Activity, renamed/archived Tag replay, machine error codes, refreshed balances, and account isolation. It creates and archives only its own fictional Group. Native process-restart/SQLite and keyboard/appearance checks remain separate device checks; this verifier does not claim to run Android.

For native fixtures, use `verify:expenses --seed-fixtures /absolute/path/manifest.json`, then `verify:expenses --cleanup-fixtures /absolute/path/manifest.json`. Never use fixture helpers against real user data. Financial read caching is described below.

### Custom splits and multiple payers

**Edit split** supports Equal, Unequal, Percentage, Shares, and Exact using the shared exact-money calculator. **Edit payers** retains the single-payer default and reveals individual paid amounts for multiple payers. The review shows each person’s paid and owed amounts with both totals conserved in the Group currency. Invalid totals, percentages, shares, precision, and duplicate members use shared correction messages.

Done and Android Back retain sheet edits in the account-scoped draft. Changing split method clears incompatible split values; participant toggles retain their entries within the same method. Existing equal-split drafts remain readable. Every custom submission uses the same persisted immutable body/key and explicit retry rules as equal splits. The HTTP verifier now saves all five methods with multiple payers, reverses participant order to verify stable remainder placement, interrupts each committed response, restarts, retries explicitly, and compares the authorized saved allocations and Activity with the preview.

## Expense detail, editing, and deletion (#55)

Open an Expense from the Group ledger to see its stored currency, payers, allocations, Tag, notes, and available edit history. **Edit expense** retains the record’s original values, including historical rounding and archived Tag association. Metadata-only changes send only changed metadata; they do not recalculate or resend allocations. **Delete expense** shows the saved record and requires explicit confirmation before soft deletion. Successful writes refresh the Group ledger, balances, and Home. The backend records Activity, verified through authorized HTTP reads; the native Activity screen remains a separate ticket.

Every edit/delete carries the displayed revision and requires an online membership check. SQLite persists the draft, original record, revision, and exact pending mutation before sending. If another member changed the record, or a response is lost, **Check current Expense** performs an authorized read only. Compare the current saved record with the retained draft, then explicitly choose **Keep my draft for review** before saving again, or **Keep current saved record** to discard the local draft. Deleted records and revoked access disable saving. Neither restart nor reconnect automatically repeats an edit/delete or adopts a new revision. A Group’s existing draft must be resolved before editing a different Expense.

Run `TZ=Asia/Kolkata pnpm mobile verify:expense-edit` against the isolated local backend. It checks metadata preservation, archived Tags, two editors, stale delete, committed-response loss, disk-backed restart, explicit reconciliation, and single deletion Activity. It archives only its own fictional Group and signs out its test sessions. Native checks separately exercise detail/edit controls, conflict choices, process restart, and deletion confirmation.

## Returning from an Expense (#104)

Opening an Expense from a Group records where it came from: the Group, its Month and the list's scroll position. Android Back and the back arrow keep the draft on this device and return there. Direct entry, with no known origin, returns to the Group at its default Month. A confirmed save, edit or deletion returns the same way with a Snackbar. When the saved Expense belongs to another Month, the Snackbar offers **View in {Month}**; the Month shown changes only when chosen. A save that finishes after you leave never navigates.

Resuming an ordinary draft is marked as never sent. A save that may already be recorded is marked **Save not confirmed** and is only retried when you choose to, with the same submission. Edit history names people ("Former member" when an account is gone) and shows amounts, dates, Tags and splits in words. The Group bottom-navigation destination is restored once #115 adds it. Evidence and unverified device checks: `docs/qa/2026-10-01-android-return-navigation.md`.

## Record actual payments (#56)

Open **Payments** in a Group to view authorized Settlement history and eligible suggested debts involving you. Review the amount actually paid; partial payments are supported. Review refreshes the suggestion while retaining your entry. An amount above the current suggestion requires a separate acknowledgment, which resets if the suggestion changes before submission. This records an existing payment; SplitBook neither transfers funds nor confirms bank/provider status.

Recording requires an online membership/party check. SQLite stores one unresolved Settlement per Group with the exact payload and submission key before any POST. Restart and foreground refresh do not resend it. **Retry same payment record** explicitly reuses the persisted body/key; a changed balance never rewrites that attempt. Confirmed success reloads Settlement history, suggestions, and Home; opening the Group reloads its ledger. Backend Activity is recorded by the shared service; native Activity remains #57.

Definite validation rejection of a new attempt retains editable input after safe local cleanup. A rejected replay stays locked because its original write may already exist. Access denial disables recording; refreshing can revalidate access. Sign-out purges attempts with the existing account cleanup marker and storage lease, preventing late responses from repopulating a retired account.

Run `MOBILE_VERIFY_URL=http://127.0.0.1:<port> pnpm mobile verify:settlements` against an isolated local backend. It checks partial/full payments, acknowledged overpayments, committed-response loss, disk-backed restart and explicit replay, exactly one Settlement/Activity, current membership and participant authorization, and sign-out cleanup. It archives only its own fictional Group. Native SQLite/process-restart checks are recorded separately in `docs/qa/2026-09-28-android-settlements.md`.

## Group Activity and historical event details (#57)

Open **Activity** from a Group for the authorized backend timeline. Events show their actor, action, timestamp, and recorded amount/currency when available. **Load older Activity** fetches another page and deduplicates by backend event identity; **Refresh Activity** replaces the timeline with the current first page so recovered history can appear without locally inventing financial events.

Event details are explicitly historical snapshots, with recorded changes and Expense/payment references where available. A separate authorized read checks whether a linked Expense currently exists, is deleted, or is unavailable. These details never open an editor or substitute the snapshot for the current Expense. Missing references and unknown current status stay explicit.

Returning to the foreground refreshes Activity authorization. Access denial removes its timeline and detail; session expiry/sign-out clears account state and late responses cannot restore it. A network failure uses the validated account-scoped cache described below; other failed refreshes retain previously loaded events with a stale/error notice and disabled detail actions. A missing event is never evidence that its Expense or payment failed.

Run `MOBILE_VERIFY_URL=http://127.0.0.1:<port> pnpm mobile verify:activity` against an isolated local backend for mixed-event pagination, deleted-target details, stale/error recovery, and foreground membership revocation. The existing `verify:settlements` journey also checks that a payment recovered after committed-response loss appears once in the native Activity controller. Both scripts use only owned fictional fixtures. For device checks, `verify:activity --seed-fixtures /absolute/path/manifest.json` preserves an owned fixture; `--cleanup-fixtures` archives that exact Group after verification.

## Offline financial views (#59)

Previously loaded Home balances, Groups, exact expense Month/page queries, running balances, Activity pages, and Expense details persist in SQLite, scoped to the backend and account. Offline reads show a saved-data notice with the oldest refresh time among the saved views displayed. An unvisited Group, Month, page, or detail remains explicitly unavailable. Server errors and invalid responses are not disguised as successful offline reads.

A cold offline restart requires the existing protected session cookie, matching account owner, and an unexpired last verified identity in SecureStore. This permits inspection of previously authorized data; it cannot discover remote revocation while disconnected. Once connected, reads recheck the session and server authorization. A denied Group is purged, including its cached aggregates; an authoritative Group list also removes caches for lost memberships. Sign-out/account switching use the existing serialized cleanup and restart marker.

Every cold start, online or not, shows that saved Home at once, marked "Saved hh:mm · checking", while the session is checked (#127). Its actions wait and nothing is sent until the session is confirmed. A failed check (signed out, expired or revoked) replaces it with sign-in or recovery. A pending sign-out cleanup finishes first, so that account's Home is never shown.

Expense drafts remain editable using saved Group context. Financial create/edit/delete and payment submission still require live checks. Reconnect preserves the draft and any uncertain attempt, and never retries a mutation automatically. Cached Activity record status is labelled as the last saved check rather than a statement of current existence. Payments history and invitations remain online-only.

Run `MOBILE_VERIFY_URL=http://127.0.0.1:<port> pnpm mobile verify:offline` against an isolated fictional backend. This public-controller/HTTP journey uses disk persistence to verify cold offline restoration, exact Month availability, retained drafts, reconnect without writes, revocation and sign-out. Android SQLite/SecureStore/process-restart and visual checks are recorded separately in the QA report.

## Google sign-in for the staging beta

Set `EXPO_PUBLIC_APP_ENV=staging`, identical HTTPS `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AUTH_ORIGIN`, and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the staging backend's `AUTH_GOOGLE_ID`. `EXPO_PUBLIC_INVITE_ORIGIN` defaults to the auth origin. Public client IDs are not secrets; never bundle the Google client secret, database URI, or Better Auth secret.

The separate backend must use `AUTH_MODE=google`, `MOBILE_APP_ENV=staging`, its own database/secret and approved email allowlist. The native controller checks `/.well-known/splitbook-mobile.json` without credentials before login, restoration and server logout; a missing or mismatched staging marker/audience stops credential transmission. This guard identifies the configured environment; operators must separately verify that the deployment uses an isolated database. Do not enable the marker on production, or enable test ID-token/demo overrides on staging.

Register `com.splitbook.app.staging` and the actual APK signing SHA-1 in the same Google project as the staging web client. Credential Manager requests tokens for that **web** audience, so the existing Google verifier accepts the same single intended audience. This direct identity-token exchange does not use a browser callback or custom-scheme redirect: it preserves the existing explicit-cookie transport and backend HTTPS Origin. It does not need an additional Better Auth Expo session store, wildcard trusted origins, or an expanded audience list. The older Expo/browser proposal in issues #35/#36 needs reconciliation with this implementation; iOS remains outside this release.

The native library autolinks on Android. Its Expo config plugin only adds Firebase/iOS configuration; this Android-only, explicit-client-ID setup requires neither and intentionally does not supply fabricated iOS settings. Rebuild the development binary after installing the native dependency. Expo Go cannot run it.

Before distribution, verify real approved/denied Google accounts, cancel/retry, restart and expiry, offline recovery, pending invitations, account switching and sign-out purge, Android App Links, light/dark and enlarged text, and a complete Group/Expense/balance/Settlement journey. Mocked controller tests and an assembled debug APK do not replace these checks.

### Build the signed staging APK locally

Run `pnpm mobile build:staging` with the staging public settings above and these explicit signing inputs:

- `SPLITBOOK_ANDROID_KEYSTORE`: absolute path to the private PKCS12/JKS keystore, stored outside Git.
- `SPLITBOOK_ANDROID_PASSWORD_FILE`: absolute path to a private file containing the keystore password. The key uses the same password; restrict both files to their owner.
- `SPLITBOOK_ANDROID_KEY_ALIAS`: alias of the staging signing key.
- `JAVA_HOME` and `ANDROID_HOME`: the installed JDK and Android SDK paths.

The command disables implicit dotenv loading, verifies the deployed staging handshake, regenerates Android from tracked Expo configuration and builds the ARM64 release APK. It explicitly reruns the JavaScript bundle task (including Metro cache reset) on every invocation because Gradle does not track Expo public environment values; native compilation remains incremental. It requires a single HTTPS host for auth, API and invitations. Generated output is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`; it runs without Metro. Signing values stay outside source and command arguments. Keep a secure backup of the key and password: future upgrades of this installed beta must use the same certificate.

Use Android SDK `apksigner verify --print-certs` on the APK. Register its package `com.splitbook.app.staging` and SHA-1 in Google Cloud, and publish its SHA-256 through the staging server's existing App Links settings. A build succeeding does not establish Google login or verified links; follow the release checks above before inviting testers.
