import { readGroupLedger } from '@/lib/group-ledger-read';
import type { LedgerReadGroup } from '@/lib/group-ledger-read';
import { Refusal, type RefusalCode } from '@splitbook/shared/refusals';
import { inGroupCurrencyOrder } from '@splitbook/shared/group-currencies';
import type { AssistantAttribution } from '@splitbook/shared/draft-attribution';
import connectDB from '@/lib/db';
import { changeLedgerExpense, recordLedger, type ExpenseAccess } from '@/lib/ledger-recording';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Group from '@/lib/models/Group';
import '@/lib/models/User'; // Ensure User model is registered for populate()
import type { CreateExpenseInput, UpdateExpenseInput } from '@splitbook/shared/validators/expense';
import type { ExpenseFilters } from '@splitbook/shared/types';
import { getQuickFilterDates, toInclusiveDateToBound } from '@splitbook/shared/date';
import { escapeRegex } from '@splitbook/shared/escape-regex';
import {
  assertExpenseParticipants,
  assertGroupCurrency,
} from '@splitbook/shared/expense-validation';
import {
  computeMemberBreakdown,
  computeUserOweGetBack,
  type LeanExpenseContribution,
} from '@splitbook/shared/expense-summary';
import {
  MoneyValidationError,
  assertStoredExpenseMoney,
  normalizeExpenseMoney,
  parseAmountMinor,
  readStoredAmountMinor,
  readUnsupportedAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
  unsupportedMajorAmount,
} from '@splitbook/shared/exact-money';
import { getCurrency, getCurrencyPrecision } from '@splitbook/shared/currency';
import {
  decideExpenseMoneyEdit,
  unsupportedCurrencyEditRefusal,
} from '@splitbook/shared/expense-money-edit';
import { involvedMembers, requestTagForReplay } from '@/lib/financial-write';
import mongoose from 'mongoose';
import {
  displayTagReference,
  findReferencedTag,
  resolveTagReference,
} from '@splitbook/shared/tag-identity';
import { expenseDate, expenseDay } from '@splitbook/shared/expense-day';
import { PERSON_FIELDS } from './person-fields';
import { GROUP_ARCHIVED_MESSAGE } from '@splitbook/shared/group-archive';
import type {
  ExpenseTagChangeRequest,
  ExpenseTagChangeResult,
} from '@splitbook/shared/expense-tag-change';

export type { ExpenseAccess } from '@/lib/ledger-recording';

/** Why one Expense of a Tag change couldn't change, in member words, by the error that said so. */
const tagChangeRefusals: Partial<Record<RefusalCode, string>> = {
  FORBIDDEN: 'You’re no longer a member of this Group.',
  GROUP_ARCHIVED: GROUP_ARCHIVED_MESSAGE,
  INVALID_TAG: 'The Tag isn’t active any more.',
  ACTIVITY_BACKLOG_FULL: 'Splitbook couldn’t record this change just now. Try it again later.',
};

/**
 * The stored-amount bounds for an Expense list's amount range (#310), or null without one.
 * The range is read exactly, in minor units of the Group's currency, so "1249.50" is 124950
 * paise; text with more decimal places than the currency has is refused. Every stored amount
 * is a whole number of minor units, so the bounds sit half a minor unit outside the range:
 * an older Expense whose amount carries a binary tail (0.30000000000000004) still matches.
 */
export function expenseAmountRange(
  filters: Pick<ExpenseFilters, 'amountMin' | 'amountMax'>,
  currency: string,
): { $gte?: number; $lt?: number } | null {
  if (filters.amountMin === undefined && filters.amountMax === undefined) return null;
  const min =
    filters.amountMin === undefined ? null : parseAmountMinor(filters.amountMin, currency);
  const max =
    filters.amountMax === undefined ? null : parseAmountMinor(filters.amountMax, currency);
  if (min !== null && max !== null && min > max) {
    throw new MoneyValidationError(
      'INVALID_AMOUNT_RANGE',
      'The lowest amount must not be more than the highest',
    );
  }
  const scale = 10 ** getCurrencyPrecision(currency);
  return {
    ...(min === null ? {} : { $gte: (min - 0.5) / scale }),
    ...(max === null ? {} : { $lt: (max + 0.5) / scale }),
  };
}

export class ExpenseService {
  private async requireWritableGroup({ actorId, groupId }: ExpenseAccess) {
    await connectDB();
    const group = await Group.findOne({ _id: groupId, 'members.user': actorId });
    if (!group) throw new Refusal('FORBIDDEN');
    // An archived Group can still be read, but takes no more changes (#578).
    if (group.isArchived) throw new Refusal('GROUP_ARCHIVED');
    return group;
  }

  /**
   * Create a new expense.
   */
  async create(
    groupId: string,
    data: CreateExpenseInput,
    userId: string,
    requestKey?: string,
    options?: { preparedBy?: AssistantAttribution },
  ) {
    const {
      records: [expense],
    } = await recordLedger({
      groupId,
      actor: { id: userId, source: 'member' },
      model: Expense,
      transactions: 'allow-standalone',
      retry: requestKey ? { key: requestKey, submittedTagAlias: data.tag } : undefined,
      command({ group, receipt }) {
        const incoming = receipt ? requestTagForReplay(data, receipt) : data;
        const money = normalizeExpenseMoney(incoming);
        const tagReference =
          receipt && incoming.tagId
            ? { tagId: incoming.tagId, tag: incoming.tag ?? receipt.tag }
            : resolveTagReference(group!.tags, incoming);
        return {
          ...incoming,
          ...money,
          ...tagReference,
          notes: incoming.notes ?? '',
          predefinedItem: incoming.predefinedItem ?? null,
        };
      },
      currencies: [{ currency: data.currency, rule: 'new-money' }],
      checkPeople(members) {
        assertExpenseParticipants(members, data.paidBy, data.splitBetween);
      },
      async prepare(command, group) {
        assertExpenseParticipants(
          new Set(group!.members.map((member) => String(member.user))),
          data.paidBy,
          data.splitBetween,
        );
        assertGroupCurrency(group!, data.currency);
        const id = new mongoose.Types.ObjectId();
        return [
          {
            id,
            async build() {
              return {
                document: { ...command, preparedBy: options?.preparedBy },
                activity: {
                  type: 'expense_added',
                  metadata: {
                    ...(options?.preparedBy ? { preparedBy: options.preparedBy } : {}),
                    expenseId: String(id),
                    description: data.description,
                    amount: command.amount,
                    currency: data.currency,
                  },
                  alert: {
                    kind: 'expense_added',
                    involved: involvedMembers(data),
                    switch: 'always',
                  },
                },
              };
            },
          },
        ];
      },
      async prepareResponseRecord(record, { group }) {
        record.tag = displayTagReference(group!.tags, record).tag;
        await record.populate([
          { path: 'paidBy.user', select: PERSON_FIELDS },
          { path: 'splitBetween.user', select: PERSON_FIELDS },
          { path: 'createdBy', select: PERSON_FIELDS },
        ]);
      },
    });
    return expense;
  }

  /**
   * Get expenses for a group with filters and pagination.
   * Optionally computes a summary (total, user owe/get-back) for the filtered set.
   */
  async getGroupExpenses(
    groupOrId: string | LedgerReadGroup,
    filters: ExpenseFilters = {},
    userId?: string,
  ) {
    const groupId = typeof groupOrId === 'string' ? groupOrId : String(groupOrId._id);
    const admittedGroup = typeof groupOrId === 'string' ? undefined : groupOrId;
    await connectDB();

    const tagGroup =
      admittedGroup ??
      (await Group.findById(groupId).select('tags defaultCurrency alternateCurrencies').lean());
    const groupTags = tagGroup?.tags ?? [];
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    // Build filter query
    const query: Record<string, unknown> = {
      group: new mongoose.Types.ObjectId(groupId),
      isDeleted: false,
    };

    // Date range filter
    if (filters.quickFilter && filters.quickFilter !== 'all') {
      const dates = getQuickFilterDates(filters.quickFilter);
      if (dates) {
        query.date = { $gte: dates.from, $lte: dates.to };
      }
    } else if (filters.dateFrom || filters.dateTo) {
      query.date = {};
      if (filters.dateFrom)
        (query.date as Record<string, unknown>).$gte = new Date(filters.dateFrom);
      if (filters.dateTo)
        (query.date as Record<string, unknown>).$lte = toInclusiveDateToBound(filters.dateTo);
    }

    // Category filter
    if (filters.category) {
      query.category = filters.category;
    }

    // Tag filter
    if (filters.tagId || filters.tag) {
      const selected = findReferencedTag(groupTags, filters);
      if (selected) {
        const idMatch = { tagId: new mongoose.Types.ObjectId(String(selected._id)) };
        const uniqueName = groupTags.filter((tag) => tag.name === selected.name).length === 1;
        query.$or = uniqueName ? [idMatch, { tagId: null, tag: selected.name }] : [idMatch];
      } else if (filters.tagId) {
        // Unknown/foreign IDs match nothing, rather than leaking another Group.
        query._id = { $in: [] };
      } else {
        query.tagId = null;
        query.tag = filters.tag;
      }
    }

    // Search filter (regex on description)
    if (filters.search) {
      query.description = { $regex: escapeRegex(filters.search), $options: 'i' };
    }

    // Paid-by member filter
    if (filters.paidByUser) {
      query['paidBy.user'] = new mongoose.Types.ObjectId(filters.paidByUser);
    }

    // Owed-by member filter (who is in splitBetween)
    if (filters.owedByUser) {
      query['splitBetween.user'] = new mongoose.Types.ObjectId(filters.owedByUser);
    }

    // "Involves me" (#310): the member paid part of it or has a share of it. A row of zero
    // (a member left out of a split by shares) doesn't count, as in the shared position.
    if (filters.involvesUser) {
      const part = {
        $elemMatch: { user: new mongoose.Types.ObjectId(filters.involvesUser), amount: { $gt: 0 } },
      };
      query.$and = [{ $or: [{ paidBy: part }, { splitBetween: part }] }];
    }

    // Amount range (#310), inclusive, in the Group's currency.
    const amountRange = expenseAmountRange(filters, tagGroup?.defaultCurrency ?? 'INR');
    if (amountRange) query.amount = amountRange;

    // Sort
    const sortField = filters.sortBy === 'amount' ? 'amount' : 'date';
    const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;

    // Run paginated query + count + summary aggregation in parallel
    const [expenses, total, summaryAgg] = await Promise.all([
      Expense.find(query)
        .select('-editHistory')
        .sort({ [sortField]: sortOrder, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('paidBy.user', PERSON_FIELDS)
        .populate('splitBetween.user', PERSON_FIELDS)
        .populate('createdBy', PERSON_FIELDS)
        .lean(),
      Expense.countDocuments(query),
      Expense.find(query)
        .select('currency moneyVersion amount amountMinor recurringExpense')
        .lean(),
    ]);

    // User owe/get-back and the opt-in per-member breakdown come from the
    // same pass over the full filtered set (not just the current page).
    let userOwes = 0;
    let userGetsBack = 0;
    let byMember: import('@splitbook/shared/types').ExpenseMemberBreakdownRow[] | undefined;
    let userByCurrency: import('@splitbook/shared/types').ExpenseCurrencyPosition[] | undefined;

    if (userId || filters.includeMemberBreakdown) {
      // For efficiency, if total <= limit we already have all. Otherwise run a lean query.
      let allFiltered = expenses;
      if (total > limit || page > 1) {
        allFiltered = await Expense.find(query)
          .select('currency moneyVersion amount amountMinor paidBy splitBetween')
          .lean();
      }
      // Stored money outlives today's currency list (#779, #810): an Expense in a currency
      // Splitbook no longer supports is listed as stored, unchecked, and left out of every figure.
      for (const record of allFiltered)
        if (getCurrency(record.currency)) assertStoredExpenseMoney(record);
      const window = allFiltered.filter(
        (row) => row.currency === tagGroup?.defaultCurrency,
      ) as LeanExpenseContribution[];

      if (userId) {
        const oweGetBack = computeUserOweGetBack(
          window,
          userId,
          tagGroup?.defaultCurrency ?? 'INR',
        );
        userOwes = oweGetBack.userOwes;
        userGetsBack = oweGetBack.userGetsBack;
        // On request, each currency's own figures the same way, in the Group's order: the main
        // currency, its extra currencies, then any other one the Expenses are still in (#759).
        if (filters.includeUserByCurrency) {
          userByCurrency = inGroupCurrencyOrder(
            {
              defaultCurrency: tagGroup?.defaultCurrency ?? 'INR',
              alternateCurrencies: tagGroup?.alternateCurrencies,
            },
            allFiltered.map((row) => row.currency as string),
          )
            // A currency Splitbook no longer supports has no position (#810).
            .filter((currency) => getCurrency(currency))
            .map((currency) => ({
              currency,
              ...computeUserOweGetBack(
                allFiltered.filter((row) => row.currency === currency) as LeanExpenseContribution[],
                userId,
                currency,
              ),
            }));
        }
      }

      if (filters.includeMemberBreakdown) {
        const group =
          admittedGroup ??
          (await Group.findById(groupId)
            .select('members')
            .populate('members.user', 'name image')
            .lean());
        const members = (group?.members || []) as Array<{
          user: { _id: unknown; name?: string; image?: string };
        }>;
        const memberIds = members.map((member) => String(member.user._id));

        byMember = computeMemberBreakdown(
          window,
          memberIds,
          tagGroup?.defaultCurrency ?? 'INR',
        ).map((row) => {
          const member = members.find((candidate) => String(candidate.user._id) === row.userId);
          return {
            user: {
              _id: row.userId,
              name: member?.user?.name ?? 'Former member',
              image: member?.user?.image,
            },
            paid: row.paid,
            share: row.share,
            net: row.net,
          };
        });
      }
    }

    const summaryCurrencies = new Map<string, number[]>();
    // A currency Splitbook no longer supports is totalled as stored, never converted, and comes
    // last: Spent has a line for it, as the count has its Expenses (#810).
    const unsupported = new Map<string, number[]>();
    for (const record of summaryAgg) {
      const supported = !!getCurrency(record.currency);
      const totals = supported ? summaryCurrencies : unsupported;
      const values = totals.get(record.currency) ?? [];
      values.push(supported ? readStoredAmountMinor(record) : readUnsupportedAmountMinor(record));
      totals.set(record.currency, values);
    }
    const totalsByCurrency = [
      ...[...summaryCurrencies].map(([currency, values]) => ({
        currency,
        totalAmount: toMajorAmount(sumMinorAmounts(values), currency),
      })),
      ...[...unsupported]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([currency, values]) => ({
          currency,
          totalAmount: unsupportedMajorAmount(sumMinorAmounts(values)),
        })),
    ];
    const summaryData = {
      totalAmount:
        totalsByCurrency.find((row) => row.currency === tagGroup?.defaultCurrency)?.totalAmount ??
        0,
      count: summaryAgg.length,
    };

    // This optional part uses the same admitted ledger read. Its window is independent of
    // the visible Month and never changes that list's pagination, totals or member shares.
    const firstUnfilteredPage =
      page === 1 &&
      limit >= 20 &&
      total <= 20 &&
      Object.keys(query).every((key) => key === 'group' || key === 'isDeleted') &&
      sortField === 'date' &&
      sortOrder === -1;
    const recent = filters.includeRecent
      ? await Promise.all([
          firstUnfilteredPage
            ? Promise.resolve(expenses.slice(0, 20))
            : Expense.find({ group: groupId, isDeleted: false })
                .select(
                  'group description amount amountMinor moneyVersion currency date createdAt paidBy',
                )
                .sort({ createdAt: -1, _id: -1 })
                .limit(20)
                .populate('paidBy.user', PERSON_FIELDS)
                .lean(),
          Settlement.find({ group: groupId })
            .select(
              'group paidBy paidTo amount amountMinor moneyVersion currency paidCurrency amountPaidMinor createdAt',
            )
            .sort({ createdAt: -1 })
            .limit(20)
            .populate('paidBy', PERSON_FIELDS)
            .populate('paidTo', PERSON_FIELDS)
            .lean(),
        ]).then(([expenses, settlements]) => ({
          expenses: [...expenses]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map(
              ({
                _id,
                group,
                description,
                amount,
                amountMinor,
                moneyVersion,
                currency,
                date,
                createdAt,
                paidBy,
              }) => ({
                _id,
                group,
                description,
                amount,
                amountMinor,
                moneyVersion,
                currency,
                date,
                createdAt,
                paidBy: paidBy.map(({ user, amount, amountMinor }) => ({
                  user,
                  amount,
                  amountMinor,
                })),
              }),
            ),
          settlements,
        }))
      : undefined;
    return {
      ...(recent ? { recent } : {}),
      expenses: expenses.map((expense) => ({
        ...expense,
        ...displayTagReference(groupTags, expense),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalAmount: summaryData.totalAmount,
        totalsByCurrency,
        count: summaryData.count,
        userOwes,
        userGetsBack,
        ...(byMember ? { byMember } : {}),
        ...(userByCurrency ? { userByCurrency } : {}),
        ...(filters.includeRecurringCount
          ? { recurringCount: summaryAgg.filter((record) => record.recurringExpense).length }
          : {}),
      },
    };
  }

  /**
   * Read an expense only through its group and a current group member.
   */
  async getById(access: ExpenseAccess) {
    return readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      read: async (_populatedGroup, group) => {
        const expense = await Expense.findOne({ _id: access.expenseId, group: access.groupId })
          .populate('paidBy.user', PERSON_FIELDS)
          .populate('splitBetween.user', PERSON_FIELDS)
          .populate('createdBy', PERSON_FIELDS)
          .populate('editHistory.editedBy', PERSON_FIELDS)
          .lean();
        return expense
          ? {
              ...expense,
              revision: expense.revision ?? 0,
              ...displayTagReference(group.tags ?? [], expense),
            }
          : null;
      },
    });
  }

  /**
   * Update an expense. Handles both edits and restore (isDeleted: false).
   */
  async update(access: ExpenseAccess, data: UpdateExpenseInput, expectedRevision?: number) {
    const expense = await changeLedgerExpense({
      access,
      expectedRevision,
      change(expense, group) {
        const original = expense.toObject();
        // Money in a currency Splitbook no longer supports stays as it was recorded, with no
        // position: such an Expense can be deleted, never changed (#820).
        if (!getCurrency(original.currency))
          throw new MoneyValidationError(
            'UNSUPPORTED_CURRENCY',
            unsupportedCurrencyEditRefusal(original.currency),
          );
        const { financialEdit, money } = decideExpenseMoneyEdit(original, data);
        if (financialEdit)
          assertExpenseParticipants(
            new Set(group.members.map((member) => String(member.user))),
            money.paidBy,
            money.splitBetween,
          );
        if (data.currency !== undefined && data.currency !== original.currency)
          assertGroupCurrency(group, data.currency);
        const tagReference = resolveTagReference(group.tags, data, expense);
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        const resultingChanges = { ...data, ...(financialEdit ? money : {}), ...tagReference };
        for (const [key, value] of Object.entries(resultingChanges)) {
          if (
            key === 'isDeleted' ||
            (!financialEdit &&
              ['amount', 'currency', 'paidBy', 'splitBetween', 'splitMethod'].includes(key))
          )
            continue;
          const oldValue = (original as unknown as Record<string, unknown>)[key];
          if (JSON.stringify(oldValue) !== JSON.stringify(value))
            changes[key] = { old: oldValue, new: value };
        }
        const restoring = data.isDeleted === false && expense.isDeleted;
        Object.assign(expense, data, money, tagReference);
        if (restoring) {
          expense.deletedAt = null;
          expense.deletedBy = null;
        }
        if (Object.keys(changes).length)
          expense.editHistory.push({
            editedBy: new mongoose.Types.ObjectId(access.actorId),
            editedAt: new Date(),
            changes,
          });
        return {
          financialEdit,
          activity:
            restoring || Object.keys(changes).length
              ? {
                  type: 'expense_updated',
                  metadata: {
                    expenseId: access.expenseId,
                    description: expense.description,
                    ...(restoring ? { action: 'restored' } : { changes }),
                  },
                }
              : undefined,
        };
      },
    });
    if (!expense) return null;
    return expense.populate([
      { path: 'paidBy.user', select: PERSON_FIELDS },
      { path: 'splitBetween.user', select: PERSON_FIELDS },
      { path: 'createdBy', select: PERSON_FIELDS },
    ]);
  }

  /**
   * Move several Expenses to one Tag (#610). The member, the Group and the Tag are checked once;
   * then each Expense changes on its own, as a single edit does, with its own history entry and
   * Activity event, so one that can't change never stops the rest. An Expense already on the Tag
   * is left as it is, so a retry edits nothing twice. Nothing is retried.
   */
  async changeTags(
    groupId: string,
    actorId: string,
    { tagId, expenses }: ExpenseTagChangeRequest,
  ): Promise<ExpenseTagChangeResult[]> {
    const group = await this.requireWritableGroup({ actorId, groupId, expenseId: '' });
    const tag = group.tags.find((entry) => String(entry._id) === tagId);
    if (!tag || tag.isArchived || tag.isDeleted) throw new Refusal('INVALID_TAG');
    const results: ExpenseTagChangeResult[] = [];
    for (const { id, revision } of expenses)
      results.push(await this.changeTag({ actorId, groupId, expenseId: id }, tagId, revision));
    return results;
  }

  /** One Expense of `changeTags`: what happened to it, never an error that loses the others. */
  private async changeTag(
    access: ExpenseAccess,
    tagId: string,
    revision: number,
  ): Promise<ExpenseTagChangeResult> {
    const expenseId = access.expenseId;
    const current = await Expense.findOne({ _id: expenseId, group: access.groupId })
      .select('tagId revision isDeleted')
      .lean();
    if (!current || current.isDeleted) return { expenseId, outcome: 'unavailable' };
    if (current.tagId && String(current.tagId) === tagId)
      return { expenseId, outcome: 'unchanged', revision: current.revision ?? 0 };
    try {
      const changed = await this.update(access, { tagId }, revision);
      return changed
        ? { expenseId, outcome: 'changed', revision: changed.revision ?? 0 }
        : { expenseId, outcome: 'unavailable' };
    } catch (error) {
      if (error instanceof MoneyValidationError && error.code === 'UNSUPPORTED_CURRENCY')
        return { expenseId, outcome: 'refused', code: error.code, reason: error.message };
      const code =
        error instanceof Error
          ? error.name === 'VersionError'
            ? 'STALE_REVISION'
            : error.message
          : '';
      if (code === 'STALE_REVISION') return { expenseId, outcome: 'changed-elsewhere' };
      // The lookup also receives fault messages outside RefusalCode.
      const words: Readonly<Record<string, string | undefined>> = tagChangeRefusals;
      const reason = words[code];
      if (!reason) console.error('Expense Tag change failed:', { expenseId, error });
      return {
        expenseId,
        outcome: 'refused',
        ...(reason ? { code } : {}),
        reason: reason ?? 'Splitbook couldn’t change this Expense.',
      };
    }
  }

  /** Soft deletion preserves identity, request keys and all audit history. */
  async delete(access: ExpenseAccess, expectedRevision?: number) {
    return changeLedgerExpense({
      access,
      expectedRevision,
      change(expense) {
        if (expense.isDeleted) return null;
        expense.isDeleted = true;
        expense.deletedAt = new Date();
        expense.deletedBy = new mongoose.Types.ObjectId(access.actorId);
        return {
          activity: {
            type: 'expense_deleted',
            metadata: { expenseId: access.expenseId, description: expense.description },
          },
        };
      },
    });
  }

  /**
   * Check for duplicate expenses (same description + amount + date in the group).
   */
  async checkDuplicate(
    groupId: string,
    description: string,
    amount: number,
    date: Date,
    excludeId?: string,
  ) {
    await connectDB();

    // The day the Expense is dated, in UTC as it is stored (#437).
    const day = expenseDay(date);
    const startOfDay = expenseDate(day);
    const endOfDay = new Date(`${day}T23:59:59.999Z`);

    const query: Record<string, unknown> = {
      group: new mongoose.Types.ObjectId(groupId),
      description: { $regex: `^${escapeRegex(description)}$`, $options: 'i' },
      amount,
      date: { $gte: startOfDay, $lte: endOfDay },
      isDeleted: false,
    };
    if (excludeId) {
      query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
    }

    const existing = await Expense.findOne(query).populate('createdBy', 'name').lean();

    return {
      isDuplicate: !!existing,
      matchingExpense: existing || undefined,
    };
  }
}

export const expenseService = new ExpenseService();
