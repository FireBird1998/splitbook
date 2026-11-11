import { Refusal } from '@splitbook/shared/refusals';
import { withGroupMutation } from '@/lib/group-mutation';
import connectDB from '@/lib/db';
import mongoose, { type HydratedDocument } from 'mongoose';
import Expense, { type IExpenseDocument } from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import ProductSwitch from '@/lib/models/ProductSwitch';
import RecurringExpense, { type IRecurringExpenseDocument } from '@/lib/models/RecurringExpense';
import '@/lib/models/User'; // Ensure User model is registered for populate()
import { recordLedger, type LedgerRecording } from '@/lib/ledger-recording';
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
import { involvedMembers } from '@/lib/financial-write';
import { assertExpectedRevision } from '@/lib/ledger-revision';
import { lockLedgerCurrency } from '@/lib/ledger-currency';
import {
  assertRecurringExpensesOn,
  recurringExpensesEnabled,
} from '@/lib/recurring-expenses-switch';
import { PERSON_FIELDS } from './person-fields';

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
    throw new Refusal('FORBIDDEN');
  }
}

function assertHouseholdTheme(category: IGroupDocument['category']): void {
  if (!getGroupTheme(category).recurringExpenses) {
    throw new Refusal('NOT_HOUSEHOLD');
  }
}

function assertValidWindow(startsOn: Date, endsOn: Date | null | undefined): void {
  if (endsOn && endsOn < startsOn) {
    throw new Refusal('INVALID_WINDOW');
  }
}

/** The same service-level invariants manual expenses go through. */
function assertTemplateData(group: IGroupDocument, data: TemplateData): void {
  const memberIds = new Set(group.members.map((member) => member.user.toString()));
  assertExpenseParticipants(memberIds, data.paidBy, data.splitBetween);
  resolveTagReference(group.tags, data);
  // Recurring Expenses stay in the main currency while extra currencies are new (#710).
  assertGroupCurrency({ defaultCurrency: group.defaultCurrency }, data.currency);
  assertValidWindow(data.startsOn, data.endsOn);
}

/**
 * The money a template adds each period, or null in its problem state: its configuration no
 * longer validates against the Group (Tag archived, payer or split member gone, currency drift)
 * or its stored money can't be read. Generation skips such a template without moving its marker,
 * and the settings list shows the problem.
 */
function generatableMoney(
  group: IGroupDocument,
  template: HydratedDocument<IRecurringExpenseDocument>,
): ReturnType<typeof readExpenseMoney> | null {
  try {
    assertTemplateData(group, template);
    // Generation copies the validated, stored allocation; metadata edits and
    // library upgrades cannot move a penny between participants retroactively.
    return readExpenseMoney(template.toObject());
  } catch {
    return null;
  }
}

/** The switch's record in `productswitches` (see `ProductSwitch`). */
const RECURRING_SWITCH = 'recurringExpenses';

/**
 * Remember that recurring Expenses are off, from the first run that finds them off. Only the
 * switch's own record is written: templates and Expenses stay exactly as they are.
 */
async function recordSwitchedOff(now: Date): Promise<void> {
  const state = await ProductSwitch.findById(RECURRING_SWITCH).lean();
  if (state?.enabled === false) return;
  await ProductSwitch.updateOne(
    { _id: RECURRING_SWITCH },
    { $set: { enabled: false, since: now } },
    { upsert: true },
  );
}

/**
 * When recurring Expenses were last turned back on, or null when this database has never seen
 * them off. The first run that finds them on after one that found them off records its time.
 */
async function lastSwitchedOnAt(now: Date): Promise<Date | null> {
  const state = await ProductSwitch.findById(RECURRING_SWITCH).lean();
  if (!state) return null;
  if (state.enabled) return state.since;
  const switchedOn = await ProductSwitch.findOneAndUpdate(
    { _id: RECURRING_SWITCH, enabled: false },
    { $set: { enabled: true, since: now } },
    { returnDocument: 'after' },
  ).lean();
  if (switchedOn) return switchedOn.since;
  // Another run changed the record in between. Without a turn-on time to trust, resume from now.
  const latest = await ProductSwitch.findById(RECURRING_SWITCH).lean();
  return latest?.enabled ? latest.since : now;
}

export class RecurringExpenseService {
  /**
   * Create a recurring template. Admins only, Household groups only.
   * Due periods are materialized immediately (idempotent lazy generation).
   * Refused with `RECURRING_EXPENSES_OFF` while recurring Expenses are off.
   */
  async create(groupId: string, data: CreateRecurringExpenseInput, userId: string) {
    assertRecurringExpensesOn();
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) return null;

    assertAdmin(group, userId);
    assertHouseholdTheme(group.category);
    assertTemplateData(group, data);
    const money = normalizeExpenseMoney(data);
    await lockLedgerCurrency(groupId, data.currency);
    // Record a turn back on before the insert, so this template counts as created after it
    // and catches up from its own start. The generation run below reads the record again and
    // reports a failure to read it, so one here only needs logging.
    await lastSwitchedOnAt(new Date()).catch((err: unknown) =>
      console.error('Could not read when recurring Expenses were turned on:', err),
    );

    const template = await withGroupMutation(groupId, async () =>
      RecurringExpense.create({
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
      }),
    );

    await this.generateDueExpenses(groupId);

    return template;
  }

  /**
   * List a group's recurring templates (any member may read). While recurring Expenses are
   * off, none is listed; the stored templates stay as they are.
   */
  async list(groupId: string) {
    if (!recurringExpensesEnabled()) return [];
    await connectDB();
    const group = await Group.findById(groupId).select('tags').lean();
    const templates = await RecurringExpense.find({ group: groupId })
      .populate('paidBy.user', PERSON_FIELDS)
      .populate('splitBetween.user', PERSON_FIELDS)
      .populate('createdBy', PERSON_FIELDS)
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
   * Refused with `RECURRING_EXPENSES_OFF` while recurring Expenses are off.
   */
  async update(
    groupId: string,
    recurringId: string,
    data: UpdateRecurringExpenseInput,
    userId: string,
    expectedRevision?: number,
  ) {
    assertRecurringExpensesOn();
    await connectDB();
    const group = await Group.findById(groupId);
    if (!group) return null;
    assertAdmin(group, userId);

    await withGroupMutation(groupId, async () =>
      RecurringExpense.updateOne(
        { _id: recurringId, group: groupId, revision: { $exists: false } },
        { $set: { revision: 0 } },
        { timestamps: false },
      ),
    );
    const template = await RecurringExpense.findOne({ _id: recurringId, group: groupId });
    if (!template) return null;
    assertExpectedRevision(template.revision, expectedRevision);

    const memberIds = new Set(group.members.map((member) => member.user.toString()));
    const original = template.toObject();
    const { money } = decideExpenseMoneyEdit(original, data);
    assertExpenseParticipants(memberIds, money.paidBy, money.splitBetween);
    assertGroupCurrency({ defaultCurrency: group.defaultCurrency }, money.currency);
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
      const result = await withGroupMutation(groupId, async () =>
        RecurringExpense.updateOne(
          { _id: template._id, group: groupId, revision: template.revision ?? 0 },
          {
            ...update,
            $inc: { revision: 1 },
            $max: { lastGeneratedFor: previousPeriod(toPeriod(new Date())) },
          },
          { runValidators: true },
        ),
      );
      if (!result.matchedCount) throw new Refusal('STALE_REVISION');
      template.revision = (template.revision ?? 0) + 1;
    } else {
      await withGroupMutation(groupId, async () => template.save());
    }

    await this.generateDueExpenses(groupId);

    return template;
  }

  /**
   * Delete a template. Hard-deletes the template only — expenses it already
   * generated are never touched.
   * Refused with `RECURRING_EXPENSES_OFF` while recurring Expenses are off.
   */
  async remove(groupId: string, recurringId: string, userId: string, expectedRevision?: number) {
    assertRecurringExpensesOn();
    await connectDB();
    const group = await Group.findById(groupId);
    if (!group) return null;
    assertAdmin(group, userId);

    await withGroupMutation(groupId, async () =>
      RecurringExpense.updateOne(
        { _id: recurringId, group: groupId, revision: { $exists: false } },
        { $set: { revision: 0 } },
        { timestamps: false },
      ),
    );
    const template = await RecurringExpense.findOne({ _id: recurringId, group: groupId });
    if (!template) return null;
    assertExpectedRevision(template.revision, expectedRevision);

    const result = await withGroupMutation(groupId, async () =>
      RecurringExpense.deleteOne({
        _id: template._id,
        group: groupId,
        revision: template.revision ?? { $exists: false },
      }),
    );
    if (!result.deletedCount) throw new Refusal('STALE_REVISION');
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
   * While recurring Expenses are off (#289) nothing is generated in any Group and
   * no template or Expense changes; once they are back on, a template that existed
   * then resumes from the month they were turned on, so the months off are never added.
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
   * `generateDueExpenses` for every Group a read across Groups covers, such as the member's
   * balances on Home (#306), so its figures agree with each Group's own reads.
   *
   * It costs one query for the whole list, plus one generation run per Group that has a month
   * to add, one Group after another: a Group with nothing due (or no template) is never run,
   * so a member with many Households pays nothing extra on most reads. The switch (#289) is read once. While it is off nothing is generated
   * and the run only records that it is off, as a single Group's read does; while it is on, the
   * first run after it was turned back on records when, even if none of these Groups has a
   * template. Like `generateDueExpenses`, this never throws into the read path.
   */
  async generateDueExpensesForGroups(
    groupIds: readonly string[],
    now: Date = new Date(),
  ): Promise<{ generated: number }> {
    let generated = 0;
    try {
      await connectDB();
      if (!recurringExpensesEnabled()) {
        await recordSwitchedOff(now).catch((err) =>
          console.error('Could not record that recurring Expenses are off:', err),
        );
        return { generated };
      }
      await lastSwitchedOnAt(now).catch((err: unknown) =>
        console.error('Could not read when recurring Expenses were turned on:', err),
      );
      if (groupIds.length === 0) return { generated };

      // One read of every template's schedule finds the Groups with a month to add. Most reads
      // find none, so no Group is run at all. A Group with one is run as its own read would be,
      // which applies everything this check leaves out (the Theme, the turn-on month, problem
      // states), so the check only has to never miss a due month.
      const currentPeriod = toPeriod(now);
      const schedules = await RecurringExpense.find({ group: { $in: groupIds } })
        .select('group dayOfMonth startsOn endsOn isPaused lastGeneratedFor')
        .lean();
      const due = new Set(
        schedules
          .filter((schedule) => getDuePeriods(schedule, currentPeriod).length > 0)
          .map((schedule) => String(schedule.group)),
      );
      for (const groupId of groupIds) {
        if (!due.has(groupId)) continue;
        generated += (await this.generateDueExpenses(groupId, now)).generated;
      }
    } catch (err) {
      console.error('Recurring generation could not complete across Groups:', err);
    }
    return { generated };
  }

  /**
   * The generation run behind `generateDueExpenses`, also reporting whether it
   * finished. `complete` is false when a due period could not be added or a
   * marker could not advance, so a due Expense may be missing from Balances; a
   * template skipped in its problem state counts as finished, as it does for
   * reads. A write that checks Balances, such as leaving a Group, refuses when
   * `complete` is false, and also while a template in its problem state
   * includes the member (`problemTemplatesIncluding`, #257). Never throws.
   */
  async materializeDueExpenses(
    groupId: string,
    now: Date = new Date(),
  ): Promise<{ generated: number; complete: boolean }> {
    let generated = 0;
    let complete = true;
    try {
      await connectDB();

      if (!recurringExpensesEnabled()) {
        // Off: no Expense is due, so the run is complete whatever happens to the record below.
        await recordSwitchedOff(now).catch((err) =>
          console.error('Could not record that recurring Expenses are off:', err),
        );
        return { generated: 0, complete };
      }
      // Read before the templates, so the first run after turning the switch back on records
      // that moment even in a Group with nothing due. A record that can't be read holds up
      // only a Group that would generate (below): a Group with nothing to add is unaffected.
      const switchedOn = await lastSwitchedOnAt(now).then(
        (at) => ({ at }),
        (err: unknown) => {
          console.error('Could not read when recurring Expenses were turned on:', err);
          return null;
        },
      );

      const templates = await RecurringExpense.find({ group: groupId });
      if (templates.length === 0) return { generated: 0, complete };

      const group = await Group.findById(groupId);
      if (!group || !getGroupTheme(group.category).recurringExpenses) {
        return { generated: 0, complete };
      }
      // An archived Group creates no recurring Expenses. Markers stay where they
      // are, so nothing is lost: were it un-archived, the next read catches up.
      if (group.isArchived) return { generated: 0, complete };

      // Without the record, the months these templates may add are unknown: add none, and
      // report the run unfinished, as any generation failure is. The next read retries.
      if (!switchedOn) return { generated: 0, complete: false };
      const switchedOnAt = switchedOn.at;

      const currentPeriod = toPeriod(now);

      for (const template of templates) {
        let duePeriods = getDuePeriods(
          {
            dayOfMonth: template.dayOfMonth,
            startsOn: template.startsOn,
            endsOn: template.endsOn,
            isPaused: template.isPaused,
            lastGeneratedFor: template.lastGeneratedFor,
          },
          currentPeriod,
        );
        // A template that existed while recurring Expenses were off resumes from the month
        // they were turned back on, as resuming a paused template does. A template created
        // since then catches up from its start, as any new template does.
        if (switchedOnAt && !(template.createdAt >= switchedOnAt)) {
          const resumeFrom = toPeriod(switchedOnAt);
          duePeriods = duePeriods.filter((period) => period >= resumeFrom);
        }
        if (duePeriods.length === 0) continue;

        const money = generatableMoney(group, template);

        // Advance only through the unbroken materialized prefix: a period that
        // fails unexpectedly is retried on the next read instead of being lost.
        let materializedThrough: string | null = null;
        for (const period of duePeriods) {
          try {
            const result = await recordLedger({
              groupId,
              actor: { id: String(template.createdBy), source: 'template-creator' },
              model: Expense,
              transactions: 'allow-standalone',
              retry: { template: template._id, period },
              command({ receipt }) {
                // A problem holds only new Months; a stored receipt is still confirmed.
                if (!receipt && !money)
                  throw new Refusal('RECURRING_EXPENSE_PROBLEM', { recurringExpenses: [] });
                return { period };
              },
              currencies: [{ currency: template.currency, rule: 'new-money' }],
              checkPeople(members) {
                assertExpenseParticipants(members, money!.paidBy, money!.splitBetween);
              },
              async prepare(command): ReturnType<LedgerRecording<IExpenseDocument>['prepare']> {
                const expenseId = new mongoose.Types.ObjectId();
                return [
                  {
                    id: expenseId,
                    async build() {
                      return {
                        document: {
                          description: template.description,
                          ...money,
                          category: template.category,
                          date: expenseDateForPeriod(command.period, template.dayOfMonth),
                          splitMethod: template.splitMethod,
                          ...resolveTagReference(group.tags, template),
                        },
                        activity: {
                          type: 'expense_added',
                          metadata: {
                            expenseId: String(expenseId),
                            description: template.description,
                            amount: money!.amount,
                            currency: template.currency,
                            recurring: true,
                            recurringExpenseId: String(template._id),
                            period: command.period,
                          },
                          alert: {
                            kind: 'expense_added',
                            involved: involvedMembers(money!),
                            switch: 'expense-changes',
                          },
                        },
                      };
                    },
                  },
                ];
              },
            });
            if (result.created) generated += 1;
            materializedThrough = period;
          } catch (err) {
            if (err instanceof Refusal && err.code === 'RECURRING_EXPENSE_PROBLEM') break;
            console.error(`Recurring generation failed for template ${template._id}:`, err);
            complete = false;
            break;
          }
        }

        if (materializedThrough) {
          await withGroupMutation(groupId, async () =>
            RecurringExpense.updateOne(
              { _id: template._id },
              { $max: { lastGeneratedFor: materializedThrough } },
              { timestamps: false },
            ),
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

  /**
   * The Group's recurring Expenses in their problem state that include this member, as a payer
   * or in the split (#257). Their missed months are added only once someone repairs them, and
   * would then fall on the members still in them, so the member stays until they're removed
   * from each, or it is repaired and they settle their share. Only where generation runs: while
   * recurring Expenses are off, outside a Household and in an archived Group none is listed,
   * since none adds anything there (and the first two hide them from the settings list).
   */
  async problemTemplatesIncluding(
    groupId: string,
    memberId: string,
  ): Promise<{ id: string; description: string }[]> {
    if (!recurringExpensesEnabled() || !mongoose.isValidObjectId(memberId)) return [];
    await connectDB();
    const group = await Group.findById(groupId);
    if (!group || group.isArchived || !getGroupTheme(group.category).recurringExpenses) return [];

    const member = new mongoose.Types.ObjectId(memberId);
    const templates = await RecurringExpense.find({
      group: groupId,
      $or: [{ 'paidBy.user': member }, { 'splitBetween.user': member }],
    }).sort({ createdAt: 1, _id: 1 });
    return templates
      .filter((template) => !generatableMoney(group, template))
      .map((template) => ({ id: String(template._id), description: template.description }));
  }
}

export const recurringExpenseService = new RecurringExpenseService();
