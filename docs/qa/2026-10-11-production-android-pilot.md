# Android production pilot preparation

## Scope

Private pilot for the owner and one invited friend, before sharing with roughly ten friends. This is a production ledger; staging remains separate. Real-account and physical-phone acceptance is tracked under #193 and is not established by unit tests.

## Build configuration

`pnpm mobile build:production` requires `EXPO_PUBLIC_APP_ENV=production`, identical HTTPS API/auth/invitation origins, the production Google web audience, and external signing inputs. It checks the public backend marker and compiled package identity and forces a fresh JavaScript bundle. Development personas remain disabled. Production and staging clients reject the other environment's marker before sending credentials.

Production package: `com.splitbook.app`; staging: `com.splitbook.app.staging`.

The operator must configure only the production Vercel project:

- `AUTH_MODE=google`
- `MOBILE_APP_ENV=production`
- `ANDROID_APP_LINKS_ENV=production`
- `ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS=B6:34:FC:FC:EC:42:B9:15:67:56:A6:97:37:EF:B0:D8:97:19:2C:22:26:19:BA:6F:42:DE:33:4A:A2:FC:18:EB`

Keep its existing production database, Google web client, auth secret and invited-email allowlist. Do not enable demo or test-token settings. Redeploy after configuring, then verify both public metadata endpoints without redirects.

## Signing and Google registration

Dedicated key generated outside Git under `~/.config/splitbook/android-production/`; key and password files have owner-only permissions. The owner must make a secure backup of both for future upgrades. Never attach either file to a PR or copy them into build output.

- Alias: `splitbook-production`
- Google Android OAuth package: `com.splitbook.app`
- SHA-1: `6C:32:CB:5F:17:38:85:3F:7A:DF:B7:A9:84:F6:65:1F:48:B1:14:BF`
- SHA-256: `B6:34:FC:FC:EC:42:B9:15:67:56:A6:97:37:EF:B0:D8:97:19:2C:22:26:19:BA:6F:42:DE:33:4A:A2:FC:18:EB`

Register this Android client in the same Google project as the production web client. The app still requests tokens for the web audience; do not substitute the Android client ID.

Example build (the public audience must match the production marker):

```sh
export EXPO_PUBLIC_APP_ENV=production
export EXPO_PUBLIC_API_URL=https://splitbook.in
export EXPO_PUBLIC_AUTH_ORIGIN=https://splitbook.in
export EXPO_PUBLIC_INVITE_ORIGIN=https://splitbook.in
export EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<production-web-client-id>
export SPLITBOOK_ANDROID_KEYSTORE="$HOME/.config/splitbook/android-production/splitbook-production.p12"
export SPLITBOOK_ANDROID_PASSWORD_FILE="$HOME/.config/splitbook/android-production/keystore-password"
export SPLITBOOK_ANDROID_KEY_ALIAS=splitbook-production
pnpm mobile build:production
```

## Checks and outstanding gates

A signed candidate was compiled directly with Expo prebuild and release Gradle before backend rollout, for local installation checks only. The distribution command intentionally refuses the current production backend's missing marker. The candidate is not cleared for distribution.

- Signed ARM64 APK compilation: passed.
- Signature: valid v2, RSA4096, expected production certificate.
- Package/version: `com.splitbook.app`, `0.1.0`, versionCode1.
- Initial mobile unit suite: 2089 passed; targeted configuration/transport suite after adding marker-isolation tests:78 passed.
- Backend metadata tests:12 passed.
- Full initial swarm gate: passed (lint, typecheck, formatting, all workspace unit tests, ceilings, and all nine isolated HTTP verifiers).
- Signed candidate on isolated Android15/API35 emulator: installs, updates and opens without a startup crash; correct LIVE badge and live-ledger sign-in notice; missing production backend marker blocks login with a recoverable error. Shared staging emulator untouched.
- Production Google Android registration: pending.
- Backend metadata deployment and App Links verification: pending.
- Candidate APK SHA-256: `b1a9f1e18b0cba027915d01b836802ce2662268a60451a1b93236d475d031dca`.
- Candidate size: about32MiB; release manifest disallows cleartext traffic and registers only the production invitation host.
- Explicit invitation intent routing: app handles the production join URL; domain association remains `legacy_failure` while the backend association is unpublished.
- Signed APK real approved/denied Google login: pending.
- Two-account physical phone pilot, accessibility and timings: pending.
- Database backup/recovery readiness: not verified in this task.

## Owner and friend pilot

Invite only the pilot friend to the production allowlist. Verify approved login and denial of an uninvited account. Use a clearly identified pilot Group, with deliberately entered test records before real daily use. Check invitations, creation, all split methods, edit/delete, running balances, settlement recording, offline read/draft recovery, explicit retry after a lost response, force-close/restart, and sign-out/account isolation. Confirm each saved record on both phones and the web ledger. Confirm no duplicate Expense/payment on retry. Never run fictional backend seed/reset scripts against production.

Record the exact APK hash, signing certificate, source commit, backend deployment and device versions with the results. Do not mark #193 complete or share with the wider group while any acceptance gate fails.
