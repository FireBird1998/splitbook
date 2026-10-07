import type { Types } from 'mongoose';
import connectDB from '@/lib/db';
import Activity from '@/lib/models/Activity';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { assertStoredExpenseMoney } from '@splitbook/shared/exact-money';
import {
  memberSpendingByMonth,
  spendingInMonth,
  type MemberSpending,
  type MonthDetail,
} from '@splitbook/shared/insights';
import { lastMonths, monthsQueryRange } from '@splitbook/shared/zoned-calendar';

/** When a Group last changed: its latest Activity, or null when it has none. */
export interface GroupLastChange {
  groupId: string;
  at: Date | null;
}

/**
 * The spending read (#307), with what #308 adds after its fields: the current Month in detail
 * (the member's share by Category, and what each Group spent) and each Group's last change.
 */
export type HomeSpending = MemberSpending & {
  thisMonth: MonthDetail;
  lastChanges: GroupLastChange[];
};

/**
 * The member's share of spending across their Groups (#307): every Group they are in today,
 * as the Groups list shows it (archived Groups and Groups they left are not theirs), bucketed
 * into calendar Months in the time zone the client sent. For the current Month it also gives
 * the member's share by Category and what each Group spent, and for each Group the time of its
 * latest Activity (#308).
 */
export async function getMemberSpending(
  userId: string,
  { months: count, timeZone, now = new Date() }: { months: number; timeZone: string; now?: Date },
): Promise<HomeSpending> {
  // Fails before any read when the zone or count is wrong.
  const months = lastMonths(count, { now, timeZone });
  const range = monthsQueryRange(months);
  const thisMonth = months[months.length - 1];
  const thisMonthRange = monthsQueryRange([thisMonth]);
  await connectDB();

  const groups = await Group.find({ 'members.user': userId, isArchived: false })
    .select('_id name')
    .sort({ name: 1, _id: 1 })
    .lean();
  const groupIds = groups.map((group) => group._id);

  // Lazy-on-read, as the Group, Expense and Balances reads do: add the recurring Expenses that
  // have fallen due first, so the figures agree. It generates nothing while recurring Expenses
  // are switched off (#289), and never throws into the read.
  await Promise.all(
    groups.map((group) => recurringExpenseService.generateDueExpenses(String(group._id), now)),
  );

  // The member's own Expenses over the window, and the current Month's Expenses of every member
  // for what each Group spent. The Months' figures still count only the member's share.
  const expenses = await Expense.find({
    group: { $in: groupIds },
    isDeleted: false,
    date: { $gte: range.from, $lt: range.to },
    $or: [{ 'splitBetween.user': userId }, { date: { $gte: thisMonthRange.from } }],
  })
    .select('group currency moneyVersion amount amountMinor date paidBy splitBetween category')
    .lean();
  // As Balances does: a stored allocation that doesn't add up is refused, never summed.
  for (const expense of expenses) assertStoredExpenseMoney(expense);

  const spendingGroups = groups.map((group) => ({
    groupId: String(group._id),
    name: group.name,
  }));
  const insightExpenses = expenses.map((expense) => ({
    groupId: String(expense.group),
    currency: expense.currency,
    date: expense.date,
    moneyVersion: expense.moneyVersion,
    // The stored total, for what its Group spent; checked above to equal its shares.
    amount: expense.amount,
    amountMinor: expense.amountMinor,
    category: expense.category,
    splitBetween: expense.splitBetween.map(({ user, amount, amountMinor }) => ({
      user: String(user),
      amount,
      amountMinor,
    })),
  }));

  return {
    ...memberSpendingByMonth({
      memberId: userId,
      timeZone,
      months,
      groups: spendingGroups,
      expenses: insightExpenses,
    }),
    thisMonth: spendingInMonth({
      memberId: userId,
      timeZone,
      month: thisMonth,
      groups: spendingGroups,
      expenses: insightExpenses,
    }),
    lastChanges: await lastChangeByGroup(groupIds),
  };
}

/**
 * Each Group's latest Activity time, in the order given: an Expense added, edited or deleted, a
 * Settlement, or a change to the Group or its members. The Group's own `updatedAt` isn't used,
 * since Expense and Settlement writes never touch it. The `{ group, createdAt }` index serves
 * each Group's newest event.
 *
 * Read-only, like Home's latest changes: an event whose publication failed counts once that
 * Group's Activity is read, or the next write to the same record publishes it.
 */
async function lastChangeByGroup(groupIds: Types.ObjectId[]): Promise<GroupLastChange[]> {
  if (groupIds.length === 0) return [];
  const latest = await Activity.aggregate<{ _id: Types.ObjectId; at: Date }>([
    { $match: { group: { $in: groupIds } } },
    { $sort: { group: 1, createdAt: -1 } },
    { $group: { _id: '$group', at: { $first: '$createdAt' } } },
  ]);
  const byGroup = new Map(latest.map((entry) => [String(entry._id), entry.at]));
  return groupIds.map((id) => ({ groupId: String(id), at: byGroup.get(String(id)) ?? null }));
}
