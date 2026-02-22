interface Balance {
  userId: string;
  amount: number;
}

interface Transaction {
  from: string;
  to: string;
  amount: number;
}

/**
 * Round to 2 decimal places
 */
function round(num: number, decimals: number = 2): number {
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Simplify debts to minimize the number of transactions.
 *
 * Algorithm:
 * 1. Calculate net balance for each person
 * 2. Separate into debtors (negative balance) and creditors (positive balance)
 * 3. Match debtors with creditors greedily (largest amounts first)
 *
 * @param balances - Array of { userId, amount } where positive = owed, negative = owes
 * @returns Minimized list of transactions
 */
export function simplifyDebts(balances: Balance[]): Transaction[] {
  // Filter out zero balances
  const nonZero = balances.filter((b) => Math.abs(b.amount) >= 0.01);

  // Separate into debtors and creditors
  const debtors = nonZero
    .filter((b) => b.amount < 0)
    .map((b) => ({ ...b, amount: -b.amount })) // Make positive for easier math
    .sort((a, b) => b.amount - a.amount); // Largest debt first

  const creditors = nonZero
    .filter((b) => b.amount > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.amount - a.amount); // Largest credit first

  const transactions: Transaction[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const transferAmount = Math.min(debtors[i].amount, creditors[j].amount);

    if (transferAmount >= 0.01) {
      transactions.push({
        from: debtors[i].userId,
        to: creditors[j].userId,
        amount: round(transferAmount),
      });
    }

    debtors[i].amount = round(debtors[i].amount - transferAmount);
    creditors[j].amount = round(creditors[j].amount - transferAmount);

    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }

  return transactions;
}

/**
 * Calculate net balances from expenses and settlements.
 */
export function calculateNetBalances(
  expenses: Array<{
    paidBy: Array<{ user: string; amount: number }>;
    splitBetween: Array<{ user: string; amount: number }>;
  }>,
  settlements: Array<{
    paidBy: string;
    paidTo: string;
    amount: number;
  }>,
): Balance[] {
  const balanceMap = new Map<string, number>();

  // Process expenses
  for (const expense of expenses) {
    for (const payer of expense.paidBy) {
      const userId = typeof payer.user === 'string' ? payer.user : String(payer.user);
      balanceMap.set(userId, (balanceMap.get(userId) ?? 0) + payer.amount);
    }
    for (const participant of expense.splitBetween) {
      const userId =
        typeof participant.user === 'string' ? participant.user : String(participant.user);
      balanceMap.set(userId, (balanceMap.get(userId) ?? 0) - participant.amount);
    }
  }

  // Process settlements — paidBy is the person settling their debt (balance goes up),
  // paidTo is the person receiving the payment (balance goes down).
  for (const settlement of settlements) {
    const payerId =
      typeof settlement.paidBy === 'string' ? settlement.paidBy : String(settlement.paidBy);
    const payeeId =
      typeof settlement.paidTo === 'string' ? settlement.paidTo : String(settlement.paidTo);
    balanceMap.set(payerId, (balanceMap.get(payerId) ?? 0) + settlement.amount);
    balanceMap.set(payeeId, (balanceMap.get(payeeId) ?? 0) - settlement.amount);
  }

  return Array.from(balanceMap.entries()).map(([userId, amount]) => ({
    userId,
    amount: round(amount),
  }));
}
