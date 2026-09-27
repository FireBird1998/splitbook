# Local Google sign-in verification — 27 September 2026

Local Google OAuth works with the owner's approved account. Production settings
and the production OAuth client were not changed.

## Configuration

- Saved the owner-provided credential only in the ignored
  `apps/web/.env.local`, with owner-only file permissions.
- Selected the existing `Splitbook Local` Web OAuth client, enabled
  `AUTH_MODE=google`, and retained `http://localhost:4127` as the app origin.
- Preserved the existing allowlist, session secret, and local MongoDB target.
- Restarted Docker and the existing `splitbook-mongo` container after finding
  the database offline. No data reset or migration was performed.
- Local database: `splitbook-demo` on port 27018. Ping and read-only schema
  inspection pass: the unique email index is correct, no duplicate email
  groups exist, and no legacy Auth.js migration indicators were found.

## Real-provider verification

The browser completed Google's actual authorization-code flow twice; no
synthetic identity token or intercepted provider response was used.

1. The Google button used the local OAuth client and exact registered callback
   `http://localhost:4127/api/auth/callback/google`.
2. The approved owner account returned to the authenticated dashboard.
3. Refresh preserved authenticated access.
4. Account-menu sign-out returned to the landing page. Visiting the protected
   dashboard afterward redirected to login.
5. A second Google login returned to the authenticated dashboard.
6. Authenticated groups API reads returned 200; an independent anonymous request
   returned 401. Application MongoDB reads work alongside Better Auth storage.
7. Final read-only MongoDB verification found exactly one owner user, one
   linked Google account, and one active session for that user. Email
   verification and timestamp types are correct. The signed-out interval was
   verified in the browser; the database inspection occurred after re-login.

Sanitized server-log checks found two successful OAuth callback redirects,
successful dashboard/groups requests, a successful sign-out, and no Better Auth
errors during this run. Existing demo data was preserved. The browser was left
signed in at `http://localhost:4127/dashboard`.

Google currently labels the shared project's consent application `claw`, even
though the Web OAuth client is named `Splitbook Local`. Changing that branding
would affect the shared Google Cloud project and was not part of this local
credential update.

The live production login still needs its own valid production client secret
and a separate deployment/smoke verification. The local credential was not
copied to Vercel.
