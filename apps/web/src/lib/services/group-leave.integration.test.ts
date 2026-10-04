/**
 * Integration tests for a member leaving a Group, against a real, isolated
 * MongoDB database (`splitbook-test-group-leave`). Covers the settle-up rule,
 * the last-admin and last-member cases, how Balances show former members, and
 * the recurring Expenses that fall due before a member leaves a Household.
 * Only the session is a stand-in for the route checks.
 */

import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import Activity from '@/lib/models/Activity';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService, LeaveBlockedError } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { balanceService } from '@/lib/services/balance.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import {
  expenseDateForPeriod,
  previousPeriod,
  toPeriod,
} from '@splitbook/shared/recurring-due-periods';
import { POST as leaveRoute } from '@/app/api/groups/[id]/leave/route';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.userId
          ? { user: { id: session.userId, name: 'Tester', email: 'tester@splitbook-test.local' } }
          : null,
      ),
    },
  },
}));

const db = integrationTestDb('group-leave');
const { alice, bob, carol, dave } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = null;
});
afterEach(() => vi.restoreAllMocks());
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

  it('makes a member change loaded before the leave fail instead of hitting a shifted index', async () => {
    const groupId = await createTrip();
    // An admin's role change has loaded the Group, with carol at index 2, before bob leaves.
    const stale = await Group.findById(groupId);
    const carolEntry = stale!.members.find((member) => member.user.toString() === carol)!;

    await expect(groupService.leave(groupId, bob)).resolves.toEqual({ archived: false });

    carolEntry.role = 'admin';
    await expect(stale!.save()).rejects.toBeInstanceOf(mongoose.Error.VersionError);
    const stored = await Group.findById(groupId).lean();
    expect(stored!.members.map((member) => [String(member.user), member.role])).toEqual([
      [alice, 'admin'],
      [carol, 'member'],
    ]);
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

const CURRENT_PERIOD = toPeriod(new Date());
const PREVIOUS_PERIOD = previousPeriod(CURRENT_PERIOD);

/**
 * A Household of alice (admin), bob and carol whose ₹30,000 Rent, paid by alice and split
 * equally, was materialized through last month only: nobody has read the Group since this
 * month's Rent fell due. Bob has paid alice his ₹10,000 for last month.
 */
async function householdWithRentDue() {
  const group = await groupService.create(
    { name: 'Flat 4B', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  await groupService.addMember(groupId, carol);

  const template = await recurringExpenseService.create(
    groupId,
    {
      description: 'Rent',
      amount: 30000,
      currency: 'INR',
      category: 'housing',
      tag: 'Rent',
      paidBy: [{ user: alice, amount: 30000 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
      dayOfMonth: 1,
      startsOn: expenseDateForPeriod(PREVIOUS_PERIOD, 1),
    },
    alice,
  );
  const templateId = String(template!._id);

  // Undo this month's materialization: remove its row and move the marker back a month.
  const removed = await Expense.deleteOne({ recurringExpense: templateId, period: CURRENT_PERIOD });
  expect(removed.deletedCount).toBe(1);
  await Activity.deleteOne({ group: groupId, 'metadata.period': CURRENT_PERIOD });
  await RecurringExpense.updateOne(
    { _id: templateId },
    { $set: { lastGeneratedFor: PREVIOUS_PERIOD } },
  );
  expect(await rentFor(templateId, PREVIOUS_PERIOD)).toBe(1);

  await settlementService.create(groupId, { paidTo: alice, amount: 10000, currency: 'INR' }, bob);
  expect(await balanceService.getMemberOpenBalances(groupId, bob)).toEqual([]);

  return { groupId, templateId };
}

function rentFor(templateId: string, period: string) {
  return Expense.countDocuments({ recurringExpense: templateId, period, isDeleted: false });
}

async function leaveThroughRoute(groupId: string, userId: string) {
  session.userId = userId;
  const request = new Request(`http://localhost/api/groups/${groupId}/leave`, { method: 'POST' });
  const response = await leaveRoute(request, { params: Promise.resolve({ id: groupId }) });
  return { status: response.status, body: await response.json() };
}

describe('leaving a Household with a recurring Expense due', () => {
  it('adds this month’s Rent before checking Balances, so the member who owes it stays', async () => {
    const { groupId, templateId } = await householdWithRentDue();

    const blocked = await blockedCode(groupService.leave(groupId, bob));

    expect(blocked.code).toBe('OPEN_BALANCE');
    expect(blocked.balances).toEqual([{ currency: 'INR', amountMinor: -1000000 }]);
    expect(await memberIds(groupId)).toEqual([alice, bob, carol].sort());
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(1);
    expect(await Activity.countDocuments({ group: groupId, type: 'member_left' })).toBe(0);
  });

  it('answers 409 OPEN_BALANCE through the route, naming this month’s share', async () => {
    const { groupId } = await householdWithRentDue();

    expect(await leaveThroughRoute(groupId, bob)).toEqual({
      status: 409,
      body: {
        error: 'Settle up before you leave: you owe ₹10,000.00 in this Group.',
        status: 409,
        code: 'OPEN_BALANCE',
        balances: [{ currency: 'INR', amount: -10000 }],
      },
    });
  });

  it('lets the member leave once they pay this month’s share, without a second Rent', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    await blockedCode(groupService.leave(groupId, bob));

    await settlementService.create(groupId, { paidTo: alice, amount: 10000, currency: 'INR' }, bob);

    await expect(groupService.leave(groupId, bob)).resolves.toEqual({ archived: false });
    expect(await memberIds(groupId)).toEqual([alice, carol].sort());
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(1);
    expect(await rentFor(templateId, PREVIOUS_PERIOD)).toBe(1);
  });

  it('refuses the leave when adding due Expenses does not finish', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const create = vi
      .spyOn(Expense, 'create')
      .mockImplementationOnce(() => Promise.reject(new Error('Expense store unavailable')));

    expect(await leaveThroughRoute(groupId, bob)).toEqual({
      status: 409,
      body: {
        error: 'This Group changed while you were leaving. Try again.',
        status: 409,
        code: 'LEAVE_CONFLICT',
      },
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ period: CURRENT_PERIOD }));
    expect(await memberIds(groupId)).toEqual([alice, bob, carol].sort());
    expect(await Activity.countDocuments({ group: groupId, type: 'member_left' })).toBe(0);
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);

    // Trying again adds this month's Rent once and finds the member owing it.
    const blocked = await blockedCode(groupService.leave(groupId, bob));
    expect(blocked.balances).toEqual([{ currency: 'INR', amountMinor: -1000000 }]);
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(1);
  });

  it('refuses the leave when a due period’s marker cannot move', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(RecurringExpense, 'updateOne').mockImplementationOnce(
      () =>
        Promise.reject(new Error('marker interrupted')) as unknown as ReturnType<
          typeof RecurringExpense.updateOne
        >,
    );

    expect(await leaveThroughRoute(groupId, bob)).toEqual({
      status: 409,
      body: {
        error: 'This Group changed while you were leaving. Try again.',
        status: 409,
        code: 'LEAVE_CONFLICT',
      },
    });

    expect(await memberIds(groupId)).toEqual([alice, bob, carol].sort());
    expect(await Activity.countDocuments({ group: groupId, type: 'member_left' })).toBe(0);
    // This month's Rent was added; only its marker failed to move.
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(1);
    const stored = await RecurringExpense.findById(templateId).lean();
    expect(stored?.lastGeneratedFor).toBe(PREVIOUS_PERIOD);

    // Trying again finds this month's Rent already added, moves the marker and
    // finds the member owing it, without a second Rent.
    const blocked = await blockedCode(groupService.leave(groupId, bob));
    expect(blocked.balances).toEqual([{ currency: 'INR', amountMinor: -1000000 }]);
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(1);
  });

  it('does not hold up the leave for a template in its problem state', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    const group = await groupService.getById(groupId);
    const rentTag = group!.tags.find((tag) => tag.name === 'Rent')!;
    await groupService.updateTag(groupId, String(rentTag._id), { isArchived: true }, alice);

    // The Rent no longer validates, so it is skipped as reads skip it, and the run
    // still counts as finished.
    expect(await recurringExpenseService.materializeDueExpenses(groupId)).toEqual({
      generated: 0,
      complete: true,
    });
    await expect(groupService.leave(groupId, bob)).resolves.toEqual({ archived: false });

    expect(await memberIds(groupId)).toEqual([alice, carol].sort());
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);
  });

  it('adds nothing first when the Household is archived', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    await groupService.archive(groupId, alice);

    await expect(groupService.leave(groupId, bob)).resolves.toEqual({ archived: false });

    expect(await memberIds(groupId)).toEqual([alice, carol].sort());
    expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);
  });
});
