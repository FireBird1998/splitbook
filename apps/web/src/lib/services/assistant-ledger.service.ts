import { readGroupsMetadata, readGroupLedger, readGroupMetadata } from '@/lib/group-ledger-read';
import 'server-only';
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

/** Identity from the validated grant; grant authorization stays in the transport. */
function assistantActor(reader: LedgerReader) {
  return {
    kind: 'assistant' as const,
    id: draftObjectId.parse(reader.id),
    excludedGroupIds: reader.excludedGroupIds ?? [],
  };
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
    const cursor = after ? draftObjectId.parse(after).toLowerCase() : undefined;
    return readGroupsMetadata({
      actor: assistantActor(reader),
      archived: 'include',
      sort: { _id: 1 },
      page: { after: cursor, limit: 51 },
      fields: ['name', 'defaultCurrency', 'alternateCurrencies', 'category', 'isArchived'],
      read: async (page) => {
        return {
          groups: page.slice(0, 50).map((group) => ({
            ...assistantGroup(group),
            alternateCurrencies: normaliseExtraCurrencies(
              group.defaultCurrency,
              group.alternateCurrencies,
            ),
          })),
          next: page.length > 50 ? String(page[49]._id) : null,
        };
      },
    });
  },
  /** Every Group the member belongs to, as the approval page lists them to tick or leave out. */
  async approvalGroups(memberId: string): Promise<ApprovalGroup[]> {
    await connectDB();
    return readGroupsMetadata({
      actor: { kind: 'member', id: draftObjectId.parse(memberId) },
      archived: 'include',
      sort: { name: 1, _id: 1 },
      read: async (_groups, storedGroups) => {
        const groups = await Group.populate<{
          assistantRuleSetBy: { _id: unknown; name: string } | null;
        }>(storedGroups, {
          path: 'assistantRuleSetBy',
          select: 'name',
          options: { lean: true },
        });
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
    });
  },
  async context(reader: LedgerReader, groupId: string) {
    return readGroupMetadata({
      actor: assistantActor(reader),
      groupId,
      read: async (group) => {
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
    });
  },
  async balances(reader: LedgerReader, groupId: string) {
    return readGroupLedger({
      actor: assistantActor(reader),
      groupId,
      read: async (group) => {
        const read = await balanceService.getGroupBalances(group, {
          includeDebtsBeforeSimplifying: false,
        });
        if (!read) throw new Error('Admitted Group was not supplied to Balances');
        const member = assistantMembers(reader.id);
        const bucket = (balances: Pick<typeof read, 'currency' | 'balances' | 'debts'>) => ({
          currency: balances.currency,
          balances: balances.balances.map((row) => ({
            user: member(row.user),
            balance: row.balance,
          })),
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
            'All recorded Expenses and Settlements, per currency. Positive means owed to the member; negative means the member owes. Due recurring Expenses are recorded before this read.',
        };
      },
    });
  },
  async spending(
    reader: LedgerReader,
    input: { groupId: string; from: string; to: string; page: number; limit: number },
  ) {
    return readGroupLedger({
      actor: assistantActor(reader),
      groupId: input.groupId,
      read: async (group) => {
        const result = await expenseService.getGroupExpenses(
          group,
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
          summary: {
            count: result.summary.count,
            totalsByCurrency: result.summary.totalsByCurrency,
          },
          range: {
            from: input.from,
            to: input.to,
            timezone: 'UTC',
            boundaries: 'Inclusive calendar dates, 00:00:00 through 23:59:59.999 UTC',
          },
          context:
            'Totals cover all matching recorded Expenses, not just this page; currencies are separate. Due recurring Expenses are recorded before this read.',
        };
      },
    });
  },
};
