import { expensePosition, type ExpensePosition } from '@splitbook/shared/expense-position';
import type { MobileExpense } from './types';

/** What a listed Expense means for a member, from the shared position arithmetic. */
export function mobileExpensePosition(
  expense: Pick<MobileExpense, 'currency' | 'paidBy' | 'splitBetween'>,
  userId: string,
): ExpensePosition | null {
  const rows = (allocations: MobileExpense['paidBy']) =>
    allocations.map(({ user, amountMinor }) => ({ userId: user.id, amountMinor }));
  return expensePosition(
    {
      currency: expense.currency,
      paidBy: rows(expense.paidBy),
      splitBetween: rows(expense.splitBetween),
    },
    userId,
  );
}
