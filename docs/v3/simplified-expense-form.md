# Simplified Expense Form (Two-Tier UX)

## Problem

Current `ExpenseFormDialog` shows ~12 fields at once: description, amount, currency, date, category, paid-by, split-payment toggle, split method selector, member checkboxes with per-member inputs, tags, notes. This is overwhelming for the most common use case: "I paid X for Y, split equally among everyone."

## Solution: Two-Tier Form

### Tier 1 — Simple Mode (default, always visible)

Only 2 required inputs + a smart summary line:

```
┌──────────────────────────────────────────┐
│ Add Expense                        [✕]   │
├──────────────────────────────────────────┤
│ [Quick picks: 🍕 🚗 🏨 ☕ ...]           │
│                                          │
│ [What was it for?              ]         │
│ [₹ Amount     ] [INR ▾]                 │
│                                          │
│ You paid · Split equally · All 4 members │
│                             [Change ▾]   │
│                                          │
│              [Save Expense]              │
└──────────────────────────────────────────┘
```

- **Description** — text input (required)
- **Amount + Currency** — inline row; currency defaults to group default
- **Summary line** — read-only text: "[Payer] paid · Split [method] · [N] members"
- **"Change" button** — toggles Tier 2 expansion
- Quick picks remain compact at top

### Tier 2 — Advanced Options (collapsed by default)

Expanding via "Change" reveals:

```
│ ── Paid by ──                            │
│ [You ▾]  [+ Split payment]              │
│                                          │
│ ── Split ──                              │
│ [Equal] [Unequal] [%] [Shares]          │
│ ☑ You    ☑ Jane    ☑ Bob                │
│                                          │
│ ── More ──                               │
│ Date: [Today      ]  Category: [Other ▾] │
│ Tags: [+ Add]                            │
│ Notes: [...]                             │
└──────────────────────────────────────────┘
```

Three collapsible sections:

1. **Paid by** — single payer dropdown + "Split payment" expander
2. **Split** — method toggle + member checkboxes + per-member inputs
3. **More** — date, category, tags, notes

### Behavior

- **Create mode**: Tier 2 collapsed by default
- **Edit mode**: Tier 2 expanded by default (since user is intentionally modifying)
- **Quick pick tap**: Fills description + category + tags, stays in simple mode
- **Defaults**: Date = today, Category = "other", Paid by = current user, Split = equal among all members

## Files Changed

- `src/components/expenses/ExpenseFormDialog.tsx` — complete rewrite of render section; same state/handlers

## Notes

- No backend changes needed
- All existing state variables remain; we just hide Tier 2 fields behind a collapsible
- Summary line is computed from state (payer name, split method label, selected member count)
