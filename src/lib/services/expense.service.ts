import connectDB from '@/lib/db';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import '@/lib/models/User'; // Ensure User model is registered for populate()
import { activityService } from './activity.service';
import type { CreateExpenseInput, UpdateExpenseInput } from '@/lib/validators/expense.validator';
import type { ExpenseFilters } from '@/types';
import { getQuickFilterDates, toInclusiveDateToBound } from '@/lib/utils/date';
import { escapeRegex } from '@/lib/utils/escape-regex';
import {
  assertActiveTag,
  assertExpenseParticipants,
  assertGroupCurrency,
  shouldValidateExpenseTag,
} from './expense-validation';
import {
  computeMemberBreakdown,
  computeUserOweGetBack,
  type LeanExpenseContribution,
} from './expense-summary';
import { calculateSplitAmounts } from './split-calculation';
import mongoose from 'mongoose';

export class ExpenseService {
  /**
   * Create a new expense.
   */
  async create(groupId: string, data: CreateExpenseInput, userId: string) {
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) throw new Error('Group not found');

    const memberIds = new Set(group.members.map((member) => member.user.toString()));
    const activeTagNames = new Set(
      group.tags.filter((tag) => !tag.isArchived).map((tag) => tag.name),
    );

    assertExpenseParticipants(memberIds, data.paidBy, data.splitBetween);
    assertActiveTag(activeTagNames, data.tag);
    assertGroupCurrency(group.defaultCurrency, data.currency);

    // Resolve split amounts for equal/shares/percentage methods
    const splitBetween = calculateSplitAmounts(data.splitMethod, data.amount, data.splitBetween);

    const expense = await Expense.create({
      group: groupId,
      description: data.description,
      amount: data.amount,
      currency: data.currency,
      category: data.category,
      date: data.date,
      paidBy: data.paidBy,
      splitMethod: data.splitMethod,
      splitBetween,
      tag: data.tag,
      predefinedItem: data.predefinedItem,
      notes: data.notes,
      createdBy: userId,
    });

    // Log activity
    await activityService.log(groupId, 'expense_added', userId, {
      expenseId: expense._id.toString(),
      description: expense.description,
      amount: expense.amount,
      currency: expense.currency,
    });

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
    if (filters.tag) {
      query.tag = filters.tag;
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
        .sort({ [sortField]: sortOrder, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('paidBy.user', 'name email image')
        .populate('splitBetween.user', 'name email image')
        .populate('createdBy', 'name email image')
        .populate('editHistory.editedBy', 'name email image')
        .lean(),
      Expense.countDocuments(query),
      // Aggregation for summary (totalAmount across ALL filtered, not just page)
      Expense.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // User owe/get-back and the opt-in per-member breakdown come from the
    // same pass over the full filtered set (not just the current page).
    let userOwes = 0;
    let userGetsBack = 0;
    let byMember: import('@/types').ExpenseMemberBreakdownRow[] | undefined;

    if (userId || filters.includeMemberBreakdown) {
      // For efficiency, if total <= limit we already have all. Otherwise run a lean query.
      let allFiltered = expenses;
      if (total > limit) {
        allFiltered = await Expense.find(query).select('paidBy splitBetween').lean();
      }
      const window = allFiltered as LeanExpenseContribution[];

      if (userId) {
        const oweGetBack = computeUserOweGetBack(window, userId);
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

        byMember = computeMemberBreakdown(window, memberIds).map((row) => {
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

    const summaryData = summaryAgg[0] || { totalAmount: 0, count: 0 };

    return {
      expenses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalAmount: summaryData.totalAmount,
        count: summaryData.count,
        userOwes,
        userGetsBack,
        ...(byMember ? { byMember } : {}),
      },
    };
  }

  /**
   * Get a single expense by ID.
   */
  async getById(expenseId: string) {
    await connectDB();
    return Expense.findById(expenseId)
      .populate('paidBy.user', 'name email image')
      .populate('splitBetween.user', 'name email image')
      .populate('createdBy', 'name email image')
      .populate('editHistory.editedBy', 'name email image')
      .lean();
  }

  /**
   * Update an expense. Handles both edits and restore (isDeleted: false).
   */
  async update(expenseId: string, data: UpdateExpenseInput, userId: string) {
    await connectDB();

    const expense = await Expense.findById(expenseId);
    if (!expense) return null;

    const group = await Group.findById(expense.group);
    if (!group) throw new Error('Group not found');

    const memberIds = new Set(group.members.map((member) => member.user.toString()));
    const activeTagNames = new Set(
      group.tags.filter((tag) => !tag.isArchived).map((tag) => tag.name),
    );

    // Handle restore (undo delete)
    if (data.isDeleted === false && expense.isDeleted) {
      expense.isDeleted = false;
      expense.deletedAt = null;
      expense.deletedBy = null;
      await expense.save();

      await activityService.log(expense.group.toString(), 'expense_updated', userId, {
        expenseId: expense._id.toString(),
        description: expense.description,
        action: 'restored',
      });

      return expense.populate([
        { path: 'paidBy.user', select: 'name email image' },
        { path: 'splitBetween.user', select: 'name email image' },
        { path: 'createdBy', select: 'name email image' },
      ]);
    }

    if (data.paidBy || data.splitBetween) {
      assertExpenseParticipants(memberIds, data.paidBy ?? [], data.splitBetween ?? []);
    }
    if (shouldValidateExpenseTag(data.tag, expense.tag)) {
      assertActiveTag(activeTagNames, data.tag!);
    }
    if (data.currency !== undefined) {
      assertGroupCurrency(group.defaultCurrency, data.currency);
    }

    // Recalculate split amounts if split method or members changed
    if (data.splitBetween && data.splitMethod && data.amount !== undefined) {
      data.splitBetween = calculateSplitAmounts(data.splitMethod, data.amount, data.splitBetween);
    }

    // Track changes (exclude isDeleted from edit tracking)
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'isDeleted') continue;
      const oldValue = (expense as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
        changes[key] = { old: oldValue, new: value };
      }
    }

    // Add edit history entry
    if (Object.keys(changes).length > 0) {
      expense.editHistory.push({
        editedBy: userId as unknown as mongoose.Types.ObjectId,
        editedAt: new Date(),
        changes,
      });
    }

    Object.assign(expense, data);
    await expense.save();

    // Log activity
    if (Object.keys(changes).length > 0) {
      await activityService.log(expense.group.toString(), 'expense_updated', userId, {
        expenseId: expense._id.toString(),
        description: expense.description,
        changes,
      });
    }

    return expense.populate([
      { path: 'paidBy.user', select: 'name email image' },
      { path: 'splitBetween.user', select: 'name email image' },
      { path: 'createdBy', select: 'name email image' },
    ]);
  }

  /**
   * Soft delete an expense.
   */
  async delete(expenseId: string, userId: string) {
    await connectDB();

    const expense = await Expense.findById(expenseId);
    if (!expense) return null;

    expense.isDeleted = true;
    expense.deletedAt = new Date();
    expense.deletedBy = userId as unknown as mongoose.Types.ObjectId;
    await expense.save();

    // Log activity
    await activityService.log(expense.group.toString(), 'expense_deleted', userId, {
      expenseId: expense._id.toString(),
      description: expense.description,
    });

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
