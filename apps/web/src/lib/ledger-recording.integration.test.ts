import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { Refusal } from '@splitbook/shared/refusals';
import { recordLedger, type LedgerRecording } from './ledger-recording';
import Expense, { type IExpenseDocument } from './models/Expense';
import Group from './models/Group';
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(db.teardown);

// A minimal Expense description, independent of either production creation service.
function record(key = randomUUID(), overrides: Partial<LedgerRecording<IExpenseDocument>> = {}) {
  return recordLedger({
    groupId,
    actorId: alice,
    model: Expense,
    source: 'expenses',
    retry: { key, command: { description: 'A record', amount: 10 } },
    currencies: [{ currency: 'INR', rule: 'listed' }],
    checkPeople(members) {
      if (!members.has(bob)) throw new Refusal('INVALID_MEMBERS');
    },
    ...overrides,
    async entries() {
      const id = new Types.ObjectId();
      return [
        {
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
          },
          activity: {
            type: 'expense_added',
            metadata: { expenseId: String(id), description: 'A record' },
            alert: { kind: 'expense_added', involved: [alice, bob, bob, carol], switch: 'always' },
          },
        },
      ];
    },
  });
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
  ])('refuses at the commit when the %s is no longer a member', async (_, person, code) => {
    await Group.updateOne({ _id: groupId }, { $pull: { members: { user: person } } });
    await expect(record()).rejects.toMatchObject({ message: code });
    expect(await Expense.countDocuments()).toBe(0);
    expect(await Activity.countDocuments()).toBe(0);
    expect((await Group.findById(groupId))!.currencyLocked).toBe(false);
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
    'captures just the involved current members except the actor (%s)', async (alertSwitch) => {
      vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', 'true');
      vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', 'true');
      const [saved] = await record(randomUUID(), {}, alertSwitch);
      const event = await Activity.findOne({ 'metadata.expenseId': String(saved._id) })
        .select('+notificationContext').lean();
      expect(event!.notificationContext).toEqual({
        version: 2, eventId: String(event!._id), kind: 'expense_added', groupId,
        recordId: String(saved._id), occurredAt: event!.createdAt, recipientIds: [bob],
      });
    },
  );
  it.each(['payments', 'expense-changes'] as const)(
    'captures no context when its %s switch is off, even if the other switch is on', async (alertSwitch) => {
      vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', alertSwitch === 'payments' ? 'false' : 'true');
      vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', alertSwitch === 'expense-changes' ? 'false' : 'true');
      await record(randomUUID(), {}, alertSwitch);
      const event = await Activity.findOne({ type: 'expense_added' }).select('+notificationContext').lean();
      expect(event!.notificationContext).toBeUndefined();
    },
  );

});
