# V2: Multiple Payers

## Problem

The schema supports `paidBy: IExpensePayerDocument[]` (an array), but the form only has a single "Paid by" dropdown. Users can't record expenses where multiple people paid portions.

## What Changes

### File: `src/components/expenses/ExpenseFormDialog.tsx`

#### Replace single payer with payer list

Remove:
```typescript
const [paidByUser, setPaidByUser] = useState(userId);
```

Add:
```typescript
const [payers, setPayers] = useState<Array<{ user: string; amount: string }>>([
  { user: userId, amount: "" },
]);
```

#### UI

Replace the single "Paid by" dropdown with a dynamic list:

```
── Paid by ──
[You ▾]          [₹ 80.00    ]    [✕]
[Jane ▾]         [₹ 40.00    ]    [✕]
[+ Add payer]

Payer total: ₹120.00 / ₹120.00 ✓
```

- Each row: member dropdown + amount input + remove button
- "Add payer" button adds a new row (disabled if all members already added)
- If only one payer, amount auto-fills with expense amount
- If multiple payers, show running total vs expense amount
- Validation: sum of payer amounts must equal expense amount

#### Single payer shortcut

When there's only one payer, auto-set their amount to the expense amount (no need for a separate amount field). The amount input only shows when there are 2+ payers.

```
── Paid by ──
[You ▾] paid the full amount
[+ Split payment between multiple people]
```

Click "Split payment" → expands to multi-payer mode.

#### Modify `handleSubmit`

```typescript
// Old:
paidBy: [{ user: paidByUser, amount: parseFloat(amount) }]

// New:
paidBy: payers.length === 1
  ? [{ user: payers[0].user, amount: parseFloat(amount) }]
  : payers.map(p => ({ user: p.user, amount: parseFloat(p.amount) }))
```

#### Validation

- At least one payer
- No duplicate payers
- Sum of payer amounts === expense amount (when multiple payers)
- Each payer amount > 0

### File: `src/components/expenses/ExpenseDetailDialog.tsx`

Already planned to show all payers in the detail view (expense-detail.md). No additional changes needed — just ensure the "Paid by" section iterates `expense.paidBy` array.

## Backend Changes

None. The API and service already handle multiple payers. The `createExpenseSchema` validates `paidBy` as an array with `min(1)`.

## Files Modified

- `src/components/expenses/ExpenseFormDialog.tsx` — replace single payer with dynamic payer list

