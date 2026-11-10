import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { Refusal } from '@splitbook/shared/refusals';
import { recordLedger } from './ledger-recording';
import Expense from './models/Expense';
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
afterEach(() => vi.restoreAllMocks());
afterAll(db.teardown);

// A minimal Expense description, independent of either production creation service.
function record(key = randomUUID()) {
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
            date: new Date('2026-11-11T12:00:00Z'),
            splitMethod: 'equal',
            paidBy: [{ user: new Types.ObjectId(alice), amount: 10 }],
            splitBetween: [{ user: new Types.ObjectId(bob) }],
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
});
