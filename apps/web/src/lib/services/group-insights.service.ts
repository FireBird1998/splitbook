import connectDB from '@/lib/db';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import User from '@/lib/models/User';
import { recurringExpensesEnabled } from '@/lib/recurring-expenses-switch';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { assertStoredExpenseMoney } from '@splitbook/shared/exact-money';
import {
  earlierMonths,
  groupMonthInsights,
  type BiggestExpense,
  type GroupMonthInsights,
} from '@splitbook/shared/insights';
import {
  monthKeyInZone,
  monthsQueryRange,
  readTimeZone,
  type MonthKey,
} from '@splitbook/shared/zoned-calendar';

/** What the Group insights read sends: `@splitbook/shared/group-insights-read` decodes it. */
export interface GroupInsightsResponse extends Omit<GroupMonthInsights, 'biggestExpense'> {
  biggestExpense:
    | (Omit<BiggestExpense, 'paidBy'> & { paidBy: { id: string; name: string }[] })
    | null;
  /** Whether the Group has any Expense at all, in any Month and currency. */
  hasExpenses: boolean;
}

/**
 * A Group's Month against the Months before it, for the Insights tab (#314). The caller has
 * checked membership. Null when the Group doesn't exist.
 *
 * - Months are calendar months in the time zone the client sent, never the server's.
 * - Recurring Expenses that have fallen due are added first, as the Group's other reads do, so
 *   the figures agree with them; nothing is added while recurring Expenses are off (#289), and
 *   then no recurring count is given either.
 * - The Group's first Month is the earlier of the Month it was created in and the Month of its
 *   earliest Expense (an Expense can be dated before the Group was made). No Month before it is
 *   compared, so a young Group's average isn't pulled down by Months it didn't exist in.
 * - Money is exact, in the Group's currency. A legacy Group with Expenses in other currencies
 *   gets them listed per currency in `otherCurrencies`, never converted and never counted in
 *   the Group's figures, as the Expense list's summary and Month bar count only the Group's
 *   currency.
 * - The biggest Expense's payers are named, never with an email.
 */
export async function getGroupInsights(
  groupId: string,
  userId: string,
  {
    month: requestedMonth,
    compare,
    timeZone,
    now = new Date(),
  }: { month?: MonthKey; compare: number; timeZone: string; now?: Date },
): Promise<GroupInsightsResponse | null> {
  // Fails before any read when the zone is wrong.
  const zone = readTimeZone(timeZone);
  const month = requestedMonth ?? monthKeyInZone(now, zone);
  await connectDB();

  // Lazy-on-read, as the Group, Expense and Balances reads do. It generates nothing while
  // recurring Expenses are switched off, and never throws into the read.
  await recurringExpenseService.generateDueExpenses(groupId, now);
  const recurringExpenses = recurringExpensesEnabled();

  const group = await Group.findById(groupId).select('defaultCurrency createdAt').lean();
  if (!group) return null;

  const earliest = await Expense.findOne({ group: groupId, isDeleted: false })
    .sort({ date: 1, _id: 1 })
    .select('date')
    .lean();
  const starts = [group.createdAt, earliest?.date]
    .filter((date): date is Date => date instanceof Date && Number.isFinite(date.getTime()))
    .map((date) => date.getTime());
  const firstMonth = starts.length ? monthKeyInZone(Math.min(...starts), zone) : null;

  const months = [...earlierMonths(month, { previousMonths: compare, since: firstMonth }), month];
  const range = monthsQueryRange(months);
  const expenses = await Expense.find({
    group: groupId,
    isDeleted: false,
    date: { $gte: range.from, $lt: range.to },
  })
    .select(
      'description currency moneyVersion amount amountMinor date paidBy splitBetween recurringExpense',
    )
    .lean();
  // As Balances does: a stored allocation that doesn't add up is refused, never summed.
  for (const expense of expenses) assertStoredExpenseMoney(expense);

  const insights = groupMonthInsights({
    memberId: userId,
    timeZone: zone,
    month,
    compare,
    firstMonth,
    currency: group.defaultCurrency,
    recurringExpenses,
    expenses: expenses.map((expense) => ({
      id: String(expense._id),
      description: expense.description,
      currency: expense.currency,
      date: expense.date,
      moneyVersion: expense.moneyVersion,
      amount: expense.amount,
      amountMinor: expense.amountMinor,
      paidBy: expense.paidBy.map(({ user, amount, amountMinor }) => ({
        user: String(user),
        amount,
        amountMinor,
      })),
      splitBetween: expense.splitBetween.map(({ user, amount, amountMinor }) => ({
        user: String(user),
        amount,
        amountMinor,
      })),
      recurring: Boolean(expense.recurringExpense),
    })),
  });

  const biggest = insights.biggestExpense;
  const names = new Map<string, string>();
  if (biggest) {
    const payers = await User.find({ _id: { $in: biggest.paidBy } })
      .select('name')
      .lean();
    for (const payer of payers) names.set(String(payer._id), payer.name);
  }

  return {
    ...insights,
    biggestExpense: biggest
      ? {
          ...biggest,
          paidBy: biggest.paidBy.map((id) => ({ id, name: names.get(id) ?? 'Former member' })),
        }
      : null,
    hasExpenses: Boolean(earliest),
  };
}
