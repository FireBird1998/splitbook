# Authentication recovery QA — 24 September 2026

Two application bugs were reproduced before changing the implementation:

- An invalid `better-auth.session_token` cookie caused `/login` and `/dashboard`
  to redirect to each other until Chromium reported `ERR_TOO_MANY_REDIRECTS`.
- A failed initial Google sign-in request, either HTTP 503 or a network failure,
  left the login page without error feedback. Both browser assertions failed.

The proxy now lets the login page validate the session. The login server page
redirects to the dashboard only when `getAuthUser()` returns a valid user.
Protected page and API validation remain unchanged. The shared Google sign-in
helper routes initial request failures to login with the intended callback
preserved, where an accessible alert explains that sign-in could not start.
The shared helper serves the login, landing and invitation sign-in buttons.
The updated route behavior is documented in [Authentication](../auth.md#4-proxy-route-protection).

## Verification

| Check                                                         | Result   |
| ------------------------------------------------------------- | -------- |
| Invalid-cookie login, and protected dashboard rejection       | Passed   |
| HTTP 503 sign-in feedback and a second retry request          | Passed   |
| Network failure feedback and a second retry request           | Passed   |
| Valid Google test identity, Mongo persistence, login redirect | Passed   |
| Proxy decision unit tests                                     | 8 passed |
| Focused ESLint and application TypeScript checks              | Passed   |

The final focused browser run passed **4 tests in 14.1 seconds**. The successful
identity test verified exactly one Google account and one session referencing
the stored user in MongoDB, then confirmed `/login` redirects to `/dashboard`.
Its locally signed identity token replaces Google's external identity proof;
Better Auth's Mongo adapter, cookies, session validation and page guards are real.

Reproduce with:

```sh
pnpm web exec playwright test --config playwright.auth-recovery.config.ts
pnpm web exec vitest run src/lib/auth/proxy-rules.test.ts
```

The browser suite is included in CI's verify job after Chromium installation.
It starts its own source snapshot on an allocated loopback port and a new
`splitbook-test-access-<uuid>` database on port 27017. It copies no environment
files, never uses the live preview, and removes its app snapshot and database
afterward. The Google test verifier secret is generated for that isolated run.

## Production follow-up

Both isolated app snapshots passed `next build --webpack`, including TypeScript,
static generation, optimization and build tracing. The route output confirms
`/login` remains dynamic. Each snapshot then ran under `next start` with
`NODE_ENV=production`, one in Google mode and one in explicitly enabled demo mode.
The user's running app and its `.next` directory were untouched.

The production browser suite passed **7 tests in 38.0 seconds**:

- All four auth recovery and Mongo persistence checks above passed again.
- Demo login recovered from a stale cookie, authenticated Alex, redirected an
  authenticated `/login` visit, signed out through the account menu, and rejected
  the subsequent protected dashboard visit.
- Google mode rejected an unapproved identity with `email_not_allowed`, created
  no session for it, kept the demo endpoint unavailable, and preserved the
  protected-page redirect.
- The Google button generated the expected OAuth authorization URL, exact
  callback, configured client ID, code response, PKCE S256 and account prompt.
  That navigation was intercepted before contacting Google.

The focused auth unit run passed **36 tests across four files**, covering the
auth builder, demo plugin, proxy rules and auth-mode guards. App typecheck,
focused ESLint and formatting checks passed. Review found no further application
correction needed after the two fixes. An initial test attempt sent a malformed
raw sign-out request and received 415; the final test uses the real account-menu
sign-out path and passes.

Reproduce the isolated production build and browser checks with:

```sh
pnpm web exec playwright test --config playwright.auth-production.config.ts
pnpm web exec vitest run src/lib/auth/create-auth.test.ts src/lib/auth/demo-persona-plugin.test.ts src/lib/auth/proxy-rules.test.ts src/lib/auth-mode.test.ts
```

Both production apps receive synthetic credentials and separate UUID test
databases on loopback port 27017, which are removed after the run. The production
suite explicitly enables its demo and test-token overrides only inside these
isolated child processes.

## Scope of the evidence

This confirms the application's authentication recovery and MongoDB storage
behavior. It does **not** prove a live Google authorization-code exchange, a
production Atlas connection, or a production deployment. A real Google login
still depends on the configured Web OAuth client, exact authorized callback URI,
the consent screen's applicable access settings, the application's normalized
`AUTH_ALLOWED_EMAILS`, and the deployment's database connectivity. The callback
for a plain configured origin is
`<NEXT_PUBLIC_APP_URL>/api/auth/callback/google`.

The live preview on port 4127 and its `splitbook-demo` database on port 27018
were not used or changed by these tests. No full workspace test rerun was needed
for these isolated auth fixes.

Live Google and Atlas setup is a separate follow-up; this report records only
the isolated checks above and makes no claim about that external configuration.
