import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { createRequestMetadata } from './financial-write';
import { withGroupMutation } from './group-mutation';
import { Refusal } from '@splitbook/shared/refusals';
import { recordLedger, type LedgerRecording } from './ledger-recording';
import Expense, { type IExpenseDocument } from './models/Expense';
import Group, { type IGroupDocument } from './models/Group';
import Activity from './models/Activity';
import { integrationTestDb } from './test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from './test-utils/fixtures';

const db = integrationTestDb(`lr-${randomUUID()}`);
const { alice, bob, carol } = TEST_USER_IDS;
let groupId: string;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol');
  const group = await Group.create({
    name: 'Recording',
    category: 'trip',
    defaultCurrency: 'INR',
    createdBy: alice,
    members: [alice, bob].map((user) => ({ user, role: 'member' })),
  });
  groupId = String(group._id);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(db.teardown);

// A minimal Expense description, independent of either production creation service.
function recordResult(
  key = randomUUID(),
  overrides: Partial<LedgerRecording<IExpenseDocument>> = {},
  alertSwitch: 'always' | 'payments' | 'expense-changes' = 'always',
  documentOverrides: Partial<IExpenseDocument> = {},
) {
  return recordLedger({
    groupId,
    actorId: alice,
    model: Expense,
    transactions: { required: new Refusal('SETTLEMENT_TRANSACTIONS_REQUIRED') },
    command: () => ({ description: 'A record', amount: 10 }),
    retry: { key },
    currencies: [{ currency: 'INR', rule: 'listed' }],
    checkPeople(members) {
      if (!members.has(bob)) throw new Refusal('INVALID_MEMBERS');
    },
    ...overrides,
    async prepare(): ReturnType<LedgerRecording<IExpenseDocument>['prepare']> {
      const id = new Types.ObjectId();
      return [
        {
          id,
          async build() {
            return {
              document: {
                _id: id,
                description: 'A record',
                amount: 10,
                currency: 'INR',
                category: 'food',
                tag: 'Food',
                date: new Date('2026-11-11T12:00:00Z'),
                splitMethod: 'equal',
                paidBy: [{ user: new Types.ObjectId(alice), amount: 10 }],
                splitBetween: [{ user: new Types.ObjectId(bob), amount: 10 }],
                ...documentOverrides,
              },
              activity: {
                type: 'expense_added',
                metadata: { expenseId: String(id), description: 'A record' },
                alert: {
                  kind: 'expense_added',
                  involved: [alice, bob, bob, carol],
                  switch: alertSwitch,
                },
              },
            };
          },
        },
      ];
    },
  });
}

async function record(...args: Parameters<typeof recordResult>) {
  return (await recordResult(...args)).records;
}

describe('ledger recording', () => {
  it('confirms an existing retry before refusing an archived Group', async () => {
    const key = randomUUID();
    const [saved] = await record(key);
    await Group.updateOne({ _id: groupId }, { $set: { isArchived: true } });
    const [replayed] = await record(key);
    expect(String(replayed._id)).toBe(String(saved._id));
    await expect(record()).rejects.toMatchObject({ message: 'GROUP_ARCHIVED' });
    expect(await Expense.countDocuments()).toBe(1);
    expect(await Activity.countDocuments({ type: 'expense_added' })).toBe(1);
  });
  it.each([
    ['actor', alice, 'FORBIDDEN'],
    ['named person', bob, 'INVALID_MEMBERS'],
  ])(
    'refuses at the commit when the %s leaves after the request starts',
    async (_, person, code) => {
      const transaction = mongoose.connection.transaction.bind(mongoose.connection);
      vi.spyOn(mongoose.connection, 'transaction').mockImplementationOnce(
        async (write, options) => {
          await mongoose.connection
            .db!.collection<IGroupDocument>('groups')
            .updateOne(
              { _id: new Types.ObjectId(groupId) },
              { $pull: { members: { user: new Types.ObjectId(person) } } },
            );
          return transaction(write, options);
        },
      );
      await expect(record()).rejects.toMatchObject({ message: code });
      expect(await Expense.countDocuments()).toBe(0);
      expect(await Activity.countDocuments()).toBe(0);
      expect((await Group.findById(groupId))!.currencyLocked).toBe(false);
    },
  );
  it.each([
    ['actor', alice],
    ['named person', bob],
  ])('can preserve a recording when the %s leaves after its pre-retry check', async (_, person) => {
    const transaction = mongoose.connection.transaction.bind(mongoose.connection);
    vi.spyOn(mongoose.connection, 'transaction').mockImplementationOnce(async (write, options) => {
      await mongoose.connection
        .db!.collection<IGroupDocument>('groups')
        .updateOne(
          { _id: new Types.ObjectId(groupId) },
          { $pull: { members: { user: new Types.ObjectId(person) } } },
        );
      return transaction(write, options);
    });
    await record(randomUUID(), {
      compatibility: { membership: 'before-retry', missingGroup: 'fault' },
    });
    expect(await Expense.countDocuments()).toBe(1);
    const event = await Activity.findOne({ type: 'expense_added' }).select('+notificationContext');
    expect(event!.notificationContext!.recipientIds).toEqual(person === bob ? [] : [bob]);
  });
  it('can preserve pre-retry membership checks without checking again at the commit', async () => {
    const key = randomUUID();
    const compatibility = { membership: 'before-retry' as const, missingGroup: 'fault' as const };
    const [saved] = await record(key, { compatibility });
    await Group.updateOne({ _id: groupId }, { $pull: { members: { user: bob } } });
    await expect(record(key, { compatibility })).rejects.toMatchObject({
      message: 'INVALID_MEMBERS',
    });
    expect(String((await record(key))[0]._id)).toBe(String(saved._id));
  });
  it.each(['always', 'payments', 'expense-changes'] as const)(
    'captures just the involved current members except the actor (%s)',
    async (alertSwitch) => {
      vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', 'true');
      vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', 'true');
      const [saved] = await record(randomUUID(), {}, alertSwitch);
      const event = await Activity.findOne({ 'metadata.expenseId': String(saved._id) })
        .select('+notificationContext')
        .lean();
      expect(event!.notificationContext).toEqual({
        version: 2,
        eventId: String(event!._id),
        kind: 'expense_added',
        groupId,
        recordId: String(saved._id),
        occurredAt: event!.createdAt,
        recipientIds: [bob],
      });
    },
  );
  it.each(['payments', 'expense-changes'] as const)(
    'captures no context when its %s switch is off, even if the other switch is on',
    async (alertSwitch) => {
      vi.stubEnv(
        'ANDROID_NOTIFICATION_PAYMENTS_ENABLED',
        alertSwitch === 'payments' ? 'false' : 'true',
      );
      vi.stubEnv(
        'ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED',
        alertSwitch === 'expense-changes' ? 'false' : 'true',
      );
      await record(randomUUID(), {}, alertSwitch);
      const event = await Activity.findOne({ type: 'expense_added' })
        .select('+notificationContext')
        .lean();
      expect(event!.notificationContext).toBeUndefined();
    },
  );
  it('publishes only after the outermost commit, including a nested retry', async () => {
    const key = randomUUID();
    await withGroupMutation(groupId, async () => {
      const [saved] = await record(key);
      const [replayed] = await record(key);
      expect(String(saved._id)).toBe(String(replayed._id));
      expect(await Activity.countDocuments({ type: 'expense_added' })).toBe(0);
      expect(
        (await Expense.findById(saved._id).select('+pendingActivity'))!.pendingActivity,
      ).toHaveLength(1);
    });
    expect(await Activity.countDocuments({ type: 'expense_added' })).toBe(1);
    expect((await Expense.findOne().select('+pendingActivity'))!.pendingActivity).toHaveLength(0);
  });
  it('publishes nothing when the outer mutation rolls back', async () => {
    await expect(
      withGroupMutation(groupId, async () => {
        await record();
        throw new Error('outer write failed');
      }),
    ).rejects.toThrow('outer write failed');
    expect(await Expense.countDocuments()).toBe(0);
    expect(await Activity.countDocuments()).toBe(0);
  });
  it('treats two concurrent saves of the retry identity as one recording', async () => {
    const key = randomUUID();
    const transaction = mongoose.connection.transaction.bind(mongoose.connection);
    let arrivals = 0;
    let release!: () => void;
    let reject!: (error: Error) => void;
    const gate = new Promise<void>((resolve, fail) => {
      release = resolve;
      reject = fail;
    });
    const barrier = vi
      .spyOn(mongoose.connection, 'transaction')
      .mockImplementation(async (write, options) => {
        if (++arrivals === 2) release();
        await gate;
        return transaction(write, options);
      });
    const timeout = setTimeout(() => reject(new Error('Concurrent writers did not arrive')), 1000);
    try {
      const results = await Promise.allSettled([record(key), record(key)]);
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      const ids = results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value.map((row) => String(row._id)) : [],
      );
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
      expect(await Expense.countDocuments()).toBe(1);
      expect(await Activity.countDocuments()).toBe(1);
    } finally {
      clearTimeout(timeout);
      barrier.mockRestore();
      release();
    }
  });
  it('leaves an atomic pending event when publication fails and recovers it on retry', async () => {
    const key = randomUUID();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const outage = vi.spyOn(Activity, 'updateOne').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    const [saved] = await record(key);
    expect(await Activity.countDocuments()).toBe(0);
    const pending = (await Expense.findById(saved._id).select('+pendingActivity'))!.pendingActivity;
    expect(pending).toHaveLength(1);
    expect(pending[0].notificationContext!.recipientIds).toEqual([bob]);
    outage.mockRestore();
    const [replayed] = await record(key);
    expect(String(replayed._id)).toBe(String(saved._id));
    expect(await Expense.countDocuments()).toBe(1);
    expect(await Activity.countDocuments()).toBe(1);
    expect(
      (await Expense.findById(saved._id).select('+pendingActivity'))!.pendingActivity,
    ).toHaveLength(0);
  });
  it('refuses an archived Group even inside a non-ledger outer fence', async () => {
    await expect(
      withGroupMutation(groupId, async () => {
        await Group.updateOne({ _id: groupId }, { $set: { isArchived: true } });
        await record();
      }),
    ).rejects.toMatchObject({ message: 'GROUP_ARCHIVED' });
    expect(await Expense.countDocuments()).toBe(0);
    expect(await Activity.countDocuments()).toBe(0);
  });
  it('takes retry identity from the description, never from the document being built', async () => {
    const [saved] = await record(randomUUID(), { retry: undefined }, 'always', {
      creationRequest: createRequestMetadata('document-key-0001', {
        description: 'Unexpected identity',
      }),
    });
    const stored = await Expense.findById(saved._id).select('+creationRequest');
    expect(stored!.creationRequest).toBeUndefined();
  });
  it('reports whether a recording was created or already present', async () => {
    const key = randomUUID();
    const first = await recordResult(key);
    const retry = await recordResult(key);
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(String(retry.records[0]._id)).toBe(String(first.records[0]._id));
    expect(await Expense.countDocuments()).toBe(1);
  });
});
