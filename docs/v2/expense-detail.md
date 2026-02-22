# V2: Expense Detail View

## Problem

Clicking an expense card does nothing. Users can't see the full split breakdown, notes, receipt, or edit history. `GET /api/groups/[id]/expenses/[expenseId]` exists but is never called from the frontend.

## What Changes

### New File: `src/components/expenses/ExpenseDetailDialog.tsx`

A slide-up dialog (or full-width Dialog) showing all expense info.

```
Props:
- open: boolean
- onClose: () => void
- groupId: string
- expenseId: string | null
- userId: string
- group: Record<string, unknown>
- onEdit: (expense: Record<string, unknown>) => void
- onDelete: (expenseId: string) => void
```

Fetches full expense data via SWR:

```typescript
const { data } = useSWR(expenseId ? `/api/groups/${groupId}/expenses/${expenseId}` : null, fetcher);
```

#### UI Layout

```
┌──────────────────────────────────────────┐
│ ← Expense Detail              [Edit] [⋮]│
├──────────────────────────────────────────┤
│                                          │
│ 🍕 Dinner at restaurant                 │
│ ₹120.00 · EUR                           │
│ Feb 10, 2026                            │
│                                          │
│ Category: Food & Drink                   │
│ Tags: [dinner] [birthday]               │
│                                          │
│ ── Paid by ──────────────────────────── │
│ 👤 John                     ₹120.00     │
│                                          │
│ ── Split (Equal) ────────────────────── │
│ 👤 You                       ₹40.00     │
│ 👤 Jane                      ₹40.00     │
│ 👤 Bob                       ₹40.00     │
│                                          │
│ ── Notes ────────────────────────────── │
│ Birthday dinner for Jane                 │
│                                          │
│ ── Receipt ──────────────────────────── │
│ [📎 View Receipt]                        │
│                                          │
│ ── History ──────────────────────────── │
│ Created by John · Feb 10, 10:30 PM      │
│ Edited by Jane · Feb 11, 2:15 PM       │
│   → Changed amount: ₹100 → ₹120        │
│                                          │
└──────────────────────────────────────────┘
```

#### Sections

1. **Header**: description, amount, currency, date
2. **Metadata**: category chip, tags chips
3. **Paid by**: list of payers with amounts
4. **Split breakdown**: list of members with their share, split method label
5. **Notes**: if present
6. **Receipt**: thumbnail/link if `receiptUrl` exists
7. **History**: created by + edit history entries (collapsed by default, "Show history" toggle)

#### Actions

- "Edit" button in header → calls `onEdit(expense)` → parent opens `ExpenseFormDialog` in edit mode
- 3-dot menu → "Delete" → calls `onDelete(expenseId)`

### File: `src/components/expenses/ExpenseCard.tsx`

Make the card clickable:

```typescript
// New prop:
onClick?: () => void;

// Wrap card in a clickable div / button:
<Box onClick={onClick} sx={{ cursor: "pointer" }}>
```

### File: `src/components/expenses/ExpenseListView.tsx`

Add state for the detail dialog:

```typescript
const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);
```

Pass `onClick={() => setDetailExpenseId(expense._id)}` to each `ExpenseCard`.

Render `ExpenseDetailDialog` with the selected expense ID.

## Backend Changes

None. The GET single expense API already returns all needed data including `editHistory`, `notes`, `receiptUrl`.

## Files Modified

- **New** `src/components/expenses/ExpenseDetailDialog.tsx`
- `src/components/expenses/ExpenseCard.tsx` — add `onClick` prop, cursor pointer
- `src/components/expenses/ExpenseListView.tsx` — manage detail dialog state
