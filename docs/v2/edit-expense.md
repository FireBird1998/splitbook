# V2: Edit Expense

## Problem

The `PATCH /api/groups/[id]/expenses/[expenseId]` API and `expenseService.update()` exist with full edit history tracking, but there is no way to trigger an edit from the UI. `ExpenseFormDialog` is create-only.

## What Changes

### File: `src/components/expenses/ExpenseFormDialog.tsx`

#### Make the dialog dual-purpose (create + edit)

Add optional prop:

```typescript
interface ExpenseFormDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  group: Record<string, unknown>;
  userId: string;
  expense?: Record<string, unknown> | null; // NEW — if provided, we're editing
}
```

#### Pre-fill form when `expense` is provided

In a `useEffect` keyed on `expense`:

- Set `description` from `expense.description`
- Set `amount` from `expense.amount`
- Set `currency` from `expense.currency`
- Set `category` from `expense.category`
- Set `date` from `expense.date`
- Set `paidByUser` from `expense.paidBy[0].user._id`
- Set `splitMethod` from `expense.splitMethod`
- Set `selectedMembers` from `expense.splitBetween.map(s => s.user._id)`
- Set `customAmounts/percentages/shares` from `expense.splitBetween` values
- Set `tags` from `expense.tags`
- Set `notes` from `expense.notes`

#### Change title dynamically

```
{expense ? "Edit Expense" : "Add Expense"}
```

#### Modify `handleSubmit`

```typescript
if (expense) {
  // PATCH existing
  const res = await fetch(`/api/groups/${groupId}/expenses/${expense._id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload }),
  });
} else {
  // POST new (existing logic)
}
```

#### Change submit button text

```
{expense ? "Save Changes" : "Save Expense"}
```

### File: `src/components/expenses/ExpenseCard.tsx`

Add a 3-dot menu (IconButton + Menu) with "Edit" option:

```typescript
// New state
const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

// New prop
onEdit?: (expense: Record<string, unknown>) => void;

// In JSX: add IconButton with MoreVertIcon at top-right of card
// Menu items: "Edit", "Delete" (delete handled in separate v2 doc)
```

### File: `src/components/expenses/ExpenseListView.tsx`

Add state to track which expense is being edited:

```typescript
const [editingExpense, setEditingExpense] = useState<Record<string, unknown> | null>(null);
```

Pass `onEdit` callback to each `ExpenseCard`. When triggered, open `ExpenseFormDialog` with the expense pre-filled.

### File: `src/components/groups/GroupDetailView.tsx`

Update `ExpenseFormDialog` usage to also support edit mode:

- Pass `editingExpense` from `ExpenseListView` up, or let `ExpenseListView` manage its own dialog instance.

Preferred approach: `ExpenseListView` renders its own `ExpenseFormDialog` for editing (separate from the FAB's create dialog). This avoids prop drilling.

## Backend Changes

None. `PATCH` API and `expenseService.update()` already work with edit history.

## Permission Notes

- Any group member can edit any expense (same as Splitwise behavior)
- Edit history tracks who changed what and when
- Future: optionally restrict edits to creator + admins only

## Files Modified

- `src/components/expenses/ExpenseFormDialog.tsx` — add `expense` prop, pre-fill, PATCH logic
- `src/components/expenses/ExpenseCard.tsx` — add 3-dot menu with "Edit"
- `src/components/expenses/ExpenseListView.tsx` — manage edit state, render edit dialog
