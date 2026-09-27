# SplitBook native client

Expo + React Native, TypeScript, Android first. This first slice implements [ticket #50](https://github.com/FireBird1998/splitbook/issues/50): guarded local persona sign-in, API-backed Group browsing, Theme-specific headers, member lists, session restoration, foreground revalidation, and sign-out. [The approved spec](https://github.com/FireBird1998/splitbook/issues/49) tracks the remaining native app.

This is a **development client**. It requires Metro and a local fictional backend. The staging APK, real Google callback, financial screens, drafts, offline views, and iOS validation have separate tickets; they are not included here.

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
```

`verify:api` uses the actual mobile controller and HTTP server. It checks session creation/restoration, normalized Group/member dates, authorization denial, server logout, local purge, and disabled development authentication. It never accepts a remote server or prints session values.

For a native smoke, verify persona → Group list → Trip and Household details → Android Back → app restart → refreshed session/Groups → sign-out → restart. With Sam signed in, the fixture helper can revoke Household membership or expire Sam's sessions before returning to the app:

```sh
node apps/mobile/scripts/dev-backend/control.mjs revoke-member sam household
node apps/mobile/scripts/dev-backend/control.mjs restore-member sam household
node apps/mobile/scripts/dev-backend/control.mjs expire-sessions sam
```

Always restore fictional membership after testing. Confirm denied/expired access removes protected content, errors can be retried, and light/dark headers preserve the Trip-only ornament. These device checks are distinct from Node HTTP tests and do not verify Google OAuth.

## Boundaries

- `src/data` owns authentication, JSON validation, dates, transport, and session-local Group state. UI never calls fetch directly. It reuses the shared Group Theme/currency modules; it does not calculate balances from Group-list data.
- `src/runtime.ts` injects native `expo/fetch` and SecureStore. Only the signed session-token cookie is stored, keyed by backend. Better Auth's raw token and cookie-cache payload are not used. Requests disable the native cookie jar and carry the explicit cookie and configured trusted origin.
- Logout invalidates request generations, purges memory, serializes SecureStore cleanup, and attempts server revocation. In-flight responses cannot refill state. Future drafts/caches must join this purge boundary.
- Native demo entry requires both `__DEV__` and explicit `EXPO_PUBLIC_APP_ENV=development`; the server independently enforces its existing demo guard. A production bundle cannot use this adapter. Cleartext Android traffic is configured only for the development variant.
- Display tokens live in `@splitbook/shared/design-tokens`; the old web import re-exports that source. Both clients share the semantic light/dark colors and Group Theme registry. Only the required Outfit/IBM Plex Mono weights are bundled.
- Financial writes, offline caches, native Google integration, and production configuration are intentionally handled by the remaining approved tickets. The data boundary is the extension point for those changes.
