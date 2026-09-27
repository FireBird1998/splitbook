# Authentication

## Overview

We use **Better Auth** (1.7) with **database sessions** stored in MongoDB
through its MongoDB adapter. One instance, built in
[`src/lib/auth/create-auth.ts`](../apps/web/src/lib/auth/create-auth.ts) and
exported from [`src/lib/auth.ts`](../apps/web/src/lib/auth.ts), serves two
sign-in paths:

- **Google OAuth** — the real sign-in path, restricted by the
  `AUTH_ALLOWED_EMAILS` private-beta allowlist through Better Auth's
  `user.validateUserInfo` gate.
- **Demo personas** — private-beta personas (Alex, Sam, Priya) through a
  custom plugin endpoint, registered only while demo auth is allowed by
  `AUTH_MODE`.

The active mode resolves through [`src/lib/auth-mode.ts`](../apps/web/src/lib/auth-mode.ts):

| `AUTH_MODE`                      | `NODE_ENV`       | `ALLOW_DEMO_AUTH` | Effective mode           |
| -------------------------------- | ---------------- | ----------------- | ------------------------ |
| `demo`                           | development/test | —                 | **demo**                 |
| `demo`                           | production       | `true`            | **demo**                 |
| `demo`                           | production       | anything else     | **google** (fail closed) |
| unset / `google` / anything else | any              | any               | **google**               |

In demo mode `/` renders the persona picker; in Google mode it renders the
marketing landing. A **Demo mode** badge shows in the navbar while demo auth
is active. See the README for seeding (`pnpm web demo:seed` / `pnpm web demo:reset`).

Both modes produce the same session: a `sessions` row referencing the user,
exposed to the app as `user.id` — the 24-hex string of the stored `ObjectId`,
which is what every service treats as the actor. The persona ids are fixed
(`a0000000000000000000000{1,2,3}`), so demo sessions carry real ids too.

> **Why Better Auth.** [ADR 0003](adr/0003-better-auth.md). The migration from
> Auth.js is specified in
> [`superpowers/specs/2026-09-08-better-auth-migration.md`](superpowers/specs/2026-09-08-better-auth-migration.md).

---

## Google OAuth Flow

```
1. User visits /login (or the landing page)
2. Clicks "Sign in with Google" → authClient.signIn.social({ provider: 'google', callbackURL })
3. Better Auth stores the OAuth state and redirects to Google's consent screen
   (prompt=select_account, scope openid profile email, PKCE S256)
4. User authorizes
5. Google redirects back to /api/auth/callback/google with an auth code
6. Better Auth exchanges the code for tokens and reads the Google profile
7. validateUserInfo normalises the email and checks AUTH_ALLOWED_EMAILS
8. Better Auth creates the user (first visit) or links the Google account to the
   existing user with that email, then creates a session row
9. Session cookie set (httpOnly, secure in production) plus a signed cookie cache
10. Redirect to callbackURL (default /dashboard); denied identities return to
    /login?error=email_not_allowed
```

### Native clients (mobile readiness)

The same instance accepts a Google **ID token** obtained from the device's
native sign-in: `POST /api/auth/sign-in/social` with
`{ provider: 'google', idToken: { token } }` verifies the token against
Google's keys and the configured client id(s), runs the same allowlist gate,
and answers with the session. Ticket #36 turns `clientId` into the array of
web, iOS and Android ids and adds the Expo client wiring.

---

## Setup

### 1. Google Cloud Console

You need a Google Cloud project with an OAuth 2.0 web client. No Google Workspace
or paid APIs are required.

**a. Configure the OAuth consent screen** (once per project)

1. Go to https://console.cloud.google.com/apis/credentials and pick (or create) a project.
2. Open **OAuth consent screen** in the left nav.
3. Choose **External** user type and click **Create**.
4. Fill in the app name, user support email, and developer contact email.
   No scopes beyond the defaults are needed — the app requests only
   `openid profile email`.
5. While the consent screen is in **Testing** publishing status, add each
   tester's Google account under **Test users**. Only listed test users can
   sign in. (Publishing to "In production" requires Google's verification and
   is not needed for the private beta.)

**b. Create the OAuth client**

1. Go to **Credentials** → **Create Credentials** → **OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins are not required** — Better Auth uses a
   server-side authorization-code flow, not the Google Sign-In JS SDK.

4. Add the matching **Authorized redirect URIs** — always
   `<origin>/api/auth/callback/google`:

   | Environment | Redirect URI                                     |
   | ----------- | ------------------------------------------------ |
   | Local dev   | `http://localhost:4127/api/auth/callback/google` |
   | Production  | `https://<your-domain>/api/auth/callback/google` |

   The automated Google-mode browser suite never contacts Google and needs
   no Console entry.

   The redirect URI must match **exactly** (scheme, host, port, path) or Google
   shows `redirect_uri_mismatch`. Better Auth derives it from `baseURL`
   (`NEXT_PUBLIC_APP_URL`) plus `/api/auth/callback/google`.

5. Copy the **Client ID** and **Client Secret** into `apps/web/.env.local` as
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. Never commit these values.

### 2. Configuration

Everything lives in [`src/lib/auth/create-auth.ts`](../apps/web/src/lib/auth/create-auth.ts),
which returns the options so tests can build the same instance on Better
Auth's memory adapter:

```typescript
export function buildAuthOptions({ database, env = process.env }) {
  return {
    baseURL: env.NEXT_PUBLIC_APP_URL,
    secret: env.AUTH_SECRET,
    database,
    trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
    session: {
      expiresIn: 30 days, updateAge: 1 day,
      cookieCache: { enabled: true, maxAge: 5 minutes },
    },
    rateLimit: { storage: 'database' },          // on in production by default
    account: { accountLinking: { trustedProviders: ['google'] } },
    socialProviders: {
      google: { clientId, clientSecret, prompt: 'select_account' /* + test verifier */ },
    },
    user: {
      validateUserInfo: (data) => validateAllowedUser(data, env),   // the allowlist
      additionalFields: { preferredCurrency: { type: 'string', defaultValue: 'INR', input: false } },
    },
    plugins: [...(demo allowed ? [demoPersona()] : []), nextCookies()],
  };
}
```

[`src/lib/auth.ts`](../apps/web/src/lib/auth.ts) adds the database and nothing else:

```typescript
export const auth = createSplitbookAuth({
  database: mongodbAdapter(getAuthDb(), { usePlural: true, transaction: false }),
});
```

- **Collections.** `usePlural` keeps the application's `users` collection as the
  user model; `sessions`, `accounts`, `verifications` and `rateLimits` are Better
  Auth's own. Ids are ObjectIds through the adapter default (no custom id
  generator — that would store plain strings). `transaction: false` because
  local and CI run a standalone `mongod`.
- **Sessions.** Database-backed, 30 days, refreshed after a day of use. The
  cookie cache lets `getSession` answer from a signed cookie for up to five
  minutes before re-reading the database, so a revoked session can stay valid
  on another device for at most five minutes (decision Q21).
- **Allowlist.** [`src/lib/auth/allowlist.ts`](../apps/web/src/lib/auth/allowlist.ts).
  Better Auth calls the gate before it creates a user, links an account and on
  every OAuth sign-in of an existing user, so removing an address from
  `AUTH_ALLOWED_EMAILS` locks that person out at their next Google sign-in.
  Matching is trimmed and case-insensitive; an empty or missing list denies
  everyone. Rejections carry the code `email_not_allowed`.
- **Account linking.** A Google login for an email that already belongs to a
  user links to that user (keeping the id) when the user row is verified.
  Better Auth refuses to link into an unverified row (a takeover guard), which
  is why the migration marks users with an Auth.js Google account as verified.
- **Secret and base URL.** `AUTH_SECRET` is Better Auth's documented fallback
  variable, so the existing secret stays. `baseURL` and the trusted origin come
  from `NEXT_PUBLIC_APP_URL`.
- **`preferredCurrency`** is declared as an additional user field so users
  Better Auth creates get the same default the Mongoose model applies.

### 3. Route Handler

File: `src/app/api/auth/[...all]/route.ts`

```typescript
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

export const { GET, POST } = toNextJsHandler(auth);
```

Every Better Auth route lives under `/api/auth/*`: `sign-in/social`,
`callback/google`, `get-session`, `sign-out`, and in demo mode
`demo-persona/sign-in`.

### 4. Proxy (Route Protection)

File: `src/proxy.ts` (Next.js 16's name for middleware). It delegates to the
pure decision table in
[`src/lib/auth/proxy-rules.ts`](../apps/web/src/lib/auth/proxy-rules.ts):

```typescript
export default function proxy(request: NextRequest) {
  return resolveProxyResponse({
    url: request.url,
    pathname: request.nextUrl.pathname,
    method: request.method,
    hasSessionCookie: getSessionCookie(request) !== null,
  });
}
```

The rules, in order:

| Rule | Path                   | Anonymous                                    | With session cookie |
| ---- | ---------------------- | -------------------------------------------- | ------------------- |
| 1    | `/api/auth/*`          | allowed                                      | allowed             |
| 2    | `GET /api/join/[code]` | allowed (invite preview)                     | allowed             |
| 3    | `/login*`              | allowed                                      | allowed             |
| 4    | `/`, `/join*`          | allowed                                      | allowed             |
| 5    | other `/api/*`         | `401 { error: 'Unauthorized', status: 401 }` | allowed             |
| 6    | everything else        | → `/login?callbackUrl=<pathname>`            | allowed             |

The matcher excludes Next internals, static files and the design-system lab
URL, so it runs on every page **and** every `/api/*` route.

The `/login` server page calls `getAuthUser()` and redirects to `/dashboard`
only for a valid session. Invalid or expired cookies leave the login page
accessible, avoiding a redirect loop with the authenticated layout.

> **The proxy is optimistic.** `getSessionCookie` only proves a session cookie
> exists; it never touches the database. An expired or revoked session passes
> the proxy and is rejected where validation lives: `getAuthUser()` answers
> 401 for API routes, and the authenticated layout redirects to `/login` for
> pages. `/` is matched exactly; `/login` and `/join` use `startsWith`, so paths
> _beginning_ with either of those two strings pass the proxy.

---

## Session Access

### In Server Components and API Routes

Both use the same helper, which validates the session (database or cookie
cache) and returns `{ id, name, email, image }` or `null`:

```typescript
import { getAuthUser, unauthorized } from '@/lib/utils/api-response';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  // Use user.id
}
```

```typescript
export default async function Page() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
}
```

Authentication is only the first gate. Most routes then check group membership
via `groupService.isMember`, and admin-only routes check role inside the service.
See the permission matrix in [`features/groups.md`](features/groups.md).

### In Client Components

```typescript
'use client';
import { authClient, signInWithGoogle, signOutToHome } from '@/lib/auth-client';

export function UserMenu() {
  const { data: session, isPending } = authClient.useSession();
  // session?.user.{id,name,email,image}
}
```

`signInWithGoogle(callbackURL)` starts the redirect flow with
`errorCallbackURL: '/login'`; `signOutToHome()` revokes the session and reloads
at `/`. The Navbar receives the user from the server layout rather than the
hook.

`callbackUrl` values from the query string pass through
[`resolveCallbackUrl`](../apps/web/src/lib/auth/callback-url.ts), which only
honours same-origin paths.

---

## Demo mode

[`src/lib/auth/demo-persona-plugin.ts`](../apps/web/src/lib/auth/demo-persona-plugin.ts)
adds `POST /api/auth/demo-persona/sign-in` with body `{ personaId }` — a
persona key (`alex`, `sam`, `priya`) or its fixed ObjectId, normalised by
`getDemoPersona`. The handler finds the seeded user by id, creates a session
and sets the cookie; unknown or unseeded personas answer 404. The client
plugin types it as `authClient.demoPersona.signIn({ personaId })`, which the
persona picker calls before navigating to the validated `callbackUrl`.

Fail closed, twice: the plugin is registered only while `isDemoAuthAllowed()`
holds, so outside demo mode the route **does not exist** (404), and the handler
re-reads the environment on every call. Persona sign-ins never provision users,
so the Google allowlist is not involved. The endpoint is rate limited to ten
entries per minute per client.

---

## Auth Guard Helper

File: `src/lib/utils/api-response.ts`

```typescript
export async function getAuthUser(): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;
  const { id, name, email, image } = session.user;
  return { id, name, email, image: image ?? null };
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized', status: 401 }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden', status: 403 }, { status: 403 });
}
```

---

## Environment Variables

```env
AUTH_SECRET=your-random-secret-min-32-chars
AUTH_GOOGLE_ID=your-google-client-id.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=your-google-client-secret
# Comma-separated invited Google addresses; missing/empty denies every Google login
AUTH_ALLOWED_EMAILS=owner@example.com,tester@example.com
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/splitbook
NEXT_PUBLIC_APP_URL=http://localhost:4127

# Auth mode: google (default when unset) | demo
AUTH_MODE=
# Required to use demo auth when NODE_ENV=production (fail closed otherwise)
ALLOW_DEMO_AUTH=

# Test-only (never on a real deployment): locally signed Google ID tokens for
# the browser suite; refused under NODE_ENV=production unless ALLOW_TEST_ID_TOKEN=true
AUTH_TEST_ID_TOKEN_SECRET=
ALLOW_TEST_ID_TOKEN=
# Optional override of the rate-limit default (on in production only)
AUTH_RATE_LIMIT_ENABLED=
```

The variable names did not change in the migration, so a deployment that
worked with Auth.js needs no new secrets. `AUTH_TRUST_HOST` and
`AUTH_GOOGLE_ISSUER` are no longer read.

---

## Switching between Google and demo mode

| Goal                   | `apps/web/.env.local`       | Entry UI                                  |
| ---------------------- | --------------------------- | ----------------------------------------- |
| Real sign-in (default) | `AUTH_MODE=google` or unset | Marketing landing + "Sign in with Google" |
| Private-beta personas  | `AUTH_MODE=demo`            | Persona picker (Alex / Sam / Priya)       |

- Restart the dev server after changing `AUTH_MODE` — it is read when the
  auth instance is built.
- Google stays configured either way; the mode only decides whether the
  persona endpoint exists and which entry the UI offers.
- Production is fail closed: `AUTH_MODE=demo` is ignored when
  `NODE_ENV=production` unless `ALLOW_DEMO_AUTH=true` is also set.
- Google sign-in is also fail closed: matching is trimmed and case-insensitive,
  and a missing or empty `AUTH_ALLOWED_EMAILS` denies every Google identity.

---

## Migrating a database from Auth.js

Run once per database after deploying this version (also on local
development databases created before it):

```bash
pnpm web migrate:auth --dry-run   # report the plan
pnpm web migrate:auth             # apply
pnpm web migrate:auth --revert    # rollback path
```

The script ([`scripts/migrate-auth.ts`](../apps/web/scripts/migrate-auth.ts) over
[`src/lib/auth/migrate-auth.ts`](../apps/web/src/lib/auth/migrate-auth.ts)) is
idempotent and refuses `splitbook-test-*` databases. It converts
`users.emailVerified` to a boolean (true for a stored Date or for users with an
Auth.js Google account row), ensures `createdAt`/`updatedAt`, renames the
Auth.js `accounts` collection to `accounts_authjs_backup`, and moves the unique
`users.email` index to the name Better Auth's adapter expects
(`users_email_uidx`). Ids never change. Google logins re-link to the same user
on their first sign-in after cutover; everyone signs in once more because the
cookie names changed. See the spec for the cutover checklist.

---

## Verifying Google mode

No interactive Google login is needed to verify the wiring:

```bash
AUTH_MODE=google pnpm dev   # or: pnpm web test:e2e:google for the automated version
```

1. `/` shows the marketing landing with **Sign in with Google** (not the
   persona picker); `/login` shows the Google button.
2. Clicking the button redirects to
   `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=<AUTH_GOOGLE_ID>&redirect_uri=<origin>%2Fapi%2Fauth%2Fcallback%2Fgoogle&scope=…openid…&code_challenge=…&code_challenge_method=S256&prompt=select_account`.
   Confirm `client_id` and `redirect_uri` match the Google Cloud client.
3. `AUTH_SECRET` must be set — it signs the session cookie and the cookie cache.

The automated equivalent is `pnpm web test:e2e:google`
([`playwright.google.config.ts`](../apps/web/playwright.google.config.ts) +
[`playwright-google/google-auth.spec.ts`](../apps/web/playwright-google/google-auth.spec.ts)),
which runs the app in Google mode on port 3101. It intercepts the redirect to
Google and asserts its parameters, then proves the approved and denied
outcomes through the ID-token sign-in endpoint with tokens it signs locally
under `AUTH_TEST_ID_TOKEN_SECRET`
([`src/lib/auth/test-id-token.ts`](../apps/web/src/lib/auth/test-id-token.ts)).
When that variable is set, the Google provider's `verifyIdToken` is replaced
by the test verifier; the code refuses the override under
`NODE_ENV=production` unless `ALLOW_TEST_ID_TOKEN=true` is also set (CI runs
the suite against a production build). Neither variable belongs on a real
deployment.

---

## Security Notes

- Session tokens live in httpOnly cookies; the cookie cache is signed with
  `AUTH_SECRET`.
- Better Auth validates the `Origin` of cookie-bearing POSTs against
  `trustedOrigins` (the app URL) and checks `callbackURL` values, so a
  cross-site page cannot start a sign-in for a victim.
- Google OAuth handles password security — we never store passwords.
- The allowlist runs on every Google sign-in, not only at first registration.
- All API routes must check the session before processing; the proxy alone
  only proves a cookie exists.
- The `users` collection stores only public Google profile info (name, email,
  image) plus app fields; `accounts` stores the Google subject and tokens.
