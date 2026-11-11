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
  describe(`${writer} recording description`, () => {
    it('describes one financial effect and publishes before its population can fail', async () => {
      const key = randomUUID();
      const model = writer === 'expenses' ? Expense : Settlement;
      const fault = vi
        .spyOn(model.prototype, 'populate')
        .mockRejectedValue(new Error('response preparation unavailable'));
      await expect(create(writer, key)).rejects.toThrow('response preparation unavailable');
      const stored = await collection(writer).findOne({ 'creationRequest.key': key });
      expect(stored).not.toBeNull();
      // A response failure must not prevent the first publication attempt.
      expect(await Activity.countDocuments({ group: groupId, type: eventType(writer) })).toBe(1);
      expect(stored!.pendingActivity).toHaveLength(0);
      fault.mockRestore();
      expect(String((await create(writer, key))._id)).toBe(String(stored!._id));
      await assertOneEffect(writer, stored!._id);
    });
  });
}
