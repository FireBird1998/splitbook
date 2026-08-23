# Feature: Invitations

## Overview

Users can be invited to groups via two methods:

1. **Email invitation** — Direct invite to a specific email address
2. **Invite link** — Shareable link anyone with the link can use to join

---

## Method 1: Email Invitation

### Flow

```
1. Group member clicks "Invite" button
2. Dialog opens → enters friend's email
3. API creates Invitation record with unique token
4. (Future: email sent with accept/decline links)
5. If invitee already has an account → shows in their "Pending Invitations"
6. If invitee doesn't have an account → they see it after signing up with that email
7. Invitee accepts → added as group member, activity logged
8. Invitee declines → invitation marked as declined
9. Invitation expires after 7 days if no action
```

### UI: Invite Dialog

```
┌──────────────────────────────────┐
│ Invite to "Europe Trip 2026"     │
│                                  │
│ Email: [friend@gmail.com    ]    │
│                                  │
│ [Cancel]            [Send Invite]│
│                                  │
│ ── OR ──                         │
│                                  │
│ Share invite link:               │
│ [https://app.com/join/abc12] [📋]│
│ Expires in 7 days                │
│ [Regenerate Link]                │
└──────────────────────────────────┘
```

### Pending Invitations (for invitee)

Shown in the navbar as a badge/bell icon, or on the dashboard.

```
┌──────────────────────────────────────────────┐
│ 📩 You've been invited to "Europe Trip 2026" │
│ Invited by John Doe                          │
│ [Accept]  [Decline]                          │
└──────────────────────────────────────────────┘
```

---

## Method 2: Invite Link

### Flow

```
1. Group admin/member clicks "Get Invite Link" in invite dialog
2. API generates unique 8-character invite code
3. Full URL: https://app.com/join/{code}
4. User copies link and shares via WhatsApp, Telegram, etc.
5. Recipient opens link:
   a. If logged in → shown group info + "Join" button
   b. If not logged in → redirected to login, then back to join page
6. Clicks "Join" → added as member, activity logged
7. Link can be regenerated (invalidates old one)
8. Link can have optional expiry (default: 7 days, or no expiry)
```

### Join Page (`/join/[code]`)

```
┌──────────────────────────────────┐
│           Splitbook              │
│                                  │
│ You've been invited to join:     │
│                                  │
│ 🏠 "Europe Trip 2026"           │
│ 3 members · Trip                 │
│                                  │
│ [Join Group]                     │
│                                  │
│ Already a member? Go to group →  │
└──────────────────────────────────┘
```

---

## Validation Rules

Enforced:

- Email must be a valid email format (Zod)
- Invite link must resolve to a group and not be expired
- Accept/decline requires the invitation's email to match the caller's — a
  mismatch returns **404** (not 403), deliberately, to resist enumeration
- Joining a group you are already in is a no-op that returns "Already a member"

**Not implemented** — described in earlier drafts, no code behind them:

- Blocking an invite to someone already in the group
- Blocking a duplicate pending invitation (the
  `{ invitedEmail, group }` index is not unique)
- Blocking joins to an archived group
- A cap on pending invitations per group

## Known gaps

- **`Invitation.token` is generated but never read.** It is a unique-indexed
  32-hex-char secret, yet no route accepts it; accept and decline are keyed on
  the invitation `_id` plus the email match.
- **Invite codes are 8 hex characters (32 bits)** and any member — not only an
  admin — can mint one. `expiresInDays` is taken from the request body with no
  validation or cap.
- `GET /api/join/[code]` is **public** and returns group name, category and
  member count to anyone with a code.
- No email is ever sent. An invitation is a database record the invitee sees on
  their dashboard.

---

## API Endpoints

See [api.md](../api.md#invitations) for full endpoint documentation.

---

## Edge Cases

- Invitee signs up with different email → cannot see email invitation (they can still use invite link)
- Multiple invites to same email → reject with "Already invited"
- Invite link shared publicly → anyone with Google account can join (by design — admin can remove)
- Expired invitation → show "This invitation has expired" message
- Already a member clicking join link → redirect to group page with info message
