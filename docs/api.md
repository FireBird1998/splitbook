# API Endpoints

All endpoints return JSON. Auth required unless marked 🔓 (public).

Standard response format:
```json
// Success
{ "data": { ... }, "status": 200 }

// Error
{ "error": "Human-readable message", "status": 400 }
```

---

## Auth

Handled entirely by Auth.js. No custom endpoints needed.

| Method | Path                        | Description        | Auth |
| ------ | --------------------------- | ------------------ | ---- |
| *      | `/api/auth/[...nextauth]`   | Auth.js catch-all  | 🔓   |

---

## User Profile

| Method | Path                | Description            |
| ------ | ------------------- | ---------------------- |
| GET    | `/api/user/profile` | Get current user       |
| PATCH  | `/api/user/profile` | Update profile         |

### GET /api/user/profile

**Response:**
```json
{
  "data": {
    "_id": "...",
    "name": "John Doe",
    "email": "john@gmail.com",
    "image": "https://...",
    "preferredCurrency": "INR"
  }
}
```

### PATCH /api/user/profile

**Body:**
```json
{
  "name": "John Doe",
  "preferredCurrency": "USD"
}
```

---

## Groups

| Method | Path                               | Description                  |
| ------ | ---------------------------------- | ---------------------------- |
| POST   | `/api/groups`                      | Create group                 |
| GET    | `/api/groups`                      | List user's groups           |
| GET    | `/api/groups/[id]`                 | Get group detail             |
| PATCH  | `/api/groups/[id]`                 | Update group                 |
| DELETE | `/api/groups/[id]`                 | Archive group (soft delete)  |

### POST /api/groups

**Body:**
```json
{
  "name": "Europe Trip 2026",
  "description": "Summer vacation expenses",
  "category": "trip",
  "defaultCurrency": "EUR",
  "alternateCurrencies": ["USD", "INR"]
}
```

### GET /api/groups

**Query params:** `?archived=false`

**Response:**
```json
{
  "data": [
    {
      "_id": "...",
      "name": "Europe Trip 2026",
      "members": [{ "user": { "_id": "...", "name": "John", "image": "..." }, "role": "admin" }],
      "defaultCurrency": "EUR",
      "category": "trip",
      "isArchived": false,
      "totalBalance": 150.00
    }
  ]
}
```

### PATCH /api/groups/[id]

**Body (partial update):**
```json
{
  "name": "New Group Name",
  "defaultCurrency": "USD",
  "alternateCurrencies": ["EUR"]
}
```

**Authorization:** Only group admins can update.

---

## Invitations

| Method | Path                                     | Description              |
| ------ | ---------------------------------------- | ------------------------ |
| POST   | `/api/groups/[id]/invite`                | Send email invitation    |
| POST   | `/api/groups/[id]/invite-link`           | Generate/refresh link    |
| GET    | `/api/groups/[id]/invite-link`           | Get current invite link  |
| GET    | `/api/invitations`                       | My pending invitations   |
| POST   | `/api/invitations/[id]`                  | Accept or decline        |
| POST   | `/api/join/[code]`                       | Join group via link      |

### POST /api/groups/[id]/invite

**Body:**
```json
{
  "email": "friend@gmail.com"
}
```

**Response:**
```json
{
  "data": {
    "_id": "...",
    "invitedEmail": "friend@gmail.com",
    "status": "pending",
    "expiresAt": "2026-02-18T00:00:00Z"
  }
}
```

### POST /api/groups/[id]/invite-link

**Body:**
```json
{
  "expiresInDays": 7
}
```

**Response:**
```json
{
  "data": {
    "inviteCode": "abc12345",
    "inviteUrl": "https://app.com/join/abc12345",
    "expiresAt": "2026-02-18T00:00:00Z"
  }
}
```

### POST /api/invitations/[id]

**Body:**
```json
{
  "action": "accept"   // or "decline"
}
```

### POST /api/join/[code]

No body needed. Adds current user to the group.

---

## Expenses

| Method | Path                                             | Description           |
| ------ | ------------------------------------------------ | --------------------- |
| POST   | `/api/groups/[id]/expenses`                      | Add expense           |
| GET    | `/api/groups/[id]/expenses`                      | List (with filters)   |
| GET    | `/api/groups/[id]/expenses/[expenseId]`          | Get single expense    |
| PATCH  | `/api/groups/[id]/expenses/[expenseId]`          | Update expense        |
| DELETE | `/api/groups/[id]/expenses/[expenseId]`          | Soft delete           |

### POST /api/groups/[id]/expenses

**Body:**
```json
{
  "description": "Dinner at restaurant",
  "amount": 120.00,
  "currency": "EUR",
  "category": "food",
  "date": "2026-02-10",
  "paidBy": [
    { "user": "userId1", "amount": 120.00 }
  ],
  "splitMethod": "equal",
  "splitBetween": [
    { "user": "userId1" },
    { "user": "userId2" },
    { "user": "userId3" }
  ],
  "tags": ["dinner", "birthday"],
  "predefinedItem": null,
  "notes": "John's birthday dinner"
}
```

**Notes on split calculation:**
- `equal`: Server calculates equal amounts. Client just sends user IDs.
- `unequal` / `exact`: Client sends `amount` for each user.
- `percentage`: Client sends `percentage` for each user (must sum to 100).
- `shares`: Client sends `shares` for each user. Server calculates proportional amounts.

### GET /api/groups/[id]/expenses

**Query params:**
```
?page=1
&limit=20
&dateFrom=2026-01-01
&dateTo=2026-01-31
&tags=dinner,birthday          // comma-separated
&category=food
&search=restaurant             // regex search on description
&quickFilter=thisWeek          // thisWeek, lastWeek, thisMonth, lastMonth, last30Days
&sortBy=date                   // date, amount
&sortOrder=desc                // asc, desc
```

**Response:**
```json
{
  "data": {
    "expenses": [ ... ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

---

## Settlements

| Method | Path                                  | Description             |
| ------ | ------------------------------------- | ----------------------- |
| POST   | `/api/groups/[id]/settlements`        | Record settlement       |
| GET    | `/api/groups/[id]/settlements`        | List settlements        |

### POST /api/groups/[id]/settlements

**Body:**
```json
{
  "paidTo": "userId2",
  "amount": 50.00,
  "currency": "EUR",
  "note": "Paid via UPI"
}
```

---

## Balances

| Method | Path                                  | Description                      |
| ------ | ------------------------------------- | -------------------------------- |
| GET    | `/api/groups/[id]/balances`           | Group balance summary            |
| GET    | `/api/groups/[id]/balances/simplified`| Simplified debts (min transfers) |
| GET    | `/api/user/balances`                  | User's balances across groups    |

### GET /api/groups/[id]/balances

**Response:**
```json
{
  "data": {
    "balances": [
      { "user": { "_id": "...", "name": "John" }, "balance": -30.00 },
      { "user": { "_id": "...", "name": "Jane" }, "balance": 50.00 },
      { "user": { "_id": "...", "name": "Bob" }, "balance": -20.00 }
    ],
    "debts": [
      { "from": { "_id": "...", "name": "John" }, "to": { "_id": "...", "name": "Jane" }, "amount": 30.00 },
      { "from": { "_id": "...", "name": "Bob" }, "to": { "_id": "...", "name": "Jane" }, "amount": 20.00 }
    ],
    "currency": "EUR"
  }
}
```

### GET /api/groups/[id]/balances/simplified

Same format as above but with minimized transactions.

---

## Activity Feed

| Method | Path                                  | Description              |
| ------ | ------------------------------------- | ------------------------ |
| GET    | `/api/groups/[id]/activity`           | Get activity feed        |

### GET /api/groups/[id]/activity

**Query params:** `?page=1&limit=20`

**Response:**
```json
{
  "data": {
    "activities": [
      {
        "_id": "...",
        "type": "expense_added",
        "actor": { "_id": "...", "name": "John", "image": "..." },
        "metadata": {
          "expenseId": "...",
          "description": "Dinner at restaurant",
          "amount": 120.00,
          "currency": "EUR"
        },
        "createdAt": "2026-02-10T19:30:00Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 100 }
  }
}
```

---

## Receipt Upload

| Method | Path                                                  | Description        |
| ------ | ----------------------------------------------------- | ------------------ |
| POST   | `/api/groups/[id]/expenses/[expenseId]/receipt`       | Upload receipt     |
| DELETE | `/api/groups/[id]/expenses/[expenseId]/receipt`       | Remove receipt     |

### POST .../receipt

**Body:** `multipart/form-data` with `file` field (image, max 5MB)

**Response:**
```json
{
  "data": {
    "receiptUrl": "https://..."
  }
}
```

