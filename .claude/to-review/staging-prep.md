# To review on staging: prepared steps 1 and 4

Checked read-only on 2026-10-14. Nothing has been changed.

## What's there now
- **Vercel project:** `ankit-das-projects/splitbook-staging` (`prj_UYPtL2qI4Fei7yl0cUTjdHQupFRa`), with root `apps/web`.
- **Flags already set** (Production target, encrypted, added 12 Oct in CP-582): `PERSISTENT_DRAFTS_ENABLED` and `NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED`. `MCP_ENABLED`, `MCP_RESOURCE_URL` and `NEXT_PUBLIC_APP_URL` are present too.
- **Live build:** the latest production deploy (23 hours ago) is PR #402's `ac582c2`, custom Tags. It doesn't include To review.
- **`https://staging.splitbook.in` publishes:**
  - environment `staging`;
  - Google web client `454607327176-0fhsf0u4l3r1e41qf7l2svc6av8eqofr.apps.googleusercontent.com`;
  - App Links for `com.splitbook.app.staging`, with signer `DD:96:E7…`.
- **Signing files** exist at `~/.config/splitbook/android-staging/`: `splitbook-staging.p12` and `keystore-password`. Their contents were never read. The alias is `splitbook-staging`.

## Decide first
1. **The staging slot.** Deploying `main` replaces #402's custom Tags build, which you were checking on your phone. The options:
   - (a) finish the #402 phone check, merge #402, then deploy `main` with both;
   - (b) deploy `main` now; custom Tags returns to staging once #402 merges.
2. **`MCP_RESOURCE_URL`: no action needed.** The public metadata shows the resource `https://mcp.staging.splitbook.in/api/mcp`, with authorization at `https://staging.splitbook.in/api/auth` and the scopes `ledger:read` and `drafts:write`.

## Step 1: deploy `main` to staging (needs your go)
Deploy from a clean copy of the exact commit, as for earlier staging rollouts:

```bash
S=/private/tmp/splitbook-staging-272486f
git -C /Users/ankitdas/AnkitPersonalProjech/SplidBook archive 272486f5dfbb77848bbfadf72891ee5c1f822ea5 | (mkdir -p $S && tar -x -C $S)
cd $S && VERCEL_ORG_ID=team_bKJO9djUyEaiPxbROAbINbu0 VERCEL_PROJECT_ID=prj_UYPtL2qI4Fei7yl0cUTjdHQupFRa vercel deploy --prod --yes
```

**After it's ready:**
- the staging aliases point at the new deployment;
- signed out, `/api/user/to-review` returns 401;
- signed in, it returns 200 with `{ total, groups }`;
- the Group tab says "To review".

**Rollback:** promote the previous deployment (`dpl_4i3arBmjCFftQue4Y1skXbaWH9R2`, `ac582c2`) with `vercel promote`, or set both flags to `false` and redeploy.

## Step 4: build the staging APK (needs your go)
Build from the same clean copy, once step 1 is live, because the build checks that the server advertises the right environment.

```bash
cd $S && corepack pnpm install --frozen-lockfile
cd $S/apps/mobile && \
EXPO_PUBLIC_APP_ENV=staging \
EXPO_PUBLIC_API_URL=https://staging.splitbook.in \
EXPO_PUBLIC_AUTH_ORIGIN=https://staging.splitbook.in \
EXPO_PUBLIC_INVITE_ORIGIN=https://staging.splitbook.in \
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=454607327176-0fhsf0u4l3r1e41qf7l2svc6av8eqofr.apps.googleusercontent.com \
EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED=true \
SPLITBOOK_ANDROID_KEYSTORE=$HOME/.config/splitbook/android-staging/splitbook-staging.p12 \
SPLITBOOK_ANDROID_PASSWORD_FILE=$HOME/.config/splitbook/android-staging/keystore-password \
SPLITBOOK_ANDROID_KEY_ALIAS=splitbook-staging \
node scripts/build-staging-apk.mjs
```

**Then:**
- copy `android/app/build/outputs/apk/release/app-release.apk` to `output/SplitBook-Staging-To-Review-272486f.apk`;
- record its size and SHA-256, and check the package is `com.splitbook.app.staging` with signer `DD:96:E7…`.

**Notes:**
- **The new domain is built in.** All three origins are `staging.splitbook.in`, so the `/groups/<id>/review` links from Claude open in the app, and invite links do too.
- **Nothing is installed anywhere.** You put it on your phone. emulator-5554 isn't touched.
- **Clean up afterwards:** remove `$S` once the APK is copied out.

## Done on 2026-10-14
- **Step 1 deployed.** You chose "Deploy main now".
  - The `272486f` clean archive went to staging as `dpl_5rr4BzZsvaAx8nw1DUXdHspM3TUJ`, Ready, production target.
  - Its aliases: `staging.splitbook.in`, `mcp.staging.splitbook.in`, `splitbook-staging.vercel.app` and `splitbook-staging-ankit-das-projects.vercel.app`.
  - Probes: handshake OK, assetlinks 200, home 200, `/api/user/to-review` signed out 401.
  - Rollback: `dpl_4i3arBmjCFftQue4Y1skXbaWH9R2` (`ac582c2`).
- **Step 4 deferred.** You chose "Deploy only", so the APK isn't built yet.
