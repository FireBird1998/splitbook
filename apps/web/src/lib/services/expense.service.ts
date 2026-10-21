import { inGroupCurrencyOrder } from '@splitbook/shared/group-currencies';
import type { AssistantAttribution } from '@splitbook/shared/draft-attribution';
import { afterGroupCommit, withGroupMutation } from '@/lib/group-mutation';
import connectDB from '@/lib/db';
import { ensureLedgerWriteIndexes } from '@/lib/ledger-indexes';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import '@/lib/models/User'; // Ensure User model is registered for populate()
import { activityService } from './activity.service';
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
import { decideExpenseMoneyEdit } from '@splitbook/shared/expense-money-edit';
import {
  assertCreateReplay,
  assertPendingActivityCapacity,
  createRequestMetadata,
  makePendingActivity,
  requestTagForReplay,
} from '@/lib/financial-write';
import { lockLedgerCurrency, lockRestoredCurrency } from '@/lib/ledger-currency';
import { assertExpectedRevision } from '@/lib/ledger-revision';
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

/** Why one Expense of a Tag change couldn't change, in member words, by the error that said so. */
const tagChangeRefusals: Record<string, string> = {
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

/** Single-expense access always pairs a trusted session actor with its requested group. */
export interface ExpenseAccess {
  actorId: string;
  groupId: string;
  expenseId: string;
}

export class ExpenseService {
  private async requireAccessGroup({ actorId, groupId }: ExpenseAccess, writing = false) {
    await connectDB();
    const group = await Group.findOne({ _id: groupId, 'members.user': actorId });
    if (!group) throw new Error('FORBIDDEN');
    // An archived Group can still be read, but takes no more changes (#578).
    if (writing && group.isArchived) throw new Error('GROUP_ARCHIVED');
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
    await connectDB();
    await ensureLedgerWriteIndexes();
    const group = await Group.findOne({ _id: groupId, 'members.user': userId });
    if (!group) throw new Error('FORBIDDEN');
    const existing = requestKey
      ? await Expense.findOne({
          group: groupId,
          createdBy: userId,
          'creationRequest.key': requestKey,
        }).select('+creationRequest +pendingActivity')
      : null;
    const incoming = existing ? requestTagForReplay(data, existing) : data;
    const money = normalizeExpenseMoney(incoming);
    // Replay validates its immutable command, without requiring the old Tag still be active.
    const tagReference =
      existing && incoming.tagId
        ? { tagId: incoming.tagId, tag: incoming.tag ?? existing.tag }
        : resolveTagReference(group.tags, incoming);
    const command = {
      ...incoming,
      ...money,
      ...tagReference,
      notes: incoming.notes ?? '',
      predefinedItem: incoming.predefinedItem ?? null,
    };
    if (existing) {
      assertCreateReplay(existing.creationRequest!, command);
      await afterGroupCommit(() =>
        activityService.publishPending('expenses', existing._id, existing.pendingActivity),
      );
      existing.tag = displayTagReference(group.tags, existing).tag;
      return existing.populate([
        { path: 'paidBy.user', select: PERSON_FIELDS },
        { path: 'splitBetween.user', select: PERSON_FIELDS },
        { path: 'createdBy', select: PERSON_FIELDS },
      ]);
    }
    // A retry of an Expense recorded before the archive is confirmed above; nothing new is (#578).
    if (group.isArchived) throw new Error('GROUP_ARCHIVED');
    const memberIds = new Set(group.members.map((member) => String(member.user)));
    assertExpenseParticipants(memberIds, data.paidBy, data.splitBetween);
    assertGroupCurrency(group, data.currency);
    const id = new mongoose.Types.ObjectId();
    const event = makePendingActivity(groupId, 'expense_added', userId, {
      ...(options?.preparedBy ? { preparedBy: options.preparedBy } : {}),
      expenseId: String(id),
      description: data.description,
      amount: money.amount,
      currency: data.currency,
    });
    let expense;
    try {
      expense = await withGroupMutation(
        groupId,
        async () => {
          // In the insert's own mutation, so a removal of the currency can't come in between.
          await lockLedgerCurrency(groupId, data.currency);
          return Expense.create({
            ...command,
            preparedBy: options?.preparedBy,
            _id: id,
            group: groupId,
            createdBy: userId,
            pendingActivity: [event],
            ...(requestKey
              ? { creationRequest: createRequestMetadata(requestKey, command, data.tag) }
              : {}),
          });
        },
        { ledger: true },
      );
    } catch (error) {
      if (requestKey && (error as { code?: number }).code === 11000) {
        const replay = await Expense.findOne({
          group: groupId,
          createdBy: userId,
          'creationRequest.key': requestKey,
        }).select('+creationRequest +pendingActivity');
        if (replay) {
          assertCreateReplay(replay.creationRequest!, command);
          await afterGroupCommit(() =>
            activityService.publishPending('expenses', replay._id, replay.pendingActivity),
          );
          return replay.populate([
            { path: 'paidBy.user', select: PERSON_FIELDS },
            { path: 'splitBetween.user', select: PERSON_FIELDS },
            { path: 'createdBy', select: PERSON_FIELDS },
          ]);
        }
      }
      throw error;
    }
    await afterGroupCommit(() =>
      activityService.publishPending('expenses', expense._id, expense.pendingActivity),
    );
    return expense.populate([
      { path: 'paidBy.user', select: PERSON_FIELDS },
      { path: 'splitBetween.user', select: PERSON_FIELDS },
      { path: 'createdBy', select: PERSON_FIELDS },
    ]);
  }

  /**
   * Get expenses for a group with filters and pagination.
   * Optionally computes a summary (total, user owe/get-back) for the filtered set.
   */
  async getGroupExpenses(groupId: string, filters: ExpenseFilters = {}, userId?: string) {
    await connectDB();

    const tagGroup = await Group.findById(groupId)
      .select('tags defaultCurrency alternateCurrencies')
      .lean();
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
        const group = await Group.findById(groupId)
          .select('members')
          .populate('members.user', 'name image')
          .lean();
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

    return {
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
    const group = await this.requireAccessGroup(access);
    const expense = await Expense.findOne({ _id: access.expenseId, group: access.groupId })
      .populate('paidBy.user', PERSON_FIELDS)
      .populate('splitBetween.user', PERSON_FIELDS)
      .populate('createdBy', PERSON_FIELDS)
      .populate('editHistory.editedBy', PERSON_FIELDS)
      .lean();
    return expense
      ? { ...expense, revision: expense.revision ?? 0, ...displayTagReference(group.tags, expense) }
      : null;
  }

  /**
   * Update an expense. Handles both edits and restore (isDeleted: false).
   */
  async update(access: ExpenseAccess, data: UpdateExpenseInput, expectedRevision?: number) {
    const group = await this.requireAccessGroup(access, true);
    // Old documents predate the revision field. Initialize atomically before loading for CAS.
    await withGroupMutation(
      access.groupId,
      async (session) =>
        Expense.collection.updateOne(
          {
            _id: new mongoose.Types.ObjectId(access.expenseId),
            group: new mongoose.Types.ObjectId(access.groupId),
            revision: { $exists: false },
          },
          { $set: { revision: 0 } },
          { session },
        ),
      { ledger: true },
    );
    const expense = await Expense.findOne({ _id: access.expenseId, group: access.groupId }).select(
      '+pendingActivity',
    );
    if (!expense) return null;
    assertExpectedRevision(expense.revision, expectedRevision);
    const original = expense.toObject();
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
    if (restoring || Object.keys(changes).length) {
      assertPendingActivityCapacity(expense.pendingActivity);
      expense.pendingActivity.push(
        makePendingActivity(access.groupId, 'expense_updated', access.actorId, {
          expenseId: access.expenseId,
          description: expense.description,
          ...(restoring ? { action: 'restored' } : { changes }),
        }),
      );
    }
    // An edit that keeps an older Expense's currency stays allowed, as the check above says.
    const currencyMoved = data.currency !== undefined && data.currency !== original.currency;
    await withGroupMutation(
      access.groupId,
      async () => {
        // A restored Expense, or one moved to another currency, needs its currency still the
        // Group's (#721), checked in the save's own mutation so a removal can't come in between.
        if (restoring)
          await lockRestoredCurrency(access.groupId, expense.currency, access.expenseId);
        else if (currencyMoved) await lockLedgerCurrency(access.groupId, expense.currency);
        return expense.save();
      },
      { ledger: true },
    );
    await activityService.publishPending('expenses', expense._id, expense.pendingActivity);
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
    const group = await this.requireAccessGroup({ actorId, groupId, expenseId: '' }, true);
    const tag = group.tags.find((entry) => String(entry._id) === tagId);
    if (!tag || tag.isArchived || tag.isDeleted) throw new Error('INVALID_TAG');
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
      const code =
        error instanceof Error
          ? error.name === 'VersionError'
            ? 'STALE_REVISION'
            : error.message
          : '';
      if (code === 'STALE_REVISION') return { expenseId, outcome: 'changed-elsewhere' };
      if (!tagChangeRefusals[code])
        console.error('Expense Tag change failed:', { expenseId, error });
      return {
        expenseId,
        outcome: 'refused',
        ...(tagChangeRefusals[code] ? { code } : {}),
        reason: tagChangeRefusals[code] ?? 'Splitbook couldn’t change this Expense.',
      };
    }
  }

  /** Soft deletion preserves identity, request keys and all audit history. */
  async delete(access: ExpenseAccess, expectedRevision?: number) {
    await this.requireAccessGroup(access, true);
    // Old documents predate the revision field. Initialize atomically before loading for CAS.
    await withGroupMutation(
      access.groupId,
      async (session) =>
        Expense.collection.updateOne(
          {
            _id: new mongoose.Types.ObjectId(access.expenseId),
            group: new mongoose.Types.ObjectId(access.groupId),
            revision: { $exists: false },
          },
          { $set: { revision: 0 } },
          { session },
        ),
      { ledger: true },
    );
    const expense = await Expense.findOne({ _id: access.expenseId, group: access.groupId }).select(
      '+pendingActivity',
    );
    if (!expense) return null;
    assertExpectedRevision(expense.revision, expectedRevision);
    if (expense.isDeleted) return expense;
    assertPendingActivityCapacity(expense.pendingActivity);
    expense.isDeleted = true;
    expense.deletedAt = new Date();
    expense.deletedBy = new mongoose.Types.ObjectId(access.actorId);
    expense.pendingActivity.push(
      makePendingActivity(access.groupId, 'expense_deleted', access.actorId, {
        expenseId: access.expenseId,
        description: expense.description,
      }),
    );
    await withGroupMutation(access.groupId, async () => expense.save(), { ledger: true });
    await activityService.publishPending('expenses', expense._id, expense.pendingActivity);
    return expense;
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
