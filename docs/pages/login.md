# Page: Login

**Route**: `/login`
**Auth**: Public (redirect to `/dashboard` if logged in)

---

## Purpose

Dedicated login page for users who need to authenticate. Single option: Google OAuth.

---

## Layout

```
┌──────────────────────────────────────────┐
│                                          │
│              💰 SplitWise                │
│                                          │
│         Welcome back!                    │
│         Sign in to continue.             │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  🔵 Sign in with Google           │  │
│  └────────────────────────────────────┘  │
│                                          │
│  By signing in, you agree to our         │
│  Terms of Service and Privacy Policy.    │
│                                          │
└──────────────────────────────────────────┘
```

---

## Behavior

- If already logged in → redirect to `/dashboard`
- If user came from a protected page → redirect back after login (callbackUrl)
- If user came from an invite link → redirect to join page after login
- Google sign-in button triggers `signIn("google")` from Auth.js
- Show loading state while auth is processing
- Show error state if auth fails (e.g. "Something went wrong. Please try again.")

---

## Implementation Notes

```typescript
"use client";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-6">
        <h1>SplitWise</h1>
        <p>Welcome back! Sign in to continue.</p>
        <Button onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
          Sign in with Google
        </Button>
      </div>
    </div>
  );
}
```

---

## Components Used

- MUI Button (Google-branded styling)
- Centered card layout (Tailwind)

