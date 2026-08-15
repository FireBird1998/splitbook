# Page: Login

**Route**: `/login`
**Auth**: Public (redirect to `/dashboard` if logged in)

---

## Purpose

Dedicated login page for users who need to authenticate.

Which control renders depends on `AUTH_MODE` (see [`../auth.md`](../auth.md)):

- **`google`** (default) — a "Sign in with Google" button (`LoginForm`)
- **`demo`** (private beta) — a persona picker for Alex, Sam and Priya
  (`DemoLoginClient`). Demo auth fails closed in production unless
  `ALLOW_DEMO_AUTH=true`.

Both providers are registered at all times, so switching modes needs only an env
change and a restart.

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
import { Box, Typography, Button } from "@mui/material";

export default function LoginPage() {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
      <Box sx={{ textAlign: "center" }}>
        <Typography variant="h4">SplitWise</Typography>
        <Typography sx={{ mt: 1, color: "text.secondary" }}>Welcome back! Sign in to continue.</Typography>
        <Button variant="contained" sx={{ mt: 3 }} onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
          Sign in with Google
        </Button>
      </Box>
    </Box>
  );
}
```

---

## Components Used

- MUI Button (Google-branded styling)
- Centered card layout (MUI Box + sx)
