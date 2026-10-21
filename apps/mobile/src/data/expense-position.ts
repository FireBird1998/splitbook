import { getCurrency } from '@splitbook/shared/currency';
import { expensePosition, type ExpensePosition } from '@splitbook/shared/expense-position';
import type { MobileExpense } from './types';

/**
 * What a listed Expense means for a member, from the shared position arithmetic. None for one in
 * a currency Splitbook no longer supports: there is nothing exact to say (#810).
 */
export function mobileExpensePosition(
  expense: Pick<MobileExpense, 'currency' | 'paidBy' | 'splitBetween'>,
  userId: string,
): ExpensePosition | null {
  if (!getCurrency(expense.currency)) return null;
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
