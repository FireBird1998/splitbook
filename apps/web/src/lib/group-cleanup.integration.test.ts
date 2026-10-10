import mongoose from 'mongoose';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { integrationTestDb } from './test-utils/integration-db';
import { inventoryOrphanGroups } from './group-cleanup';

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
