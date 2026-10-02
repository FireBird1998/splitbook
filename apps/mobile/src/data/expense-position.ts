import { sumMinorAmounts, toMajorAmount } from '@splitbook/shared/exact-money';
import type { MobileExpense } from './types';

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
  expense: Pick<MobileExpense, 'currency' | 'paidBy' | 'splitBetween'>,
  userId: string,
): ExpensePosition | null {
  const own = (rows: MobileExpense['paidBy']) =>
    sumMinorAmounts(rows.filter(({ user }) => user.id === userId).map((row) => row.amountMinor));
  const net = sumMinorAmounts([own(expense.paidBy), -own(expense.splitBetween)]);
  if (net === 0) return null;
  const amountMinor = Math.abs(net);
  return {
    kind: net > 0 ? 'lent' : 'owe',
    amountMinor,
    amount: toMajorAmount(amountMinor, expense.currency),
  };
}
