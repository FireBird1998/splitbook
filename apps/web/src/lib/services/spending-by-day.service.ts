import type { Types } from 'mongoose';
import { readGroupLedgers } from '@/lib/group-ledger-read';
import Expense from '@/lib/models/Expense';
import User from '@/lib/models/User';
import { inSupportedCurrencies } from '@splitbook/shared/currency';
import { expenseDate, expenseMonthRange } from '@splitbook/shared/expense-day';
import { assertStoredExpenseMoney, readStoredAmountMinor } from '@splitbook/shared/exact-money';
import { memberSpendingByDay } from '@splitbook/shared/spending-by-day';
import type { MonthKey } from '@splitbook/shared/zoned-calendar';

const DAY = 24 * 60 * 60 * 1000;

/** One payer of an Expense, named; without a name when their account no longer exists. */
export type SpendingByDayPayer = { _id: string; name?: string };

/** The read's answer, as `docs/api.md` and `parseSpendingByDayResponse` describe it. */
export interface SpendingByDay {
  month: MonthKey;
  timeZone: string;
  currencies: {
    currency: string;
    totalMinor: number;
    dayCount: number;
    days: { day: string; shareMinor: number }[];
    expenses: {
      _id: string;
      group: { _id: string; name: string };
      description: string;
      tag: string;
      paidBy: SpendingByDayPayer[];
      day: string;
      shareMinor: number;
      amountMinor: number;
    }[];
  }[];
}

/**
 * The Expenses one Month of Spending by day reads (#1273): the member's undeleted Expenses in
 * the given Groups, dated from the Month's first day to its last. Expense dates are calendar days
 * stored at midnight UTC (#437), so the Month is its UTC days. The `{ group, isDeleted, date }`
 * index bounds the scan to the Month.
 */
export function spendingByDayFilter(
  userId: string,
  groupIds: readonly Types.ObjectId[],
  month: MonthKey,
) {
  const { dateFrom, dateTo } = expenseMonthRange(month);
  return {
    group: { $in: [...groupIds] },
    isDeleted: false,
    date: { $gte: expenseDate(dateFrom), $lt: new Date(expenseDate(dateTo).getTime() + DAY) },
    'splitBetween.user': userId,
  };
}

/**
 * One Month of the member's Spending by day across their Groups (#1273): every Group they are
 * in today, as the Groups list shows it (archived Groups and Groups they left are not theirs),
 * with recurring Expenses that have fallen due added first, as the other reads do. Only
 * Expenses count, for the member's own share; Settlements, Drafts and To review items are other
 * records. A currency Splitbook no longer supports is left out, as the monthly read does. The
 * time zone decided which Months may be asked for; it is echoed, and moves no Expense.
 */
export async function getSpendingByDay(
  userId: string,
  { month, timeZone, now = new Date() }: { month: MonthKey; timeZone: string; now?: Date },
): Promise<SpendingByDay> {
  return readGroupLedgers({
    actor: { kind: 'member', id: userId },
    archived: 'exclude',
    now,
    sort: { name: 1, _id: 1 },
    read: async (groups) => {
      if (groups.length === 0) return { month, timeZone, currencies: [] };
      const groupNames = new Map(groups.map((group) => [String(group._id), group.name]));
      const expenses = inSupportedCurrencies(
        await Expense.find(
          spendingByDayFilter(
            userId,
            groups.map((group) => group._id),
            month,
          ),
        )
          .select(
            'group description tag currency moneyVersion amount amountMinor date paidBy splitBetween createdAt',
          )
          .lean(),
      );
      // As Balances does: a stored allocation that doesn't add up is refused, never summed.
      for (const expense of expenses) assertStoredExpenseMoney(expense);
      // In the order they were added; the projection orders by day and keeps this order within
      // one. A record without a creation time falls back to its id.
      expenses.sort(
        (a, b) =>
          Number(a.createdAt) - Number(b.createdAt) || String(a._id).localeCompare(String(b._id)),
      );

      const payerIds = [
        ...new Set(expenses.flatMap((expense) => expense.paidBy.map((row) => String(row.user)))),
      ];
      const names = new Map(
        (
          await User.find({ _id: { $in: payerIds } })
            .select('name')
            .lean()
        ).map((person) => [String(person._id), person.name]),
      );

      const byDay = memberSpendingByDay({
        memberId: userId,
        month,
        expenses: expenses.map((expense) => ({
          ...expense,
          splitBetween: expense.splitBetween.map(({ user, amount, amountMinor }) => ({
            user: String(user),
            amount,
            amountMinor,
          })),
        })),
      });

      return {
        month,
        timeZone,
        currencies: byDay.currencies.map(({ currency, totalMinor, dayCount, days, expenses }) => ({
          currency,
          totalMinor,
          dayCount,
          days,
          expenses: expenses.map(({ expense, day, shareMinor }) => ({
            _id: String(expense._id),
            group: { _id: String(expense.group), name: groupNames.get(String(expense.group))! },
            description: expense.description,
            tag: expense.tag,
            paidBy: expense.paidBy.map(({ user }) => {
              const name = names.get(String(user));
              return name === undefined ? { _id: String(user) } : { _id: String(user), name };
            }),
            day,
            shareMinor,
            amountMinor: readStoredAmountMinor(expense),
          })),
        })),
      };
    },
  });
}
