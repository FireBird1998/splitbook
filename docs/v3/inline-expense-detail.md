# Inline Expandable Expense Detail

## Problem

Clicking an expense in the list currently opens a modal (`ExpenseDetailDialog`). This forces a context switch — the user leaves the list, waits for a fetch, views details, then closes the modal to return. This is jarring for quickly scanning multiple expenses.

## Solution: Accordion-Style Inline Expansion

Replace the modal with an inline expansion on the expense card itself:

- **Click on expense card** → card expands in-place to show full details below the summary row
- **Click again (or click collapse button)** → card collapses back to summary
- Only **one expense** can be expanded at a time (clicking another auto-collapses the previous)

### Expanded Card Layout

```
┌─────────────────────────────────────────────────┐
│ 🍕  Dinner at Olive Garden        ₹2,400.00     │
│     You paid · Split 4 ways · 2 hrs ago         │
│                                                  │
│  ── Paid by ──────────────────────────────────   │
│  👤 You                             ₹2,400.00   │
│                                                  │
│  ── Split (Equal) ────────────────────────────   │
│  👤 You           ₹600.00                       │
│  👤 Jane          ₹600.00                       │
│  👤 Bob           ₹600.00                       │
│  👤 Alice         ₹600.00                       │
│                                                  │
│  Notes: "Birthday celebration"                   │
│  📎 View Receipt                                 │
│                                                  │
│  Created by You · Feb 10, 2026 at 8:30 PM       │
│  [Show edit history (2 edits)]                   │
│                                                  │
│  [Edit]  [Delete]                                │
└─────────────────────────────────────────────────┘
```

### Data Strategy

The list API (`GET /api/groups/[id]/expenses`) already returns full expense data including `paidBy`, `splitBetween`, `tags`, `notes`, `editHistory`, `createdBy`. We just don't populate `editHistory.editedBy` in the list query.

**Change needed**: Add `.populate("editHistory.editedBy", "name email image")` to the list query so all data is available inline without a second fetch.

## Files Changed

- `src/lib/services/expense.service.ts` → add `editHistory.editedBy` populate to `getGroupExpenses`
- `src/components/expenses/ExpenseCard.tsx` → add expansion state + detail section (absorb content from `ExpenseDetailDialog`)
- `src/components/expenses/ExpenseListView.tsx` → replace `detailExpenseId` state with `expandedExpenseId`; remove `ExpenseDetailDialog`
- `src/components/expenses/ExpenseDetailDialog.tsx` → can be deleted (all content moves into ExpenseCard)

## Behavior

- `expandedExpenseId` state lives in `ExpenseListView`
- `ExpenseCard` receives `isExpanded` boolean + `onToggleExpand` callback
- Clicking the card toggles expansion
- Edit/Delete buttons inside expanded area trigger the same handlers as before
- The 3-dot menu on collapsed cards is kept for quick edit/delete without expanding
- Collapsing animation: simple CSS `max-height` transition or MUI `Collapse` component
