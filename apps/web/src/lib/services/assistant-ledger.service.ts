import 'server-only';
import connectDB from '@/lib/db';
import Group from '@/lib/models/Group';
import { draftObjectId } from '@splitbook/shared/validators/expense-draft';
import { balanceService } from './balance.service';
import { expenseService } from './expense.service';

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
      members: group.members.map((member) => ({
        id: String((member.user as unknown as { _id: unknown })._id),
        name: (member.user as unknown as { name: string }).name,
      })),
      tags: group.tags
        .filter((tag) => !tag.isArchived && !tag.isDeleted)
        .map((tag) => ({ id: String(tag._id), name: tag.name })),
    };
  },
  async balances(actorId: string, groupId: string) {
    await requireLedgerMembership(actorId, groupId);
    return {
      balances: await balanceService.getGroupBalances(groupId),
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
      expenses: result.expenses,
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
