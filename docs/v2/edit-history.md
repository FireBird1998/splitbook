# V2: Edit History Viewer

## Problem

The `editHistory` array in the Expense schema gets populated when expenses are updated, but there's no UI to view it. Users can't see who changed what and when.

## What Changes

### File: `src/components/expenses/ExpenseDetailDialog.tsx`

Add a "History" section at the bottom of the detail dialog.

#### UI

```
── History ──────────────────────────────
▸ Show edit history (2 edits)

── Expanded ──
│ Created by John · Feb 10, 10:30 PM
│
│ ✏️ Edited by Jane · Feb 11, 2:15 PM
│   • Amount: ₹100.00 → ₹120.00
│   • Description: "Dinner" → "Dinner at restaurant"
│
│ ✏️ Edited by John · Feb 12, 9:00 AM
│   • Category: transport → food
│   • Added tag: "birthday"
```

#### Implementation

```typescript
const [showHistory, setShowHistory] = useState(false);

// In the History section:
{expense.editHistory && expense.editHistory.length > 0 && (
  <div>
    <Button onClick={() => setShowHistory(!showHistory)} size="small">
      {showHistory ? "Hide" : "Show"} edit history ({expense.editHistory.length} edit{s})
    </Button>

    {showHistory && (
      <Stack spacing={1.5} sx={{ mt: 2, borderLeft: 2, borderColor: "divider", pl: 2 }}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            Created by {expense.createdBy.name} · {formatDateTime(expense.createdAt)}
          </Typography>
        </Box>

        {expense.editHistory.map((edit, i) => (
          <Box key={i}>
            <Typography variant="body2" color="text.secondary">
              Edited by {edit.editedBy.name} · {formatDateTime(edit.editedAt)}
            </Typography>
            <Box component="ul" sx={{ mt: 0.5, pl: 2 }}>
              {Object.entries(edit.changes).map(([field, { old, new: newVal }]) => (
                <Typography component="li" variant="caption" color="text.disabled" key={field}>
                  {formatFieldName(field)}: {formatValue(old)} → {formatValue(newVal)}
                </Typography>
              ))}
            </Box>
          </Box>
        ))}
      </Stack>
    )}
  </div>
)}
```

#### Helper: `formatFieldName`

Map internal field names to human-readable labels:

```typescript
const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  amount: 'Amount',
  currency: 'Currency',
  category: 'Category',
  date: 'Date',
  splitMethod: 'Split method',
  tags: 'Tags',
  notes: 'Notes',
  paidBy: 'Paid by',
  splitBetween: 'Split between',
};
```

### Backend Changes

#### File: `src/lib/services/expense.service.ts`

Ensure `editHistory.editedBy` is populated in the response:

In `getById()`, add:

```typescript
.populate("editHistory.editedBy", "name email image")
```

This allows the frontend to show editor names without extra API calls.

## Files Modified

- `src/components/expenses/ExpenseDetailDialog.tsx` — add collapsible edit history section
- `src/lib/services/expense.service.ts` — populate `editHistory.editedBy` in `getById()`
