/**
 * Integration tests for Home's latest changes (`GET /api/user/activity`, #309) against a real,
 * isolated MongoDB database (`splitbook-test-user-activity-route`). Only the session is a
 * stand-in; membership, ordering, the cap and what the read sends run against stored events.
 */

import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Activity from '@/lib/models/Activity';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { activityService } from '@/lib/services/activity.service';
import { makePendingActivity } from '@/lib/financial-write';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { formatActivityAmount } from '@splitbook/shared/activity-timeline';
import {
  parseUserActivityResponse,
  type UserActivityEventRead,
} from '@splitbook/shared/user-activity-read';
import { GET } from './route';

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

const db = integrationTestDb('user-activity-route');
const { alice, bob, carol, dave } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = null;
});
afterAll(db.teardown);

async function readLatest(userId: string | null, query = '') {
  session.userId = userId;
  const response = await GET(new Request(`http://localhost/api/user/activity${query}`));
  return { status: response.status, body: await response.json() };
}

/** A successful read, checked by the shared decoder the web card uses. */
async function latest(userId: string, query = '') {
  const { status, body } = await readLatest(userId, query);
  expect(status).toBe(200);
  return parseUserActivityResponse(body);
}

/** Each event as "type · Group · actor", in the order the read sends them. */
const lines = (events: UserActivityEventRead[]) =>
  events.map((event) => {
    const actor = event.actor && typeof event.actor === 'object' ? event.actor.name : event.actor;
    return `${event.type} · ${event.group.name} · ${actor}`;
  });

async function createGroup(name: string, creator: string, ...members: string[]) {
  const group = await groupService.create(
    { name, category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    creator,
  );
  const groupId = String(group._id);
  for (const member of members) await groupService.addMember(groupId, member);
  return groupId;
}

const command = (description: string, amount: number, payer: string, members: string[]) => ({
  description,
  amount,
  currency: 'INR',
  category: 'transport',
  tag: 'General',
  date: new Date('2026-09-20'),
  paidBy: [{ user: payer, amount }],
  splitMethod: 'equal' as const,
  splitBetween: members.map((user) => ({ user })),
});

describe('GET /api/user/activity', () => {
  it('lists the latest changes across the member’s Groups, newest first, each naming its Group', async () => {
    const ferry = await createGroup('Ferry Trip', alice, bob);
    const cabin = await createGroup('Cabin', carol, alice);
    const tickets = await expenseService.create(
      ferry,
      command('Ferry tickets', 120, alice, [alice, bob]),
      alice,
    );
    await expenseService.create(cabin, command('Firewood', 60, carol, [alice, carol]), carol);
    await expenseService.update(
      { actorId: bob, groupId: ferry, expenseId: String(tickets._id) },
      command('Ferry tickets', 150, alice, [alice, bob]),
      0,
    );

    const read = await latest(alice);
    expect(lines(read.activities)).toEqual([
      'expense_updated · Ferry Trip · Bob Tester',
      'expense_added · Cabin · Carol Tester',
      'expense_added · Ferry Trip · Alice Tester',
      'member_joined · Cabin · Alice Tester',
      'group_created · Cabin · Carol Tester',
      'member_joined · Ferry Trip · Bob Tester',
      'group_created · Ferry Trip · Alice Tester',
    ]);
    const times = read.activities.map((event) => Date.parse(event.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(read.activities[0].group).toEqual({ _id: ferry, name: 'Ferry Trip' });
    expect(read.limit).toBe(10);
  });

  it('breaks a tie in time by the newer event first', async () => {
    const ferry = await createGroup('Ferry Trip', alice);
    await Activity.deleteMany({});
    const at = new Date('2026-10-01T09:00:00Z');
    const [older, newer] = [new Types.ObjectId(), new Types.ObjectId()];
    await Activity.collection.insertMany([
      {
        _id: older,
        group: new Types.ObjectId(ferry),
        type: 'expense_added',
        actor: new Types.ObjectId(alice),
        metadata: { description: 'Older' },
        createdAt: at,
      },
      {
        _id: newer,
        group: new Types.ObjectId(ferry),
        type: 'expense_added',
        actor: new Types.ObjectId(alice),
        metadata: { description: 'Newer' },
        createdAt: at,
      },
    ]);

    const read = await latest(alice);
    expect(read.activities.map((event) => event._id)).toEqual([String(newer), String(older)]);
  });

  it('leaves out a Group the member has left, one they never joined, and an archived one', async () => {
    const ferry = await createGroup('Ferry Trip', alice, bob);
    const lake = await createGroup('Lake House', alice, bob);
    const cabin = await createGroup('Cabin', carol, dave);
    const attic = await createGroup('Attic', bob);
    await expenseService.create(ferry, command('Ferry tickets', 120, alice, [alice, bob]), alice);
    await expenseService.create(lake, command('Boat hire', 300, alice, [alice]), alice);
    await expenseService.create(cabin, command('Firewood', 60, carol, [carol, dave]), carol);
    await groupService.leave(lake, bob);
    await groupService.archive(attic, bob);

    const groupsBobSees = new Set((await latest(bob)).activities.map((event) => event.group.name));
    expect([...groupsBobSees]).toEqual(['Ferry Trip']);

    // Alice is still in the Lake House: she sees Bob leave it, and its Expense.
    expect(lines((await latest(alice)).activities).slice(0, 3)).toEqual([
      'member_left · Lake House · Bob Tester',
      'expense_added · Lake House · Alice Tester',
      'expense_added · Ferry Trip · Alice Tester',
    ]);
    // Dave never joined Alice's Groups, and Alice never joined the Cabin.
    expect(new Set((await latest(dave)).activities.map((event) => event.group._id))).toEqual(
      new Set([cabin]),
    );
  });

  it('is empty for a member with no Groups', async () => {
    expect(await latest(dave)).toEqual({ activities: [], limit: 10 });
  });

  it('reads 10 by default, as many as asked up to 50, and never more', async () => {
    const ferry = await createGroup('Ferry Trip', alice);
    await Activity.deleteMany({});
    const start = Date.parse('2026-10-01T09:00:00Z');
    await Activity.collection.insertMany(
      Array.from({ length: 60 }, (_, index) => ({
        group: new Types.ObjectId(ferry),
        type: 'expense_added',
        actor: new Types.ObjectId(alice),
        metadata: { description: `Snack ${index}`, amount: index + 1, currency: 'INR' },
        createdAt: new Date(start + index * 60_000),
      })),
    );

    const byDefault = await latest(alice);
    expect(byDefault.limit).toBe(10);
    expect(byDefault.activities.map((event) => event.metadata.description)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Snack ${59 - index}`),
    );
    expect((await latest(alice, '?limit=3')).activities).toHaveLength(3);

    for (const query of ['?limit=50', '?limit=51', '?limit=500', '?limit=1e9']) {
      const capped = await latest(alice, query);
      expect(capped.limit).toBe(50);
      expect(capped.activities).toHaveLength(50);
      expect(capped.activities.at(-1)?.metadata.description).toBe('Snack 10');
    }
  });

  it.each(['0', '-1', '2.5', 'ten', ''])('refuses the size %j', async (limit) => {
    const { status, body } = await readLatest(alice, `?limit=${limit}`);
    expect(status).toBe(422);
    expect(body).toMatchObject({ error: 'Validation error', code: 'VALIDATION_ERROR' });
  });

  it('names people by name only, and sends no email or member id', async () => {
    const ferry = await createGroup('Ferry Trip', alice, bob);
    await expenseService.create(ferry, command('Ferry tickets', 120, alice, [alice, bob]), alice);
    await settlementService.create(
      ferry,
      { paidTo: alice, amount: 60, currency: 'INR', note: 'Tickets' },
      bob,
    );
    // An older event that recorded more than today's events do.
    await Activity.collection.insertOne({
      group: new Types.ObjectId(ferry),
      type: 'member_joined',
      actor: new Types.ObjectId(carol),
      metadata: { userId: carol, invitedEmail: 'carol.test@splitbook-test.local', method: 'link' },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const { body } = await readLatest(alice);
    const text = JSON.stringify(body);
    expect(text).not.toContain('@');
    expect(text).not.toContain('splitbook-test.local');
    // A member's id appears only as the id of an event's actor.
    const beyondActors = JSON.stringify(
      body.data.activities.map((event: object) => ({ ...event, actor: undefined })),
    );
    for (const userId of [alice, bob, carol]) expect(beyondActors).not.toContain(userId);

    const read = parseUserActivityResponse(body);
    for (const event of read.activities) {
      if (event.actor && typeof event.actor === 'object')
        expect(Object.keys(event.actor).sort()).toEqual(['_id', 'name']);
    }
    const payment = read.activities.find((event) => event.type === 'settlement_recorded');
    expect(payment?.metadata).toEqual({
      settlementId: expect.stringMatching(/^[a-f\d]{24}$/),
      amount: 60,
      currency: 'INR',
      paidByName: 'Bob Tester',
      paidToName: 'Alice Tester',
    });
    expect(payment?.currency).toBe('INR');
    expect(read.activities.at(-1)).toMatchObject({
      type: 'member_joined',
      actor: { name: 'Carol Tester' },
      metadata: { method: 'link' },
    });
  });

  it('carries an Expense edit’s amount before and after, in the Expense’s currency', async () => {
    const ferry = await createGroup('Ferry Trip', alice, bob);
    const tickets = await expenseService.create(
      ferry,
      command('Ferry tickets', 899, alice, [alice, bob]),
      alice,
    );
    const expenseId = String(tickets._id);
    await expenseService.update(
      { actorId: bob, groupId: ferry, expenseId },
      command('Ferry tickets', 999, alice, [alice, bob]),
      0,
    );
    await expenseService.update(
      { actorId: alice, groupId: ferry, expenseId },
      { notes: 'Return' },
      1,
    );

    const [notes, amount] = (await latest(alice)).activities;
    expect(amount).toMatchObject({
      type: 'expense_updated',
      currency: 'INR',
      metadata: {
        expenseId,
        description: 'Ferry tickets',
        changes: { amount: { old: 899, new: 999 }, amountMinor: { old: 89900, new: 99900 } },
      },
    });
    // Only the money changes are sent: who paid and the split stay with the Group's own read.
    expect(Object.keys(amount.metadata.changes ?? {}).sort()).toEqual(['amount', 'amountMinor']);
    expect(formatActivityAmount(amount, amount.currency)).toEqual({
      before: '₹899.00',
      after: '₹999.00',
    });
    // An edit that left the amount alone has none to show.
    expect(notes.metadata.changes).toEqual({});
    expect(notes.currency).toBeUndefined();
    expect(formatActivityAmount(notes, notes.currency)).toBeNull();
  });

  it('gives a legacy Expense’s edit the currency the Expense had then, never another', async () => {
    const legacy = await createGroup('Legacy Trip', alice);
    const groupId = new Types.ObjectId(legacy);
    const expenseId = new Types.ObjectId();
    const actor = new Types.ObjectId(alice);
    const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, '0')}T09:00:00Z`);
    // A EUR Expense in an INR Group, edited in EUR, then moved to the Group's currency.
    await mongoose.connection.db!.collection('expenses').insertOne({
      _id: expenseId,
      group: groupId,
      description: 'Museum',
      currency: 'INR',
      editHistory: [
        { editedBy: actor, editedAt: at(2), changes: { amount: { old: 10, new: 12 } } },
        {
          editedBy: actor,
          editedAt: at(3),
          changes: { amount: { old: 12, new: 1100 }, currency: { old: 'EUR', new: 'INR' } },
        },
        { editedBy: actor, editedAt: at(4), changes: { amount: { old: 1100, new: 1200 } } },
      ],
    });
    const edit = (day: number, changes: Record<string, unknown>) => ({
      group: groupId,
      type: 'expense_updated',
      actor,
      metadata: { expenseId: String(expenseId), description: 'Museum', changes },
      createdAt: at(day),
    });
    await Activity.collection.insertMany([
      edit(2, { amount: { old: 10, new: 12 } }),
      edit(3, { amount: { old: 12, new: 1100 }, currency: { old: 'EUR', new: 'INR' } }),
      edit(4, { amount: { old: 1100, new: 1200 } }),
    ]);

    const edits = (await latest(alice)).activities.filter(
      (event) => event.type === 'expense_updated',
    );
    expect(
      edits.map((event) => [event.currency, formatActivityAmount(event, event.currency)]),
    ).toEqual([
      ['INR', { before: '₹1,100.00', after: '₹1,200.00' }],
      ['INR', { before: '€12.00', after: '₹1,100.00' }],
      ['EUR', { before: '€10.00', after: '€12.00' }],
    ]);
  });

  it('only reads: an event still waiting to be published stays waiting, and out of the list', async () => {
    const ferry = await createGroup('Ferry Trip', alice);
    // An Expense saved while its Activity couldn't be published.
    const event = makePendingActivity(ferry, 'expense_added', alice, {
      description: 'Unpublished snack',
      amount: 50,
      currency: 'INR',
    });
    const expenses = mongoose.connection.db!.collection('expenses');
    const { insertedId } = await expenses.insertOne({
      group: new Types.ObjectId(ferry),
      description: 'Unpublished snack',
      currency: 'INR',
      pendingActivity: [event],
    });
    const before = await Activity.countDocuments();

    const read = await latest(alice);
    expect(read.activities.map((item) => item.metadata.description)).not.toContain(
      'Unpublished snack',
    );
    expect(await Activity.countDocuments()).toBe(before);
    expect((await expenses.findOne({ _id: insertedId }))?.pendingActivity).toHaveLength(1);

    // The Group's own Activity read recovers it, and then the latest changes list it.
    await activityService.getGroupActivity(ferry);
    expect((await latest(alice)).activities[0].metadata.description).toBe('Unpublished snack');
  });

  it('refuses a signed-out request', async () => {
    expect(await readLatest(null)).toEqual({
      status: 401,
      body: { error: 'Unauthorized', status: 401 },
    });
  });
});
