import connectDB from '@/lib/db';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import RecurringExpense from '@/lib/models/RecurringExpense';
import User from '@/lib/models/User';
import { recurringExpensesEnabled } from '@/lib/recurring-expenses-switch';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { CURRENCY_CODES, inSupportedCurrencies } from '@splitbook/shared/currency';
import { assertStoredExpenseMoney, readStoredAmountMinor } from '@splitbook/shared/exact-money';
import {
  openingSpendingCurrency,
  spendingCurrencies,
  type CurrencySpending,
} from '@splitbook/shared/spending-currencies';
import {
  earlierMonths,
  groupMonthInsights,
  groupMonthPaidAndShares,
  groupRecurringMonth,
  groupSpendingByTag,
  type BiggestExpense,
  type GroupMonthInsights,
  type GroupRecurringMonth,
  type MemberPaidAndShare,
  type RecurringTemplateMonth,
  type TagMonthSpending,
} from '@splitbook/shared/insights';
import {
  monthKeyInZone,
  monthsQueryRange,
  readTimeZone,
  type MonthKey,
} from '@splitbook/shared/zoned-calendar';
import { expenseMonth } from '@splitbook/shared/expense-day';

/** Someone the read names: by name and id, never by email. */
interface NamedPerson {
  id: string;
  name: string;
}

/** What the Group insights read sends: `@splitbook/shared/group-insights-read` decodes it. */
export interface GroupInsightsResponse extends Omit<GroupMonthInsights, 'biggestExpense'> {
  biggestExpense: (Omit<BiggestExpense, 'paidBy'> & { paidBy: NamedPerson[] }) | null;
  /** Whether the Group has any Expense at all, in any Month and currency. */
  hasExpenses: boolean;
  /** The Month's spending by Tag, each Tag against its own average of the earlier Months (#315). */
  byTag: { earlierMonths: MonthKey[]; tags: TagMonthSpending[] };
  /** Each person's Paid against their Share in the Month (#315). */
  whoPaid: { members: Array<NamedPerson & Omit<MemberPaidAndShare, 'memberId'>> };
  /** The recurring Expenses card (#315): sent only while recurring Expenses are switched on. */
  recurring?: Omit<GroupRecurringMonth, 'templates'> & {
    templates: Array<Omit<RecurringTemplateMonth, 'paidBy'> & { paidBy: NamedPerson[] }>;
  };
  /** What was spent in the Month in each currency, for the currency switch (#729). */
  currencies: CurrencySpending[];
}

/**
 * A Group's Month against the Months before it, for the Insights tab (#314), and the Month in
 * detail (#315). The caller has checked membership. Null when the Group doesn't exist.
 *
 * - Months are calendar months in the time zone the client sent, never the server's.
 * - Recurring Expenses that have fallen due are added first, as the Group's other reads do, so
 *   the figures agree with them; nothing is added while recurring Expenses are off (#289), and
 *   then no recurring count and no recurring templates are sent either.
 * - The Group's first Month is the earlier of the Month it was created in and the Month of its
 *   earliest Expense (an Expense can be dated before the Group was made). No Month before it is
 *   compared, so a young Group's average isn't pulled down by Months it didn't exist in.
 * - Money is exact, in the Group's currency. A legacy Group with Expenses in other currencies
 *   gets them listed per currency in `otherCurrencies`, never converted and never counted in
 *   the Group's figures, as the Expense list's summary and Month bar count only the Group's
 *   currency.
 * - People are named, never with an email: the biggest Expense's payers, who paid in the Month
 *   and who pays each recurring template.
 * - The fields #315 added (`byTag`, `whoPaid`, `recurring`) follow every field #314 sent, which
 *   are unchanged: Android and older web clients read only those.
 */
export async function getGroupInsights(
  groupId: string,
  userId: string,
  {
    month: requestedMonth,
    compare,
    timeZone,
    currency: requestedCurrency,
    now = new Date(),
  }: { month?: MonthKey; compare: number; timeZone: string; currency?: string; now?: Date },
): Promise<GroupInsightsResponse | null> {
  // Fails before any read when the zone is wrong.
  const zone = readTimeZone(timeZone);
  const month = requestedMonth ?? monthKeyInZone(now, zone);
  await connectDB();

  // Lazy-on-read, as the Group, Expense and Balances reads do. It generates nothing while
  // recurring Expenses are switched off, and never throws into the read.
  await recurringExpenseService.generateDueExpenses(groupId, now);
  const recurringExpenses = recurringExpensesEnabled();

  const group = await Group.findById(groupId)
    .select('defaultCurrency alternateCurrencies createdAt tags members')
    .lean();
  if (!group) return null;

  // Only an Expense in a supported currency starts the Group's Months (#820).
  const earliest = await Expense.findOne({
    group: groupId,
    isDeleted: false,
    currency: { $in: CURRENCY_CODES },
  })
    .sort({ date: 1 })
    .select('date')
    .lean();
  // The Group started in the viewer's Month it was created, or the Month its first Expense is
  // dated if that is earlier: an Expense's Month is the same for everyone (#437).
  const valid = (date: unknown): date is Date =>
    date instanceof Date && Number.isFinite(date.getTime());
  const starts = [
    valid(group.createdAt) ? monthKeyInZone(group.createdAt, zone) : null,
    valid(earliest?.date) ? expenseMonth(earliest.date) : null,
  ].filter((month): month is string => month !== null);
  const firstMonth = starts.length ? starts.sort()[0] : null;

  const months = [...earlierMonths(month, { previousMonths: compare, since: firstMonth }), month];
  const range = monthsQueryRange(months);
  // A currency Splitbook no longer supports has no position, so it is left out (#812, #820).
  const expenses = inSupportedCurrencies(
    await Expense.find({
      group: groupId,
      isDeleted: false,
      date: { $gte: range.from, $lt: range.to },
    })
      .select(
        'description currency moneyVersion amount amountMinor date paidBy splitBetween recurringExpense tag tagId',
      )
      .lean(),
  );
  // As Balances does: a stored allocation that doesn't add up is refused, never summed.
  for (const expense of expenses) assertStoredExpenseMoney(expense);

  const stored = expenses.map((expense) => ({
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
    recurringExpenseId: expense.recurringExpense ? String(expense.recurringExpense) : null,
    tagId: expense.tagId ? String(expense.tagId) : null,
    tag: expense.tag,
  }));
  // What the Month spent in each currency (#729): the switch lists them, and without a currency
  // asked for, the read opens on the one with the most Expenses. Nothing is converted.
  const spending = new Map<string, CurrencySpending>();
  for (const expense of stored) {
    if (expenseMonth(expense.date) !== month) continue;
    const row = spending.get(expense.currency) ?? {
      currency: expense.currency,
      expenseCount: 0,
      spentMinor: 0,
    };
    row.expenseCount += 1;
    row.spentMinor += readStoredAmountMinor(expense);
    spending.set(expense.currency, row);
  }
  const currencies = spendingCurrencies(group, [...spending.values()]);
  const currency = requestedCurrency ?? openingSpendingCurrency(group, [...spending.values()]);

  const insights = groupMonthInsights({
    memberId: userId,
    timeZone: zone,
    month,
    compare,
    firstMonth,
    currency,
    recurringExpenses,
    expenses: stored,
  });
  const byTag = groupSpendingByTag({
    timeZone: zone,
    month,
    compare,
    firstMonth,
    currency,
    tags: group.tags,
    expenses: stored,
  });
  const paidAndShares = groupMonthPaidAndShares({
    timeZone: zone,
    month,
    currency,
    memberIds: group.members.map((member) => String(member.user)),
    expenses: stored,
  });
  const recurring = recurringExpenses
    ? groupRecurringMonth({
        timeZone: zone,
        month,
        currency,
        now,
        templates: (
          await RecurringExpense.find({ group: groupId })
            .select(
              'description currency moneyVersion amount amountMinor dayOfMonth startsOn endsOn isPaused lastGeneratedFor paidBy',
            )
            .lean()
        ).map((template) => ({
          id: String(template._id),
          description: template.description,
          currency: template.currency,
          moneyVersion: template.moneyVersion,
          amount: template.amount,
          amountMinor: template.amountMinor,
          dayOfMonth: template.dayOfMonth,
          startsOn: template.startsOn,
          endsOn: template.endsOn,
          isPaused: template.isPaused,
          lastGeneratedFor: template.lastGeneratedFor,
          paidBy: template.paidBy.map(({ user, amount, amountMinor }) => ({
            user: String(user),
            amount,
            amountMinor,
          })),
        })),
        expenses: stored,
      })
    : null;

  // Everyone the answer names, in one read: names only, never an email.
  const biggest = insights.biggestExpense;
  const named = new Set([
    ...(biggest?.paidBy ?? []),
    ...paidAndShares.map((row) => row.memberId),
    ...(recurring?.templates.flatMap((template) => template.paidBy) ?? []),
  ]);
  const names = new Map<string, string>();
  if (named.size) {
    const people = await User.find({ _id: { $in: [...named] } })
      .select('name')
      .lean();
    for (const person of people) names.set(String(person._id), person.name);
  }
  const person = (id: string): NamedPerson => ({ id, name: names.get(id) ?? 'Former member' });

  return {
    ...insights,
    biggestExpense: biggest ? { ...biggest, paidBy: biggest.paidBy.map(person) } : null,
    hasExpenses: Boolean(earliest),
    byTag: { earlierMonths: byTag.earlierMonths, tags: byTag.tags },
    whoPaid: {
      members: paidAndShares.map(({ memberId, ...figures }) => ({
        ...person(memberId),
        ...figures,
      })),
    },
    ...(recurring
      ? {
          recurring: {
            addedInMonth: recurring.addedInMonth,
            templates: recurring.templates.map((template) => ({
              ...template,
              paidBy: template.paidBy.map(person),
            })),
          },
        }
      : {}),
    currencies,
  };
}
