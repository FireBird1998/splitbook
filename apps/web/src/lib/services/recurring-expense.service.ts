import connectDB from '@/lib/db';
import mongoose from 'mongoose';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import RecurringExpense from '@/lib/models/RecurringExpense';
import '@/lib/models/User'; // Ensure User model is registered for populate()
import { activityService } from './activity.service';
import {
  assertExpenseParticipants,
  assertGroupCurrency,
} from '@splitbook/shared/expense-validation';
import { normalizeExpenseMoney } from '@splitbook/shared/exact-money';
import { decideExpenseMoneyEdit, readExpenseMoney } from '@splitbook/shared/expense-money-edit';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import {
  expenseDateForPeriod,
  getDuePeriods,
  previousPeriod,
  toPeriod,
} from '@splitbook/shared/recurring-due-periods';
import type {
  CreateRecurringExpenseInput,
  UpdateRecurringExpenseInput,
} from '@splitbook/shared/validators/recurring-expense';
import type { IGroupDocument } from '@/lib/models/Group';
import { displayTagReference, resolveTagReference } from '@splitbook/shared/tag-identity';
import { makePendingActivity } from '@/lib/financial-write';
import { assertExpectedRevision } from '@/lib/ledger-revision';
import { lockLedgerCurrency } from '@/lib/ledger-currency';
import { ensureLedgerWriteIndexes } from '@/lib/ledger-indexes';

type TemplateData = {
  description: string;
  amount: number;
  amountMinor?: number;
  moneyVersion?: number;
  currency: string;
  tag?: string;
  tagId?: unknown;
  paidBy: Array<{ user: unknown; amount: number; amountMinor?: number }>;
  splitMethod: 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';
  splitBetween: Array<{
    user: unknown;
    amount?: number;
    amountMinor?: number;
    percentage?: number;
    shares?: number;
  }>;
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
  assertExpenseParticipants(memberIds, data.paidBy, data.splitBetween);
  resolveTagReference(group.tags, data);
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
    const money = normalizeExpenseMoney(data);
    await lockLedgerCurrency(groupId, data.currency);

    const template = await RecurringExpense.create({
      group: groupId,
      description: data.description,
      ...money,
      category: data.category,
      ...resolveTagReference(group.tags, data),
      splitMethod: data.splitMethod,
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
    const group = await Group.findById(groupId).select('tags').lean();
    const templates = await RecurringExpense.find({ group: groupId })
      .populate('paidBy.user', 'name email image')
      .populate('splitBetween.user', 'name email image')
      .populate('createdBy', 'name email image')
      .sort({ createdAt: -1 })
      .lean();
    return templates.map((template) => ({
      ...template,
      ...displayTagReference(group?.tags ?? [], template),
    }));
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
    expectedRevision?: number,
  ) {
    await connectDB();
    const group = await Group.findById(groupId);
    if (!group) return null;
    assertAdmin(group, userId);

    await RecurringExpense.updateOne(
      { _id: recurringId, group: groupId, revision: { $exists: false } },
      { $set: { revision: 0 } },
      { timestamps: false },
    );
    const template = await RecurringExpense.findOne({ _id: recurringId, group: groupId });
    if (!template) return null;
    assertExpectedRevision(template.revision, expectedRevision);

    const memberIds = new Set(group.members.map((member) => member.user.toString()));
    const original = template.toObject();
    const { money } = decideExpenseMoneyEdit(original, data);
    assertExpenseParticipants(memberIds, money.paidBy, money.splitBetween);
    assertGroupCurrency(group.defaultCurrency, money.currency);
    const tagReference = resolveTagReference(group.tags, data, template);

    const mergedStartsOn = data.startsOn ?? template.startsOn;
    const mergedEndsOn = data.endsOn !== undefined ? data.endsOn : template.endsOn;
    assertValidWindow(mergedStartsOn, mergedEndsOn);

    const wasPaused = template.isPaused;
    Object.assign(template, data, money, tagReference);

    if (wasPaused && data.isPaused === false) {
      // Save the validated configuration and the skipped-window marker together.
      // $max prevents a concurrent generator's later marker being overwritten.
      await template.validate();
      const update = template.getChanges();
      const result = await RecurringExpense.updateOne(
        { _id: template._id, group: groupId, revision: template.revision ?? 0 },
        {
          ...update,
          $inc: { revision: 1 },
          $max: { lastGeneratedFor: previousPeriod(toPeriod(new Date())) },
        },
        { runValidators: true },
      );
      if (!result.matchedCount) throw new Error('STALE_REVISION');
      template.revision = (template.revision ?? 0) + 1;
    } else {
      await template.save();
    }

    await this.generateDueExpenses(groupId);

    return template;
  }

  /**
   * Delete a template. Hard-deletes the template only — expenses it already
   * generated are never touched.
   */
  async remove(groupId: string, recurringId: string, userId: string, expectedRevision?: number) {
    await connectDB();
    const group = await Group.findById(groupId);
    if (!group) return null;
    assertAdmin(group, userId);

    await RecurringExpense.updateOne(
      { _id: recurringId, group: groupId, revision: { $exists: false } },
      { $set: { revision: 0 } },
      { timestamps: false },
    );
    const template = await RecurringExpense.findOne({ _id: recurringId, group: groupId });
    if (!template) return null;
    assertExpectedRevision(template.revision, expectedRevision);

    const result = await RecurringExpense.deleteOne({
      _id: template._id,
      group: groupId,
      revision: template.revision ?? { $exists: false },
    });
    if (!result.deletedCount) throw new Error('STALE_REVISION');
    return template;
  }

  /**
   * Lazy-on-read generation: materialize every due period for the group's
   * templates. Called from the group-detail, expense-list and group-balances
   * read paths after the membership check. Idempotent under concurrency via
   * the unique (recurringExpense, period) index; `lastGeneratedFor` advances
   * monotonically via $max.
   *
   * A template whose configuration no longer validates against group state
   * (tag archived, member removed, currency drift) is skipped without
   * advancing its marker — the settings list surfaces that problem state.
   * An archived Group generates nothing, and generation moves none of its markers.
   * This method never throws into the read path, and reads ignore whether the
   * run finished: a period that failed is retried on the next read.
   */
  async generateDueExpenses(
    groupId: string,
    now: Date = new Date(),
  ): Promise<{ generated: number }> {
    const { generated } = await this.materializeDueExpenses(groupId, now);
    return { generated };
  }

  /**
   * The generation run behind `generateDueExpenses`, also reporting whether it
   * finished. `complete` is false when a due period could not be added or a
   * marker could not advance, so a due Expense may be missing from Balances; a
   * template skipped in its problem state counts as finished, as it does for
   * reads. A write that checks Balances, such as leaving a Group, refuses when
   * `complete` is false. Never throws.
   */
  async materializeDueExpenses(
    groupId: string,
    now: Date = new Date(),
  ): Promise<{ generated: number; complete: boolean }> {
    let generated = 0;
    let complete = true;
    try {
      await connectDB();

      const templates = await RecurringExpense.find({ group: groupId });
      if (templates.length === 0) return { generated: 0, complete };

      const group = await Group.findById(groupId);
      if (!group || !getGroupTheme(group.category).recurringExpenses) {
        return { generated: 0, complete };
      }
      // An archived Group creates no recurring Expenses. Markers stay where they
      // are, so nothing is lost: were it un-archived, the next read catches up.
      if (group.isArchived) return { generated: 0, complete };

      const currentPeriod = toPeriod(now);

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

        let money: ReturnType<typeof readExpenseMoney>;
        try {
          assertTemplateData(group, template);
          // Generation copies the validated, stored allocation; metadata edits and
          // library upgrades cannot move a penny between participants retroactively.
          money = readExpenseMoney(template.toObject());
        } catch {
          continue; // Problem state — visible in the settings list.
        }

        // The unique (recurringExpense, period) index makes the inserts below
        // idempotent. Only a run that inserts needs it (the call is memoized), so a
        // Trip Group or a Household with nothing due never depends on it.
        await ensureLedgerWriteIndexes();

        // Advance only through the unbroken materialized prefix: a period that
        // fails unexpectedly is retried on the next read instead of being lost.
        let materializedThrough: string | null = null;
        for (const period of duePeriods) {
          try {
            await lockLedgerCurrency(groupId, template.currency);
            const expenseId = new mongoose.Types.ObjectId();
            const event = makePendingActivity(
              groupId,
              'expense_added',
              template.createdBy.toString(),
              {
                expenseId: expenseId.toString(),
                description: template.description,
                amount: money.amount,
                currency: template.currency,
                recurring: true,
                recurringExpenseId: template._id.toString(),
                period,
              },
            );
            const expense = await Expense.create({
              _id: expenseId,
              group: new mongoose.Types.ObjectId(groupId),
              description: template.description,
              ...money,
              category: template.category,
              date: expenseDateForPeriod(period, template.dayOfMonth),
              splitMethod: template.splitMethod,
              ...resolveTagReference(group.tags, template),
              recurringExpense: template._id,
              period,
              createdBy: template.createdBy,
              pendingActivity: [event],
            });
            generated += 1;
            materializedThrough = period;

            await activityService.publishPending('expenses', expense._id, [event]);
          } catch (err) {
            if (isDuplicateKeyError(err)) {
              // Only this exact period proves materialization. A different unique
              // index violation must never advance the generation marker.
              const existing = await Expense.findOne({
                recurringExpense: template._id,
                period,
              }).select('+pendingActivity');
              if (existing) {
                await activityService.publishPending(
                  'expenses',
                  existing._id,
                  existing.pendingActivity,
                );
                materializedThrough = period;
                continue;
              }
            }
            console.error(`Recurring generation failed for template ${template._id}:`, err);
            complete = false;
            break;
          }
        }

        if (materializedThrough) {
          await RecurringExpense.updateOne(
            { _id: template._id },
            { $max: { lastGeneratedFor: materializedThrough } },
            { timestamps: false },
          );
        }
      }
    } catch (err) {
      // Lazy generation must not turn a successfully committed template or a
      // normal ledger read into a failed request. Unmaterialized periods retry.
      console.error(`Recurring generation could not complete for group ${groupId}:`, err);
      complete = false;
    }

    return { generated, complete };
  }
}

export const recurringExpenseService = new RecurringExpenseService();
