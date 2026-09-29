# SplitBook native client

Expo + React Native, TypeScript, Android first. The foundation implements [ticket #50](https://github.com/FireBird1998/splitbook/issues/50): guarded local persona sign-in, API-backed Group browsing, Theme-specific headers, member lists, session restoration, foreground revalidation, and sign-out. [Ticket #52](https://github.com/FireBird1998/splitbook/issues/52) adds Group creation, Android sharing, invitation preview, and explicit joining. [The approved spec](https://github.com/FireBird1998/splitbook/issues/49) tracks the remaining native app.

This is a **development client**. It requires Metro and a local fictional backend. The staging APK, real Google callback, and iOS validation have separate tickets; they are not included here.

## Run locally

Use Node 22.13+ and the root-pinned pnpm version. Install Android Studio with an SDK/emulator and a compatible JDK. The first Gradle build downloads its required SDK components using your installed SDK license records.

From a clean checkout/worktree (do not copy a real web `.env.local`):

```sh
pnpm install --frozen-lockfile
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm mobile backend:seed
pnpm mobile backend:start
```

The [backend helper](scripts/dev-backend/README.md) requires a local Mongo server (default port 27018). Set `SPLITBOOK_NATIVE_MONGO_PORT=27017` on both seed/start commands if your server uses 27017. It claims only an empty or already-owned `splitbook_mobile_50` database, seeds fictional personas/Groups, and listens on `127.0.0.1:4138`. It refuses root/web environment files; leave existing application environments untouched and use a clean worktree.

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
```

`verify:api` uses the actual mobile controller and HTTP server. It checks session creation/restoration, normalized Group/member dates, authorization denial, server logout, local purge, and disabled development authentication. It never accepts a remote server or prints session values.

For a native smoke, verify persona → Group list → Trip and Household details → Android Back → app restart → refreshed session/Groups → sign-out → restart. With Sam signed in, the fixture helper can revoke Household membership or expire Sam's sessions before returning to the app:

```sh
node apps/mobile/scripts/dev-backend/control.mjs revoke-member sam household
node apps/mobile/scripts/dev-backend/control.mjs restore-member sam household
node apps/mobile/scripts/dev-backend/control.mjs expire-sessions sam
```

Always restore fictional membership after testing. Confirm denied/expired access removes protected content, errors can be retried, and light/dark headers preserve the Trip-only ornament. These device checks are distinct from Node HTTP tests and do not verify Google OAuth.

## Android invitation links

Shared invitations remain canonical web URLs so they can open in a browser when the app is absent. Set `EXPO_PUBLIC_INVITE_ORIGIN` to the backend's `NEXT_PUBLIC_APP_URL` origin; it defaults to `EXPO_PUBLIC_AUTH_ORIGIN`. The app accepts only that origin's `/join/<eight-hex-character-code>` links. Changing a native intent filter requires rebuilding the binary. Local HTTP links are development-only; they do not establish verified Android App Links.

The future staging build uses `EXPO_PUBLIC_APP_ENV=staging`, an explicit HTTPS invitation origin, and the distinct `SplitBook Staging` / `com.splitbook.app.staging` / `splitbook-staging` identity. On that web host, set `ANDROID_APP_LINKS_ENV=staging` and `ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS` to the actual APK signing certificate's SHA-256 fingerprint, or a comma-separated list during certificate rotation. Each fingerprint must contain 32 colon-separated hexadecimal bytes. The public `/.well-known/assetlinks.json` route publishes only the fixed staging package and validated fingerprints; missing or malformed settings return empty 404 JSON.

No real staging domain or certificate is configured here. Ticket [#60](https://github.com/FireBird1998/splitbook/issues/60) must verify that the actual host serves the JSON over HTTPS without redirects, the installed APK uses the matching signing certificate, and Android reports the domain verified. Recheck warm and cold invitation opening plus absent-app browser fallback on that deployment. The manifest and local HTTP smoke alone do not establish domain ownership. See [Expo Android App Links](https://docs.expo.dev/linking/android-app-links/) and [Android domain verification](https://developer.android.com/training/app-links/verify-applinks).

## Boundaries

- `src/data` owns authentication, JSON validation, dates, transport, and session-local Group state. UI never calls fetch directly. It reuses the shared Group Theme/currency modules; it does not calculate balances from Group-list data.
- `src/runtime.ts` injects native `expo/fetch` and SecureStore. Only the signed session-token cookie is stored, keyed by backend. Better Auth's raw token and cookie-cache payload are not used. Requests disable the native cookie jar and carry the explicit cookie and configured trusted origin.
- Logout invalidates request generations, purges memory and SQLite drafts, serializes account storage cleanup, and attempts server revocation. In-flight responses cannot refill state. Future caches must join this purge boundary.
- Native demo entry requires both `__DEV__` and explicit `EXPO_PUBLIC_APP_ENV=development`; the server independently enforces its existing demo guard. A production bundle cannot use this adapter. Cleartext Android traffic is configured only for the development variant.
- Display tokens live in `@splitbook/shared/design-tokens`; the old web import re-exports that source. Both clients share the semantic light/dark colors and Group Theme registry. Only the required Outfit/IBM Plex Mono weights are bundled.
- Native Google integration, staging release, and production configuration are handled by the remaining approved tickets. The data boundary is the extension point for those changes.

## Home and Group financial views

[Ticket #51](https://github.com/FireBird1998/splitbook/issues/51) adds server-provided Home obligations with **You owe** and **You are owed** shown separately for each currency. It does not combine currencies or replace obligations with a net number. Loading and failed reads remain distinct from a confirmed empty ledger.

Opening a Group loads its expenses and all-time running balances. Expenses show their recorded date, payers, amount, currency, and Tag, with refresh and explicit pagination. Trip keeps its itinerary strip; Household uses the neutral header and a Month selector. Household defaults to the viewer's current Month and supports previous Months and All time.

A Month is only an expense window. The client sends full ISO bounds for local calendar-month start and end, asks for the backend's summary and member contributions, and keeps running balances separate. Monthly contributions are scoped to the Group's default currency; expense totals and running balances preserve every currency returned by the backend. Changing Month neither resets the ledger nor records a Settlement.

The expense read can materialize due recurring entries on the backend, so the controller reads expenses before refreshing Group balances. The native app validates the returned money with shared exact-money helpers but does not compute its own balances. These reads now support the account-scoped offline cache described below and join the existing session/navigation invalidation and sign-out cleanup boundaries.

`verify:financial` exercises the public mobile controller against the real local HTTP backend with uniquely named fictional Groups, known obligations in INR/EUR, local Month boundaries, an empty Month, and more than one expense page. Run it with `TZ=Asia/Kolkata` for a reproducible non-UTC fixture; the app itself follows the device timezone. The verifier archives its own Groups afterward. Native checks separately cover rendering, controls, refresh, light/dark appearance, and enlarged text.

## Create and join a Group

Choose **Create Group**, select a Theme and currency, and enter a name. Optional dates appear only for Trip. Form input survives navigation, recoverable failures, and same-account reauthentication while the process is running; Group forms are not restart-persistent Expense drafts. After an uncertain create, the app refreshes Groups and asks you to check them before explicitly returning to the form. It never automatically repeats the create.

From a Group, get its invite link and use **Share invite link** to open Android sharing. The app reuses a valid link; if generation loses its response, it reads the current link before considering another user-requested generation. Only exact configured-environment web invitations are accepted. A pending invitation is stored separately from the session, survives cold restart and sign-in, and always requires explicit joining. Success, cancellation, and explicit sign-out clear the pending destination. Opening the canonical link without the app retains the existing web join flow.

`verify:groups` uses the real controller, HTTP routes, and isolated backend for creation, sharing, second-persona joining, authentication interruption, and committed-response loss. It archives only its uniquely named test Groups through authorized requests and signs out its sessions. Android verification separately checks the form/keyboard, share sheet, cold/warm link delivery, and appearance. Local HTTP links are unverified on Android: targeting the installed package exercises routing but does not prove staging App Links verification. The staging domain/certificate/device check belongs to #60.

## Settings and account cleanup

[Ticket #58](https://github.com/FireBird1998/splitbook/issues/58) adds Settings from the toolbar. System, Light, and Dark apply through the shared semantic tokens. The appearance preference is saved on this device and survives sign-out; a failed save restores the last confirmed choice and offers recovery. Settings shows the authenticated member and the configured development connection. Web settings open only at the configured public origin (`EXPO_PUBLIC_INVITE_ORIGIN`, falling back to the auth origin), with no native session values in the link. The browser uses its own sign-in session.

Sign-out clears memory and protected session storage, cancels requests, and prevents their late responses from restoring account content. Persistent financial stores added by later tickets must register with the account-local cleanup boundary. Cleanup failures stay visible and are retried before session restoration; the device stores a cleanup marker so restarting cannot bypass an unfinished purge. Existing Group forms remain memory-only, and this ticket does not add financial caches, Expense drafts, or pending financial submissions.

`verify:settings` exercises account details, sign-out, server session revocation, restart/account switching, and delayed response delivery through the real controller and isolated HTTP backend. Native checks separately verify actual SecureStore appearance persistence, system appearance changes, enlarged text, the browser destination, and sign-out/account switching.

## Expense creation and drafts (#53–54)

Open a Group and choose **Add expense**. Equal splits use shared exact-money allocation; the form collects a payer, participants, date, stable Tag identity, and optional category/notes. A past Household Month starts on that Month’s last day. Currency is the Group currency; an outdated draft requires an explicit currency choice and amount review.

SQLite keeps one draft per backend, account, and Group. Every edit is serialized through the account-storage lease. One atomic row holds the exact serialized request together with its UUID before any POST. An uncertain attempt stays immutable across restart and retries with the same body/key. An online Group check precedes Save; editing a draft never queues a write. Confirmation removes the record and reloads Group expenses, balances, and Home. Sign-out removes drafts and recovery keys; the confirmation explains checking saved history before recreating an uncertain expense.

Run `TZ=Asia/Kolkata pnpm mobile verify:expenses` against the isolated local development backend. It verifies literal remainder allocation, corrected validation, offline prevention, real response loss after commit, disk-backed controller restart, identical retry, exactly one Expense and Activity, renamed/archived Tag replay, machine error codes, refreshed balances, and account isolation. It creates and archives only its own fictional Group. Native process-restart/SQLite and keyboard/appearance checks remain separate device checks; this verifier does not claim to run Android.

For native fixtures, use `verify:expenses --seed-fixtures /absolute/path/manifest.json`, then `verify:expenses --cleanup-fixtures /absolute/path/manifest.json`. Never use fixture helpers against real user data. Financial read caching is described below.

### Custom splits and multiple payers

**Edit split** supports Equal, Unequal, Percentage, Shares, and Exact using the shared exact-money calculator. **Edit payers** retains the single-payer default and reveals individual paid amounts for multiple payers. The review shows each person’s paid and owed amounts with both totals conserved in the Group currency. Invalid totals, percentages, shares, precision, and duplicate members use shared correction messages.

Done and Android Back retain sheet edits in the account-scoped draft. Changing split method clears incompatible split values; participant toggles retain their entries within the same method. Existing equal-split drafts remain readable. Every custom submission uses the same persisted immutable body/key and explicit retry rules as equal splits. The HTTP verifier now saves all five methods with multiple payers, reverses participant order to verify stable remainder placement, interrupts each committed response, restarts, retries explicitly, and compares the authorized saved allocations and Activity with the preview.

## Expense detail, editing, and deletion (#55)

Open an Expense from the Group ledger to see its stored currency, payers, allocations, Tag, notes, and available edit history. **Edit expense** retains the record’s original values, including historical rounding and archived Tag association. Metadata-only changes send only changed metadata; they do not recalculate or resend allocations. **Delete expense** shows the saved record and requires explicit confirmation before soft deletion. Successful writes refresh the Group ledger, balances, and Home. The backend records Activity, verified through authorized HTTP reads; the native Activity screen remains a separate ticket.

Every edit/delete carries the displayed revision and requires an online membership check. SQLite persists the draft, original record, revision, and exact pending mutation before sending. If another member changed the record, or a response is lost, **Check current Expense** performs an authorized read only. Compare the current saved record with the retained draft, then explicitly choose **Keep my draft for review** before saving again, or **Keep current saved record** to discard the local draft. Deleted records and revoked access disable saving. Neither restart nor reconnect automatically repeats an edit/delete or adopts a new revision. A Group’s existing draft must be resolved before editing a different Expense.

Run `TZ=Asia/Kolkata pnpm mobile verify:expense-edit` against the isolated local backend. It checks metadata preservation, archived Tags, two editors, stale delete, committed-response loss, disk-backed restart, explicit reconciliation, and single deletion Activity. It archives only its own fictional Group and signs out its test sessions. Native checks separately exercise detail/edit controls, conflict choices, process restart, and deletion confirmation.

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

Expense drafts remain editable using saved Group context. Financial create/edit/delete and payment submission still require live checks. Reconnect preserves the draft and any uncertain attempt, and never retries a mutation automatically. Cached Activity record status is labelled as the last saved check rather than a statement of current existence. Payments history and invitations remain online-only.

Run `MOBILE_VERIFY_URL=http://127.0.0.1:<port> pnpm mobile verify:offline` against an isolated fictional backend. This public-controller/HTTP journey uses disk persistence to verify cold offline restoration, exact Month availability, retained drafts, reconnect without writes, revocation and sign-out. Android SQLite/SecureStore/process-restart and visual checks are recorded separately in the QA report.
