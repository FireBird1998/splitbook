import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoClient, ObjectId } from 'mongodb';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { auditTagReferences, migrateTagReferences } from './tag-references';

const harness = integrationTestDb('tag-migration');
const client = new MongoClient(harness.uri);
beforeAll(async () => {
  await harness.connect();
  await client.connect();
});
beforeEach(harness.reset);
afterAll(async () => {
  await client.close();
  await harness.teardown();
});
const database = () => client.db(harness.dbName);

async function fixture() {
  const groupId = new ObjectId();
  const tagId = new ObjectId();
  const db = database();
  await db
    .collection('groups')
    .insertOne({ _id: groupId, tags: [{ _id: tagId, name: 'Rent', isArchived: false }] });
  const legacy = {
    group: groupId,
    tag: 'Rent',
    amount: 12.34,
    currency: 'INR',
    paidBy: [{ user: 'member', amount: 12.34 }],
    splitBetween: [{ user: 'member', amount: 12.34 }],
    isDeleted: true,
    updatedAt: new Date('2026-01-02'),
    editHistory: [{ changes: { description: { old: 'Before', new: 'After' } } }],
  };
  const expense = await db.collection('expenses').insertOne(legacy);
  const template = await db
    .collection('recurringexpenses')
    .insertOne({ ...legacy, isPaused: true, lastGeneratedFor: '2026-01' });
  return { db, groupId, tagId, expenseId: expense.insertedId, templateId: template.insertedId };
}

describe('Tag reference migration', () => {
  it('defaults to audit and preserves every field apart from the added identity', async () => {
    const { db, tagId, expenseId, templateId } = await fixture();
    const beforeExpense = await db.collection('expenses').findOne({ _id: expenseId });
    const beforeTemplate = await db.collection('recurringexpenses').findOne({ _id: templateId });
    const audit = await migrateTagReferences(db);
    expect(audit.dryRun).toBe(true);
    expect(audit.collections.expenses).toMatchObject({ planned: 1, applied: 0 });
    expect(await db.collection('expenses').findOne({ _id: expenseId })).toEqual(beforeExpense);
    const result = await migrateTagReferences(db, { apply: true });
    expect(result.collections.expenses.applied).toBe(1);
    expect(result.collections.recurringexpenses.applied).toBe(1);
    expect(await db.collection('expenses').findOne({ _id: expenseId })).toEqual({
      ...beforeExpense,
      tagId,
    });
    expect(await db.collection('recurringexpenses').findOne({ _id: templateId })).toEqual({
      ...beforeTemplate,
      tagId,
    });
    expect(await db.collection('activities').countDocuments()).toBe(0);
    const rerun = await migrateTagReferences(db, { apply: true });
    expect(rerun.collections.expenses).toMatchObject({
      alreadyResolved: 1,
      planned: 0,
      applied: 0,
    });
    expect(rerun.collections.recurringexpenses).toMatchObject({
      alreadyResolved: 1,
      planned: 0,
      applied: 0,
    });
  });

  it('resumes a bounded interrupted batch without recreating or overwriting identities', async () => {
    const { db, tagId } = await fixture();
    const first = await migrateTagReferences(db, { apply: true, maxUpdates: 1 });
    expect(first.collections.expenses.applied + first.collections.recurringexpenses.applied).toBe(
      1,
    );
    const second = await migrateTagReferences(db, { apply: true });
    expect(second.collections.expenses.applied + second.collections.recurringexpenses.applied).toBe(
      1,
    );
    expect(await db.collection('expenses').countDocuments({ tagId })).toBe(1);
    expect(await db.collection('recurringexpenses').countDocuments({ tagId })).toBe(1);
  });

  it('requires exact Group-scoped reviewed mappings for orphan names', async () => {
    const { db, groupId, tagId, expenseId } = await fixture();
    await db.collection('expenses').updateOne({ _id: expenseId }, { $set: { tag: 'Old Rent' } });
    const audit = await auditTagReferences(db);
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ recordId: String(expenseId), reason: 'unresolved' }),
    );
    const wrongGroup = await migrateTagReferences(db, {
      apply: true,
      mappings: [{ groupId: String(new ObjectId()), legacyTag: 'Old Rent', tagId: String(tagId) }],
    });
    expect(wrongGroup.collections.expenses.applied).toBe(0);
    const wrongTarget = await migrateTagReferences(db, {
      apply: true,
      mappings: [
        { groupId: String(groupId), legacyTag: 'Old Rent', tagId: String(new ObjectId()) },
      ],
    });
    expect(wrongTarget.issues[0].reason).toBe('invalid-mapping');
    const applied = await migrateTagReferences(db, {
      apply: true,
      mappings: [{ groupId: String(groupId), legacyTag: 'Old Rent', tagId: String(tagId) }],
    });
    expect(applied.collections.expenses.applied).toBe(1);
    expect(await db.collection('expenses').findOne({ _id: expenseId })).toMatchObject({
      tag: 'Old Rent',
      tagId,
    });
  });

  it('reports duplicate names, missing Groups and invalid existing references without guessing', async () => {
    const { db, groupId, expenseId } = await fixture();
    const group = await db.collection('groups').findOne({ _id: groupId });
    await db.collection('groups').updateOne(
      { _id: groupId },
      {
        $set: {
          tags: [
            ...group!.tags,
            { _id: new ObjectId(), name: 'Rent', isArchived: true, isDeleted: true },
          ],
        },
      },
    );
    const missing = await db
      .collection('expenses')
      .insertOne({ group: new ObjectId(), tag: 'Rent' });
    const invalid = await db
      .collection('expenses')
      .insertOne({ group: groupId, tag: 'Rent', tagId: new ObjectId() });
    const report = await migrateTagReferences(db, { apply: true });
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: String(expenseId), reason: 'ambiguous' }),
        expect.objectContaining({ recordId: String(missing.insertedId), reason: 'missing-group' }),
        expect.objectContaining({
          recordId: String(invalid.insertedId),
          reason: 'invalid-reference',
        }),
      ]),
    );
    expect(report.collections.expenses.applied).toBe(0);
  });

  it('rejects string and malformed stored identities during audit without coercing them', async () => {
    const { db, groupId, tagId, expenseId } = await fixture();
    await db
      .collection('expenses')
      .updateOne({ _id: expenseId }, { $set: { tagId: String(tagId) } });
    const invalidGroup = await db
      .collection('expenses')
      .insertOne({ group: String(groupId), tag: 'Rent' });
    const audit = await auditTagReferences(db);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: String(expenseId), reason: 'invalid-reference' }),
        expect.objectContaining({
          recordId: String(invalidGroup.insertedId),
          reason: 'invalid-reference',
        }),
      ]),
    );
    expect((await db.collection('expenses').findOne({ _id: expenseId }))?.tagId).toBe(
      String(tagId),
    );
    await db
      .collection('groups')
      .updateOne(
        { _id: groupId },
        { $set: { tags: [{ _id: 'not-an-object-id', name: 'Rent', isArchived: false }] } },
      );
    const invalidTarget = await auditTagReferences(db);
    expect(invalidTarget.collections.recurringexpenses).toMatchObject({ planned: 0, blocked: 1 });
    expect(invalidTarget.issues).toContainEqual(
      expect.objectContaining({ collection: 'recurringexpenses', reason: 'invalid-reference' }),
    );
  });
});
