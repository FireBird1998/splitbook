import 'server-only';
import connectDB from '@/lib/db';
import Group from '@/lib/models/Group';
import { EXPENSE_CATEGORIES } from '@splitbook/shared/categories';
import {
  moneyParticipantId,
  readStoredAmountMinor,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import type { StoredAllocationRow, StoredExpenseSplit } from '@splitbook/shared/expense-detail';
import { draftObjectId } from '@splitbook/shared/validators/expense-draft';
import { balanceService } from './balance.service';
import { expenseService } from './expense.service';

/**
 * Members as assistants see them: id and name only, never an email or photo (#438). The
 * connected member is `you: true`, so "I" resolves even beside a namesake. A member whose
 * account is gone has no id and is a "Former member".
 */
function assistantMembers(actorId: string) {
  return (user: unknown) => {
    const id = moneyParticipantId(user);
    if (!id) return { id: null, name: 'Former member' };
    const name = (user as { name?: unknown }).name;
    return {
      id,
      name: typeof name === 'string' ? name : 'Former member',
      ...(id === actorId ? { you: true } : {}),
    };
  };
}

/** A recorded Expense as the Group's Expenses read returns it, populated and with its Tag. */
type RecordedExpense = StoredExpenseSplit & {
  _id: unknown;
  description: string;
  date: Date;
  category?: string;
  tag?: string;
  tagId?: string;
  notes?: string;
  createdBy: unknown;
};

/**
 * A recorded Expense as assistants see it, field by field: nothing else the app stores (receipt
 * links, history, retry or outbox fields, emails or photos) reaches a tool reply (#438).
 */
function assistantExpense(expense: RecordedExpense, member: ReturnType<typeof assistantMembers>) {
  const major = (money: { amount: number; amountMinor?: number }) =>
    toMajorAmount(
      readStoredAmountMinor({
        amount: money.amount,
        amountMinor: money.amountMinor,
        currency: expense.currency,
        moneyVersion: expense.moneyVersion,
      }),
      expense.currency,
    );
  const row = (entry: StoredAllocationRow) => ({
    user: member(entry.user),
    amount: major(entry),
    ...(typeof entry.percentage === 'number' ? { percentage: entry.percentage } : {}),
    ...(typeof entry.shares === 'number' ? { shares: entry.shares } : {}),
  });
  return {
    id: String(expense._id),
    description: expense.description,
    amount: major(expense),
    currency: expense.currency,
    date: new Date(expense.date).toISOString(),
    category: expense.category,
    tag: expense.tag,
    ...(expense.tagId ? { tagId: expense.tagId } : {}),
    ...(expense.notes ? { notes: expense.notes } : {}),
    splitMethod: expense.splitMethod,
    paidBy: expense.paidBy.map(row),
    splitBetween: expense.splitBetween.map(row),
    createdBy: member(expense.createdBy),
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
      members: group.members.map((member) => assistantMembers(actorId)(member.user)),
      tags: group.tags
        .filter((tag) => !tag.isArchived && !tag.isDeleted)
        .map((tag) => ({ id: String(tag._id), name: tag.name })),
      categories: EXPENSE_CATEGORIES.map(({ id, label }) => ({ id, label })),
    };
  },
  async balances(actorId: string, groupId: string) {
    await requireLedgerMembership(actorId, groupId);
    const read = await balanceService.getGroupBalances(groupId, {
      includeDebtsBeforeSimplifying: false,
    });
    if (!read) throw new Error('FORBIDDEN');
    const member = assistantMembers(actorId);
    const bucket = (balances: Pick<typeof read, 'currency' | 'balances' | 'debts'>) => ({
      currency: balances.currency,
      balances: balances.balances.map((row) => ({ user: member(row.user), balance: row.balance })),
      debts: balances.debts.map((debt) => ({
        from: member(debt.from),
        to: member(debt.to),
        amount: debt.amount,
      })),
    });
    return {
      balances: {
        ...bucket(read),
        byCurrency: read.byCurrency.map(bucket),
        hasMixedCurrencies: read.hasMixedCurrencies,
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
        assistantExpense(expense as unknown as RecordedExpense, assistantMembers(actorId)),
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
