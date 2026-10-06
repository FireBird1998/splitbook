/**
 * Writes the demo Groups planned in `groups-plan.ts` (#302).
 *
 * Every record goes through the validators and services a member's request goes through, so
 * stored data has the shape real writes give it: exact money, Tag ids, the currency lock,
 * edit history, soft deletes and Activity entries. The Groups themselves are created with
 * fixed ids, as the Goa trip is, so `demo:reset` can remove exactly what the seed made, and
 * their Tags have fixed ids too, so a reset gives the same Tag ids.
 *
 * Recurring Expenses follow the product switch (#289). Switched on, the Household's monthly
 * bills are templates, created as a Household admin creates them, and the template adds
 * one Expense per Month. Switched off, no template is created; the flatmates enter the same
 * monthly bills by hand, so the ledger and every balance are the same either way.
 */

import mongoose from 'mongoose';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Invitation from '@/lib/models/Invitation';
import { activityService } from '@/lib/services/activity.service';
import { expenseService } from '@/lib/services/expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { invitationService } from '@/lib/services/invitation.service';
import { expenseDateForPeriod } from '@splitbook/shared/recurring-due-periods';
import { createGroupSchema } from '@splitbook/shared/validators/group';
import { createExpenseSchema, updateExpenseSchema } from '@splitbook/shared/validators/expense';
import { createRecurringExpenseSchema } from '@splitbook/shared/validators/recurring-expense';
import { createSettlementSchema } from '@splitbook/shared/validators/settlement';
import {
  demoGroupTags,
  shouldInsertDemoLedger,
  type DemoExpenseEditPlan,
  type DemoExpenseInput,
  type DemoGroupKey,
  type DemoGroupPlan,
} from '@/lib/demo/groups-plan';

export interface DemoGroupSeedResult {
  key: DemoGroupKey;
  groupId: string;
  name: string;
  groupCreated: boolean;
  membersEnsured: number;
  tagsEnsured: number;
  /** Every Expense written, including the recurring Months. */
  expensesCreated: number;
  expensesEdited: number;
  expensesDeleted: number;
  recurringTemplatesCreated: number;
  settlementsCreated: number;
  invitationsCreated: number;
  skippedTransactions: boolean;
}

const objectId = (id: string) => new mongoose.Types.ObjectId(id);

async function ensureGroup(plan: DemoGroupPlan): Promise<boolean> {
  if (await Group.exists({ _id: plan.groupId })) return false;

  const data = createGroupSchema.parse({
    name: plan.name,
    description: plan.description,
    category: plan.category,
    defaultCurrency: plan.currency,
    startDate: plan.startDate,
    endDate: plan.endDate,
  });
  await Group.create({
    ...data,
    _id: objectId(plan.groupId),
    createdBy: plan.adminId,
    members: [{ user: objectId(plan.adminId), role: 'admin', joinedAt: plan.joinedAt }],
    tags: demoGroupTags(plan).map((tag) => ({
      _id: objectId(tag.id),
      name: tag.name,
      isArchived: false,
      createdAt: plan.joinedAt,
    })),
  });
  await activityService.log(plan.groupId, 'group_created', plan.adminId, {
    groupName: plan.name,
  });
  return true;
}

async function ensureMembers(plan: DemoGroupPlan): Promise<number> {
  const group = await Group.findById(plan.groupId);
  if (!group) throw new Error(`Demo Group ${plan.name} missing after it was ensured`);

  const joining = plan.memberIds.filter(
    (memberId) => !group.members.some((member) => member.user.toString() === memberId),
  );
  if (joining.length === 0) return 0;

  for (const memberId of joining) {
    group.members.push({
      user: objectId(memberId),
      role: memberId === plan.adminId ? 'admin' : 'member',
      joinedAt: plan.joinedAt,
    });
  }
  await group.save();
  for (const memberId of joining) {
    if (memberId === plan.adminId) continue;
    await activityService.log(plan.groupId, 'member_joined', memberId, {
      userId: memberId,
      method: 'invite',
    });
  }
  return joining.length;
}

async function ensureTags(plan: DemoGroupPlan): Promise<number> {
  const group = await Group.findById(plan.groupId);
  if (!group) throw new Error(`Demo Group ${plan.name} missing after it was ensured`);

  // Only a default Tag missing by name and by id is added again; renamed or archived Tags stay.
  const names = new Set(group.tags.map((tag) => tag.name.trim().toLowerCase()));
  const ids = new Set(group.tags.map((tag) => String(tag._id)));
  const missing = demoGroupTags(plan).filter(
    (tag) => !names.has(tag.name.toLowerCase()) && !ids.has(tag.id),
  );
  if (missing.length === 0) return 0;
  for (const tag of missing) {
    group.tags.push({
      _id: objectId(tag.id),
      name: tag.name,
      isArchived: false,
      createdAt: plan.joinedAt,
    });
  }
  await group.save();
  return missing.length;
}

async function currentRevision(expenseId: string): Promise<number> {
  const expense = await Expense.findById(expenseId).select('revision').lean();
  return expense?.revision ?? 0;
}

/** Writes a Group's Expenses, edits, deletions, recurring Months and payments, in that order. */
async function insertLedger(plan: DemoGroupPlan, recurringOn: boolean) {
  const group = await Group.findById(plan.groupId).lean();
  if (!group) throw new Error(`Demo Group ${plan.name} missing before its ledger`);

  const tagId = (name: string) => {
    const tag = group.tags.find(
      (candidate) => candidate.name === name && !candidate.isArchived && !candidate.isDeleted,
    );
    if (!tag) throw new Error(`Demo Group ${plan.name} has no active Tag ${name}`);
    return tag._id.toString();
  };
  // The body a member's form sends: the Tag by its id, the amount in the Group's currency.
  const body = (input: DemoExpenseInput) => ({
    description: input.description,
    amount: input.amount,
    currency: plan.currency,
    category: input.category,
    tagId: tagId(input.tag),
    tag: input.tag,
    paidBy: input.paidBy,
    splitMethod: input.splitMethod,
    splitBetween: input.splitBetween,
    ...(input.notes ? { notes: input.notes } : {}),
  });
  const editBody = ({ change }: DemoExpenseEditPlan) => {
    const { tag, ...rest } = change;
    const money = change.amount !== undefined || change.paidBy || change.splitBetween;
    return {
      ...rest,
      ...(money ? { currency: plan.currency } : {}),
      ...(tag ? { tagId: tagId(tag), tag } : {}),
    };
  };

  let expensesCreated = 0;
  let recurringTemplatesCreated = 0;

  for (const recurring of plan.recurring) {
    if (recurringOn) {
      const template = await recurringExpenseService.create(
        plan.groupId,
        createRecurringExpenseSchema.parse({
          ...body(recurring),
          dayOfMonth: recurring.dayOfMonth,
          startsOn: recurring.startsOn,
        }),
        recurring.createdBy,
      );
      if (!template) throw new Error(`Demo Group ${plan.name} missing for its templates`);
      recurringTemplatesCreated += 1;
      const generation = await recurringExpenseService.materializeDueExpenses(plan.groupId);
      const generated = await Expense.countDocuments({ recurringExpense: template._id });
      if (!generation.complete || generated !== recurring.periods.length) {
        throw new Error(
          `Recurring Expense "${recurring.description}" added ${generated} of ` +
            `${recurring.periods.length} Months. Run pnpm web demo:reset to seed again.`,
        );
      }
      expensesCreated += generated;
    } else {
      for (const period of recurring.periods) {
        await expenseService.create(
          plan.groupId,
          createExpenseSchema.parse({
            ...body(recurring),
            date: expenseDateForPeriod(period, recurring.dayOfMonth).toISOString().slice(0, 10),
          }),
          recurring.createdBy,
        );
        expensesCreated += 1;
      }
    }
  }

  const expenseIds = new Map<string, string>();
  for (const expense of plan.expenses) {
    const created = await expenseService.create(
      plan.groupId,
      createExpenseSchema.parse({ ...body(expense), date: expense.date }),
      expense.recordedBy,
    );
    expenseIds.set(expense.key, created._id.toString());
    expensesCreated += 1;
  }
  const idOf = (key: string) => {
    const id = expenseIds.get(key);
    if (!id) throw new Error(`Demo Group ${plan.name} has no planned Expense ${key}`);
    return id;
  };

  for (const edit of plan.edits) {
    const expenseId = idOf(edit.expenseKey);
    await expenseService.update(
      { actorId: edit.editedBy, groupId: plan.groupId, expenseId },
      updateExpenseSchema.parse(editBody(edit)),
      await currentRevision(expenseId),
    );
  }

  for (const deletion of plan.deletions) {
    const expenseId = idOf(deletion.expenseKey);
    await expenseService.delete(
      { actorId: deletion.deletedBy, groupId: plan.groupId, expenseId },
      await currentRevision(expenseId),
    );
  }

  for (const settlement of plan.settlements) {
    await settlementService.create(
      plan.groupId,
      createSettlementSchema.parse({
        paidBy: settlement.paidBy,
        paidTo: settlement.paidTo,
        amount: settlement.amount,
        currency: plan.currency,
        note: settlement.note,
      }),
      settlement.paidBy,
    );
  }

  return {
    expensesCreated,
    expensesEdited: plan.edits.length,
    expensesDeleted: plan.deletions.length,
    recurringTemplatesCreated,
    settlementsCreated: plan.settlements.length,
  };
}

/**
 * Invite whoever the plan invites, once. Nothing is sent again after the invitation was
 * answered, or once it expires; `demo:reset` sends a fresh one.
 */
async function ensureInvitations(plan: DemoGroupPlan): Promise<number> {
  let created = 0;
  for (const invitation of plan.invitations) {
    const exists = await Invitation.exists({
      group: plan.groupId,
      invitedEmail: invitation.email.toLowerCase(),
    });
    if (exists) continue;
    await invitationService.create(plan.groupId, invitation.email, invitation.invitedBy);
    created += 1;
  }
  return created;
}

/** Idempotent: a Group that already has a ledger keeps it, and nothing is added twice. */
export async function seedDemoGroup(
  plan: DemoGroupPlan,
  recurringOn: boolean,
): Promise<DemoGroupSeedResult> {
  const groupCreated = await ensureGroup(plan);
  const membersEnsured = await ensureMembers(plan);
  const tagsEnsured = await ensureTags(plan);

  const [expenseCount, settlementCount, recurringCount] = await Promise.all([
    Expense.countDocuments({ group: plan.groupId }),
    Settlement.countDocuments({ group: plan.groupId }),
    RecurringExpense.countDocuments({ group: plan.groupId }),
  ]);
  const insert = shouldInsertDemoLedger({ expenseCount, settlementCount, recurringCount });
  const ledger = insert
    ? await insertLedger(plan, recurringOn)
    : {
        expensesCreated: 0,
        expensesEdited: 0,
        expensesDeleted: 0,
        recurringTemplatesCreated: 0,
        settlementsCreated: 0,
      };
  const invitationsCreated = await ensureInvitations(plan);

  return {
    key: plan.key,
    groupId: plan.groupId,
    name: plan.name,
    groupCreated,
    membersEnsured,
    tagsEnsured,
    ...ledger,
    invitationsCreated,
    skippedTransactions: !insert,
  };
}
