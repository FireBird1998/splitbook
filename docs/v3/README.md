# V3 — UX Simplification & New Features

Overview of changes in this iteration. Focus on reducing friction, improving information density, and adding group management.

## Changes

| #   | Feature                                             | Doc                                                        | Status  |
| --- | --------------------------------------------------- | ---------------------------------------------------------- | ------- |
| 1   | Simplified Expense Form (two-tier UX)               | [simplified-expense-form.md](./simplified-expense-form.md) | Pending |
| 2   | Inline Expandable Expense Detail                    | [inline-expense-detail.md](./inline-expense-detail.md)     | Pending |
| 3   | Group Settings Page                                 | [group-settings.md](./group-settings.md)                   | Pending |
| 4   | Custom Date Range Filter (max 31 days)              | [custom-date-range.md](./custom-date-range.md)             | Pending |
| 5   | Expense Summary Bar (total + owe)                   | [expense-summary.md](./expense-summary.md)                 | Pending |
| 6   | Non-blocking Filter Loading                         | [non-blocking-filters.md](./non-blocking-filters.md)       | Pending |
| 7   | Tag Management (group-scoped, mandatory single tag) | [tag-management.md](./tag-management.md)                   | Pending |

## Key Principles

- **Fewer clicks for common actions**: The 90% case (equal split, you paid) needs only 2 fields
- **Information without navigation**: Expense details should be visible inline, not in a modal
- **Visual stability**: Changing filters should NOT cause the whole page to flash/reload
- **Summary at a glance**: Users should always see aggregate totals for current view
