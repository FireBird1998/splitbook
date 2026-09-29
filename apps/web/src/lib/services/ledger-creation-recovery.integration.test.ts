import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Activity from '@/lib/models/Activity';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { expenseService } from './expense.service';
import { settlementService } from './settlement.service';
import { groupService } from './group.service';
import { balanceService } from './balance.service';
import { activityService } from './activity.service';

const db = integrationTestDb(`creation-${randomUUID()}`);
const { alice, bob } = TEST_USER_IDS;
type Writer = 'expenses' | 'settlements';
let groupId: string;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob');
  const group = await groupService.create(
    { name: 'Recovery ledger', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  groupId = String(group._id);
  await groupService.addMember(groupId, bob);
});
afterEach(() => vi.restoreAllMocks());
afterAll(db.teardown);

function create(writer: Writer, key: string) {
  if (writer === 'expenses')
    return expenseService.create(
      groupId,
      {
        description: 'Recoverable dinner',
        amount: 100,
        currency: 'INR',
        category: 'food',
        tag: 'Food',
        date: new Date('2026-09-01T12:00:00Z'),
        paidBy: [{ user: alice, amount: 100 }],
        splitMethod: 'equal',
        splitBetween: [{ user: bob }],
      },
      alice,
      key,
    );
  return settlementService.create(
    groupId,
    { paidBy: alice, paidTo: bob, amount: 25, currency: 'INR', note: 'Recoverable payment' },
    alice,
    key,
  );
}

function collection(writer: Writer) {
  return mongoose.connection.db!.collection(writer);
}
const eventType = (writer: Writer) =>
  writer === 'expenses' ? 'expense_added' : 'settlement_recorded';

async function assertOneEffect(writer: Writer, id: unknown) {
  expect(
    await collection(writer).countDocuments({ group: new mongoose.Types.ObjectId(groupId) }),
  ).toBe(1);
  const balances = await balanceService.getGroupBalances(groupId);
  expect(balances!.balances.map((row) => ({ user: row.user._id, balance: row.balance }))).toEqual(
    expect.arrayContaining([
      { user: alice, balance: writer === 'expenses' ? 100 : 25 },
      { user: bob, balance: writer === 'expenses' ? -100 : -25 },
    ]),
  );
  const feed = await activityService.getGroupActivity(groupId);
  const events = feed.activities.filter((event) => event.type === eventType(writer));
  expect(events).toHaveLength(1);
  expect(String(events[0].metadata[writer === 'expenses' ? 'expenseId' : 'settlementId'])).toBe(
    String(id),
  );
}

for (const writer of ['expenses', 'settlements'] as const) {
  describe(`${writer} creation recovery`, () => {
    it('characterizes a committed write whose response preparation fails, then replays once', async () => {
      const key = randomUUID();
      const model = writer === 'expenses' ? Expense : Settlement;
      const fault = vi
        .spyOn(model.prototype, 'populate')
        .mockRejectedValue(new Error('response preparation unavailable'));
      await expect(create(writer, key)).rejects.toThrow('response preparation unavailable');
      const stored = await collection(writer).findOne({ 'creationRequest.key': key });
      expect(stored).not.toBeNull();
      // Baseline #77: Expense publishes first; fresh Settlement still prepares first.
      expect(await Activity.countDocuments({ group: groupId, type: eventType(writer) })).toBe(
        writer === 'expenses' ? 1 : 0,
      );
      expect(stored!.pendingActivity).toHaveLength(writer === 'expenses' ? 0 : 1);
      // Normal replay already publishes before preparing its response for both writers.
      await expect(create(writer, key)).rejects.toThrow('response preparation unavailable');
      expect(await Activity.countDocuments({ group: groupId, type: eventType(writer) })).toBe(1);
      fault.mockRestore();
      expect(String((await create(writer, key))._id)).toBe(String(stored!._id));
      await assertOneEffect(writer, stored!._id);
    });

    it('publishes during real same-key collision recovery even when both response preparations fail', async () => {
      const key = randomUUID();
      const model = writer === 'expenses' ? Expense : Settlement;
      let arrivals = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const insert = model.collection.insertOne;
      // Hold real Mongo insertions until both requests have passed their initial lookup.
      const barrier = vi.spyOn(model.collection, 'insertOne').mockImplementation(async function (
        ...args
      ) {
        arrivals += 1;
        if (arrivals === 2) release();
        await gate;
        return insert.apply(model.collection, args);
      });
      const fault = vi
        .spyOn(model.prototype, 'populate')
        .mockRejectedValue(new Error('response preparation unavailable'));
      const results = await Promise.allSettled([create(writer, key), create(writer, key)]);
      expect(results).toEqual([
        expect.objectContaining({
          status: 'rejected',
          reason: expect.objectContaining({ message: 'response preparation unavailable' }),
        }),
        expect.objectContaining({
          status: 'rejected',
          reason: expect.objectContaining({ message: 'response preparation unavailable' }),
        }),
      ]);
      expect(await Activity.countDocuments({ group: groupId, type: eventType(writer) })).toBe(1);
      const stored = await collection(writer).findOne({ 'creationRequest.key': key });
      expect(stored!.pendingActivity).toEqual([]);
      fault.mockRestore();
      barrier.mockRestore();
      expect(String((await create(writer, key))._id)).toBe(String(stored!._id));
      await assertOneEffect(writer, stored!._id);
    });

    it('retains atomic pending intent during an Activity outage and retries one financial effect', async () => {
      const key = randomUUID();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const fault = vi.spyOn(Activity, 'updateOne').mockImplementation(() => {
        throw new Error('Activity storage unavailable');
      });
      const saved = await create(writer, key);
      expect(await Activity.countDocuments({ group: groupId, type: eventType(writer) })).toBe(0);
      const stored = await collection(writer).findOne({ _id: saved._id });
      expect(stored!.pendingActivity).toHaveLength(1);
      expect(stored!.pendingActivity[0].type).toBe(eventType(writer));
      expect(String((await create(writer, key))._id)).toBe(String(saved._id));
      fault.mockRestore();
      await assertOneEffect(writer, saved._id);
      expect((await collection(writer).findOne({ _id: saved._id }))!.pendingActivity).toEqual([]);
    });

    it('recovers publication-before-acknowledgement failure without duplicating Activity', async () => {
      const key = randomUUID();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const original = mongoose.mongo.Collection.prototype.updateOne;
      const fault = vi
        .spyOn(mongoose.mongo.Collection.prototype, 'updateOne')
        .mockImplementation(function (this: mongoose.mongo.Collection, filter, update, options) {
          if (this.collectionName === writer && '$pull' in update)
            throw new Error('acknowledgement unavailable');
          return original.call(this, filter, update, options);
        });
      const saved = await create(writer, key);
      expect(await Activity.countDocuments({ group: groupId, type: eventType(writer) })).toBe(1);
      expect((await collection(writer).findOne({ _id: saved._id }))!.pendingActivity).toHaveLength(
        1,
      );
      fault.mockRestore();
      expect(String((await create(writer, key))._id)).toBe(String(saved._id));
      await assertOneEffect(writer, saved._id);
      expect((await collection(writer).findOne({ _id: saved._id }))!.pendingActivity).toEqual([]);
    });

    it('rethrows an unrelated real unique collision without a matching scoped creation record', async () => {
      const first = await create(writer, randomUUID());
      const field = writer === 'expenses' ? 'description' : 'note';
      const index = await collection(writer).createIndex(
        { [field]: 1 },
        { unique: true, name: 'isolated_unrelated_collision' },
      );
      const secondKey = randomUUID();
      try {
        await expect(create(writer, secondKey)).rejects.toMatchObject({ code: 11000 });
        expect(await collection(writer).findOne({ 'creationRequest.key': secondKey })).toBeNull();
        await assertOneEffect(writer, first._id);
      } finally {
        await collection(writer).dropIndex(index);
      }
    });
  });
}
