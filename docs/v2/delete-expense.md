# V2: Delete Expense + Restore

## Problem

`DELETE /api/groups/[id]/expenses/[expenseId]` API exists with soft-delete, but there's no UI to trigger it. No confirmation dialog, no undo.

## What Changes

### File: `src/components/expenses/ExpenseCard.tsx`

Add "Delete" to the 3-dot menu (same menu added in edit-expense.md):

```typescript
// Menu items:
// - "Edit" (from edit-expense.md)
// - "Delete" → opens confirmation dialog

// New prop:
onDelete?: (expenseId: string) => void;
```

### New File: `src/components/expenses/DeleteExpenseDialog.tsx`

Confirmation dialog before deleting.

```
Props:
- open: boolean
- onClose: () => void
- expense: { _id: string; description: string; amount: number; currency: string }
- groupId: string
- onDeleted: () => void
```

#### UI

```
┌──────────────────────────────────────┐
│ Delete Expense                       │
├──────────────────────────────────────┤
│                                      │
│ Are you sure you want to delete      │
│ "Dinner at restaurant" (₹120.00)?   │
│                                      │
│ This can be undone from the expense  │
│ detail view.                         │
│                                      │
│              [Cancel]  [Delete]      │
└──────────────────────────────────────┘
```

Delete button: red color, calls `DELETE /api/groups/${groupId}/expenses/${expense._id}`

On success:
- Close dialog
- Show Snackbar/toast: "Expense deleted" with "Undo" action
- Revalidate expense list via SWR mutate

### Undo (Restore)

#### New API: `PATCH /api/groups/[id]/expenses/[expenseId]` with body `{ isDeleted: false }`

The existing PATCH handler already supports updating any field. However, the `updateExpenseSchema` doesn't include `isDeleted`.

#### File: `src/lib/validators/expense.validator.ts`

Add to `updateExpenseSchema`:

```typescript
// Add this field to updateExpenseSchema (or create a separate restoreExpenseSchema)
isDeleted: z.literal(false).optional(),
```

#### Snackbar with Undo

In `ExpenseListView`, after delete succeeds:

```typescript
// Show snackbar
setSnackbar({
  open: true,
  message: "Expense deleted",
  expenseId: deletedId,
});

// Undo handler
const handleUndo = async () => {
  await fetch(`/api/groups/${groupId}/expenses/${snackbar.expenseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isDeleted: false }),
  });
  mutate(); // refresh list
};
```

Snackbar auto-hides after 5 seconds.

## Backend Changes

### File: `src/lib/validators/expense.validator.ts`

- Add `isDeleted: z.literal(false).optional()` to `updateExpenseSchema`

### File: `src/lib/services/expense.service.ts`

- `update()`: if `data.isDeleted === false`, clear `deletedAt` and `deletedBy` too
- Log "expense_restored" activity type

### File: `src/types/index.ts`

- Add `"expense_restored"` to `ActivityType` union

### File: `src/lib/models/Activity.ts`

- Add `"expense_restored"` to the enum

## Files Modified

- `src/components/expenses/ExpenseCard.tsx` — add "Delete" to menu
- `src/components/expenses/ExpenseListView.tsx` — manage delete state, snackbar with undo
- **New** `src/components/expenses/DeleteExpenseDialog.tsx`
- `src/lib/validators/expense.validator.ts` — add `isDeleted` to update schema
- `src/lib/services/expense.service.ts` — handle restore logic
- `src/types/index.ts` — add activity type

