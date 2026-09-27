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
  assertStoredExpenseMoney,
  normalizeExpenseMoney,
  readStoredAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import {
  assertCreateReplay,
  assertPendingActivityCapacity,
  createRequestMetadata,
  makePendingActivity,
  requestTagForReplay,
} from '@/lib/financial-write';
import { lockLedgerCurrency } from '@/lib/ledger-currency';
import { assertExpectedRevision } from '@/lib/ledger-revision';
import mongoose from 'mongoose';
import {
  displayTagReference,
  findReferencedTag,
  resolveTagReference,
} from '@splitbook/shared/tag-identity';

/** Single-expense access always pairs a trusted session actor with its requested group. */
export interface ExpenseAccess {
  actorId: string;
  groupId: string;
  expenseId: string;
}

export class ExpenseService {
  private async requireAccessGroup({ actorId, groupId }: ExpenseAccess) {
    await connectDB();
    const group = await Group.findOne({ _id: groupId, 'members.user': actorId });
    if (!group) throw new Error('FORBIDDEN');
    return group;
  }

  /**
   * Create a new expense.
   */
  async create(groupId: string, data: CreateExpenseInput, userId: string, requestKey?: string) {
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
      await activityService.publishPending('expenses', existing._id, existing.pendingActivity);
      existing.tag = displayTagReference(group.tags, existing).tag;
      return existing.populate([
        { path: 'paidBy.user', select: 'name email image' },
        { path: 'splitBetween.user', select: 'name email image' },
        { path: 'createdBy', select: 'name email image' },
      ]);
    }
    const memberIds = new Set(group.members.map((member) => String(member.user)));
    assertExpenseParticipants(memberIds, data.paidBy, data.splitBetween);
    assertGroupCurrency(group.defaultCurrency, data.currency);
    await lockLedgerCurrency(groupId, data.currency);
    const id = new mongoose.Types.ObjectId();
    const event = makePendingActivity(groupId, 'expense_added', userId, {
      expenseId: String(id),
      description: data.description,
      amount: money.amount,
      currency: data.currency,
    });
    let expense;
    try {
      expense = await Expense.create({
        ...command,
        _id: id,
        group: groupId,
        createdBy: userId,
        pendingActivity: [event],
        ...(requestKey
          ? { creationRequest: createRequestMetadata(requestKey, command, data.tag) }
          : {}),
      });
    } catch (error) {
      if (requestKey && (error as { code?: number }).code === 11000) {
        const replay = await Expense.findOne({
          group: groupId,
          createdBy: userId,
          'creationRequest.key': requestKey,
        }).select('+creationRequest +pendingActivity');
        if (replay) {
          assertCreateReplay(replay.creationRequest!, command);
          await activityService.publishPending('expenses', replay._id, replay.pendingActivity);
          return replay.populate([
            { path: 'paidBy.user', select: 'name email image' },
            { path: 'splitBetween.user', select: 'name email image' },
            { path: 'createdBy', select: 'name email image' },
          ]);
        }
      }
      throw error;
    }
    await activityService.publishPending('expenses', expense._id, expense.pendingActivity);
    return expense.populate([
      { path: 'paidBy.user', select: 'name email image' },
      { path: 'splitBetween.user', select: 'name email image' },
      { path: 'createdBy', select: 'name email image' },
    ]);
  }

  /**
   * Get expenses for a group with filters and pagination.
   * Optionally computes a summary (total, user owe/get-back) for the filtered set.
   */
  async getGroupExpenses(groupId: string, filters: ExpenseFilters = {}, userId?: string) {
    await connectDB();

    const tagGroup = await Group.findById(groupId).select('tags defaultCurrency').lean();
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
        .populate('paidBy.user', 'name email image')
        .populate('splitBetween.user', 'name email image')
        .populate('createdBy', 'name email image')
        .lean(),
      Expense.countDocuments(query),
      Expense.find(query).select('currency moneyVersion amount amountMinor').lean(),
    ]);

    // User owe/get-back and the opt-in per-member breakdown come from the
    // same pass over the full filtered set (not just the current page).
    let userOwes = 0;
    let userGetsBack = 0;
    let byMember: import('@splitbook/shared/types').ExpenseMemberBreakdownRow[] | undefined;

    if (userId || filters.includeMemberBreakdown) {
      // For efficiency, if total <= limit we already have all. Otherwise run a lean query.
      let allFiltered = expenses;
      if (total > limit || page > 1) {
        allFiltered = await Expense.find(query)
          .select('currency moneyVersion amount amountMinor paidBy splitBetween')
          .lean();
      }
      for (const record of allFiltered) assertStoredExpenseMoney(record);
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
    for (const record of summaryAgg) {
      const values = summaryCurrencies.get(record.currency) ?? [];
      values.push(readStoredAmountMinor(record));
      summaryCurrencies.set(record.currency, values);
    }
    const totalsByCurrency = [...summaryCurrencies].map(([currency, values]) => ({
      currency,
      totalAmount: toMajorAmount(sumMinorAmounts(values), currency),
    }));
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
      },
    };
  }

  /**
   * Read an expense only through its group and a current group member.
   */
  async getById(access: ExpenseAccess) {
    const group = await this.requireAccessGroup(access);
    const expense = await Expense.findOne({ _id: access.expenseId, group: access.groupId })
      .populate('paidBy.user', 'name email image')
      .populate('splitBetween.user', 'name email image')
      .populate('createdBy', 'name email image')
      .populate('editHistory.editedBy', 'name email image')
      .lean();
    return expense
      ? { ...expense, revision: expense.revision ?? 0, ...displayTagReference(group.tags, expense) }
      : null;
  }

  /**
   * Update an expense. Handles both edits and restore (isDeleted: false).
   */
  async update(access: ExpenseAccess, data: UpdateExpenseInput, expectedRevision?: number) {
    const group = await this.requireAccessGroup(access);
    // Old documents predate the revision field. Initialize atomically before loading for CAS.
    await Expense.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(access.expenseId),
        group: new mongoose.Types.ObjectId(access.groupId),
        revision: { $exists: false },
      },
      { $set: { revision: 0 } },
    );
    const expense = await Expense.findOne({ _id: access.expenseId, group: access.groupId }).select(
      '+pendingActivity',
    );
    if (!expense) return null;
    assertExpectedRevision(expense.revision, expectedRevision);
    const original = expense.toObject();
    assertStoredExpenseMoney(original);
    const storedMajor = (record: { amount: number; amountMinor?: number }) =>
      toMajorAmount(
        readStoredAmountMinor({
          ...record,
          currency: original.currency,
          moneyVersion: original.moneyVersion,
        }),
        original.currency,
      );
    const canonicalOriginal = {
      ...original,
      amount: storedMajor(original),
      paidBy: original.paidBy.map((row) => ({ ...row, amount: storedMajor(row) })),
      splitBetween: original.splitBetween.map((row) => ({ ...row, amount: storedMajor(row) })),
    };
    const merged = { ...canonicalOriginal, ...data };
    // A restore is a real write and follows the same whole-record validation as editing.
    const sameRows = (
      next: typeof data.paidBy | typeof data.splitBetween,
      previous: typeof original.paidBy | typeof original.splitBetween,
      keys: string[],
    ) => {
      if (next === undefined) return true;
      if (next.length !== previous.length) return false;
      // Form order is not a financial change. Sort copies so the stored
      // participant order and historical allocation remain intact.
      const byUser = (left: { user: unknown }, right: { user: unknown }) =>
        String(left.user).localeCompare(String(right.user));
      const nextRows = [...next].sort(byUser);
      const previousRows = [...previous].sort(byUser);
      return nextRows.every((row, index) =>
        keys.every(
          (key) =>
            String(Reflect.get(row, key) ?? '') ===
            String(Reflect.get(previousRows[index], key) ?? ''),
        ),
      );
    };
    const allocationKeys =
      original.splitMethod === 'percentage'
        ? ['user', 'percentage']
        : original.splitMethod === 'shares'
          ? ['user', 'shares']
          : original.splitMethod === 'equal'
            ? ['user']
            : ['user', 'amount'];
    const financialEdit =
      (data.amount !== undefined && data.amount !== canonicalOriginal.amount) ||
      (data.currency !== undefined && data.currency !== original.currency) ||
      (data.splitMethod !== undefined && data.splitMethod !== original.splitMethod) ||
      !sameRows(data.paidBy, canonicalOriginal.paidBy, ['user', 'amount']) ||
      !sameRows(data.splitBetween, canonicalOriginal.splitBetween, allocationKeys);
    if (financialEdit)
      assertExpenseParticipants(
        new Set(group.members.map((member) => String(member.user))),
        merged.paidBy,
        merged.splitBetween,
      );
    if (data.currency !== undefined && data.currency !== original.currency)
      assertGroupCurrency(group.defaultCurrency, data.currency);
    const money = normalizeExpenseMoney({
      ...(financialEdit ? merged : { ...merged, splitMethod: 'exact' as const }),
      paidBy: merged.paidBy.map((row) => ({ ...row, user: String(row.user) })),
      splitBetween: (financialEdit ? merged.splitBetween : canonicalOriginal.splitBetween).map(
        (row) => ({
          ...row,
          user: String(row.user),
        }),
      ),
    });
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
    await expense.save();
    await activityService.publishPending('expenses', expense._id, expense.pendingActivity);
    return expense.populate([
      { path: 'paidBy.user', select: 'name email image' },
      { path: 'splitBetween.user', select: 'name email image' },
      { path: 'createdBy', select: 'name email image' },
    ]);
  }

  /** Soft deletion preserves identity, request keys and all audit history. */
  async delete(access: ExpenseAccess, expectedRevision?: number) {
    await this.requireAccessGroup(access);
    // Old documents predate the revision field. Initialize atomically before loading for CAS.
    await Expense.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(access.expenseId),
        group: new mongoose.Types.ObjectId(access.groupId),
        revision: { $exists: false },
      },
      { $set: { revision: 0 } },
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
    await expense.save();
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

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

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
