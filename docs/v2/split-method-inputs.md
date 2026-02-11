# V2: Split Method Inputs

## Problem

The split method toggle (Equal / Unequal / % / Shares) exists in `ExpenseFormDialog`, but only "Equal" works. Selecting Unequal, Percentage, or Shares shows the same member checkboxes with no per-person input fields. The backend calculates correctly for all methods, but the frontend never sends the required `amount`, `percentage`, or `shares` values.

## What Changes

### File: `src/components/expenses/ExpenseFormDialog.tsx`

#### Add state for per-member custom amounts

```
New state variables:
- customAmounts: Record<string, string>    — for unequal/exact split
- customPercentages: Record<string, string> — for percentage split
- customShares: Record<string, string>      — for shares split
```

Initialize all to empty when split method changes.

#### Modify the "Split between" section

**When splitMethod === "equal"** (no change):
- Show checkboxes with calculated per-person amount

**When splitMethod === "unequal" or "exact":**
- Show checkboxes + a TextField (number) next to each member
- Label: member name | input field for exact amount
- Show running total at bottom: "Total: ₹X / ₹Y" with red if doesn't match
- Validation: sum of custom amounts must equal expense amount

**When splitMethod === "percentage":**
- Show checkboxes + a TextField (number, 0-100) next to each member
- Label: member name | input field for % | calculated amount shown as helper text
- Show running total: "Total: X% / 100%"
- Validation: sum of percentages must equal 100

**When splitMethod === "shares":**
- Show checkboxes + a TextField (integer, min 1) next to each member
- Label: member name | input field for shares | calculated amount shown as helper text
- Show total shares and per-share value

#### Modify `handleSubmit`

```typescript
// For unequal/exact: send amount per person
splitBetween: selectedMembers.map(id => ({
  user: id,
  amount: parseFloat(customAmounts[id] || "0"),
}))

// For percentage: send percentage per person (backend calculates amount)
splitBetween: selectedMembers.map(id => ({
  user: id,
  percentage: parseFloat(customPercentages[id] || "0"),
}))

// For shares: send shares per person (backend calculates amount)
splitBetween: selectedMembers.map(id => ({
  user: id,
  shares: parseInt(customShares[id] || "1"),
}))
```

#### Add validation before submit

- Unequal: `sum(amounts) === expense amount` → error "Amounts must add up to ₹X"
- Percentage: `sum(percentages) === 100` → error "Percentages must add up to 100%"
- Shares: `all shares >= 1` for selected members

### UI Mockup (Unequal)

```
── Split ──
[Equal] [▶Unequal] [%] [Shares]

☑ You         [₹ 60.00    ]
☑ Jane        [₹ 40.00    ]
☑ Bob         [₹ 20.00    ]

Total: ₹120.00 / ₹120.00 ✓
```

### UI Mockup (Percentage)

```
── Split ──
[Equal] [Unequal] [▶%] [Shares]

☑ You         [50  ]%    → ₹60.00
☑ Jane        [30  ]%    → ₹36.00
☑ Bob         [20  ]%    → ₹24.00

Total: 100% / 100% ✓
```

### UI Mockup (Shares)

```
── Split ──
[Equal] [Unequal] [%] [▶Shares]

☑ You         [3] shares   → ₹60.00
☑ Jane        [2] shares   → ₹40.00
☑ Bob         [1] shares   → ₹20.00

Total: 6 shares · ₹20.00/share
```

## Backend Changes

None. The service already handles all split methods. Only the frontend is broken.

## Files Modified

- `src/components/expenses/ExpenseFormDialog.tsx` — add per-member input fields

