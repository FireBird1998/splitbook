# Splitbook authentication migration to Better Auth — specification

**Date:** 2026-09-08  
**Status:** Complete for the authentication migration. Web parity landed in PR #38; mobile authentication follows PR #97 and ADR 0006. Production verification and cleanup were completed on 2026-10-10 (see section 11). Signed Android release and physical-phone verification remain outside this migration, under #193.

**Tracking:** Spec issue [#26](https://github.com/FireBird1998/splitbook/issues/26) with tickets #27–#36.  
**Decision record:** [ADR 0003](../../adr/0003-better-auth.md).  
**Baseline:** Canonical `main` at commit `bd42d15` (pnpm workspace; app in `apps/web`, shared code in `packages/shared`). This is the historical implementation baseline.

## 1. Problem and intended outcome

At the start of this migration, Splitbook authenticated with Auth.js v5, which
had stayed in beta for years, and kept a stateless JWT in a browser cookie. The Android and iOS client planned in
ADR 0001 cannot complete a browser redirect login and cannot follow a redirect to
an HTML page; it needs an API that verifies a Google ID token obtained from the
device's native sign-in and returns a session it can send with every request.

The outcome is Better Auth running the same product rules as today, with a
session model both clients share: invite-only Google sign-in, one-click demo
personas in demo mode, unchanged user ids, the 401 JSON contract for anonymous
API calls, and a documented path for the mobile app to sign in natively.

## 2. Accepted scope and invariants

- Keep Next.js 16, MongoDB, Mongoose for application data, and the workspace
  layout. Better Auth owns only authentication collections and the session.
- Google is the only sign-in method for real users. No email and password.
- Every existing `users._id` (ObjectId) is preserved, including the three demo
  persona ids `a0000000000000000000000{1,2,3}`. Services keep comparing the
  session user id byte-for-byte with stored ObjectId strings.
- Anonymous `/api/*` requests answer `{ error: 'Unauthorized', status: 401 }`;
  anonymous page visits redirect to `/login?callbackUrl=<pathname>`; the login
  page keeps its invite-only copy; the OAuth callback path stays
  `/api/auth/callback/google`.
- Demo sign-in remains fail-closed: available only when `AUTH_MODE=demo` and,
  under `NODE_ENV=production`, only with `ALLOW_DEMO_AUTH=true`.
- Environment variable names are unchanged for the parity release, so the
  cutover needs no Vercel changes.
- `@splitbook/shared` keeps importing nothing from authentication (ADR 0002).

### User outcomes

An invited tester signs in once more after cutover and finds everything as it
was. A person outside the allowlist sees the invite-only message. A demo tester
enters as a persona with one click. A member whose session expired is sent to
sign in rather than shown empty screens. A future mobile user signs in with the
native Google prompt and stays signed in for 30 days of use.

## 3. Decision log

| #      | Decision                 | Choice                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1     | Session strategy         | Database sessions with the cookie cache enabled                                                                                                                                                                                                                                                                                                                                                                        |
| Q2     | Identity continuity      | Users migrated in place; ids stay ObjectIds (adapter default)                                                                                                                                                                                                                                                                                                                                                          |
| Q3     | Demo personas            | One-click picker via a custom plugin endpoint, same guard semantics                                                                                                                                                                                                                                                                                                                                                    |
| Q4     | Allowlist                | Re-checked on every Google sign-in; stays an environment variable                                                                                                                                                                                                                                                                                                                                                      |
| Q5     | Session lifetime         | 30 days, refreshed on activity after one day, 5-minute cookie cache                                                                                                                                                                                                                                                                                                                                                    |
| Q6     | Mobile platforms         | Original plan: iOS and Android from day one. **Amendment (2026-10-10):** Android staging uses a registered Android client to request the web audience; production-package and iOS clients belong to their release work (#35 closure).                                                                                                                                                                                  |
| Q7/Q18 | Google test coverage     | Redirect parameters asserted without contacting Google; approved and denied outcomes through the ID-token path with a locally signed token behind an environment-gated `verifyIdToken` override; mock issuer removed. **Amendment:** under `NODE_ENV=production` the override needs `ALLOW_TEST_ID_TOKEN=true` as well (CI runs the suite against a production build), the same two-variable rule as `ALLOW_DEMO_AUTH` |
| Q8     | Rollout                  | PR A web parity (#38). **Amendment (2026-10-10):** PR #97 delivers the mobile exchange; the originally planned PR B is superseded (#36 closure, ADR 0006).                                                                                                                                                                                                                                                             |
| Q9     | Tickets                  | Spec issue plus child tickets, `ready-for-agent` / `ready-for-human`                                                                                                                                                                                                                                                                                                                                                   |
| Q10    | Cutover settings         | Parity needs none. **Amendment (2026-10-10):** the server retains its web Google audience; mobile client ids are not added to its environment.                                                                                                                                                                                                                                                                         |
| Q11    | Old Auth.js data         | Backed up at migration, dropped in a cleanup ticket                                                                                                                                                                                                                                                                                                                                                                    |
| Q12    | Sign-in methods          | Google only                                                                                                                                                                                                                                                                                                                                                                                                            |
| Q13    | Middleware file          | Renamed to `proxy.ts`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q14    | Mobile identifiers       | Scheme `splitbook`; bundle id and package `com.splitbook.app`                                                                                                                                                                                                                                                                                                                                                          |
| Q15    | Auth.js account rows     | Renamed to a backup collection; Google logins re-link on next sign-in                                                                                                                                                                                                                                                                                                                                                  |
| Q16    | Rate limiting            | Better Auth defaults with database storage. **Amendment:** `AUTH_RATE_LIMIT_ENABLED` overrides the default; the browser suites set it to `false` because behind `next start` on loopback no client IP is resolvable and every request would share one bucket                                                                                                                                                           |
| Q17    | Middleware depth         | Optimistic session-cookie check; routes and pages validate                                                                                                                                                                                                                                                                                                                                                             |
| Q19    | Mobile session transport | Signed Better Auth session cookie through the mobile controller and SecureStore; no bearer plugin. **Amendment (2026-10-10):** the Expo client is superseded by PR #97 and ADR 0006.                                                                                                                                                                                                                                   |
| Q20    | Environment variables    | Names kept; base URL derived from `NEXT_PUBLIC_APP_URL`                                                                                                                                                                                                                                                                                                                                                                |
| Q21    | Cookie cache trade-off   | Up to five minutes of stale validity after revocation accepted                                                                                                                                                                                                                                                                                                                                                         |

## 4. Server architecture

### 4.1 Instance

`apps/web/src/lib/auth.ts` builds one `betterAuth` instance:

- **Database:** the MongoDB adapter over a native driver `Db` created by the
  existing `mongodb-client.ts` (the driver connects lazily, so construction is
  synchronous). `transaction: false` (local and CI run a standalone `mongod`).
  Plural collection names so the application's `users` collection is the user
  collection; sessions, accounts, verifications and rate-limit counters get their
  own collections.
- **Ids:** adapter default. `_id` and user references are ObjectIds; the
  session exposes `user.id` as the 24-hex string services expect. No custom id
  generator (a custom function would store plain strings).
- **Session:** `expiresIn` 30 days, `updateAge` 1 day, `cookieCache` enabled
  with `maxAge` 300 seconds.
- **Rate limiting:** enabled in production by default, `storage: 'database'`;
  `AUTH_RATE_LIMIT_ENABLED=true|false` overrides the default (see Q16).
- **Base URL and secret:** `baseURL` from `NEXT_PUBLIC_APP_URL`; the secret is
  read from `AUTH_SECRET` (Better Auth's documented fallback), so the existing
  Vercel secret stays.
- **Trusted origins:** the configured app URL. The native exchange sends the
  configured trusted web origin; it does not require Expo or `splitbook://`
  origins for sign-in (PR #97, ADR 0006).
- **Google provider:** `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`,
  `prompt: 'select_account'`. Native identity acquisition requests this web
  audience too; no server array of Android/iOS audiences is needed.
- **Allowlist:** `user.validateUserInfo` returns an `email_not_allowed` error
  unless the provider email, trimmed and lower-cased, is in
  `AUTH_ALLOWED_EMAILS`; an empty or missing list rejects everyone. The gate
  runs on user creation, account linking and every OAuth sign-in, which matches
  today's per-sign-in check.
- **Plugins:** the demo persona plugin only when `isDemoAuthAllowed()` is true,
  then `nextCookies()` last.

### 4.2 Route handler and session access

`app/api/auth/[...all]/route.ts` exports `toNextJsHandler(auth)`; the Auth.js
catch-all is deleted. `getAuthUser()` in `api-response.ts` reads
`auth.api.getSession({ headers })` and returns `{ id, name, email, image }` or
`null`; every API route keeps calling it, so route-level validation is
unchanged. Server pages that called `auth()` use the same helper.

### 4.3 Proxy

`middleware.ts` becomes `proxy.ts`. It applies today's rules in the same order
using Better Auth's optimistic session-cookie check:

1. `/api/auth/*` always allowed.
2. `GET /api/join/<code>` allowed (invite preview).
3. Signed-in visits to `/login` redirect to `/dashboard`.
4. `/`, `/join*`, `/login*` are public.
5. Anonymous `/api/*` answers the 401 JSON body.
6. Any other anonymous path redirects to `/login?callbackUrl=<pathname>`.

The check only proves a cookie exists. Expired or revoked sessions pass the
proxy and are rejected by `getAuthUser` (401) or by the app layout (redirect),
which is where validation already lives. The matcher keeps excluding
`/dev/design-system`, Next internals and static files.

### 4.4 Demo persona plugin

A server plugin exposes `POST /api/auth/demo-persona/sign-in` with body
`{ personaId }` accepting a persona key or id with today's normalisation. It is
registered only when demo mode is allowed, so in every other configuration the
route does not exist. It finds the seeded user by its fixed ObjectId through the
internal adapter, creates a session, sets the session cookie and returns the
user; unknown personas answer 404. Rate limit: 10 requests per minute. A client
plugin types `authClient.demoPersona.signIn({ personaId })`.

## 5. Web client

`apps/web/src/lib/auth-client.ts` exports `authClient` from `createAuthClient`
with the demo persona client plugin. `SessionProvider` is removed; the two
components that read the session use `authClient.useSession()`. Google sign-in
calls `authClient.signIn.social({ provider: 'google', callbackURL, errorCallbackURL: '/login' })`;
Better Auth appends `?error=<code>` on rejection and the login page maps
`email_not_allowed` to the existing invite-only copy. Sign-out calls
`authClient.signOut()` then navigates to `/`. The SWR fetcher's 401 handling
and the Navbar's server-provided user are unchanged.

## 6. Data migration

`apps/web/scripts/migrate-auth.ts` (`pnpm web migrate:auth`) is idempotent and
supports `--dry-run` and `--revert`:

- `users.emailVerified`: Date or null becomes boolean — true when a Date was
  set **or when the user owns an Auth.js Google account row** (**Amendment:**
  Better Auth only links a Google login to an existing user whose row is
  verified, a takeover guard; Auth.js proved these emails through Google but
  stored `null`). No other user field changes; `createdAt`/`updatedAt` are
  ensured.
- The Auth.js `accounts` collection is renamed to `accounts_authjs_backup` when
  its documents carry `provider`/`providerAccountId`. Better Auth creates fresh
  account rows and links them to the existing user on the next Google sign-in,
  because Google reports verified emails and the user row is marked verified.
- **Amendment:** the unique `users.email` index moves from Mongoose's `email_1`
  to `users_email_uidx`, the name Better Auth's adapter generates before it
  writes to a collection; MongoDB refuses a second index with the same keys
  under a different name. The Mongoose schema declares the same name.
- Any Auth.js `sessions` or `verification_tokens` collections are left in place
  for the cleanup ticket; none exist under the current JWT strategy.
- The script refuses databases whose name matches the test-database pattern and
  prints counts per step.
- The Mongoose `User` model declares `emailVerified: Boolean, default false`.

Rollback: revert PR A and run `migrate:auth --revert`, which restores the Date
form and the backup collection. Users sign in again either way, since cookie
names change at cutover.

## 7. Verification and enforcement

### Unit (Vitest)

Tests of the instance options (session lifetimes, cache, rate-limit storage,
collection names), the allowlist gate (normalisation, rejection, fail-closed on
empty), the proxy rules (every rule above, including the 401 body and the
`callbackUrl`), the demo plugin guard (absent outside demo mode, absent in
production without `ALLOW_DEMO_AUTH`), and the migration script against an
isolated database (forward, idempotent re-run, revert).

### Browser suites

- **Demo journeys, pilot, design system, production UI:** unchanged; they drive
  the persona picker through the UI.
- **Expense access:** the fixture's `login` posts to the persona endpoint and
  asserts the session user id; the anonymous matrix keeps asserting 401 JSON and
  no redirect.
- **Google mode:** the mock OIDC issuer and `AUTH_GOOGLE_ISSUER` are removed.
  The suite asserts that clicking "Sign in with Google" navigates to
  `accounts.google.com` with the configured client id,
  `redirect_uri=<origin>/api/auth/callback/google`, `response_type=code`, a
  scope containing `openid` and PKCE S256, intercepting the navigation so Google
  is never contacted. Approved and denied outcomes run through the ID-token
  sign-in endpoint with a token signed locally under `AUTH_TEST_ID_TOKEN_SECRET`;
  when that variable is set the Google provider's `verifyIdToken` is replaced by
  a verifier for those tokens, and the code refuses to enable the override when
  `NODE_ENV=production` unless `ALLOW_TEST_ID_TOKEN=true` is also set (see the
  Q18 amendment).

### CI

The existing workflow already runs every suite; no new jobs. The build step's
placeholder Google variables stay valid.

## 8. Delivery sequence and review gate

1. **Web parity:** PR #38 delivered #27–#32, including the migration tool,
   server, persona plugin, web client, regression suites and docs.
2. **Production verification:** #33 is complete. The owner verified approved
   and denied Google sign-in. The read-only audit found Better Auth-compatible
   data and no pending conversion. Other testers use staging, so production
   re-login notifications are unnecessary.
3. **Cleanup:** #34 is complete with no work required. No legacy auth backups
   or verification-token collection remain; `AUTH_TRUST_HOST` is absent. Current
   Better Auth `accounts`, `sessions` and `verifications` must not be dropped.
4. **Mobile readiness:** #35 and #36 closed as superseded by PR #97 and
   [ADR 0006](../../adr/0006-android-client-architecture.md). Android obtains a
   Google ID token for the configured web audience and supplies it with a nonce
   to Better Auth. The controller owns the exchange and saves only the signed
   session cookie through SecureStore, scoped to the backend/account. Neither
   the Expo auth plugin nor multiple server-side client audiences are used.
   Production-package and iOS OAuth registration belong to their release work;
   #193 retains the signed staging APK and real-phone release checks.

### Rollback and scope control

Revert PR A and run the script's `--revert`. No schema outside authentication
changes, so the ledger is untouched by either direction. Scope stays at parity
plus mobile readiness; session management UI, invite management in the
database, and email sign-in are out of scope.

## 9. Original acceptance checklist

The criteria below were delivered by the merged web-parity implementation and
its regression suites. Section 11 distinguishes the production checks performed
for closeout from those automated guarantees; it does not claim a fresh real-device
or 30-day session endurance test.

- [x] Invited tester signs in with Google and keeps groups, expenses and settlements.
- [x] Address outside the allowlist sees the invite-only message; empty allowlist denies everyone.
- [x] Demo personas work with one click in demo mode; endpoint absent otherwise and in production without `ALLOW_DEMO_AUTH`.
- [x] Anonymous `/api/*` returns 401 JSON without a redirect; anonymous pages redirect with `callbackUrl`.
- [x] Sessions last 30 days of use; sign-out clears the device; other devices stale for at most five minutes.
- [x] Persona ids and every `users._id` unchanged after migration; `--revert` restores the previous shape.
- [x] All Vitest and Playwright suites green in CI without the mock issuer.
- [x] Docs, README, `.env.example`, AGENTS.md and the Cursor rule describe Better Auth.
- [x] `next-auth` and `@auth/mongodb-adapter` removed from the workspace.

## 10. Deferred and out of scope

- A database-backed invite list editable without a deploy.
- "Sign out everywhere" and session listing UI.
- Instant cross-device revocation (would require disabling the cookie cache).
- The `apps/mobile` scaffold itself; this spec ends at mobile readiness.
- Migrating Auth.js account rows field by field; re-linking on sign-in replaces it.

## 11. Production closeout — 2026-10-10

Evidence: [#33 verification](https://github.com/FireBird1998/splitbook/issues/33#issuecomment-6099584287)
and [#34 cleanup](https://github.com/FireBird1998/splitbook/issues/34#issuecomment-6099584763).

The owner reports successful production use and supplied the invite-only rejection
screen after trying a nonallowlisted Google account. All other testers use staging.
Live anonymous checks on `https://splitbook.in` returned 401 JSON for `/api/groups`,
307 to `/login?callbackUrl=%2Fdashboard` for `/dashboard`, null for `get-session`,
and 404 for demo-persona sign-in. The Google authorization response used the
`splitbook.in/api/auth/callback/google` callback, code flow, PKCE S256 and account
selection. Owner sign-in confirms the callback is accepted.

Read-only Atlas inspection of the production `splitbook` database found:

- One user with an ObjectId, `emailVerified: true`, and Date timestamps.
- One Better Auth account and two Better Auth sessions, all referencing the user;
  no orphaned references or legacy Auth.js account/session field shapes.
- `users_email_uidx` on email; no legacy `email_1`. The connector exposed index
  names and keys, not uniqueness options.
- No Auth.js backup collections or legacy `verification_tokens` collection.
- No `AUTH_TRUST_HOST` in the production Vercel environment-variable list.

No migration, export, deletion, or environment change was needed or performed.
No database credential was downloaded. This audit confirms the current shape;
it does not reconstruct historical migration counts or establish pre-cutover id
continuity from a backup. The migration's forward/idempotence/revert regression
suite supplies that guarantee. Mobile release validation stays tracked in #193.
