import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import Activity from '@/lib/models/Activity';
import { makePendingActivity, type IPendingActivity } from '@/lib/financial-write';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { activityService, type ActivitySource } from './activity.service';

const db = integrationTestDb('activity-outbox');
const { alice } = TEST_USER_IDS;
const groupId = 'b00000000000000000000020';
const otherGroupId = 'b00000000000000000000021';
const ledgerTimestamp = new Date('2026-09-01T12:00:00Z');

interface SourceFixture {
  _id: Types.ObjectId;
  group: Types.ObjectId;
  amount: number;
  revision: number;
  updatedAt: Date;
  isDeleted: boolean;
  pendingActivity: IPendingActivity[];
}

function collection(source: ActivitySource) {
  return mongoose.connection.db!.collection<SourceFixture>(source);
}

async function sourceFixture(
  source: ActivitySource,
  events: IPendingActivity[],
  id: string = groupId,
) {
  const record = {
    _id: new Types.ObjectId(),
    group: new Types.ObjectId(id),
    amount: 123,
    revision: 7,
    updatedAt: ledgerTimestamp,
    isDeleted: true,
    pendingActivity: events,
  };
  await collection(source).insertOne(record);
  return record;
}

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice');
});
afterEach(() => vi.restoreAllMocks());
afterAll(db.teardown);

describe('recoverable financial Activity on standalone MongoDB', () => {
  it('publishes one immutable event under simultaneous retries and cleans up intent', async () => {
    const event = makePendingActivity(groupId, 'expense_added', alice, { description: 'Dinner' });
    const expense = await sourceFixture('expenses', [event]);

    await Promise.all(
      Array.from({ length: 6 }, () =>
        activityService.publishPending('expenses', expense._id, [event]),
      ),
    );

    expect(await Activity.countDocuments({ group: groupId })).toBe(1);
    const saved = await collection('expenses').findOne({ _id: expense._id });
    expect(saved).toMatchObject({ amount: 123, revision: 7, pendingActivity: [] });
    expect(saved?.updatedAt).toEqual(ledgerTimestamp);
  });

  it('retains recoverable intent when Activity persistence fails after a ledger commit', async () => {
    const event = makePendingActivity(groupId, 'settlement_recorded', alice, { amount: 123 });
    const settlement = await sourceFixture('settlements', [event]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = vi.spyOn(Activity, 'updateOne').mockImplementationOnce(() => {
      throw new Error('simulated Activity outage');
    });

    await expect(
      activityService.publishPending('settlements', settlement._id, [event]),
    ).resolves.toMatchObject({ published: 0, failed: 1, remaining: 1 });
    expect(await Activity.countDocuments()).toBe(0);
    expect(await collection('settlements').findOne({ _id: settlement._id })).toMatchObject({
      amount: 123,
      revision: 7,
      pendingActivity: [{ metadata: { amount: 123 } }],
    });

    failure.mockRestore();
    const feed = await activityService.getGroupActivity(groupId);
    expect(feed.activities).toHaveLength(1);
    expect(feed.activities[0].metadata.amount).toBe(123);
    expect(
      (await collection('settlements').findOne({ _id: settlement._id }))?.pendingActivity,
    ).toEqual([]);
  });

  it('recovers a crash after publishing but before acknowledgement without duplicating Activity', async () => {
    const event = makePendingActivity(
      groupId,
      'expense_updated',
      alice,
      { description: 'Original event', changes: { amount: { old: 100, new: 123 } } },
      new Date('2026-08-01T12:00:00Z'),
    );
    const expense = await sourceFixture('expenses', [event]);
    await Activity.create({
      _id: event._id,
      group: event.group,
      type: event.type,
      actor: event.actor,
      metadata: event.metadata,
      createdAt: event.occurredAt,
    });

    // The expense has changed since the event; repair must use the immutable intent.
    await collection('expenses').updateOne({ _id: expense._id }, { $set: { amount: 999 } });
    const feed = await activityService.getGroupActivity(groupId);
    expect(feed.activities).toHaveLength(1);
    expect(feed.activities[0].metadata).toEqual(event.metadata);
    expect(feed.activities[0].createdAt).toEqual(event.occurredAt);
    expect((await collection('expenses').findOne({ _id: expense._id }))?.pendingActivity).toEqual(
      [],
    );
  });

  it('recovers soft-deleted sources, keeps original chronology, and stays within the Group', async () => {
    const oldEvent = makePendingActivity(
      groupId,
      'expense_deleted',
      alice,
      { description: 'Old expense' },
      new Date('2026-08-01T12:00:00Z'),
    );
    await sourceFixture('expenses', [oldEvent]);
    const foreign = makePendingActivity(otherGroupId, 'expense_added', alice);
    const foreignExpense = await sourceFixture('expenses', [foreign], otherGroupId);
    await activityService.log(groupId, 'group_updated', alice, { description: 'New event' });

    const feed = await activityService.getGroupActivity(groupId);
    expect(feed.activities.map((activity) => activity.type)).toEqual([
      'group_updated',
      'expense_deleted',
    ]);
    expect(feed.activities[1].createdAt).toEqual(oldEvent.occurredAt);
    expect(await Activity.countDocuments({ group: otherGroupId })).toBe(0);
    expect(
      (await collection('expenses').findOne({ _id: foreignExpense._id }))?.pendingActivity,
    ).toHaveLength(1);
  });

  it('limits recovery per read and finishes remaining work on later reads', async () => {
    for (let index = 0; index < 5; index += 1) {
      const source = index % 2 === 0 ? 'expenses' : 'settlements';
      const type = source === 'expenses' ? 'expense_added' : 'settlement_recorded';
      await sourceFixture(source, [makePendingActivity(groupId, type, alice, { index })]);
    }

    await activityService.recoverGroupActivity(groupId, { maxDocuments: 2, maxEvents: 2 });
    expect(await Activity.countDocuments({ group: groupId })).toBe(2);
    await activityService.recoverGroupActivity(groupId, { maxDocuments: 2, maxEvents: 2 });
    expect(await Activity.countDocuments({ group: groupId })).toBe(4);
    await activityService.recoverGroupActivity(groupId, { maxDocuments: 2, maxEvents: 2 });
    expect(await Activity.countDocuments({ group: groupId })).toBe(5);
    expect(
      await collection('expenses').countDocuments({ 'pendingActivity.0': { $exists: true } }),
    ).toBe(0);
    expect(
      await collection('settlements').countDocuments({ 'pendingActivity.0': { $exists: true } }),
    ).toBe(0);
  });

  it('returns the existing feed during a publication outage and retries successfully later', async () => {
    const event = makePendingActivity(groupId, 'expense_added', alice);
    await sourceFixture('expenses', [event]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = vi.spyOn(Activity, 'updateOne').mockImplementation(() => {
      throw new Error('still offline');
    });

    await expect(activityService.getGroupActivity(groupId)).resolves.toMatchObject({
      activities: [],
      pagination: { total: 0 },
    });
    failure.mockRestore();
    await expect(activityService.getGroupActivity(groupId)).resolves.toMatchObject({
      pagination: { total: 1 },
    });
  });
});
