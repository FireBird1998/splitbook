# Feature: Expenses

## Overview

Expenses are the core data unit. A group member records an expense with details on who paid, how to split, and optional metadata (tags, receipt, notes). The system supports 5 split methods and tracks a full edit history.

---

## User Stories

1. **As a user**, I can add an expense to a group with description, amount, and who paid.
2. **As a user**, I can choose how to split the expense (equal, unequal, percentage, shares, exact).
3. **As a user**, I can tag expenses for easy filtering.
4. **As a user**, I can pick from predefined items for quick entry.
5. **As a user**, I can edit or delete an expense I created.
6. **As an admin**, I can edit or delete any expense in the group.
7. **As a user**, I can see the edit history of any expense.

---

## Split Methods

### 1. Equal Split

Everyone pays the same amount. Simplest and most common.

```
Expense: €120, 3 people
→ Each person: €40.00
(Remainder cents distributed to first N people)
```

### 2. Unequal (Exact Amounts)

Each person's share is manually specified.

```
Expense: €120
→ John: €60, Jane: €40, Bob: €20
(Must sum to €120)
```

### 3. Percentage

Each person's share as a percentage of total.

```
Expense: €120
→ John: 50% (€60), Jane: 30% (€36), Bob: 20% (€24)
(Must sum to 100%)
```

### 4. Shares

Proportional split based on share count.

```
Expense: €120, Total shares: 6
→ John: 3 shares (€60), Jane: 2 shares (€40), Bob: 1 share (€20)
```

### 5. Exact

Same as unequal — user enters exact amounts per person.

---

## Add Expense Flow

```
1. User clicks "+" / "Add Expense" button
2. Expense form opens (modal on desktop, full page on mobile):

   a. Description (text input, required)
   b. Amount (number input, required)
   c. Currency (dropdown — shows group's default + alternates first)
   d. Date (date picker, defaults to today)
   e. Category (dropdown or chips)
   f. Paid by (member selector — default: current user)
      - Can select multiple payers with amounts
   g. Split method (toggle: Equal | Unequal | Percentage | Shares)
   h. Split between (member checkboxes — default: all members)
      - Shows calculated amounts per person
   i. Tags (autocomplete chip input)
   j. Predefined item (optional quick-select)
   k. Receipt (image upload, optional)
   l. Notes (text area, optional)

3. User submits → API creates expense → Activity logged
4. All group members see updated balances
5. Real-time notification sent to group
```

---

## Expense Form UI

```
┌──────────────────────────────────────────┐
│ Add Expense                     [✕ Close]│
├──────────────────────────────────────────┤
│ Description: [Dinner at restaurant    ]  │
│                                          │
│ Amount: [120.00]  Currency: [EUR ▾]      │
│ Date:   [Feb 10, 2026         📅]       │
│                                          │
│ Category: [🍕Food ▾]                    │
│                                          │
│ ── Paid by ──                            │
│ [You ▾] paid [€120.00]                  │
│ + Add another payer                      │
│                                          │
│ ── Split ──                              │
│ [Equal] [Unequal] [%] [Shares]          │
│                                          │
│ ☑ You         €40.00                    │
│ ☑ Jane        €40.00                    │
│ ☑ Bob         €40.00                    │
│                                          │
│ Tags: [dinner] [birthday] [+ Add]       │
│                                          │
│ 📎 Attach receipt                        │
│ Notes: [Optional notes...            ]   │
│                                          │
│              [Cancel]  [Save Expense]    │
└──────────────────────────────────────────┘
```

---

## Predefined Items

Quick-select common expenses instead of typing description manually.

| Item          | Category      | Default Tags       |
| ------------- | ------------- | ------------------ |
| Groceries     | food          | groceries          |
| Restaurant    | food          | dining             |
| Taxi / Uber   | transport     | taxi               |
| Gas / Fuel    | transport     | fuel               |
| Hotel         | accommodation | hotel              |
| Airbnb        | accommodation | airbnb             |
| Flight        | travel        | flight             |
| Train ticket  | travel        | train              |
| Movie tickets | entertainment | movie              |
| Rent          | housing       | rent, monthly      |
| Utilities     | housing       | utilities, monthly |
| Internet      | housing       | internet, monthly  |
| Coffee        | food          | coffee             |
| Drinks / Bar  | food          | drinks, bar        |
| Shopping      | shopping      | -                  |
| Medical       | health        | medical            |
| Parking       | transport     | parking            |

When user selects a predefined item:

- Description auto-fills with item name
- Category auto-fills
- Tags auto-fill (user can modify)

---

## Categories

```typescript
const EXPENSE_CATEGORIES = [
  { id: 'food', label: 'Food & Drink', icon: '🍕' },
  { id: 'transport', label: 'Transport', icon: '🚗' },
  { id: 'accommodation', label: 'Accommodation', icon: '🏨' },
  { id: 'travel', label: 'Travel', icon: '✈️' },
  { id: 'entertainment', label: 'Entertainment', icon: '🎬' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️' },
  { id: 'housing', label: 'Housing', icon: '🏠' },
  { id: 'health', label: 'Health', icon: '🏥' },
  { id: 'education', label: 'Education', icon: '📚' },
  { id: 'other', label: 'Other', icon: '📋' },
];
```

---

## Edit Expense

- Same form as add, pre-filled with current values
- On save → creates entry in `editHistory` array
- Activity logged: "expense_updated" with diff of changes

---

## Delete Expense

- Soft delete: `isDeleted: true`, `deletedAt`, `deletedBy`
- Show confirmation dialog: "Delete expense 'Dinner at restaurant' (€120.00)?"
- Activity logged: "expense_deleted"
- Deleted expenses are hidden from normal views but preserved in database
- Admins may see deleted expenses in a "show deleted" toggle (future)

---

## Expense Card Display

```
┌──────────────────────────────────────────┐
│ 🍕 Dinner at restaurant                 │
│ Feb 10 · John paid €120.00              │
│                                          │
│ You owe €40.00                          │
│                                          │
│ [dinner] [birthday]           [⋮ More]  │
└──────────────────────────────────────────┘
```

---

## API Endpoints

See [api.md](../api.md#expenses) for full endpoint documentation.

---

## Edge Cases

- Rounding: When splitting €10 three ways → €3.34, €3.33, €3.33 (extra cent to first person)
- Zero amount: Not allowed
- Negative amount: Not allowed (use settlements for payments)
- Expense with 0 people in split: Not allowed
- User not in group trying to add expense: 403 Forbidden
- Currency mismatch: Expense currency doesn't have to match group default (any currency allowed, group currencies are just shortcuts)
- Very large amounts: Cap at 10,000,000 per expense
- Empty description: Not allowed
- Duplicate detection: If same description + amount + date exists, show warning (not blocker)
