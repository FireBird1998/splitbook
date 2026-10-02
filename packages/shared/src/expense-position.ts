import { sumMinorAmounts, toMajorAmount } from './exact-money';

/** One payer or share row of a stored Expense, in exact minor units. */
export interface ExpensePositionRow {
  /** Null when the row's member can't be identified; it then counts for no one. */
  userId: string | null;
  amountMinor: number;
}

export interface ExpensePositionInput {
  currency: string;
  paidBy: ExpensePositionRow[];
  splitBetween: ExpensePositionRow[];
}

/** What one Expense means for a member: they lent the others money, or owe it. */
export interface ExpensePosition {
  kind: 'lent' | 'owe';
  amountMinor: number;
  amount: number;
}

/**
 * The member's paid amount minus their share of one Expense, in exact minor units from its
 * stored allocation, so the split's rounding is never recalculated. Null when they neither
 * paid nor share it, or when the two are equal.
 */
export function expensePosition(
  expense: ExpensePositionInput,
  userId: string,
): ExpensePosition | null {
  const own = (rows: ExpensePositionRow[]) =>
    sumMinorAmounts(rows.filter((row) => row.userId === userId).map((row) => row.amountMinor));
  const net = sumMinorAmounts([own(expense.paidBy), -own(expense.splitBetween)]);
  if (net === 0) return null;
  const amountMinor = Math.abs(net);
  return {
    kind: net > 0 ? 'lent' : 'owe',
    amountMinor,
    amount: toMajorAmount(amountMinor, expense.currency),
  };
}
