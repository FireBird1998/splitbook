# V2 — Expense Management Improvements

These docs describe **only what is changing** relative to the existing v1 implementation. Each file covers one feature gap.

## Current State (v1)

What works today:

- Create expense with equal split (form dialog)
- List expenses with quick-date-filters, search, pagination
- Expense cards showing payer, amount, "you owe" summary
- Tags input (autocomplete)
- Predefined items (quick pick)
- Backend: PATCH + DELETE APIs exist, edit history tracking in schema

## V2 Features

| #   | File                                               | Summary                                                          |
| --- | -------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | [edit-expense.md](./edit-expense.md)               | Make form dual-purpose (create + edit), add edit button to cards |
| 2   | [delete-expense.md](./delete-expense.md)           | Add 3-dot menu, delete with confirmation, restore (undo)         |
| 3   | [split-method-inputs.md](./split-method-inputs.md) | Make unequal/percentage/shares split methods actually functional |
| 4   | [expense-detail.md](./expense-detail.md)           | Click expense card → full detail view with breakdown             |
| 5   | [multiple-payers.md](./multiple-payers.md)         | Support multiple payers in expense form                          |
| 6   | [filters-and-sorting.md](./filters-and-sorting.md) | Category filter, member filter, sort controls, who-paid filter   |
| 7   | [receipt-upload.md](./receipt-upload.md)           | File upload API + UI for attaching receipts                      |
| 8   | [edit-history.md](./edit-history.md)               | UI to view edit history timeline on an expense                   |
| 9   | [duplicate-warning.md](./duplicate-warning.md)     | Warn when a similar expense already exists                       |

## Build Order (dependency chain)

```
1. split-method-inputs  (no deps — fixes broken functionality)
2. edit-expense         (no deps — unlocks core CRUD)
3. delete-expense       (no deps — unlocks core CRUD)
4. expense-detail       (benefits from 2, 3 being done)
5. filters-and-sorting  (no deps — enhances list view)
6. multiple-payers      (no deps — enhances form)
7. edit-history         (needs 2 done first — edits produce history)
8. receipt-upload       (no deps — new infra needed)
9. duplicate-warning    (no deps — nice-to-have polish)
```
