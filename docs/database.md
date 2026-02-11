# Database Schema

All models use MongoDB via Mongoose. Timestamps (`createdAt`, `updatedAt`) are auto-managed.

---

## User

Managed by Auth.js + extended with app-specific fields.

```typescript
{
  _id: ObjectId,
  name: string,                       // From Google profile
  email: string,                      // Unique, from Google
  image: string,                      // Google avatar URL
  emailVerified: Date | null,         // Auth.js field
  preferredCurrency: string,          // Default: "INR"
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**: `{ email: 1 }` (unique)

**Notes**:
- Auth.js creates `users`, `accounts`, and `sessions` collections automatically.
- We extend the `users` collection with `preferredCurrency`.

---

## Group

```typescript
{
  _id: ObjectId,
  name: string,                       // Required, 1-100 chars
  description: string,                // Optional
  image: string,                      // Optional group image URL
  createdBy: ObjectId (ref User),     // Group creator
  members: [{
    user: ObjectId (ref User),        // Member reference
    role: "admin" | "member",         // Creator is always admin
    joinedAt: Date
  }],
  defaultCurrency: string,            // Required, e.g. "INR"
  alternateCurrencies: [string],      // Max 2 items, e.g. ["USD", "EUR"]
  category: "trip" | "home" | "couple" | "work" | "other",
  isArchived: boolean,                // Default: false
  inviteCode: string | null,          // Unique 8-char code for invite links
  inviteCodeExpiresAt: Date | null,   // Optional expiry
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `{ "members.user": 1 }` — fast lookup of user's groups
- `{ inviteCode: 1 }` — unique sparse (only when set)
- `{ createdBy: 1 }`

**Validation**:
- `name`: required, trimmed, 1-100 chars
- `alternateCurrencies`: max 2 items, each must be valid ISO 4217 code
- `members`: at least 1 member (the creator)

---

## Expense

```typescript
{
  _id: ObjectId,
  group: ObjectId (ref Group),        // Which group this belongs to
  description: string,                // Required, 1-200 chars
  amount: number,                     // Total amount (positive)
  currency: string,                   // ISO 4217 code
  category: string,                   // e.g. "food", "transport", "entertainment"
  date: Date,                         // When expense occurred (not createdAt)

  // Who paid
  paidBy: [{
    user: ObjectId (ref User),
    amount: number                    // How much this person paid
  }],
  // paidBy amounts must sum to `amount`

  // How to split
  splitMethod: "equal" | "unequal" | "percentage" | "shares" | "exact",
  splitBetween: [{
    user: ObjectId (ref User),
    amount: number,                   // Calculated share for this person
    percentage: number,               // Only for percentage split (optional)
    shares: number                    // Only for shares split (optional)
  }],
  // splitBetween amounts must sum to `amount`

  tags: [string],                     // User-defined tags, e.g. ["dinner", "birthday"]
  predefinedItem: string | null,      // From predefined items list

  receiptUrl: string | null,          // Uploaded receipt image URL
  notes: string,                      // Optional notes

  createdBy: ObjectId (ref User),
  isDeleted: boolean,                 // Soft delete, default: false
  deletedAt: Date | null,
  deletedBy: ObjectId (ref User) | null,

  // Audit trail for edits
  editHistory: [{
    editedBy: ObjectId (ref User),
    editedAt: Date,
    changes: object                   // What changed (diff)
  }],

  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `{ group: 1, date: -1 }` — list expenses by date
- `{ group: 1, isDeleted: 1 }` — filter out deleted
- `{ group: 1, tags: 1 }` — filter by tag
- `{ group: 1, category: 1 }` — filter by category
- `{ description: "text" }` — text search for regex-like queries

**Validation**:
- `amount`: positive number
- `paidBy`: at least 1 entry, amounts sum to `amount`
- `splitBetween`: at least 1 entry, amounts sum to `amount`
- All users in `paidBy` and `splitBetween` must be group members

---

## Settlement

```typescript
{
  _id: ObjectId,
  group: ObjectId (ref Group),
  paidBy: ObjectId (ref User),        // Person who paid to settle
  paidTo: ObjectId (ref User),        // Person who received the payment
  amount: number,                     // Settlement amount (positive)
  currency: string,
  note: string,                       // Optional note, e.g. "Paid via UPI"
  createdBy: ObjectId (ref User),     // Who recorded this settlement
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `{ group: 1, createdAt: -1 }`
- `{ group: 1, paidBy: 1 }`
- `{ group: 1, paidTo: 1 }`

---

## Activity

```typescript
{
  _id: ObjectId,
  group: ObjectId (ref Group),
  type: "expense_added" | "expense_updated" | "expense_deleted"
      | "settlement_recorded"
      | "member_joined" | "member_left"
      | "group_created" | "group_updated",
  actor: ObjectId (ref User),         // Who performed the action
  metadata: {
    // Flexible based on type:
    // expense_added:    { expenseId, description, amount, currency }
    // expense_updated:  { expenseId, changes: { field: { old, new } } }
    // expense_deleted:  { expenseId, description }
    // settlement:       { settlementId, paidTo, amount, currency }
    // member_joined:    { userId, userName, method: "invite" | "link" }
    // member_left:      { userId, userName }
    // group_created:    { groupName }
    // group_updated:    { changes: { field: { old, new } } }
  },
  createdAt: Date
}
```

**Indexes**:
- `{ group: 1, createdAt: -1 }` — paginated activity feed

**Notes**:
- Activity records are append-only, never updated or deleted.
- Used for the group activity feed and audit trail.

---

## Invitation

```typescript
{
  _id: ObjectId,
  group: ObjectId (ref Group),
  invitedBy: ObjectId (ref User),
  invitedEmail: string,               // Email of invited person
  status: "pending" | "accepted" | "declined" | "expired",
  token: string,                      // Unique token for accept/decline URL
  expiresAt: Date,                    // Invitation expiry (e.g. 7 days)
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `{ token: 1 }` (unique)
- `{ invitedEmail: 1, group: 1 }` — prevent duplicate invites
- `{ status: 1, expiresAt: 1 }` — cleanup expired invitations

---

## Relationships Diagram

```
User ──────── creates ──────── Group
  │                              │
  │ (member of)                  │ (has many)
  │                              │
  ├──── Expense ◄────────────────┤
  │     (paidBy, splitBetween)   │
  │                              │
  ├──── Settlement ◄─────────────┤
  │     (paidBy, paidTo)         │
  │                              │
  ├──── Activity ◄───────────────┤
  │     (actor)                  │
  │                              │
  └──── Invitation ◄─────────────┘
        (invitedBy, invitedEmail)
```

---

## Auth.js Collections (Auto-managed)

Auth.js with the MongoDB adapter automatically creates and manages:

- **users** — User records (we extend this with `preferredCurrency`)
- **accounts** — OAuth provider accounts linked to users
- **sessions** — Active sessions (if using database sessions)
- **verification_tokens** — Email verification tokens (not used with Google-only)

We use JWT strategy for sessions (no `sessions` collection needed).

