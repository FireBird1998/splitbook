/**
 * Idempotent demo database seed / reset.
 * Intended for CLI use via `pnpm demo:seed` and `pnpm demo:reset`.
 */

import mongoose from 'mongoose';
import connectDB from '@/lib/db';
import User from '@/lib/models/User';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Activity from '@/lib/models/Activity';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Invitation from '@/lib/models/Invitation';
import { DEMO_PERSONAS, DEMO_SEEDED_GROUP_IDS } from '@/lib/demo-personas';
import { expenseService } from '@/lib/services/expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { activityService } from '@/lib/services/activity.service';
import {
  buildDemoSeedPlan,
  daysAgoDate,
  shouldInsertTripTransactions,
  type DemoSeedPlan,
} from '@/lib/demo/seed-plan';
import { buildDemoGroupsPlan } from '@/lib/demo/groups-plan';
import { seedDemoGroup, type DemoGroupSeedResult } from '@/lib/demo/seed-groups';
import { recurringExpensesEnabled } from '@/lib/recurring-expenses-switch';

export interface SeedResult {
  usersUpserted: number;
  groupCreated: boolean;
  tagsEnsured: number;
  membersEnsured: number;
  expensesCreated: number;
  settlementsCreated: number;
  skippedTransactions: boolean;
  /**
   * The recurring Expenses switch (#289) while seeding: on, the Household's monthly bills
   * are templates; off, the same bills are entered by hand.
   */
  recurringExpenses: 'on' | 'off';
  /** The Groups seeded beside the Goa trip (#302); the fields above describe the trip. */
  demoGroups: DemoGroupSeedResult[];
}

async function upsertDemoUsers(): Promise<number> {
  let count = 0;
  for (const persona of DEMO_PERSONAS) {
    const existing = await User.findById(persona.id);
    if (existing) {
      existing.name = persona.name;
      existing.email = persona.email;
      if (persona.image) existing.image = persona.image;
      existing.preferredCurrency = 'INR';
      await existing.save();
    } else {
      await User.create({
        _id: new mongoose.Types.ObjectId(persona.id),
        name: persona.name,
        email: persona.email,
        image: persona.image ?? undefined,
        preferredCurrency: 'INR',
      });
    }
    count += 1;
  }
  return count;
}

async function ensureGroup(plan: DemoSeedPlan): Promise<{ created: boolean }> {
  const existing = await Group.findById(plan.groupId);
  if (existing) {
    return { created: false };
  }

  await Group.create({
    _id: new mongoose.Types.ObjectId(plan.groupId),
    name: plan.groupName,
    description: 'Private-beta demo trip — three friends splitting a Goa getaway.',
    createdBy: plan.adminId,
    category: 'trip',
    defaultCurrency: plan.currency,
    alternateCurrencies: [],
    startDate: daysAgoDate(10),
    endDate: daysAgoDate(7),
    isArchived: false,
    members: [
      {
        user: new mongoose.Types.ObjectId(plan.adminId),
        role: 'admin',
        joinedAt: daysAgoDate(12),
      },
    ],
    tags: [],
  });

  await activityService.log(plan.groupId, 'group_created', plan.adminId, {
    groupName: plan.groupName,
  });

  return { created: true };
}

async function ensureMembers(plan: DemoSeedPlan): Promise<number> {
  const group = await Group.findById(plan.groupId);
  if (!group) throw new Error('Demo group missing after ensureGroup');

  let added = 0;
  for (const memberId of plan.memberIds) {
    const exists = group.members.some((m) => m.user.toString() === memberId);
    if (exists) continue;

    group.members.push({
      user: new mongoose.Types.ObjectId(memberId),
      role: memberId === plan.adminId ? 'admin' : 'member',
      joinedAt: daysAgoDate(11),
    });
    added += 1;

    if (memberId !== plan.adminId) {
      await activityService.log(plan.groupId, 'member_joined', memberId, {
        userId: memberId,
        method: 'invite',
      });
    }
  }

  if (added > 0) {
    await group.save();
  }

  return added;
}

async function ensureTags(plan: DemoSeedPlan): Promise<number> {
  const group = await Group.findById(plan.groupId);
  if (!group) throw new Error('Demo group missing after ensureGroup');

  const existingNames = new Set((group.tags || []).map((t) => t.name.toLowerCase()));
  let added = 0;

  for (const tagName of plan.tags) {
    if (existingNames.has(tagName.toLowerCase())) continue;
    group.tags.push({
      _id: new mongoose.Types.ObjectId(),
      name: tagName,
      isArchived: false,
      createdAt: daysAgoDate(11),
    });
    existingNames.add(tagName.toLowerCase());
    added += 1;
  }

  if (added > 0) {
    await group.save();
  }

  return added;
}

async function insertTripTransactions(plan: DemoSeedPlan): Promise<{
  expensesCreated: number;
  settlementsCreated: number;
}> {
  let expensesCreated = 0;
  const group = await Group.findById(plan.groupId);
  if (!group) throw new Error('Demo group missing before transactions');

  for (const expense of plan.expenses) {
    await expenseService.create(
      plan.groupId,
      {
        description: expense.description,
        amount: expense.amount,
        currency: expense.currency,
        category: expense.category,
        date: daysAgoDate(expense.daysAgo),
        paidBy: expense.paidBy,
        splitMethod: expense.splitMethod,
        splitBetween: expense.splitBetween,
        tagId: group.tags
          .find((tag) => tag.name === expense.tag && !tag.isArchived && !tag.isDeleted)
          ?._id.toString(),
        tag: expense.tag,
        notes: expense.notes,
      },
      expense.paidBy[0].user,
    );
    expensesCreated += 1;
  }

  await settlementService.create(
    plan.groupId,
    {
      paidTo: plan.settlement.paidTo,
      amount: plan.settlement.amount,
      currency: plan.settlement.currency,
      note: plan.settlement.note,
    },
    plan.settlement.paidBy,
  );

  return { expensesCreated, settlementsCreated: 1 };
}

/**
 * Idempotent seed: upserts personas, ensures the Goa trip, then the demo Groups beside it
 * (a Household, a week-long Trip and a Work Group, #302).
 * Re-running does not duplicate expenses, settlements, templates or invitations.
 */
export async function seedDemoData(): Promise<SeedResult> {
  await connectDB();
  const plan = buildDemoSeedPlan();

  const usersUpserted = await upsertDemoUsers();
  const { created: groupCreated } = await ensureGroup(plan);
  const membersEnsured = await ensureMembers(plan);
  const tagsEnsured = await ensureTags(plan);

  const expenseCount = await Expense.countDocuments({ group: plan.groupId, isDeleted: false });
  const settlementCount = await Settlement.countDocuments({ group: plan.groupId });

  const insert = shouldInsertTripTransactions({
    groupExists: true,
    expenseCount,
    settlementCount,
  });

  let expensesCreated = 0;
  let settlementsCreated = 0;
  let skippedTransactions = false;

  if (insert) {
    const result = await insertTripTransactions(plan);
    expensesCreated = result.expensesCreated;
    settlementsCreated = result.settlementsCreated;
  } else {
    skippedTransactions = true;
  }

  const recurringOn = recurringExpensesEnabled();
  const demoGroups: DemoGroupSeedResult[] = [];
  for (const groupPlan of buildDemoGroupsPlan(new Date())) {
    demoGroups.push(await seedDemoGroup(groupPlan, recurringOn));
  }

  return {
    usersUpserted,
    groupCreated,
    tagsEnsured,
    membersEnsured,
    expensesCreated,
    settlementsCreated,
    skippedTransactions,
    recurringExpenses: recurringOn ? 'on' : 'off',
    demoGroups,
  };
}

/**
 * Wipe every Group the seed creates, with everything recorded in them, then reseed.
 * Other Groups, and the persona users, are left alone.
 */
export async function resetDemoData(): Promise<SeedResult> {
  await connectDB();

  const inSeededGroups = { group: { $in: [...DEMO_SEEDED_GROUP_IDS] } };
  await Promise.all([
    Expense.deleteMany(inSeededGroups),
    Settlement.deleteMany(inSeededGroups),
    Activity.deleteMany(inSeededGroups),
    RecurringExpense.deleteMany(inSeededGroups),
    Invitation.deleteMany(inSeededGroups),
    Group.deleteMany({ _id: { $in: [...DEMO_SEEDED_GROUP_IDS] } }),
  ]);

  // Keep persona user docs; seed upserts them again.
  return seedDemoData();
}

export async function disconnectDemoDb(): Promise<void> {
  await mongoose.disconnect();
}
