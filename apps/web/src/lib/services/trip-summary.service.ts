import connectDB from '@/lib/db';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import Settlement from '@/lib/models/Settlement';
import User from '@/lib/models/User';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { assertStoredExpenseMoney } from '@splitbook/shared/exact-money';
import { findReferencedTag } from '@splitbook/shared/tag-identity';
import {
  hasTripSummary,
  tripSummary,
  type TripPayment,
  type TripSummary,
} from '@splitbook/shared/trip-summary';
import { readTimeZone } from '@splitbook/shared/zoned-calendar';

/** Someone in a suggested payment, named, never with an email. */
interface NamedPerson {
  id: string;
  name: string;
}

/** What the Trip summary read sends: `@splitbook/shared/trip-summary-read` decodes it. */
export interface TripSummaryResponse extends Omit<TripSummary, 'suggestedPayments'> {
  suggestedPayments: (Omit<TripPayment, 'from' | 'to'> & { from: NamedPerson; to: NamedPerson })[];
  /** Whether the Trip has any Expense at all, in any currency. */
  hasExpenses: boolean;
}

export type TripSummaryResult =
  | { kind: 'summary'; summary: TripSummaryResponse }
  /** No Group with this id. */
  | { kind: 'missing' }
  /** The Group's Theme isn't Trip: only a Trip has a Trip summary. */
  | { kind: 'not-a-trip' };

/**
 * A Trip's whole-trip summary, for its Insights tab (#316). The caller has checked membership.
 *
 * - Only a Trip has one: any other Theme gets `not-a-trip`, before anything is generated.
 * - Days are calendar days in the time zone the client sent, never the server's; the Trip's
 *   dates and the Expenses' are read in it alike (`@splitbook/shared/trip-summary`).
 * - Recurring Expenses that have fallen due are added first, as the Group's other reads do, so
 *   the figures agree with them. The generation respects the product-wide switch (#289) and
 *   each Theme's own (a Trip's has none), so on a Trip it adds nothing either way.
 * - Every Expense and Settlement counts, whatever its date: the totals match the trip strip and
 *   the Expenses tab, and the suggested payments match Balances. Expenses outside the Trip's
 *   dates are summed apart, never drawn as days.
 * - Money is exact, in the Group's currency. A legacy Group's Expenses in other currencies are
 *   listed in `otherCurrencies`, never converted.
 * - Tags are read by identity: renamed Tags keep their place, a Tag's current name is shown, and
 *   a legacy name no Tag matches gets no id (it can't filter the Expenses tab).
 * - People in the suggested payments are named from the Group's members, or from their account
 *   when they have left the Group with a balance open, as Balances does; never by email.
 */
export async function getTripSummary(
  groupId: string,
  userId: string,
  { timeZone, now = new Date() }: { timeZone: string; now?: Date },
): Promise<TripSummaryResult> {
  // Fails before any read when the zone is wrong.
  const zone = readTimeZone(timeZone);
  await connectDB();

  const group = await Group.findById(groupId)
    .select('category defaultCurrency startDate endDate tags members')
    .populate('members.user', 'name')
    .lean();
  if (!group) return { kind: 'missing' };
  if (!hasTripSummary(group.category)) return { kind: 'not-a-trip' };

  // Lazy-on-read, as the Group, Expense and Balances reads do. Never throws into the read.
  await recurringExpenseService.generateDueExpenses(groupId, now);

  const [expenses, settlements] = await Promise.all([
    Expense.find({ group: groupId, isDeleted: false })
      .select(
        'description currency moneyVersion amount amountMinor date paidBy splitBetween tag tagId',
      )
      .lean(),
    Settlement.find({ group: groupId })
      .select('currency moneyVersion amount amountMinor paidBy paidTo')
      .lean(),
  ]);
  // As Balances does: a stored allocation that doesn't add up is refused, never summed.
  for (const expense of expenses) assertStoredExpenseMoney(expense);

  const tags = group.tags.map((tag) => ({
    _id: String(tag._id),
    name: tag.name,
    isArchived: Boolean(tag.isArchived),
    isDeleted: Boolean(tag.isDeleted),
  }));
  const money = ({
    user,
    amount,
    amountMinor,
  }: {
    user: unknown;
    amount: number;
    amountMinor?: number;
  }) => ({
    user: String(user),
    amount,
    amountMinor,
  });

  const summary = tripSummary({
    memberId: userId,
    timeZone: zone,
    currency: group.defaultCurrency,
    startDate: group.startDate ?? null,
    endDate: group.endDate ?? null,
    expenses: expenses.map((expense) => {
      const tag = findReferencedTag(tags, { tagId: expense.tagId, tag: expense.tag });
      return {
        id: String(expense._id),
        description: expense.description,
        currency: expense.currency,
        date: expense.date,
        moneyVersion: expense.moneyVersion,
        amount: expense.amount,
        amountMinor: expense.amountMinor,
        paidBy: expense.paidBy.map(money),
        splitBetween: expense.splitBetween.map(money),
        // The Expenses tab filters by any Tag the Group hasn't deleted.
        tag: {
          id: tag && !tag.isDeleted ? String(tag._id) : null,
          name: tag?.name ?? expense.tag,
        },
      };
    }),
    settlements: settlements.map((settlement) => ({
      currency: settlement.currency,
      moneyVersion: settlement.moneyVersion,
      amount: settlement.amount,
      amountMinor: settlement.amountMinor,
      paidBy: String(settlement.paidBy),
      paidTo: String(settlement.paidTo),
    })),
  });

  const names = new Map<string, string>();
  for (const member of group.members) {
    const person = member.user as unknown as { _id: unknown; name?: string } | null;
    if (person?._id && person.name) names.set(String(person._id), person.name);
  }
  const former = [
    ...new Set(summary.suggestedPayments.flatMap(({ from, to }) => [from, to])),
  ].filter((id) => !names.has(id));
  if (former.length > 0) {
    const people = await User.find({ _id: { $in: former } })
      .select('name')
      .lean();
    for (const person of people) names.set(String(person._id), person.name);
  }
  const named = (id: string): NamedPerson => ({ id, name: names.get(id) ?? 'Former member' });

  return {
    kind: 'summary',
    summary: {
      ...summary,
      suggestedPayments: summary.suggestedPayments.map((payment) => ({
        from: named(payment.from),
        to: named(payment.to),
        amountMinor: payment.amountMinor,
      })),
      hasExpenses: expenses.length > 0,
    },
  };
}
