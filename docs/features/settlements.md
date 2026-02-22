# Feature: Settlements

## Overview

Settlements record payments between group members to clear debts. When someone owes money, they can "settle up" by paying the other person (cash, UPI, bank transfer, etc.) and recording it in the app.

---

## User Stories

1. **As a user**, I can see who I owe and who owes me in a group.
2. **As a user**, I can record a settlement payment to someone.
3. **As a user**, I can view the history of all settlements in a group.

---

## Settle Up Flow

```
1. User views Balances tab in group
2. Sees simplified debts: "You owe Jane €30"
3. Clicks "Settle Up" button on that debt
4. Dialog opens pre-filled:
   - Paying to: Jane
   - Amount: €30 (editable — can do partial settlement)
   - Currency: EUR
   - Note: optional (e.g. "Paid via UPI")
5. Confirms → Settlement recorded
6. Balances recalculated
7. Activity logged: "settlement_recorded"
8. Real-time notification sent
```

---

## Settle Up Dialog

```
┌──────────────────────────────────────┐
│ Settle Up                            │
├──────────────────────────────────────┤
│                                      │
│ You are paying:                      │
│ [Jane Doe ▾]                        │
│                                      │
│ Amount: [€30.00]                    │
│ Currency: [EUR ▾]                   │
│                                      │
│ Note: [Paid via Google Pay      ]   │
│                                      │
│         [Cancel]  [Record Payment]  │
└──────────────────────────────────────┘
```

---

## Smart Debt Simplification

### Problem

With many expenses, the raw debts can have lots of transactions:

```
A owes B: €30
B owes C: €20
A owes C: €10
C owes A: €5
```

### Solution: Minimize Transactions

Use a **net balance algorithm** to minimize the number of transfers:

```
1. Calculate net balance for each person:
   A: -€35 (owes net €35)
   B: +€10 (is owed net €10)
   C: +€25 (is owed net €25)

2. Match debtors with creditors:
   A pays B: €10
   A pays C: €25
   (2 transactions instead of 4)
```

### Algorithm

```typescript
function simplifyDebts(balances: { userId: string; amount: number }[]) {
  // Separate into debtors (negative) and creditors (positive)
  const debtors = balances.filter((b) => b.amount < 0).sort((a, b) => a.amount - b.amount);
  const creditors = balances.filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let i = 0,
    j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(-debtors[i].amount, creditors[j].amount);
    transactions.push({
      from: debtors[i].userId,
      to: creditors[j].userId,
      amount: round(amount, 2),
    });

    debtors[i].amount += amount;
    creditors[j].amount -= amount;

    if (Math.abs(debtors[i].amount) < 0.01) i++;
    if (Math.abs(creditors[j].amount) < 0.01) j++;
  }

  return transactions;
}
```

---

## Balance Calculation

### How Balances Work

For each expense in the group:

- Each person in `paidBy` gets **credited** their paid amount
- Each person in `splitBetween` gets **debited** their share amount

For each settlement:

- `paidBy` gets **debited** the settlement amount (they paid out cash)
- `paidTo` gets **credited** the settlement amount (they received cash)

**Net balance** = total credits - total debits

- Positive balance → others owe you
- Negative balance → you owe others
- Zero → all settled

### Example

```
Group: Alice, Bob, Charlie

Expense 1: Dinner €90, paid by Alice, split equally
  Alice: +90 (paid) -30 (share) = +60
  Bob:   -30 (share)
  Charlie: -30 (share)

Expense 2: Taxi €30, paid by Bob, split equally
  Alice: -10 (share) → net: +50
  Bob: +30 (paid) -10 (share) → net: -10
  Charlie: -10 (share) → net: -40

Settlement: Charlie pays Alice €40
  Alice: net +50 -40 = +10
  Charlie: net -40 +40 = 0

Final: Bob owes Alice €10
```

---

## Settlement History

```
┌──────────────────────────────────────────┐
│ 💰 Settlement History                    │
├──────────────────────────────────────────┤
│ Feb 10 · Charlie paid Alice €40.00      │
│          "Paid via UPI"                  │
│                                          │
│ Feb 8  · Bob paid Jane €25.00           │
│          "Bank transfer"                 │
└──────────────────────────────────────────┘
```

---

## API Endpoints

See [api.md](../api.md#settlements) and [api.md](../api.md#balances) for full documentation.

---

## Edge Cases

- Partial settlement: User can pay less than the full debt amount
- Over-settlement: User pays more than owed → the other person now owes them (allowed, but show warning)
- Self-settlement: Cannot settle with yourself
- Settlement on archived group: Not allowed
- Currency mismatch: Settlement currency should match group default or alternate currencies (warn but allow)
- Concurrent expenses: Balance calculation must include all expenses up to current moment
