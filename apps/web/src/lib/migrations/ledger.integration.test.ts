import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoClient, ObjectId } from 'mongodb';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { migrateLedger } from './ledger';

const harness = integrationTestDb('ledger-coordinator');
const client = new MongoClient(harness.uri);
const db = client.db(harness.dbName);
beforeAll(async () => {
  await harness.connect();
  await client.connect();
});
beforeEach(harness.reset);
afterAll(async () => {
  await client.close();
  await harness.teardown();
});

async function seed(tag = 'Rent', amount = 12) {
  const group = new ObjectId();
  const tagId = new ObjectId();
  const user = new ObjectId();
  await db.collection('groups').insertOne({
    _id: group,
    tags: [{ _id: tagId, name: 'Rent', isArchived: false }],
    defaultCurrency: 'INR',
  });
  const record = {
    group,
    tag,
    amount,
    currency: 'INR',
    paidBy: [{ user, amount: 12 }],
    splitBetween: [{ user, amount: 12 }],
    splitMethod: 'equal',
    updatedAt: new Date('2026-01-01'),
  };
  const expense = await db.collection('expenses').insertOne({ ...record, isDeleted: true });
  const template = await db
    .collection('recurringexpenses')
    .insertOne({ ...record, isPaused: true });
  return { group, tagId, expenseId: expense.insertedId, templateId: template.insertedId };
}

describe('combined ledger migration', () => {
  it('audits Tags before writing otherwise valid money', async () => {
    const { expenseId } = await seed('Orphan');
    const before = await db.collection('expenses').findOne({ _id: expenseId });
    const report = await migrateLedger(db, { apply: true });
    expect(report.status).toBe('blocked');
    expect(report.tags.issues[0].reason).toBe('unresolved');
    expect(await db.collection('expenses').findOne({ _id: expenseId })).toEqual(before);
    expect(report.indexes).toBe('not-run');
  });

  it('audits money before assigning otherwise valid Tags', async () => {
    const { expenseId } = await seed('Rent', 13);
    const report = await migrateLedger(db, { apply: true });
    expect(report.status).toBe('blocked');
    expect(report.money.issues).not.toHaveLength(0);
    const record = await db.collection('expenses').findOne({ _id: expenseId });
    expect(record?.tagId).toBeUndefined();
    expect(record?.revision).toBeUndefined();
  });

  it('defaults to read-only, then migrates, locks historical Groups and reruns without changes', async () => {
    const { group, tagId, expenseId, templateId } = await seed();
    const emptyGroup = new ObjectId();
    const settlementGroup = new ObjectId();
    await db.collection('groups').insertMany([
      { _id: emptyGroup, tags: [] },
      { _id: settlementGroup, tags: [] },
    ]);
    await db
      .collection('settlements')
      .insertOne({ group: settlementGroup, amount: 2, currency: 'INR' });
    const audit = await migrateLedger(db);
    expect(audit.status).toBe('audited');
    expect(audit.metadata).toMatchObject({
      revisionsPlanned: 2,
      groupsToLock: 2,
      revisionsApplied: 0,
    });
    expect(
      (await db.collection('expenses').findOne({ _id: expenseId }))?.moneyVersion,
    ).toBeUndefined();
    const applied = await migrateLedger(db, { apply: true });
    expect(applied.status).toBe('applied');
    expect(applied.metadata).toMatchObject({ revisionsApplied: 2, groupsLocked: 2 });
    expect(await db.collection('expenses').findOne({ _id: expenseId })).toMatchObject({
      tagId,
      revision: 0,
      moneyVersion: 1,
      amount: 12,
      amountMinor: 1200,
      isDeleted: true,
      updatedAt: new Date('2026-01-01'),
    });
    expect(await db.collection('recurringexpenses').findOne({ _id: templateId })).toMatchObject({
      tagId,
      revision: 0,
      moneyVersion: 1,
      isPaused: true,
    });
    expect((await db.collection('groups').findOne({ _id: group }))?.currencyLocked).toBe(true);
    expect((await db.collection('groups').findOne({ _id: settlementGroup }))?.currencyLocked).toBe(
      true,
    );
    expect(
      (await db.collection('groups').findOne({ _id: emptyGroup }))?.currencyLocked,
    ).toBeUndefined();
    const indexes = await db.collection('expenses').indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unique: true,
          key: { group: 1, createdBy: 1, 'creationRequest.key': 1 },
        }),
        expect.objectContaining({ unique: true, key: { recurringExpense: 1, period: 1 } }),
      ]),
    );
    const rerun = await migrateLedger(db, { apply: true });
    expect(rerun.status).toBe('applied');
    expect(rerun.money.applied).toBe(0);
    expect(rerun.tags.collections.expenses.applied).toBe(0);
    expect(rerun.metadata).toMatchObject({ revisionsApplied: 0, groupsLocked: 0 });
    expect(await db.collection('activities').countDocuments()).toBe(0);
  });

  it('does not overwrite invalid existing revisions', async () => {
    const { expenseId } = await seed();
    await db.collection('expenses').updateOne({ _id: expenseId }, { $set: { revision: -1 } });
    const report = await migrateLedger(db, { apply: true });
    expect(report.status).toBe('blocked');
    expect(report.metadata.issues[0].reason).toContain('Invalid existing revision');
    expect(
      (await db.collection('expenses').findOne({ _id: expenseId }))?.moneyVersion,
    ).toBeUndefined();
  });

  it('blocks malformed Tag identities before otherwise valid money is migrated', async () => {
    const { group, expenseId } = await seed();
    await db
      .collection('groups')
      .updateOne(
        { _id: group },
        { $set: { tags: [{ _id: 'broken-id', name: 'Rent', isArchived: false }] } },
      );
    const before = await db.collection('expenses').findOne({ _id: expenseId });
    const report = await migrateLedger(db, { apply: true });
    expect(report.status).toBe('blocked');
    expect(report.tags.issues[0].reason).toBe('invalid-reference');
    expect(await db.collection('expenses').findOne({ _id: expenseId })).toEqual(before);
    expect(report.money.applied).toBe(0);
  });

  it('blocks string Group references on Settlements instead of declaring them migrated', async () => {
    const { group } = await seed();
    const settlement = await db
      .collection('settlements')
      .insertOne({ group: String(group), amount: 2, currency: 'INR' });
    const report = await migrateLedger(db, { apply: true });
    expect(report.status).toBe('blocked');
    expect(report.metadata.issues).toContainEqual(
      expect.objectContaining({
        collection: 'settlements',
        id: String(settlement.insertedId),
        reason: 'Invalid Group identity; BSON ObjectId required',
      }),
    );
    expect(report.money.applied).toBe(0);
  });
});
