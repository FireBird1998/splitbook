import connectDB from '@/lib/db';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { assertStoredExpenseMoney } from '@splitbook/shared/exact-money';
import { memberSpendingByMonth, type MemberSpending } from '@splitbook/shared/insights';
import { lastMonths, monthsQueryRange } from '@splitbook/shared/zoned-calendar';

/**
 * The member's share of spending across their Groups (#307): every Group they are in today,
 * as the Groups list shows it (archived Groups and Groups they left are not theirs), bucketed
 * into calendar Months in the time zone the client sent.
 */
export async function getMemberSpending(
  userId: string,
  { months: count, timeZone, now = new Date() }: { months: number; timeZone: string; now?: Date },
): Promise<MemberSpending> {
  // Fails before any read when the zone or count is wrong.
  const months = lastMonths(count, { now, timeZone });
  const range = monthsQueryRange(months);
  await connectDB();

  const groups = await Group.find({ 'members.user': userId, isArchived: false })
    .select('_id name')
    .sort({ name: 1, _id: 1 })
    .lean();

  // Lazy-on-read, as the Group, Expense and Balances reads do: add the recurring Expenses that
  // have fallen due first, so the figures agree. It generates nothing while recurring Expenses
  // are switched off (#289), and never throws into the read.
  await Promise.all(
    groups.map((group) => recurringExpenseService.generateDueExpenses(String(group._id), now)),
  );

  const expenses = await Expense.find({
    group: { $in: groups.map((group) => group._id) },
    isDeleted: false,
    date: { $gte: range.from, $lt: range.to },
    'splitBetween.user': userId,
  })
    .select('group currency moneyVersion amount amountMinor date paidBy splitBetween')
    .lean();
  // As Balances does: a stored allocation that doesn't add up is refused, never summed.
  for (const expense of expenses) assertStoredExpenseMoney(expense);

  return memberSpendingByMonth({
    memberId: userId,
    timeZone,
    months,
    groups: groups.map((group) => ({ groupId: String(group._id), name: group.name })),
    expenses: expenses.map((expense) => ({
      groupId: String(expense.group),
      currency: expense.currency,
      date: expense.date,
      moneyVersion: expense.moneyVersion,
      splitBetween: expense.splitBetween.map(({ user, amount, amountMinor }) => ({
        user: String(user),
        amount,
        amountMinor,
      })),
    })),
  });
}
