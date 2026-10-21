import 'server-only';
import { assistantGroupFilter } from '@splitbook/shared/assistant-reach';
import connectDB from '@/lib/db';
import Group from '@/lib/models/Group';
import '@/lib/models/User'; // Registered for the rule's admin, populated below
import type { AssistantRule } from '@splitbook/shared/assistant-rule';
import { normaliseExtraCurrencies } from '@splitbook/shared/group-currencies';
import { EXPENSE_CATEGORIES } from '@splitbook/shared/categories';
import {
  moneyParticipantId,
  readStoredAmountMinor,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import type { StoredAllocationRow, StoredExpenseSplit } from '@splitbook/shared/expense-detail';
import type { GroupCategory } from '@splitbook/shared/types';
import { draftObjectId } from '@splitbook/shared/validators/expense-draft';
import { balanceService } from './balance.service';
import { expenseService } from './expense.service';
import type { DraftActor } from './expense-draft.service';

/** Who reads the ledger through an assistant, and the Groups their connection leaves out (#617). */
type LedgerReader = Pick<DraftActor, 'id' | 'excludedGroupIds'>;

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

/**
 * A Group the reader belongs to and their connection reaches: not one they left out (#617), nor
 * one whose admins don't allow assistants (#621). One out of reach answers exactly as a Group
 * that doesn't exist.
 */
export async function requireLedgerMembership(reader: LedgerReader, groupId: string) {
  await connectDB();
  const reach = assistantGroupFilter({
    memberId: draftObjectId.parse(reader.id),
    excludedGroupIds: reader.excludedGroupIds,
  });
  const group = await Group.findOne({
    ...reach,
    _id: { ...reach._id, $eq: draftObjectId.parse(groupId) },
  })
    .populate('members.user', 'name')
    .lean();
  if (!group) throw new Error('GROUP_NOT_FOUND');
  return group;
}

/** A Group as an assistant sees it in a list: no members, Expenses or Balances. */
function assistantGroup(group: {
  _id: unknown;
  name: string;
  defaultCurrency: string;
  category: GroupCategory;
  isArchived: boolean;
}) {
  return {
    id: String(group._id),
    name: group.name,
    currency: group.defaultCurrency,
    theme: group.category,
    archived: group.isArchived,
  };
}
export type AssistantGroup = ReturnType<typeof assistantGroup>;

/**
 * A Group as the approval page lists it (#617): every currency it uses, default first, and its
 * Assistant rule with the admin who set Not allowed (#621).
 */
export type ApprovalGroup = AssistantGroup & {
  currencies: readonly string[];
  rule: AssistantRule;
  ruleSetBy: { id: string; name: string } | null;
};

export const assistantLedgerService = {
  async groups(reader: LedgerReader, after?: string) {
    await connectDB();
    const reach = assistantGroupFilter({
      memberId: draftObjectId.parse(reader.id),
      excludedGroupIds: reader.excludedGroupIds,
    });
    const groups = await Group.find({
      ...reach,
      // Groups out of reach are filtered in the query, so a page is never short of what it says.
      _id: {
        ...reach._id,
        ...(after ? { $gt: draftObjectId.parse(after) } : {}),
      },
    })
      .sort({ _id: 1 })
      .limit(51)
      .select('name defaultCurrency alternateCurrencies category isArchived')
      .lean();
    return {
      groups: groups.slice(0, 50).map((group) => ({
        ...assistantGroup(group),
        alternateCurrencies: normaliseExtraCurrencies(
          group.defaultCurrency,
          group.alternateCurrencies,
        ),
      })),
      next: groups.length > 50 ? String(groups[49]._id) : null,
    };
  },
  /** Every Group the member belongs to, as the approval page lists them to tick or leave out. */
  async approvalGroups(memberId: string): Promise<ApprovalGroup[]> {
    await connectDB();
    const groups = await Group.find({
      'members.user': draftObjectId.parse(memberId),
      deletionRequestedAt: null,
    })
      .sort({ name: 1, _id: 1 })
      .select(
        'name defaultCurrency alternateCurrencies category isArchived members assistantRule assistantRuleSetBy',
      )
      .populate<{ assistantRuleSetBy: { _id: unknown; name: string } | null }>(
        'assistantRuleSetBy',
        'name',
      )
      .lean();
    return groups.map((group) => {
      // A Group stored before the rule is Allowed.
      const rule = group.assistantRule ?? 'allowed';
      const setBy = rule === 'not_allowed' ? group.assistantRuleSetBy : null;
      // Named while they are still an admin here; otherwise the page names the Group's admins.
      const admin =
        setBy &&
        group.members.some(
          (member) => String(member.user) === String(setBy._id) && member.role === 'admin',
        );
      return {
        ...assistantGroup(group),
        currencies: [group.defaultCurrency, ...(group.alternateCurrencies ?? [])],
        rule,
        ruleSetBy: admin ? { id: String(setBy._id), name: setBy.name } : null,
      };
    });
  },
  async context(reader: LedgerReader, groupId: string) {
    const group = await requireLedgerMembership(reader, groupId);
    return {
      id: String(group._id),
      name: group.name,
      currency: group.defaultCurrency,
      alternateCurrencies: normaliseExtraCurrencies(
        group.defaultCurrency,
        group.alternateCurrencies,
      ),
      members: group.members.map((member) => assistantMembers(reader.id)(member.user)),
      tags: group.tags
        .filter((tag) => !tag.isArchived && !tag.isDeleted)
        .map((tag) => ({ id: String(tag._id), name: tag.name })),
      categories: EXPENSE_CATEGORIES.map(({ id, label }) => ({ id, label })),
    };
  },
  async balances(reader: LedgerReader, groupId: string) {
    await requireLedgerMembership(reader, groupId);
    const read = await balanceService.getGroupBalances(groupId, {
      includeDebtsBeforeSimplifying: false,
    });
    if (!read) throw new Error('GROUP_NOT_FOUND');
    const member = assistantMembers(reader.id);
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
    reader: LedgerReader,
    input: { groupId: string; from: string; to: string; page: number; limit: number },
  ) {
    await requireLedgerMembership(reader, input.groupId);
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
      reader.id,
    );
    return {
      expenses: result.expenses.map((expense) =>
        assistantExpense(expense as unknown as RecordedExpense, assistantMembers(reader.id)),
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
