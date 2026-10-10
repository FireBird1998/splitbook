import mongoose from 'mongoose';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { integrationTestDb } from './test-utils/integration-db';
import { inventoryOrphanGroups } from './group-cleanup';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.userId
          ? {
              user: {
                id: session.userId,
                name: 'Fictional Tester',
                email: 'fictional@example.test',
              },
            }
          : null,
      ),
    },
  },
}));
import { POST as leaveRoute } from '@/app/api/groups/[id]/leave/route';
import { activityService } from './services/activity.service';
import { groupService } from './services/group.service';
const actor = 'a00000000000000000000001';
async function lastMemberGroup() {
  const group = await groupService.create(
    {
      name: 'Fictional cleanup Trip',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
    actor,
  );
  return String(group._id);
}
async function leave(id: string, acknowledgement?: boolean) {
  session.userId = actor;
  const response = await leaveRoute(
    new Request(`http://localhost/api/groups/${id}/leave`, {
      method: 'POST',
      ...(acknowledgement === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deleteIfLastMember: acknowledgement }),
          }),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

const testDb = integrationTestDb('orphan-cleanup');
beforeAll(testDb.connect);
beforeEach(testDb.reset);
afterAll(testDb.teardown);

describe('read-only orphan Group inventory', () => {
  it('reports actual empty membership and separately reports missing-parent records without changing either', async () => {
    const db = mongoose.connection.db!;
    const empty = new mongoose.Types.ObjectId('b00000000000000000000001');
    const populated = new mongoose.Types.ObjectId('b00000000000000000000002');
    const missing = new mongoose.Types.ObjectId('b00000000000000000000003');
    await db.collection('groups').insertMany([
      {
        _id: empty,
        name: 'Fictional empty Trip',
        category: 'trip',
        members: [],
        isArchived: true,
        updatedAt: new Date('2026-10-01T12:00:00Z'),
      },
      {
        _id: populated,
        name: 'Missing User is still a member',
        members: [{ user: new mongoose.Types.ObjectId() }],
        isArchived: true,
      },
      { name: 'Malformed members', members: null, isArchived: true },
    ]);
    await db.collection('expenses').insertMany([
      { group: empty, description: 'Private description', amount: 99, isDeleted: true },
      { group: missing, description: 'Missing parent', amount: 20 },
    ]);
    const report = await inventoryOrphanGroups(db, 'test');
    expect(
      report.groups.map((group) => [
        group.id,
        group.name,
        group.memberCount,
        group.counts.expenses,
      ]),
    ).toEqual([[String(empty), 'Fictional empty Trip', 0, 1]]);
    expect(report.missingParents).toEqual([
      {
        groupId: String(missing),
        counts: {
          expenses: 1,
          settlements: 0,
          activities: 0,
          recurringexpenses: 0,
          invitations: 0,
        },
      },
    ]);
    expect(JSON.stringify(report)).not.toContain('Private description');
    expect(JSON.stringify(report)).not.toContain('amount');
    expect(await db.collection('groups').countDocuments()).toBe(3);
    expect(await db.collection('expenses').countDocuments()).toBe(2);
  });
});

describe('last-member deletion consent through HTTP', () => {
  it('requires explicit acknowledgement and preserves membership for an old client', async () => {
    const id = await lastMemberGroup();
    const response = await leave(id);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('GROUP_DELETION_CONFIRMATION_REQUIRED');
    expect((await groupService.getById(id))?.members).toHaveLength(1);
  });
});

describe('confirmed last-member deletion', () => {
  it('removes all Group-owned collections and keeps unrelated Groups and accounts', async () => {
    const id = await lastMemberGroup();
    const db = mongoose.connection.db!;
    const group = new mongoose.Types.ObjectId(id);
    const other = new mongoose.Types.ObjectId();
    for (const name of [
      'expenses',
      'settlements',
      'activities',
      'recurringexpenses',
      'invitations',
    ]) {
      await db
        .collection(name)
        .insertMany([
          { group, isDeleted: true, pendingActivity: [{ description: 'Fictional pending event' }] },
          { group: other },
        ]);
    }
    await db.collection('users').insertOne({ name: 'Unaffected fictional account' });
    const result = await leave(id, true);
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ deleted: true, deletionPending: false });
    expect(await groupService.getById(id)).toBeNull();
    const report = await inventoryOrphanGroups(db, 'test');
    expect(report.groups).toHaveLength(0);
    expect(report.missingParents.map((row) => row.groupId)).toEqual([String(other)]);
    expect(await db.collection('users').countDocuments()).toBe(1);
    expect(await leave(id, true)).toEqual(result);
  });
});

it('refuses a delayed Activity publication after completed deletion', async () => {
  const id = await lastMemberGroup();
  await leave(id, true);
  await expect(activityService.log(id, 'member_left', actor)).rejects.toThrow('FORBIDDEN');
  expect((await inventoryOrphanGroups(mongoose.connection.db!, 'test')).missingParents).toEqual([]);
});
