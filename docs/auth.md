# Authentication

## Overview

We use **Auth.js v5** (formerly NextAuth.js) with **JWT sessions** and the **MongoDB adapter**. Two providers are registered side by side in [`src/lib/auth.config.ts`](../src/lib/auth.config.ts) so the mode can switch without a rebuild:

- **Google OAuth** — the real sign-in path, and the default whenever demo mode is not explicitly enabled.
- **Demo Credentials** — private-beta personas (Alex, Sam, Priya), guarded by `AUTH_MODE`.

The active mode resolves through [`src/lib/auth-mode.ts`](../src/lib/auth-mode.ts):

| `AUTH_MODE`                      | `NODE_ENV`       | `ALLOW_DEMO_AUTH` | Effective mode           |
| -------------------------------- | ---------------- | ----------------- | ------------------------ |
| `demo`                           | development/test | —                 | **demo**                 |
| `demo`                           | production       | `true`            | **demo**                 |
| `demo`                           | production       | anything else     | **google** (fail closed) |
| unset / `google` / anything else | any              | any               | **google**               |

Demo sign-in goes through the Credentials `authorize()` in
[`src/lib/demo-credentials.ts`](../src/lib/demo-credentials.ts), which only
returns one of the three allowlisted personas from
[`src/lib/demo-personas.ts`](../src/lib/demo-personas.ts). Sessions are real
Auth.js JWTs, so every API route keeps receiving a real `session.user.id`
ObjectId string — the authorization path is identical in both modes.

In demo mode `/` renders the persona picker; in Google mode it renders the
marketing landing. A **Demo mode** badge shows in the navbar while demo auth
is active. See the README for seeding (`pnpm demo:seed` / `pnpm demo:reset`).

> Middleware note: route protection lives in the `authorized` callback of
> `auth.config.ts` (edge-safe, no Node/Mongo imports); `src/middleware.ts`
> just re-exports it. The examples below show the Google flow and session
> usage.

---

## Google OAuth Flow

```
1. User visits /login
2. Clicks "Sign in with Google"
3. Auth.js redirects to Google OAuth consent screen
4. User authorizes the app
5. Google redirects back with auth code
6. Auth.js exchanges code for tokens
7. Auth.js creates/updates user in MongoDB (via MongoDB adapter)
8. JWT session cookie is set (httpOnly, secure)
9. User is redirected to /dashboard
```

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
3. **Authorized JavaScript origins are not required** — Auth.js uses a
   server-side authorization-code flow, not the Google Sign-In JS SDK. (Adding
   `http://localhost:3000` etc. is harmless but unused.)

4. Add the matching **Authorized redirect URIs** — always
   `<origin>/api/auth/callback/google`:

   | Environment                         | Redirect URI                                     |
   | ----------------------------------- | ------------------------------------------------ |
   | Local dev (default port)            | `http://localhost:3000/api/auth/callback/google` |
   | Local dev (private-beta / e2e port) | `http://localhost:3100/api/auth/callback/google` |
   | Production                          | `https://<your-domain>/api/auth/callback/google` |

   The redirect URI must match **exactly** (scheme, host, port, path) or Google
   shows `redirect_uri_mismatch`. Auth.js always uses
   `/api/auth/callback/google` — it is derived from the route handler in
   `src/app/api/auth/[...nextauth]/route.ts`, not from configuration.

5. Copy the **Client ID** and **Client Secret** into `.env.local` as
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. Never commit these values.

### 2. Auth.js Configuration

File: `src/lib/auth.ts`

```typescript
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import clientPromise from './mongodb-client';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: MongoDBAdapter(clientPromise),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
```

### 3. Route Handler

File: `src/app/api/auth/[...nextauth]/route.ts`

```typescript
import { handlers } from '@/lib/auth';
export const { GET, POST } = handlers;
```

### 4. Middleware (Route Protection)

File: `src/middleware.ts` (delegates to the `authorized` callback in `src/lib/auth.config.ts`)

```typescript
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';

export default NextAuth(authConfig).auth;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
```

---

## Session Access

### In Server Components

```typescript
import { auth } from '@/lib/auth';

export default async function Page() {
  const session = await auth();
  // session.user.id, session.user.name, session.user.email, session.user.image
}
```

### In API Routes

```typescript
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Use session.user.id
}
```

### In Client Components

```typescript
'use client';
import { useSession } from 'next-auth/react';

export function UserMenu() {
  const { data: session, status } = useSession();
  // status: "loading" | "authenticated" | "unauthenticated"
}
```

---

## Auth Guard Helper

File: `src/lib/utils/api-response.ts`

```typescript
import { auth } from '@/lib/auth';

export async function getAuthUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user;
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
```

---

## Environment Variables

```env
AUTH_SECRET=your-random-secret-min-32-chars
AUTH_GOOGLE_ID=your-google-client-id.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=your-google-client-secret
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/splitwise
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Auth mode: google (default when unset) | demo
AUTH_MODE=
# Required to use demo auth when NODE_ENV=production (fail closed otherwise)
ALLOW_DEMO_AUTH=
```

---

## Switching between Google and demo mode

| Goal                   | `.env.local`                | Entry UI                                  |
| ---------------------- | --------------------------- | ----------------------------------------- |
| Real sign-in (default) | `AUTH_MODE=google` or unset | Marketing landing + "Sign in with Google" |
| Private-beta personas  | `AUTH_MODE=demo`            | Persona picker (Alex / Sam / Priya)       |

- Restart the dev server after changing `AUTH_MODE` — it is read server-side.
- Both providers stay registered either way; the mode only chooses which one
  the UI offers. The demo Credentials `authorize()` fails closed whenever demo
  mode is not allowed, so a direct POST to the demo callback in google mode
  just redirects back to `/login` with an error and sets no session.
- Production is fail closed: `AUTH_MODE=demo` is ignored when
  `NODE_ENV=production` unless `ALLOW_DEMO_AUTH=true` is also set.

---

## Verifying Google mode (OAuth smoke test)

No interactive Google login is needed to verify the wiring:

```bash
AUTH_MODE=google pnpm dev   # or: pnpm test:e2e:google for the automated version
```

1. `/` shows the marketing landing with **Sign in with Google** (not the
   persona picker); `/login` shows the Google button.
2. `GET /api/auth/providers` lists `google` with callback URL
   `<origin>/api/auth/callback/google`.
3. Clicking the button (or POSTing `/api/auth/signin/google` with a CSRF
   token) redirects to
   `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=<AUTH_GOOGLE_ID>&redirect_uri=<origin>%2Fapi%2Fauth%2Fcallback%2Fgoogle&scope=openid+profile+email&code_challenge=...&code_challenge_method=S256`.
   Confirm `client_id` and `redirect_uri` match the Google Cloud client.
4. `AUTH_SECRET` must be set — sessions are JWT (`session.strategy: 'jwt'` in
   `auth.config.ts`), so the MongoDB adapter only persists users/accounts
   while session state lives in the httpOnly cookie.

The automated equivalent is `pnpm test:e2e:google`
([`playwright.google.config.ts`](../playwright.google.config.ts) +
[`playwright-google/google-auth.spec.ts`](../playwright-google/google-auth.spec.ts)),
which runs the app in google mode on port 3101, intercepts the
`accounts.google.com` navigation, and asserts the request shape without
completing a real login.

---

## Security Notes

- JWT tokens are stored in httpOnly cookies (not accessible via JS)
- CSRF protection is built into Auth.js
- Google OAuth handles password security — we never store passwords
- All API routes must check session before processing
- MongoDB adapter stores only public Google profile info (name, email, image)
