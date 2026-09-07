import connectDB from '@/lib/db';
import mongoose from 'mongoose';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import RecurringExpense from '@/lib/models/RecurringExpense';
import '@/lib/models/User'; // Ensure User model is registered for populate()
import { activityService } from './activity.service';
import {
  assertActiveTag,
  assertExpenseParticipants,
  assertGroupCurrency,
} from './expense-validation';
import { calculateSplitAmounts } from './split-calculation';
import { getGroupTheme } from '@/lib/group-themes';
import {
  expenseDateForPeriod,
  getDuePeriods,
  previousPeriod,
  toPeriod,
} from '@/lib/recurring-due-periods';
import type {
  CreateRecurringExpenseInput,
  UpdateRecurringExpenseInput,
} from '@/lib/validators/recurring-expense.validator';
import type { IGroupDocument } from '@/lib/models/Group';

type TemplateData = {
  description: string;
  amount: number;
  currency: string;
  tag: string;
  paidBy: Array<{ user: unknown; amount: number }>;
  splitMethod: 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';
  splitBetween: Array<{ user: unknown; amount?: number; percentage?: number; shares?: number }>;
  startsOn: Date;
  endsOn?: Date | null;
};

function assertAdmin(group: IGroupDocument, userId: string): void {
  const member = group.members.find((m) => m.user.toString() === userId);
  if (!member || member.role !== 'admin') {
    throw new Error('FORBIDDEN');
  }
}

function assertHouseholdTheme(category: IGroupDocument['category']): void {
  if (!getGroupTheme(category).recurringExpenses) {
    throw new Error('NOT_HOUSEHOLD');
  }
}

function assertValidWindow(startsOn: Date, endsOn: Date | null | undefined): void {
  if (endsOn && endsOn < startsOn) {
    throw new Error('INVALID_WINDOW');
  }
}

/** The same service-level invariants manual expenses go through. */
function assertTemplateData(group: IGroupDocument, data: TemplateData): void {
  const memberIds = new Set(group.members.map((member) => member.user.toString()));
  const activeTagNames = new Set(
    group.tags.filter((tag) => !tag.isArchived).map((tag) => tag.name),
  );
  assertExpenseParticipants(memberIds, data.paidBy, data.splitBetween);
  assertActiveTag(activeTagNames, data.tag);
  assertGroupCurrency(group.defaultCurrency, data.currency);
  assertValidWindow(data.startsOn, data.endsOn);
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

export class RecurringExpenseService {
  /**
   * Create a recurring template. Admins only, Household groups only.
   * Due periods are materialized immediately (idempotent lazy generation).
   */
  async create(groupId: string, data: CreateRecurringExpenseInput, userId: string) {
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) return null;

    assertAdmin(group, userId);
    assertHouseholdTheme(group.category);
    assertTemplateData(group, data);

    const template = await RecurringExpense.create({
      group: groupId,
      description: data.description,
      amount: data.amount,
      currency: data.currency,
      category: data.category,
      tag: data.tag,
      paidBy: data.paidBy,
      splitMethod: data.splitMethod,
      splitBetween: calculateSplitAmounts(data.splitMethod, data.amount, data.splitBetween),
      dayOfMonth: data.dayOfMonth,
      startsOn: data.startsOn,
      endsOn: data.endsOn ?? null,
      isPaused: false,
      lastGeneratedFor: null,
      createdBy: userId,
    });

    await this.generateDueExpenses(groupId);

    return template;
  }

  /**
   * List a group's recurring templates (any member may read).
   */
  async list(groupId: string) {
    await connectDB();
    return RecurringExpense.find({ group: groupId })
      .populate('paidBy.user', 'name email image')
      .populate('splitBetween.user', 'name email image')
      .populate('createdBy', 'name email image')
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Update a template. Edits apply to future periods only — expenses already
   * generated are ordinary expenses and stay untouched. Resuming a paused
   * template skips the on-hold window: the marker advances to the period
   * before the current month, so generation resumes from the current month.
   */
  async update(
    groupId: string,
    recurringId: string,
    data: UpdateRecurringExpenseInput,
    userId: string,
  ) {
    await connectDB();

    const template = await RecurringExpense.findOne({ _id: recurringId, group: groupId });
    if (!template) return null;

    const group = await Group.findById(groupId);
    if (!group) return null;

    assertAdmin(group, userId);

    const memberIds = new Set(group.members.map((member) => member.user.toString()));
    const activeTagNames = new Set(
      group.tags.filter((tag) => !tag.isArchived).map((tag) => tag.name),
    );

    if (data.paidBy || data.splitBetween) {
      assertExpenseParticipants(memberIds, data.paidBy ?? [], data.splitBetween ?? []);
    }
    if (data.tag !== undefined && data.tag !== template.tag) {
      assertActiveTag(activeTagNames, data.tag);
    }
    if (data.currency !== undefined) {
      assertGroupCurrency(group.defaultCurrency, data.currency);
    }

    const mergedStartsOn = data.startsOn ?? template.startsOn;
    const mergedEndsOn = data.endsOn !== undefined ? data.endsOn : template.endsOn;
    assertValidWindow(mergedStartsOn, mergedEndsOn);

    const wasPaused = template.isPaused;
    Object.assign(template, data);

    // Re-resolve split amounts when the split definition or amount changed.
    if (data.splitBetween || data.splitMethod || data.amount !== undefined) {
      template.splitBetween = calculateSplitAmounts(
        template.splitMethod,
        template.amount,
        template.splitBetween,
      ) as typeof template.splitBetween;
    }

    if (wasPaused && data.isPaused === false) {
      const previous = previousPeriod(toPeriod(new Date()));
      if (!template.lastGeneratedFor || template.lastGeneratedFor < previous) {
        template.lastGeneratedFor = previous;
      }
    }

    await template.save();

    await this.generateDueExpenses(groupId);

    return template;
  }

  /**
   * Delete a template. Hard-deletes the template only — expenses it already
   * generated are never touched.
   */
  async remove(groupId: string, recurringId: string, userId: string) {
    await connectDB();

    const template = await RecurringExpense.findOne({ _id: recurringId, group: groupId });
    if (!template) return null;

    const group = await Group.findById(groupId);
    if (!group) return null;

    assertAdmin(group, userId);

    await template.deleteOne();
    return template;
  }

  /**
   * Lazy-on-read generation: materialize every due period for the group's
   * templates. Called from the group-detail and expense-list read paths after
   * the membership check. Idempotent under concurrency via the unique
   * (recurringExpense, period) index; `lastGeneratedFor` advances
   * monotonically via $max.
   *
   * A template whose configuration no longer validates against group state
   * (tag archived, member removed, currency drift) is skipped without
   * advancing its marker — the settings list surfaces that problem state.
   * This method never throws into the read path.
   */
  async generateDueExpenses(
    groupId: string,
    now: Date = new Date(),
  ): Promise<{ generated: number }> {
    await connectDB();

    const templates = await RecurringExpense.find({ group: groupId });
    if (templates.length === 0) return { generated: 0 };

    const group = await Group.findById(groupId);
    if (!group || !getGroupTheme(group.category).recurringExpenses) {
      return { generated: 0 };
    }

    const currentPeriod = toPeriod(now);
    let generated = 0;

    for (const template of templates) {
      const duePeriods = getDuePeriods(
        {
          dayOfMonth: template.dayOfMonth,
          startsOn: template.startsOn,
          endsOn: template.endsOn,
          isPaused: template.isPaused,
          lastGeneratedFor: template.lastGeneratedFor,
        },
        currentPeriod,
      );
      if (duePeriods.length === 0) continue;

      try {
        assertTemplateData(group, template);
      } catch {
        continue; // Problem state — visible in the settings list.
      }

      // Advance only through the unbroken materialized prefix: a period that
      // fails unexpectedly is retried on the next read instead of being lost.
      let materializedThrough: string | null = null;
      for (const period of duePeriods) {
        try {
          const expense = await Expense.create({
            group: new mongoose.Types.ObjectId(groupId),
            description: template.description,
            amount: template.amount,
            currency: template.currency,
            category: template.category,
            date: expenseDateForPeriod(period, template.dayOfMonth),
            paidBy: template.paidBy,
            splitMethod: template.splitMethod,
            splitBetween: calculateSplitAmounts(
              template.splitMethod,
              template.amount,
              template.splitBetween,
            ),
            tag: template.tag,
            recurringExpense: template._id,
            period,
            createdBy: template.createdBy,
          });
          generated += 1;
          materializedThrough = period;

          await activityService.log(groupId, 'expense_added', template.createdBy.toString(), {
            expenseId: expense._id.toString(),
            description: expense.description,
            amount: expense.amount,
            currency: expense.currency,
            recurring: true,
            recurringExpenseId: template._id.toString(),
            period,
          });
        } catch (err) {
          if (isDuplicateKeyError(err)) {
            // A concurrent reader already materialized this period.
            materializedThrough = period;
            continue;
          }
          console.error(`Recurring generation failed for template ${template._id}:`, err);
          break;
        }
      }

      if (materializedThrough) {
        await RecurringExpense.updateOne(
          { _id: template._id },
          { $max: { lastGeneratedFor: materializedThrough } },
        );
      }
    }

    return { generated };
  }
}

export const recurringExpenseService = new RecurringExpenseService();
