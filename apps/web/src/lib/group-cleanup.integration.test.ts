import mongoose from 'mongoose';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { integrationTestDb } from './test-utils/integration-db';
import { inventoryOrphanGroups } from './group-cleanup';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn() };
});
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
import {
  applyOrphanGroupManifest,
  resumeRequestedGroupDeletions,
} from './services/group-cleanup.service';
import { activityService } from './services/activity.service';
import { makePendingActivity } from './financial-write';
import { groupService } from './services/group.service';
import { settlementService } from './services/settlement.service';
import { recurringExpenseService } from './services/recurring-expense.service';
vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
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
beforeAll(async () => {
  await mongoose.connect(testDb.uri, { appName: testDb.dbName });
  await testDb.connect();
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid')
    throw new Error(
      'Group deletion tests require an isolated replica set; use TEST_MONGODB_URI and the documented QA setup.',
    );
});
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

it('defaults a reviewed maintenance selection to read-only and rejects changed membership on apply', async () => {
  const db = mongoose.connection.db!;
  const id = new mongoose.Types.ObjectId('b00000000000000000000071');
  await db.collection('groups').insertOne({
    _id: id,
    name: 'Fictional old empty Group',
    category: 'other',
    members: [],
    isArchived: true,
  });
  await db.collection('expenses').insertOne({ group: id });
  const report = await inventoryOrphanGroups(db, 'test');
  const manifest = { ...report, selectedGroupIds: [String(id)] };
  expect(
    await applyOrphanGroupManifest(manifest, { environment: 'test', database: db.databaseName }),
  ).toMatchObject({ dryRun: true, results: [{ groupId: String(id), status: 'eligible' }] });
  expect(await db.collection('groupdeletions').countDocuments()).toBe(0);
  await db
    .collection('groups')
    .updateOne(
      { _id: id },
      { $set: { members: [{ user: new mongoose.Types.ObjectId(actor), role: 'admin' }] } },
    );
  expect(
    await applyOrphanGroupManifest(manifest, {
      apply: true,
      environment: 'test',
      database: db.databaseName,
    }),
  ).toMatchObject({ results: [{ groupId: String(id), status: 'changed' }] });
  expect((await groupService.getById(String(id)))?.members).toHaveLength(1);
});

it('never sweeps historical empty or archived-with-members Groups during queued recovery', async () => {
  const db = mongoose.connection.db!;
  const historic = new mongoose.Types.ObjectId();
  await db.collection('groups').insertOne({
    _id: historic,
    name: 'Fictional historical empty Group',
    members: [],
    isArchived: true,
  });
  await db.collection('expenses').insertOne({ group: historic });
  const id = await lastMemberGroup();
  await groupService.archive(id, actor);
  await resumeRequestedGroupDeletions();
  expect((await inventoryOrphanGroups(db, 'test')).groups.map((group) => group.id)).toEqual([
    String(historic),
  ]);
  expect((await groupService.getById(id))?.members).toHaveLength(1);
  expect(await db.collection('expenses').countDocuments({ group: historic })).toBe(1);
});

it('applies only the exact reviewed selection and treats duplicate concurrent execution as the same deletion', async () => {
  const db = mongoose.connection.db!;
  const selected = new mongoose.Types.ObjectId();
  const kept = new mongoose.Types.ObjectId();
  await db.collection('groups').insertMany([
    { _id: selected, name: 'Fictional selected Group', members: [], isArchived: true },
    { _id: kept, name: 'Fictional unselected Group', members: [], isArchived: true },
  ]);
  await db.collection('expenses').insertMany([{ group: selected }, { group: kept }]);
  const report = await inventoryOrphanGroups(db, 'test');
  const manifest = {
    ...report,
    groups: report.groups.filter((group) => group.id === String(selected)),
    selectedGroupIds: [String(selected)],
  };
  const outcomes = await Promise.all([
    applyOrphanGroupManifest(manifest, {
      apply: true,
      environment: 'test',
      database: db.databaseName,
    }),
    applyOrphanGroupManifest(manifest, {
      apply: true,
      environment: 'test',
      database: db.databaseName,
    }),
  ]);
  expect(outcomes.map((outcome) => outcome.results[0].status)).toEqual(['complete', 'complete']);
  expect((await inventoryOrphanGroups(db, 'test')).groups.map((group) => group.id)).toEqual([
    String(kept),
  ]);
  await expect(
    applyOrphanGroupManifest(
      { ...manifest, selectedGroupIds: [String(kept)] },
      { apply: true, environment: 'test', database: db.databaseName },
    ),
  ).rejects.toThrow();
  await expect(
    applyOrphanGroupManifest(manifest, {
      apply: true,
      environment: 'another',
      database: db.databaseName,
    }),
  ).rejects.toThrow('Manifest target');
});

it('keeps a large deletion pending across a server restart and lets independent workers finish without late history', async () => {
  const id = await lastMemberGroup();
  const db = mongoose.connection.db!;
  const group = new mongoose.Types.ObjectId(id);
  await db
    .collection('expenses')
    .insertMany(Array.from({ length: 1_300 }, () => ({ group, isDeleted: true })));
  const first = await leave(id, true);
  expect(first.body.data).toMatchObject({ deleted: false, deletionPending: true });
  // Disconnecting removes the process connection/session while retaining only durable Mongo state.
  await mongoose.disconnect();
  await mongoose.connect(testDb.uri, { appName: testDb.dbName });
  const replies = await Promise.all([leave(id, true), leave(id, true)]);
  expect(replies.every((reply) => reply.body.data.deleted === true)).toBe(true);
  expect((await inventoryOrphanGroups(mongoose.connection.db!, 'test')).missingParents).toEqual([]);
});

it('resumes after a real database failure in a deletion batch without claiming successful deletion', async () => {
  const id = await lastMemberGroup();
  const db = mongoose.connection.db!;
  await db.collection('expenses').insertOne({ group: new mongoose.Types.ObjectId(id) });
  await db.admin().command({
    configureFailPoint: 'failCommand',
    mode: { times: 1 },
    data: { appName: testDb.dbName, failCommands: ['delete'], errorCode: 8 },
  });
  try {
    const interrupted = await leave(id, true);
    expect(interrupted.body.data).toMatchObject({ deleted: false, deletionPending: true });
    expect((await inventoryOrphanGroups(db, 'test')).groups[0].counts.expenses).toBe(1);
  } finally {
    await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
  }
  await resumeRequestedGroupDeletions();
  await resumeRequestedGroupDeletions();
  await resumeRequestedGroupDeletions();
  expect((await leave(id, true)).body.data.deleted).toBe(true);
  expect((await inventoryOrphanGroups(db, 'test')).missingParents).toEqual([]);
});

it.each(['expense', 'recurring template', 'invitation', 'Activity'] as const)(
  'coordinates a delayed %s commit with deletion through a real Mongo barrier',
  async (kind) => {
    const group = await groupService.create(
      {
        name: `Fictional ${kind} race`,
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: [],
      },
      actor,
    );
    const id = String(group._id);
    const db = mongoose.connection.db!;
    session.userId = actor;
    const payload = {
      description: 'Fictional delayed write',
      amount: 20,
      currency: 'INR',
      category: 'food',
      date: new Date().toISOString(),
      paidBy: [{ user: actor, amount: 20 }],
      splitBetween: [{ user: actor }],
      splitMethod: 'equal',
      tag: 'Rent',
    };
    const params = { params: Promise.resolve({ id }) };
    const barrier = await db.admin().command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        appName: testDb.dbName,
        failCommands: ['insert'],
        blockConnection: true,
        blockTimeMS: 500,
      },
    });
    try {
      let writing: Promise<Response>;
      if (kind === 'expense') {
        const { POST } = await import('@/app/api/groups/[id]/expenses/route');
        writing = POST(
          new Request(`http://localhost/api/groups/${id}/expenses`, {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
          params,
        );
      } else if (kind === 'recurring template') {
        const { POST } = await import('@/app/api/groups/[id]/recurring/route');
        writing = POST(
          new Request(`http://localhost/api/groups/${id}/recurring`, {
            method: 'POST',
            body: JSON.stringify({ ...payload, dayOfMonth: 1, startsOn: '2030-01-01' }),
          }),
          params,
        );
      } else if (kind === 'invitation') {
        const { POST } = await import('@/app/api/groups/[id]/invite/route');
        writing = POST(
          new Request(`http://localhost/api/groups/${id}/invite`, {
            method: 'POST',
            body: JSON.stringify({ email: 'fictional-friend@example.test' }),
          }),
          params,
        );
      } else {
        const { PATCH } = await import('@/app/api/groups/[id]/route');
        writing = PATCH(
          new Request(`http://localhost/api/groups/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ description: 'Fictional changed description' }),
          }),
          params,
        );
      }
      await db.admin().command({
        waitForFailPoint: 'failCommand',
        timesEntered: barrier.count + 1,
        maxTimeMS: 3_000,
      });
      const deleting = leave(id, true);
      await Promise.all([writing, deleting]);
      const finished = await leave(id, true);
      expect(finished.body.data.deleted).toBe(true);
      expect((await inventoryOrphanGroups(db, 'test')).missingParents).toEqual([]);
    } finally {
      await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
  },
);

it.each(['hello', 'update'])(
  'keeps the Activity publication deadline while its new %s fence step is blocked',
  async (command) => {
    const id = await lastMemberGroup();
    const record = new mongoose.Types.ObjectId();
    const event = makePendingActivity(id, 'expense_added', actor, {
      description: 'Fictional retained event',
    });
    await mongoose.connection.db!.collection('expenses').insertOne({
      _id: record,
      group: new mongoose.Types.ObjectId(id),
      amount: 10,
      pendingActivity: [event],
    });
    // Fresh connection also clears per-Db capability discovery; the real caller budget
    // must include its first hello, not just the Activity upsert.
    await mongoose.disconnect();
    await mongoose.connect(testDb.uri, { appName: testDb.dbName });
    const db = mongoose.connection.db!;
    const barrier = await db.admin().command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        appName: testDb.dbName,
        failCommands: [command],
        blockConnection: true,
        blockTimeMS: 800,
      },
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const started = Date.now();
      const published = activityService.publishPending('expenses', record, [event], {
        maxDurationMs: 100,
      });
      await db.admin().command({
        waitForFailPoint: 'failCommand',
        timesEntered: barrier.count + 1,
        maxTimeMS: 3_000,
      });
      expect(await published).toMatchObject({ published: 0, failed: 1, remaining: 1 });
      expect(Date.now() - started).toBeLessThan(450);
      expect(
        (await db.collection('expenses').findOne({ _id: record }))?.pendingActivity,
      ).toHaveLength(1);
    } finally {
      await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
      errors.mockRestore();
    }
  },
);

it('coordinates a delayed Settlement commit, member removal and final deletion without orphaning financial history', async () => {
  const id = await lastMemberGroup();
  const second = 'a00000000000000000000002';
  await groupService.addMember(id, second);
  const db = mongoose.connection.db!;
  const barrier = await db.admin().command({
    configureFailPoint: 'failCommand',
    mode: { times: 1 },
    data: {
      appName: testDb.dbName,
      failCommands: ['insert'],
      blockConnection: true,
      blockTimeMS: 500,
    },
  });
  try {
    const writing = settlementService.create(
      id,
      { paidBy: actor, paidTo: second, amount: 20, currency: 'INR' },
      actor,
    );
    await db.admin().command({
      waitForFailPoint: 'failCommand',
      timesEntered: barrier.count + 1,
      maxTimeMS: 3_000,
    });
    // The independent member mutation must wait for the Settlement's shared fence.
    await groupService.removeMember(id, second, actor);
    await leave(id, true);
    await writing;
    expect((await leave(id, true)).body.data.deleted).toBe(true);
    expect((await inventoryOrphanGroups(db, 'test')).missingParents).toEqual([]);
    expect(await db.collection('settlements').countDocuments()).toBe(0);
  } finally {
    await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
  }
});

it('coordinates a generated recurring Expense and its later marker with final deletion', async () => {
  const group = await groupService.create(
    {
      name: 'Fictional materialization race',
      category: 'home',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
    actor,
  );
  const id = String(group._id);
  await recurringExpenseService.create(
    id,
    {
      description: 'Fictional future Rent',
      amount: 20,
      currency: 'INR',
      category: 'other',
      tag: 'Rent',
      paidBy: [{ user: actor, amount: 20 }],
      splitBetween: [{ user: actor }],
      splitMethod: 'equal',
      dayOfMonth: 1,
      startsOn: new Date('2030-01-01'),
    },
    actor,
  );
  const db = mongoose.connection.db!;
  const barrier = await db.admin().command({
    configureFailPoint: 'failCommand',
    mode: { times: 1 },
    data: {
      appName: testDb.dbName,
      failCommands: ['insert'],
      blockConnection: true,
      blockTimeMS: 500,
    },
  });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const generating = recurringExpenseService.materializeDueExpenses(id, new Date('2030-01-02'));
    await db.admin().command({
      waitForFailPoint: 'failCommand',
      timesEntered: barrier.count + 1,
      maxTimeMS: 3_000,
    });
    await Promise.all([generating, leave(id, true)]);
    expect((await leave(id, true)).body.data.deleted).toBe(true);
    expect(await db.collection('expenses').countDocuments()).toBe(0);
    expect(await db.collection('recurringexpenses').countDocuments()).toBe(0);
    expect((await inventoryOrphanGroups(db, 'test')).missingParents).toEqual([]);
  } finally {
    await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
    errors.mockRestore();
  }
});

it('coordinates recovered pending Activity with deletion instead of publishing missing-parent history', async () => {
  const id = await lastMemberGroup();
  const db = mongoose.connection.db!;
  const event = makePendingActivity(id, 'expense_added', actor, {
    description: 'Fictional interrupted save',
  });
  await db.collection('expenses').insertOne({
    group: new mongoose.Types.ObjectId(id),
    isDeleted: true,
    pendingActivity: [event],
  });
  const barrier = await db.admin().command({
    configureFailPoint: 'failCommand',
    mode: { times: 1 },
    data: {
      appName: testDb.dbName,
      failCommands: ['update'],
      blockConnection: true,
      blockTimeMS: 500,
    },
  });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const recovering = activityService.recoverGroupActivity(id);
    await db.admin().command({
      waitForFailPoint: 'failCommand',
      timesEntered: barrier.count + 1,
      maxTimeMS: 3_000,
    });
    await Promise.all([recovering, leave(id, true)]);
    expect((await leave(id, true)).body.data.deleted).toBe(true);
    expect((await inventoryOrphanGroups(db, 'test')).missingParents).toEqual([]);
  } finally {
    await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
    errors.mockRestore();
  }
});

it.each(['update', 'insert'])(
  'coordinates an actual invite-link join delayed at %s with the final-member claim',
  async (command) => {
    const db = mongoose.connection.db!;
    const second = 'a00000000000000000000002';
    await db.collection('users').insertMany([
      {
        _id: new mongoose.Types.ObjectId(actor),
        name: 'Fictional Alex',
        email: 'fictional-alex@example.test',
      },
      {
        _id: new mongoose.Types.ObjectId(second),
        name: 'Fictional Sam',
        email: 'fictional-sam@example.test',
      },
    ]);
    const id = await lastMemberGroup();
    const link = await groupService.generateInviteCode(id, actor, 7);
    const code = link!.inviteCode;
    const { POST } = await import('@/app/api/join/[code]/route');
    session.userId = second;
    const barrier = await db.admin().command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        appName: testDb.dbName,
        failCommands: [command],
        blockConnection: true,
        blockTimeMS: 500,
      },
    });
    try {
      const joining = POST(new Request(`http://localhost/api/join/${code}`, { method: 'POST' }), {
        params: Promise.resolve({ code }),
      });
      await db.admin().command({
        waitForFailPoint: 'failCommand',
        timesEntered: barrier.count + 1,
        maxTimeMS: 3_000,
      });
      const deleting = await leave(id, true);
      const joined = await joining;
      if (command === 'update') {
        expect(deleting.body.data.deleted).toBe(true);
        expect(joined.status).toBe(403);
      } else {
        // Membership committed before the delayed Activity; the final-member premise
        // is gone, so the destructive request is safely refused.
        expect(deleting.status).toBe(409);
        expect(deleting.body.code).toBe('LAST_ADMIN');
        expect(joined.status).toBe(201);
        expect((await groupService.getById(id))?.members).toHaveLength(2);
      }
      expect((await inventoryOrphanGroups(db, 'test')).missingParents).toEqual([]);
    } finally {
      await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
  },
);

it('rotates changed pending jobs instead of starving a healthy requested deletion', async () => {
  const id = await lastMemberGroup();
  const db = mongoose.connection.db!;
  await db.collection('expenses').insertMany(
    Array.from({ length: 1_300 }, () => ({
      group: new mongoose.Types.ObjectId(id),
      isDeleted: true,
    })),
  );
  expect((await leave(id, true)).body.data.deletionPending).toBe(true);
  for (let index = 0; index < 3; index++) {
    const malformed = new mongoose.Types.ObjectId();
    await db.collection('groups').insertOne({
      _id: malformed,
      name: 'Fictional changed request',
      members: [{ user: new mongoose.Types.ObjectId(actor) }],
    });
    await db.collection('groupdeletions').insertOne({
      _id: malformed,
      actorId: actor,
      state: 'pending',
      collectionIndex: 0,
      requestedAt: new Date('2020-01-01'),
    });
  }
  for (let pass = 0; pass < 12; pass++) await resumeRequestedGroupDeletions();
  expect(
    (await db.collection('groupdeletions').findOne({ _id: new mongoose.Types.ObjectId(id) }))
      ?.state,
  ).toBe('complete');
  expect(await db.collection('groups').countDocuments()).toBe(3);
});

it('retries capability discovery after a temporary hello failure without losing pending Activity', async () => {
  const id = await lastMemberGroup();
  const record = new mongoose.Types.ObjectId();
  const event = makePendingActivity(id, 'expense_added', actor, {
    description: 'Fictional retained event',
  });
  await mongoose.connection
    .db!.collection('expenses')
    .insertOne({ _id: record, group: new mongoose.Types.ObjectId(id), pendingActivity: [event] });
  await mongoose.disconnect();
  await mongoose.connect(testDb.uri, { appName: testDb.dbName });
  const db = mongoose.connection.db!;
  await db.admin().command({
    configureFailPoint: 'failCommand',
    mode: { times: 1 },
    data: { appName: testDb.dbName, failCommands: ['hello'], errorCode: 8 },
  });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await activityService.publishPending('expenses', record, [event])).toMatchObject({
      published: 0,
      failed: 1,
      remaining: 1,
    });
    expect(await activityService.publishPending('expenses', record, [event])).toMatchObject({
      published: 1,
      remaining: 0,
    });
    expect((await db.collection('expenses').findOne({ _id: record }))?.pendingActivity).toEqual([]);
  } finally {
    await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
    errors.mockRestore();
  }
});
