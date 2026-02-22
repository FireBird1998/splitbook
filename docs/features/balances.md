# Feature: Balances

## Overview

The balance system calculates who owes whom in a group based on all expenses and settlements. It provides both raw per-pair debts and a simplified view that minimizes the number of transactions needed.

---

## User Stories

1. **As a user**, I can see my net balance in a group (do I owe or am I owed?).
2. **As a user**, I can see who owes whom in the group.
3. **As a user**, I can see simplified debts (minimum transactions to settle all debts).
4. **As a user**, I can see my total balance across all groups on the dashboard.

---

## Balance Calculation Engine

### Step 1: Calculate Net Balance Per Person

```typescript
function calculateBalances(groupId: string): Balance[] {
  // Fetch all non-deleted expenses for this group
  // Fetch all settlements for this group

  const balanceMap: Map<string, number> = new Map();

  // Process expenses
  for (const expense of expenses) {
    // Credit payers
    for (const payer of expense.paidBy) {
      balanceMap.set(payer.user, (balanceMap.get(payer.user) ?? 0) + payer.amount);
    }
    // Debit participants
    for (const participant of expense.splitBetween) {
      balanceMap.set(
        participant.user,
        (balanceMap.get(participant.user) ?? 0) - participant.amount,
      );
    }
  }

  // Process settlements
  for (const settlement of settlements) {
    // Person who paid out cash (debited)
    balanceMap.set(settlement.paidBy, (balanceMap.get(settlement.paidBy) ?? 0) - settlement.amount);
    // Person who received cash (credited)
    balanceMap.set(settlement.paidTo, (balanceMap.get(settlement.paidTo) ?? 0) + settlement.amount);
  }

  return Array.from(balanceMap.entries()).map(([userId, amount]) => ({
    userId,
    balance: round(amount, 2),
  }));
}
```

### Step 2: Calculate Pair-wise Debts

```typescript
function calculateDebts(balances: Balance[]): Debt[] {
  // Use debt simplification algorithm from settlements.md
  return simplifyDebts(balances);
}
```

---

## UI: Balances Tab

### Balance Summary Section

```
┌──────────────────────────────────────────────────┐
│ Group Balance Summary                            │
├──────────────────────────────────────────────────┤
│                                                  │
│ 🟢 You are owed €50.00 overall                  │
│                                                  │
│ ┌────────────────────────────────────────────┐  │
│ │ 👤 John          Balance: +€50.00  (owed)  │  │
│ │ 👤 Jane          Balance: -€30.00  (owes)  │  │
│ │ 👤 Bob           Balance: -€20.00  (owes)  │  │
│ └────────────────────────────────────────────┘  │
│                                                  │
│ ── Simplified Debts ──                           │
│                                                  │
│ Jane → You:  €30.00    [Settle Up]              │
│ Bob  → You:  €20.00    [Settle Up]              │
│                                                  │
│ Total: 2 payments needed to settle all debts     │
└──────────────────────────────────────────────────┘
```

### Visual Indicators

- **Positive balance** (owed money): Green text, upward arrow
- **Negative balance** (owes money): Red text, downward arrow
- **Zero balance**: Gray text, checkmark ✓
- **Amount bars**: Proportional width bars to visualize relative amounts

---

## Dashboard: Cross-Group Balance

On the main dashboard, show aggregate balance:

```
┌──────────────────────────────────────┐
│ Your Overall Balance                 │
├──────────────────────────────────────┤
│ 🟢 You are owed ₹2,450.00 overall   │
│                                      │
│ Europe Trip:    +€50.00              │
│ Home Expenses:  -₹1,200.00          │
│ Work Lunch:     +₹150.00            │
└──────────────────────────────────────┘
```

**Note**: Cross-currency balances are shown per-group (not summed across currencies).

---

## API Endpoints

### GET /api/groups/[id]/balances

Returns net balance for each member + pair-wise debts.

### GET /api/groups/[id]/balances/simplified

Returns minimized transactions (simplified debts).

### GET /api/user/balances

Returns user's net balance per group.

See [api.md](../api.md#balances) for full documentation.

---

## Performance Considerations

- Balance calculation iterates all expenses + settlements in a group
- For groups with many expenses (>500), consider caching calculated balances
- Cache invalidation: Recalculate when expense is added/updated/deleted or settlement is recorded
- For v1: Calculate on-the-fly (sufficient for most groups)
- For v2: Consider storing running balances that update incrementally

---

## Edge Cases

- New member with no expenses: Balance is 0
- Member who left: Their balance should still be shown (they may still owe/be owed)
- Multiple currencies: Balances are calculated per-currency, not converted
  - If expense in EUR and settlement in USD → shown separately
  - Recommendation: Always settle in the same currency as the expense
- Floating point: Always round to 2 decimal places
- Empty group (no expenses): Show "No expenses yet" state
