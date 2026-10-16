import 'server-only';
import connectDB from '@/lib/db';
import Group from '@/lib/models/Group';
import { EXPENSE_CATEGORIES } from '@splitbook/shared/categories';
import { readStoredAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import { draftObjectId } from '@splitbook/shared/validators/expense-draft';
import { balanceService } from './balance.service';
import { expenseService } from './expense.service';

/**
 * A member as assistants see them: id and name only, never an email or photo (#438). The
 * connected member is `you: true`, so "I" resolves even beside a namesake.
 */
function assistantMember(user: { _id: unknown; name?: string }, actorId: string) {
  const id = String(user._id);
  return { id, name: user.name ?? 'Former member', ...(id === actorId ? { you: true } : {}) };
}

type PopulatedUser = { _id: unknown; name?: string };
type RecordedRow = {
  user: PopulatedUser;
  amount?: number;
  amountMinor?: number;
  percentage?: number;
  shares?: number;
};
/** A recorded Expense as the Group's Expenses read returns it, populated and with its Tag. */
type RecordedExpense = {
  _id: unknown;
  description: string;
  amount?: number;
  amountMinor?: number;
  moneyVersion?: number;
  currency: string;
  date: Date;
  category?: string;
  tag?: string;
  tagId?: string;
  notes?: string;
  splitMethod: string;
  paidBy: RecordedRow[];
  splitBetween: RecordedRow[];
  createdBy: PopulatedUser;
};

/**
 * A recorded Expense as assistants see it, field by field: nothing else the app stores (receipt
 * links, history, retry or outbox fields, emails or photos) reaches a tool reply (#438). Its
 * date is the UTC calendar day the tool's ranges use.
 */
function assistantExpense(expense: RecordedExpense, actorId: string) {
  const major = (money: { amount?: number; amountMinor?: number }) =>
    toMajorAmount(
      readStoredAmountMinor({
        ...money,
        currency: expense.currency,
        moneyVersion: expense.moneyVersion,
      }),
      expense.currency,
    );
  const row = (entry: RecordedRow) => ({
    member: assistantMember(entry.user, actorId),
    amount: major(entry),
    ...(typeof entry.percentage === 'number' ? { percentage: entry.percentage } : {}),
    ...(typeof entry.shares === 'number' ? { shares: entry.shares } : {}),
  });
  return {
    id: String(expense._id),
    description: expense.description,
    amount: major(expense),
    currency: expense.currency,
    date: new Date(expense.date).toISOString().slice(0, 10),
    category: expense.category ?? 'other',
    tag: expense.tag
      ? { ...(expense.tagId ? { id: expense.tagId } : {}), name: expense.tag }
      : null,
    ...(expense.notes ? { notes: expense.notes } : {}),
    splitMethod: expense.splitMethod,
    paidBy: expense.paidBy.map(row),
    splitBetween: expense.splitBetween.map(row),
    addedBy: assistantMember(expense.createdBy, actorId),
  };
}

export async function requireLedgerMembership(actorId: string, groupId: string) {
  await connectDB();
  const group = await Group.findOne({
    _id: draftObjectId.parse(groupId),
    'members.user': draftObjectId.parse(actorId),
    deletionRequestedAt: null,
  })
    .populate('members.user', 'name')
    .lean();
  if (!group) throw new Error('FORBIDDEN');
  return group;
}
export const assistantLedgerService = {
  async groups(actorId: string, after?: string) {
    await connectDB();
    const groups = await Group.find({
      'members.user': draftObjectId.parse(actorId),
      deletionRequestedAt: null,
      ...(after ? { _id: { $gt: draftObjectId.parse(after) } } : {}),
    })
      .sort({ _id: 1 })
      .limit(51)
      .select('name defaultCurrency category isArchived')
      .lean();
    return {
      groups: groups.slice(0, 50).map((group) => ({
        id: String(group._id),
        name: group.name,
        currency: group.defaultCurrency,
        theme: group.category,
        archived: group.isArchived,
      })),
      next: groups.length > 50 ? String(groups[49]._id) : null,
    };
  },
  async context(actorId: string, groupId: string) {
    const group = await requireLedgerMembership(actorId, groupId);
    return {
      id: String(group._id),
      name: group.name,
      currency: group.defaultCurrency,
      members: group.members.map((member) =>
        assistantMember(member.user as unknown as { _id: unknown; name?: string }, actorId),
      ),
      tags: group.tags
        .filter((tag) => !tag.isArchived && !tag.isDeleted)
        .map((tag) => ({ id: String(tag._id), name: tag.name })),
      categories: EXPENSE_CATEGORIES.map(({ id, label }) => ({ id, label })),
    };
  },
  async balances(actorId: string, groupId: string) {
    await requireLedgerMembership(actorId, groupId);
    const read = await balanceService.getGroupBalances(groupId);
    if (!read) throw new Error('FORBIDDEN');
    const member = (user: { _id: unknown; name?: string }) => assistantMember(user, actorId);
    return {
      balances: {
        hasMixedCurrencies: read.hasMixedCurrencies,
        byCurrency: read.byCurrency.map((bucket) => ({
          currency: bucket.currency,
          balances: bucket.balances.map((row) => ({
            member: member(row.user),
            balance: row.balance,
          })),
          debts: bucket.debts.map((debt) => ({
            from: member(debt.from),
            to: member(debt.to),
            amount: debt.amount,
          })),
        })),
      },
      context:
        'All recorded Expenses and Settlements, per currency. Positive means owed to the member; negative means the member owes. Scheduled recurring Expenses not yet recorded are excluded. This read creates nothing.',
    };
  },
  async spending(
    actorId: string,
    input: { groupId: string; from: string; to: string; page: number; limit: number },
  ) {
    await requireLedgerMembership(actorId, input.groupId);
    const result = await expenseService.getGroupExpenses(
      input.groupId,
      {
        dateFrom: input.from,
        dateTo: input.to,
        page: input.page,
        limit: input.limit,
        sortBy: 'date',
        sortOrder: 'desc',
      },
      actorId,
    );
    return {
      expenses: result.expenses.map((expense) =>
        assistantExpense(expense as unknown as RecordedExpense, actorId),
      ),
      pagination: result.pagination,
      // The canonical UI also has legacy default-currency-only scalar totals. An
      // assistant response exposes only explicitly denominated, full-range totals.
      summary: { count: result.summary.count, totalsByCurrency: result.summary.totalsByCurrency },
      range: {
        from: input.from,
        to: input.to,
        timezone: 'UTC',
        boundaries: 'Inclusive calendar dates, 00:00:00 through 23:59:59.999 UTC',
      },
      context:
        'Totals cover all matching recorded Expenses, not just this page; currencies are separate. Does not materialize scheduled recurring Expenses.',
    };
  },
};
