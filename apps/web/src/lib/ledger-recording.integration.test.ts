import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { createRequestMetadata } from './financial-write';
import { pendingActivityFixture } from './test-utils/pending-activity';
import { withGroupMutation } from './group-mutation';
import { Refusal } from '@splitbook/shared/refusals';
import { recordLedger, changeLedgerExpense, type LedgerRecording } from './ledger-recording';
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
  event?: { metadata: Record<string, unknown>; occurredAt: Date },
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
                metadata: event?.metadata ?? { expenseId: String(id), description: 'A record' },
                occurredAt: event?.occurredAt,
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
  it.each([false, true])(
    'treats concurrent recovery as one recording even if response preparation fails: %s',
    async (responseFails) => {
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
      const timeout = setTimeout(
        () => reject(new Error('Concurrent writers did not arrive')),
        1000,
      );
      try {
        const response = async () => {
          if (responseFails) throw new Error('Response unavailable');
        };
        const results = await Promise.allSettled([
          record(key, { prepareResponseRecord: response }),
          record(key, { prepareResponseRecord: response }),
        ]);
        if (responseFails) {
          expect(results).toEqual(
            Array.from({ length: 2 }, () =>
              expect.objectContaining({
                status: 'rejected',
                reason: expect.objectContaining({ message: 'Response unavailable' }),
              }),
            ),
          );
        } else expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
        const ids = results.flatMap((result) =>
          result.status === 'fulfilled' ? result.value.map((row) => String(row._id)) : [],
        );
        if (!responseFails) {
          expect(ids).toHaveLength(2);
          expect(ids[0]).toBe(ids[1]);
        }
        expect(await Expense.countDocuments()).toBe(1);
        expect(await Activity.countDocuments()).toBe(1);
        const stored = await Expense.findOne().select('+pendingActivity');
        expect(stored!.pendingActivity).toHaveLength(0);
        barrier.mockRestore();
        expect(String((await record(key))[0]._id)).toBe(String(stored!._id));
      } finally {
        clearTimeout(timeout);
        barrier.mockRestore();
        release();
      }
    },
  );
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
    expect(String((await record(key))[0]._id)).toBe(String(saved._id));
    expect(await Expense.countDocuments()).toBe(1);
    expect(
      (await Expense.findById(saved._id).select('+pendingActivity'))!.pendingActivity,
    ).toHaveLength(1);
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

describe('changing a ledger Expense', () => {
  it('checks the revision before applying a change, then records its event and audience', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', 'true');
    const [expense] = await record();
    const change = vi.fn((stored: mongoose.HydratedDocument<IExpenseDocument>) => {
      stored.description = 'Changed through the module';
      return {
        activity: {
          type: 'expense_updated' as const,
          metadata: { expenseId: String(stored._id), description: stored.description },
        },
      };
    });
    const description = {
      access: { actorId: alice, groupId, expenseId: String(expense._id) },
      change,
    };
    await expect(
      changeLedgerExpense({ ...description, expectedRevision: Number.NaN }),
    ).rejects.toMatchObject({ message: 'REVISION_REQUIRED' });
    expect(change).not.toHaveBeenCalled();
    const changed = await changeLedgerExpense({ ...description, expectedRevision: 0 });
    expect(changed!.description).toBe('Changed through the module');
    expect(changed!.revision).toBe(1);
    const activity = await Activity.findOne({ type: 'expense_updated' }).select(
      '+notificationContext',
    );
    expect(activity!.metadata.description).toBe('Changed through the module');
    expect(activity!.notificationContext!.recipientIds).toEqual([bob]);
  });
});

describe('private recording intent', () => {
  it('keeps the original event payload and timestamp after caller values change', async () => {
    const when = new Date('2026-09-16T12:00:00Z');
    const metadata = { description: 'Original', changes: { amount: { old: 10, new: 20 } } };
    const result = await recordResult(
      randomUUID(),
      {},
      'always',
      {},
      { metadata, occurredAt: when },
    );
    metadata.description = 'Changed later';
    metadata.changes.amount.new = 99;
    when.setUTCFullYear(2030);
    const intent = result.records[0].pendingActivity[0];
    expect(intent.metadata).toEqual({
      description: 'Original',
      changes: { amount: { old: 10, new: 20 } },
    });
    expect(intent.occurredAt.toISOString()).toBe('2026-09-16T12:00:00.000Z');
    const activity = await Activity.findOne({ type: 'expense_added' });
    expect(activity!.metadata).toEqual({
      description: 'Original',
      changes: { amount: { old: 10, new: 20 } },
    });
    expect(activity!.createdAt.toISOString()).toBe('2026-09-16T12:00:00.000Z');
  });
  it('accepts the hundredth pending event and refuses another without dropping any', async () => {
    const [saved] = await record();
    const pending = Array.from({ length: 99 }, () =>
      pendingActivityFixture(groupId, 'expense_updated', alice),
    );
    await Expense.collection.updateOne({ _id: saved._id }, { $set: { pendingActivity: pending } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Activity, 'updateOne').mockImplementation(() => {
      throw new Error('Activity unavailable');
    });
    const description = {
      access: { actorId: alice, groupId, expenseId: String(saved._id) },
      change(expense: mongoose.HydratedDocument<IExpenseDocument>) {
        expense.description = 'Hundredth event';
        return {
          activity: {
            type: 'expense_updated' as const,
            metadata: { description: expense.description },
          },
        };
      },
    };
    await changeLedgerExpense({ ...description, expectedRevision: 0 });
    expect(
      (await Expense.findById(saved._id).select('+pendingActivity'))!.pendingActivity,
    ).toHaveLength(100);
    await expect(
      changeLedgerExpense({ ...description, expectedRevision: 1 }),
    ).rejects.toMatchObject({ message: 'ACTIVITY_BACKLOG_FULL' });
    await expect(
      changeLedgerExpense({ ...description, expectedRevision: 1 }),
    ).rejects.toBeInstanceOf(Refusal);
    expect(
      (await Expense.findById(saved._id).select('+pendingActivity'))!.pendingActivity,
    ).toHaveLength(100);
  });
});

describe('recording recovery ownership', () => {
  it('attempts publication before failing response preparation on creation and ordinary replay', async () => {
    const key = randomUUID();
    const options = {
      prepareResponseRecord: async () => {
        throw new Error('Response unavailable');
      },
    };
    await expect(record(key, options)).rejects.toThrow('Response unavailable');
    const stored = await Expense.findOne().select('+pendingActivity');
    expect(stored!.pendingActivity).toHaveLength(0);
    expect(await Activity.countDocuments()).toBe(1);
    await expect(record(key, options)).rejects.toThrow('Response unavailable');
    expect(String((await record(key))[0]._id)).toBe(String(stored!._id));
    expect(await Expense.countDocuments()).toBe(1);
    expect(await Activity.countDocuments()).toBe(1);
  });
  it('recovers publication before acknowledgement failure without duplicating Activity', async () => {
    const key = randomUUID();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = mongoose.mongo.Collection.prototype.updateOne;
    const fault = vi
      .spyOn(mongoose.mongo.Collection.prototype, 'updateOne')
      .mockImplementation(function (this: mongoose.mongo.Collection, filter, update, options) {
        if (this.collectionName === 'expenses' && '$pull' in update)
          throw new Error('Acknowledgement unavailable');
        return original.call(this, filter, update, options);
      });
    const [saved] = await record(key);
    expect(await Activity.countDocuments()).toBe(1);
    expect(
      (await Expense.findById(saved._id).select('+pendingActivity'))!.pendingActivity,
    ).toHaveLength(1);
    fault.mockRestore();
    expect(String((await record(key))[0]._id)).toBe(String(saved._id));
    expect(await Expense.countDocuments()).toBe(1);
    expect(await Activity.countDocuments()).toBe(1);
    expect(
      (await Expense.findById(saved._id).select('+pendingActivity'))!.pendingActivity,
    ).toHaveLength(0);
  });
  it('rethrows an unrelated real unique collision without a matching scoped receipt', async () => {
    const [saved] = await record();
    const index = await Expense.collection.createIndex(
      { description: 1 },
      { unique: true, name: 'isolated_unrelated_collision' },
    );
    const key = randomUUID();
    try {
      await expect(record(key)).rejects.toMatchObject({ code: 11000 });
      expect(await Expense.findOne({ 'creationRequest.key': key })).toBeNull();
      expect(String((await Expense.findOne())!._id)).toBe(String(saved._id));
      expect(await Expense.countDocuments()).toBe(1);
      expect(await Activity.countDocuments()).toBe(1);
    } finally {
      await Expense.collection.dropIndex(index);
    }
  });
});
