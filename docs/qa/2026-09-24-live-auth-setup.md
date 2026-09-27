# Live authentication setup — 24 September 2026

Follow-up: [27 September local verification](2026-09-27-local-google-auth.md)
confirms real local Google sign-in after installing the owner's new local
credential. Production configuration remains pending and unchanged.

Status: local demo is available; real Google sign-in is blocked by an invalid
production OAuth client secret. External configuration has not been changed.

## Verified

- Local preview: `http://localhost:4127`, using the existing `splitbook-demo`
  database on port 27018. A read-only MongoDB ping succeeded and the demo
  dashboard loaded. Existing data was preserved.
- The owner's provided email was configured in the ignored local allowlist.
  Local Google client ID and secret are empty; the preview remains in demo mode.
- Vercel CLI identity is `firebird1998`. Project `splitbook` belongs to
  `ankit-das-projects`, links to `FireBird1998/splitbook`, deploys production
  from `main`, and has Root Directory `apps/web`.
- Production origin: `https://splitbook-ankit-das-projects.vercel.app`.
  Current production deployment: `dpl_GNeCotqtaCyu26pxxmGTMCXeJQtN`.
- Production environment metadata includes `MONGODB_URI`, `AUTH_SECRET`,
  `NEXT_PUBLIC_APP_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and
  `AUTH_ALLOWED_EMAILS`. Secret values were not printed or changed.
- A real production Google sign-in reached Google's account chooser with the
  correct production callback and PKCE. Selecting the owner-provided Google
  account returned to `/login?error=invalid_code`.
- The corresponding Vercel callback log at `2026-09-24T10:06:40.114Z` gives the
  provider cause: `invalid_client`, `The provided client secret is invalid.`,
  HTTP 401. This is an OAuth credential failure; a successful session was not
  created or verified.
- Application recovery fixes and isolated production verification are recorded
  in [the auth recovery report](2026-09-24-auth-recovery.md). Those tests do not
  substitute for a successful real Google sign-in.

## Required next steps

1. Confirm the Google Cloud project owner and open its Web OAuth client. Obtain
   a valid matching client ID/secret through the owner-controlled credential
   workflow; keep the secret out of chat, committed files, and logs.
2. Verify these exact authorized callbacks:
   - `http://localhost:4127/api/auth/callback/google`
   - `https://splitbook-ankit-das-projects.vercel.app/api/auth/callback/google`
3. Configure local Google credentials and the production secret securely. Check
   the deployed allowlist includes the approved owner without removing other
   intended testers. Redeploy the approved production source so new environment
   values apply.
4. Obtain authorized access to the Splitbook Atlas project. Confirm the actual
   database target and application user's permissions. Issue #9 specifies a
   fresh `splitbook` database with a scoped application user and preservation of
   the old database. Do not infer completion from environment-key presence.
5. Complete real sign-in, logout, and renewed sign-in, then verify an authorized
   Group/Expense journey and persistence in the intended database.

## Owner-authorized service inspection

The owner subsequently confirmed that the supplied personal Google account
administers both services and authorized access. Google Cloud and Atlas sign-in
then succeeded through that account. The earlier access blocks are resolved.

- Google Cloud project: `project-30d211b9-9cda-4fb0-85e` (My First Project).
  It already contains distinct `Splitbook` and `Splitbook Local` Web OAuth
  clients. Their production and local callback URLs match the values above.
- Both clients have an enabled existing secret. Google no longer permits
  retrieving those secrets. The production value configured on Vercel is
  rejected by Google; local credentials are absent. The owner was asked to
  perform the credential creation/rotation step and securely save new values,
  as required by the browser tool's credential-handling policy.
- Atlas organization `splitbook`, project `Splitbook`, cluster `splitbook`
  are accessible. Data Explorer connected successfully. The `splitbook`
  database currently contains `rateLimits` and `verifications`; no application
  users or ledger collections were listed. This is consistent with successful
  OAuth state/rate-limit storage followed by the failed Google token exchange.
  It is not a substitute for the completed sign-in and ledger smoke journey.
- Database user `splitbook_app` currently has `readWriteAnyDatabase @ admin`.
  That is broader than the `splitbook`-only role specified by issue #9. A
  separate administrator user also exists. Neither user's permissions changed.
- Network access already includes an active all-addresses entry. No network
  access was added or expanded.
- Vercel's live deployment metadata confirms Git SHA
  `35984f7fdf04db94000ed2bc6b639401398e81a7` on `main`. A configuration-only
  redeployment can reuse that source without deploying the uncommitted ledger
  changes or performing their migrations.

No live secrets, deployments, database users, network access rules, or production
ledger data were changed during this diagnosis. The ledger/auth source changes
remain local and uncommitted.
