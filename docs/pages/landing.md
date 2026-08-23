# Page: Landing Page

**Route**: `/`
**Auth**: Public (redirect to `/dashboard` if logged in)

---

## Purpose

The first page visitors see. Communicates the app's value proposition and has a clear CTA to sign in with Google.

---

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  💰 Splitbook                          [Sign In] button  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│              Split expenses with friends,                │
│              the smart way.                              │
│                                                          │
│  Track group expenses, settle debts with minimal         │
│  transactions, and never argue about money again.        │
│                                                          │
│           [🔵 Sign in with Google]                       │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ── Features ──                                          │
│                                                          │
│  🏠 Groups          💸 Smart Split     💰 Settle Up     │
│  Create groups for  Equal, percentage, Minimize          │
│  trips, home, work  shares, and more   transactions      │
│                                                          │
│  📊 Dashboard       🔄 Real-time       💱 Multi-Currency │
│  Filter & search    Instant sync       Default + 2 alt   │
│  all expenses       across devices     currencies/group   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Built with ❤️ · Open Source                             │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Behavior

- If user is already logged in → redirect to `/dashboard`
- "Sign In" button triggers Auth.js Google OAuth flow
- Page should be fast (no data fetching)
- Simple, clean, modern design
- Responsive: stacks features vertically on mobile

---

## Components Used

- Custom hero section (MUI Box + Typography)
- Feature cards (MUI Box grid via sx)
- MUI Button for CTA
