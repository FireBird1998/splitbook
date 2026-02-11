# V2: Duplicate Expense Warning

## Problem

Per the spec in `features/expenses.md`: "If same description + amount + date exists, show warning (not blocker)." This isn't implemented.

## What Changes

### New API: `GET /api/groups/[id]/expenses/check-duplicate`

#### File: `src/app/api/groups/[id]/expenses/check-duplicate/route.ts`

```
GET /api/groups/{id}/expenses/check-duplicate?description=...&amount=...&date=...

Response:
{
  data: {
    isDuplicate: true,
    matchingExpense: {
      _id: "...",
      description: "Dinner at restaurant",
      amount: 120,
      date: "2026-02-10",
      createdBy: { name: "John" }
    }
  }
}
```

Query params:
- `description` (string, required)
- `amount` (number, required)
- `date` (string ISO date, required)
- `excludeId` (string, optional — when editing, exclude self)

#### Logic

```typescript
const existing = await Expense.findOne({
  group: groupId,
  description: { $regex: `^${escapeRegex(description)}$`, $options: "i" },
  amount,
  date: { $gte: startOfDay(date), $lte: endOfDay(date) },
  isDeleted: false,
  ...(excludeId ? { _id: { $ne: excludeId } } : {}),
}).populate("createdBy", "name").lean();
```

### File: `src/components/expenses/ExpenseFormDialog.tsx`

#### Debounced duplicate check

After the user fills description + amount + date, debounce a check:

```typescript
const [duplicateWarning, setDuplicateWarning] = useState<string>("");

useEffect(() => {
  const timer = setTimeout(async () => {
    if (!description.trim() || !amount || !date) {
      setDuplicateWarning("");
      return;
    }

    const params = new URLSearchParams({
      description: description.trim(),
      amount,
      date,
      ...(expense?._id ? { excludeId: expense._id } : {}),
    });

    const res = await fetch(`/api/groups/${groupId}/expenses/check-duplicate?${params}`);
    const data = await res.json();

    if (data.data?.isDuplicate) {
      setDuplicateWarning(
        `Similar expense found: "${data.data.matchingExpense.description}" ` +
        `(${formatCurrency(data.data.matchingExpense.amount, currency)}) ` +
        `added by ${data.data.matchingExpense.createdBy.name}`
      );
    } else {
      setDuplicateWarning("");
    }
  }, 800); // 800ms debounce

  return () => clearTimeout(timer);
}, [description, amount, date]);
```

#### UI — Warning banner

Show below the error banner, only when `duplicateWarning` is set:

```
⚠️ Similar expense found: "Dinner at restaurant" (₹120.00) added by John
   [Add anyway]
```

- Yellow/amber background
- Non-blocking — user can still submit
- Disappears if they change description/amount/date

## Backend Changes

### File: `src/lib/services/expense.service.ts`

Add method:

```typescript
async checkDuplicate(
  groupId: string,
  description: string,
  amount: number,
  date: Date,
  excludeId?: string
): Promise<{ isDuplicate: boolean; matchingExpense?: unknown }>
```

### New File: `src/app/api/groups/[id]/expenses/check-duplicate/route.ts`

GET endpoint as described above.

## Files Modified

- `src/components/expenses/ExpenseFormDialog.tsx` — add debounced duplicate check + warning UI
- `src/lib/services/expense.service.ts` — add `checkDuplicate()` method
- **New** `src/app/api/groups/[id]/expenses/check-duplicate/route.ts`

