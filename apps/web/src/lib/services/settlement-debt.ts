import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import {
  calculateNetBalancesMinor,
  simplifyDebtsMinor,
  type BalanceSettlement,
} from '@splitbook/shared/debt-simplifier';
import { assertStoredExpenseMoney, toMajorAmount } from '@splitbook/shared/exact-money';

/** Called inside the Settlement's Group mutation, before insertion, in the same snapshot. */
export async function settlementDebtSnapshot(
  groupId: string,
  currency: string,
  paidBy: string,
  paidTo: string,
  amountMinor: number,
) {
  // Keep queries sequential: a transaction session must not run parallel operations.
  const expenses = await Expense.find({ group: groupId, currency, isDeleted: false })
    .select('group currency moneyVersion amount amountMinor paidBy splitBetween')
    .lean();
  const settlements = await Settlement.find({ group: groupId, currency })
    .select('currency moneyVersion amount amountMinor paidBy paidTo')
    .lean();
  for (const expense of expenses) assertStoredExpenseMoney(expense);
  const expenseMoney = expenses.map((expense) => ({
    currency,
    moneyVersion: expense.moneyVersion,
    paidBy: expense.paidBy.map((row) => ({ ...row, user: String(row.user) })),
    splitBetween: expense.splitBetween.map((row) => ({ ...row, user: String(row.user) })),
  }));
  const settlementMoney = settlements.map((row) => ({
    ...row,
    paidBy: String(row.paidBy),
    paidTo: String(row.paidTo),
  }));
  const pair = (rows: BalanceSettlement[]) => {
    const debts = simplifyDebtsMinor(calculateNetBalancesMinor(expenseMoney, rows, currency));
    const outgoing = debts.find((debt) => debt.from === paidBy && debt.to === paidTo);
    const incoming = debts.find((debt) => debt.from === paidTo && debt.to === paidBy);
    // Zero means no direct edge in this simplified plan, not no underlying pairwise Debt.
    return outgoing ? -outgoing.amountMinor : (incoming?.amountMinor ?? 0);
  };
  const pairDebtBeforeMinor = pair(settlementMoney);
  const next = {
    currency,
    paidBy,
    paidTo,
    amountMinor,
    amount: toMajorAmount(amountMinor, currency),
    moneyVersion: 1,
  };
  return { pairDebtBeforeMinor, pairDebtAfterMinor: pair([...settlementMoney, next]) };
}
