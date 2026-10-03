/**
 * Integration tests for a member leaving a Group, against a real, isolated
 * MongoDB database (`splitbook-test-group-leave`). Covers the settle-up rule,
 * the last-admin and last-member cases, and how Balances show former members.
 */

import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import Activity from '@/lib/models/Activity';
import { groupService, LeaveBlockedError } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { balanceService } from '@/lib/services/balance.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';

const db = integrationTestDb('group-leave');
const { alice, bob, carol, dave } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
});
afterAll(db.teardown);

/** A trip with alice (admin), then each of `members` as plain members. */
async function createTrip(members: string[] = [bob, carol]): Promise<string> {
  const group = await groupService.create(
    { name: 'Leave Trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  const groupId = group._id.toString();
  for (const member of members) await groupService.addMember(groupId, member);
  return groupId;
}

/** `payer` pays `amount` rupees, shared equally by `between`. */
async function addExpense(groupId: string, payer: string, amount: number, between: string[]) {
  return expenseService.create(
    groupId,
    {
      description: 'Dinner',
      amount,
      currency: 'INR',
      category: 'food',
      date: new Date('2026-09-20T12:00:00.000Z'),
      splitMethod: 'equal',
      tag: 'Food',
      paidBy: [{ user: payer, amount }],
      splitBetween: between.map((user) => ({ user })),
    },
    payer,
  );
}

async function memberIds(groupId: string) {
  const stored = await Group.findById(groupId).lean();
  return stored!.members.map((member) => member.user.toString()).sort();
}

async function blockedCode(action: Promise<unknown>) {
  const caught = await action.then(
    () => null,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(LeaveBlockedError);
  return caught as LeaveBlockedError;
}

describe('leaving a Group', () => {
  it('lets a settled-up member leave, logs it, and drops them from Balances', async () => {
    const groupId = await createTrip();
    await addExpense(groupId, alice, 300, [alice, bob, carol]);
    await settlementService.create(groupId, { paidTo: alice, amount: 100, currency: 'INR' }, bob);

    await expect(groupService.leave(groupId, bob)).resolves.toEqual({ archived: false });

    expect(await memberIds(groupId)).toEqual([alice, carol].sort());
    const left = await Activity.findOne({ group: groupId, type: 'member_left' }).lean();
    expect(left?.actor.toString()).toBe(bob);
    expect(left?.metadata).toEqual({ userId: bob, method: 'left' });

    const balances = await balanceService.getGroupBalances(groupId);
    expect(balances!.balances.map((balance) => balance.user._id).sort()).toEqual(
      [alice, carol].sort(),
    );
  });

  it('refuses while the member owes or is owed, listing each currency', async () => {
    const groupId = await createTrip();
    await addExpense(groupId, alice, 300, [alice, bob, carol]);
    // A legacy euro Expense, written directly because new Expenses must use the
    // Group's currency, leaves bob owed €12.50.
    await Expense.create({
      group: new mongoose.Types.ObjectId(groupId),
      description: 'Legacy euro taxi',
      amount: 25,
      currency: 'EUR',
      category: 'transport',
      date: new Date('2026-09-19T12:00:00.000Z'),
      paidBy: [{ user: new mongoose.Types.ObjectId(bob), amount: 25 }],
      splitMethod: 'equal',
      splitBetween: [
        { user: new mongoose.Types.ObjectId(bob), amount: 12.5 },
        { user: new mongoose.Types.ObjectId(carol), amount: 12.5 },
      ],
      tag: 'Food',
      createdBy: new mongoose.Types.ObjectId(bob),
    });

    const blocked = await blockedCode(groupService.leave(groupId, bob));

    expect(blocked.code).toBe('OPEN_BALANCE');
    expect(blocked.balances).toEqual([
      { currency: 'EUR', amountMinor: 1250 },
      { currency: 'INR', amountMinor: -10000 },
    ]);
    expect(await memberIds(groupId)).toEqual([alice, bob, carol].sort());
    expect(await Activity.countDocuments({ group: groupId, type: 'member_left' })).toBe(0);
  });

  it('ignores deleted Expenses when deciding whether the member is settled', async () => {
    const groupId = await createTrip();
    const expense = await addExpense(groupId, alice, 300, [alice, bob, carol]);
    await expenseService.delete(
      { actorId: alice, groupId, expenseId: String(expense._id) },
      expense.revision,
    );

    await expect(groupService.leave(groupId, bob)).resolves.toEqual({ archived: false });
  });

  it('asks the last admin to hand over before leaving', async () => {
    const groupId = await createTrip();

    expect((await blockedCode(groupService.leave(groupId, alice))).code).toBe('LAST_ADMIN');
    expect(await memberIds(groupId)).toEqual([alice, bob, carol].sort());

    await groupService.updateMemberRole(groupId, bob, 'admin', alice);
    await expect(groupService.leave(groupId, alice)).resolves.toEqual({ archived: false });
    expect(await memberIds(groupId)).toEqual([bob, carol].sort());
  });

  it('keeps one admin when the last two admins leave at the same moment', async () => {
    const groupId = await createTrip();
    await groupService.updateMemberRole(groupId, bob, 'admin', alice);

    const results = await Promise.allSettled([
      groupService.leave(groupId, alice),
      groupService.leave(groupId, bob),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(LeaveBlockedError);
    expect((refused.reason as LeaveBlockedError).code).toBe('LAST_ADMIN');
    const stored = await Group.findById(groupId).lean();
    expect(stored!.members.filter((member) => member.role === 'admin')).toHaveLength(1);
  });

  it('archives the Group when its last member leaves', async () => {
    const groupId = await createTrip([]);

    await expect(groupService.leave(groupId, alice)).resolves.toEqual({ archived: true });

    const stored = await Group.findById(groupId).lean();
    expect(stored!.members).toHaveLength(0);
    expect(stored!.isArchived).toBe(true);
    const types = await Activity.find({ group: groupId, actor: alice })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    expect(types.map((activity) => activity.type)).toEqual([
      'group_created',
      'member_left',
      'group_updated',
    ]);
    expect(types[2].metadata).toEqual({ changes: { isArchived: { old: false, new: true } } });
  });

  it('refuses strangers and answers null for a missing Group', async () => {
    const groupId = await createTrip();

    await expect(groupService.leave(groupId, dave)).rejects.toThrow('FORBIDDEN');
    await expect(groupService.leave('66f100000000000000000000', bob)).resolves.toBeNull();
  });

  it('lets a former member rejoin with their history intact', async () => {
    const groupId = await createTrip();
    await addExpense(groupId, bob, 90, [alice, bob, carol]);
    await settlementService.create(groupId, { paidTo: bob, amount: 30, currency: 'INR' }, alice);
    await settlementService.create(groupId, { paidTo: bob, amount: 30, currency: 'INR' }, carol);
    await groupService.leave(groupId, bob);

    await groupService.addMember(groupId, bob, 'member', undefined, 'link');

    expect(await memberIds(groupId)).toEqual([alice, bob, carol].sort());
    expect(await balanceService.getMemberOpenBalances(groupId, bob)).toEqual([]);
  });
});

describe('Balances with former members', () => {
  it('names a removed member who still has a balance instead of "Unknown"', async () => {
    const groupId = await createTrip();
    await addExpense(groupId, alice, 300, [alice, bob, carol]);
    await groupService.removeMember(groupId, carol, alice);

    const balances = await balanceService.getGroupBalances(groupId);
    const removed = balances!.balances.find((balance) => balance.user._id === carol);

    expect(removed?.user.name).toBe('Carol Tester');
    expect(removed?.balance).toBe(-100);
  });
});
