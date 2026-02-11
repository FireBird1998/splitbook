# Page: Add / Edit Expense

**Route**: Modal overlay on `/groups/[id]` (desktop) or `/groups/[id]/expenses/new` (mobile)
**Auth**: Required (must be group member)

---

## Purpose

Form to create a new expense or edit an existing one. This is the most complex form in the app.

---

## Layout (Desktop — Modal)

```
┌──────────────────────────────────────────────────┐
│ Add Expense                             [✕ Close]│
├──────────────────────────────────────────────────┤
│                                                  │
│ ── Quick Pick ── (optional)                      │
│ [🍕 Restaurant] [🚗 Taxi] [🏨 Hotel] [☕ Coffee] │
│ [🛒 Groceries] [✈️ Flight] [More ▾]            │
│                                                  │
│ Description *                                    │
│ [Dinner at restaurant                       ]    │
│                                                  │
│ ┌──────────────────┐ ┌──────────────────────┐   │
│ │ Amount *         │ │ Currency             │   │
│ │ [120.00      ]   │ │ [🇪🇺 EUR ▾]         │   │
│ └──────────────────┘ └──────────────────────┘   │
│                                                  │
│ ┌──────────────────┐ ┌──────────────────────┐   │
│ │ Date *           │ │ Category             │   │
│ │ [Feb 10, 2026 📅]│ │ [🍕 Food & Drink ▾] │   │
│ └──────────────────┘ └──────────────────────┘   │
│                                                  │
│ ── Paid By ──                                    │
│ [You ▾] paid [€120.00]                          │
│ [+ Add another payer]                            │
│                                                  │
│ ── Split Between ──                              │
│ Method: (Equal) (Unequal) (%) (Shares)          │
│                                                  │
│ ☑ You           €40.00                          │
│ ☑ Jane Doe      €40.00                          │
│ ☑ Bob Smith     €40.00                          │
│ ☐ Alice (unchecked = excluded)                  │
│                                                  │
│ Total: €120.00 ✓                                │
│                                                  │
│ ── Optional ──                                   │
│ Tags: [dinner ✕] [birthday ✕] [+ Add]          │
│ 📎 Attach receipt                                │
│ Notes: [John's birthday dinner            ]     │
│                                                  │
│              [Cancel]       [Save Expense]       │
└──────────────────────────────────────────────────┘
```

---

## Form Fields

### Required Fields

| Field       | Type          | Default              | Validation                   |
| ----------- | ------------- | -------------------- | ---------------------------- |
| description | text          | "" or predefined item| 1-200 chars, required        |
| amount      | number        | 0                    | > 0, max 10,000,000         |
| currency    | select        | Group default        | Valid ISO 4217 code          |
| date        | date picker   | Today                | Not in future (warn, allow)  |
| paidBy      | member select | Current user         | At least 1 payer             |
| splitMethod | toggle        | "equal"              | One of 5 methods             |
| splitBetween| checkboxes    | All members checked  | At least 1 person            |

### Optional Fields

| Field          | Type              | Default | Notes                        |
| -------------- | ----------------- | ------- | ---------------------------- |
| category       | select            | "other" | From predefined categories   |
| tags           | chip input        | []      | Autocomplete from group tags |
| predefinedItem | quick select      | null    | Auto-fills description+tags  |
| receiptUrl     | file upload       | null    | Image, max 5MB               |
| notes          | textarea          | ""      | Max 500 chars                |

---

## Split Method Interactions

### Equal
- All checked members get equal share
- Amount auto-calculated: `total / numberOfPeople`
- Remainder cents go to first person(s)
- User can only check/uncheck members

### Unequal / Exact
- Each checked member has an editable amount input
- Running total shown: "Total: €110.00 / €120.00 (€10.00 remaining)"
- Validation: Sum must equal total amount
- Error state if sum doesn't match

### Percentage
- Each checked member has a percentage input
- Running total: "Total: 90% / 100% (10% remaining)"
- Auto-calculate amounts from percentages
- Must sum to 100%

### Shares
- Each checked member has a shares input (integer)
- Show calculated amount per share
- E.g., "3 shares × €20.00 = €60.00"

---

## Paid By — Multiple Payers

By default, one payer (current user) pays the full amount. But users can add multiple payers:

```
Paid By:
[You ▾]      [€80.00]  [✕]
[Jane ▾]     [€40.00]  [✕]
[+ Add another payer]
Total paid: €120.00 ✓
```

- Each payer needs a member selector and amount input
- Sum of payer amounts must equal total expense amount
- Validation error if they don't match

---

## Quick Pick (Predefined Items)

Top of the form — horizontal scrollable row of common expense types:

```
[🍕 Restaurant] [🚗 Taxi] [🏨 Hotel] [☕ Coffee] [🛒 Groceries] [✈️ Flight] [More ▾]
```

Clicking one:
1. Sets `description` to item name
2. Sets `category` to item's category
3. Sets `tags` to item's default tags
4. User can still modify all fields

---

## Edit Mode

When editing an existing expense:
- Form pre-filled with current values
- Title changes to "Edit Expense"
- On save → changes tracked in `editHistory`
- Activity logged with diff of changes
- "Delete" button shown (with confirmation)

---

## Form State Management

Use React Hook Form + Zod for validation:

```typescript
const schema = z.object({
  description: z.string().min(1).max(200),
  amount: z.number().positive().max(10_000_000),
  currency: z.string().length(3),
  date: z.date(),
  category: z.string(),
  paidBy: z.array(z.object({
    user: z.string(),
    amount: z.number().positive(),
  })).min(1),
  splitMethod: z.enum(["equal", "unequal", "percentage", "shares", "exact"]),
  splitBetween: z.array(z.object({
    user: z.string(),
    amount: z.number().optional(),
    percentage: z.number().optional(),
    shares: z.number().optional(),
  })).min(1),
  tags: z.array(z.string()),
  notes: z.string().max(500).optional(),
});
```

---

## Responsive Behavior

- **Desktop**: Opens as a centered modal dialog (MUI Dialog, max-width 600px)
- **Tablet**: Same modal but wider
- **Mobile**: Full-screen page (`/groups/[id]/expenses/new`)
- Form layout: Single column on all sizes for simplicity

---

## Components Used

- MUI `Dialog` (desktop modal)
- MUI `TextField` for text inputs
- MUI `Select` for dropdowns
- MUI `DatePicker` for date
- MUI `ToggleButtonGroup` for split method
- MUI `Checkbox` for member selection
- MUI `Chip` + `Autocomplete` for tags
- `CurrencySelect` custom component
- `ReceiptUpload` custom component
- `PredefinedItemPicker` custom component

