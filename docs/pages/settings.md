# Page: User Settings

**Route**: `/settings`
**Auth**: Required

---

## Purpose

Allow users to update their profile preferences.

---

## Layout

```
┌──────────────────────────────────────────────────────┐
│ Sidebar │  Settings                                   │
│         │                                             │
│         │  ── Profile ──                              │
│         │  ┌─────────────────────────────────────┐   │
│         │  │ 📷 Avatar (from Google, read-only)  │   │
│         │  │                                     │   │
│         │  │ Name:     [John Doe            ]    │   │
│         │  │ Email:    john@gmail.com (read-only) │   │
│         │  │                                     │   │
│         │  │ Preferred Currency: [🇮🇳 INR ▾]     │   │
│         │  │                                     │   │
│         │  │             [Save Changes]          │   │
│         │  └─────────────────────────────────────┘   │
│         │                                             │
│         │  ── Account ──                              │
│         │  ┌─────────────────────────────────────┐   │
│         │  │ Connected with Google                │   │
│         │  │ john@gmail.com ✓                    │   │
│         │  │                                     │   │
│         │  │ [Sign Out]                          │   │
│         │  └─────────────────────────────────────┘   │
│         │                                             │
└─────────┴─────────────────────────────────────────────┘
```

---

## Fields

| Field              | Editable | Type     | Notes                           |
| ------------------ | -------- | -------- | ------------------------------- |
| Avatar             | No       | Image    | Pulled from Google profile      |
| Name               | Yes      | Text     | 1-100 chars                     |
| Email              | No       | Text     | From Google, can't be changed   |
| Preferred Currency | Yes      | Select   | Used as default for new groups  |

---

## Behavior

- On load: Fetch current profile from `/api/user/profile`
- On save: PATCH `/api/user/profile` with updated fields
- Show success toast: "Settings saved!"
- Show error toast if update fails
- "Sign Out" button triggers `signOut()` from Auth.js → redirects to landing page

---

## Components Used

- MUI `TextField` for name
- MUI `Avatar` for profile picture
- `CurrencySelect` for preferred currency
- MUI `Button` for save and sign out
- MUI `Snackbar` for success/error feedback

