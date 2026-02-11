# Authentication

## Overview

We use **Auth.js v5** (formerly NextAuth.js) with the **Google OAuth provider** and **MongoDB adapter**. Sessions are managed via **JWT** (no database sessions collection needed).

---

## Flow

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

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID
3. Set authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (dev)
4. Copy Client ID and Client Secret to `.env.local`

### 2. Auth.js Configuration

File: `src/lib/auth.ts`

```typescript
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import clientPromise from "./mongodb-client";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: MongoDBAdapter(clientPromise),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  session: {
    strategy: "jwt",
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
    signIn: "/login",
  },
});
```

### 3. Route Handler

File: `src/app/api/auth/[...nextauth]/route.ts`

```typescript
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

### 4. Middleware (Route Protection)

File: `src/middleware.ts`

```typescript
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isAuthPage = req.nextUrl.pathname.startsWith("/login");
  const isPublicPage = req.nextUrl.pathname === "/" || req.nextUrl.pathname.startsWith("/join");
  const isApiAuth = req.nextUrl.pathname.startsWith("/api/auth");

  // Allow auth API routes
  if (isApiAuth) return NextResponse.next();

  // Redirect logged-in users away from login
  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Allow public pages
  if (isPublicPage || isAuthPage) return NextResponse.next();

  // Protect everything else
  if (!isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

---

## Session Access

### In Server Components

```typescript
import { auth } from "@/lib/auth";

export default async function Page() {
  const session = await auth();
  // session.user.id, session.user.name, session.user.email, session.user.image
}
```

### In API Routes

```typescript
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Use session.user.id
}
```

### In Client Components

```typescript
"use client";
import { useSession } from "next-auth/react";

export function UserMenu() {
  const { data: session, status } = useSession();
  // status: "loading" | "authenticated" | "unauthenticated"
}
```

---

## Auth Guard Helper

File: `src/lib/utils/api-response.ts`

```typescript
import { auth } from "@/lib/auth";

export async function getAuthUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user;
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
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
```

---

## Security Notes

- JWT tokens are stored in httpOnly cookies (not accessible via JS)
- CSRF protection is built into Auth.js
- Google OAuth handles password security — we never store passwords
- All API routes must check session before processing
- MongoDB adapter stores only public Google profile info (name, email, image)

