import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { MongoClient, type ObjectId } from 'mongodb';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { migrateExpenseDates } from './expense-dates';

const db = integrationTestDb('expense-dates-migration');
const client = new MongoClient(db.uri);
beforeAll(async () => {
  await db.connect();
  await client.connect();
});
beforeEach(db.reset);
afterAll(async () => {
  await client.close();
  await db.teardown();
});

const expenses = () => client.db(db.dbName).collection('expenses');
const stored = async (id: ObjectId) => (await expenses().findOne({ _id: id }))!;

describe('moving Expense dates to midnight UTC (#437)', () => {
  it('audits without writing, moves each date to midnight UTC on its day, and applies once', async () => {
    const at = (iso: string, extra = {}) => ({
      description: 'Dinner',
      date: new Date(iso),
      updatedAt: new Date('2026-10-16T18:00:00.000Z'),
      revision: 2,
      isDeleted: false,
      ...extra,
    });
    const { insertedIds: ids } = await expenses().insertMany([
      // Android's Add expense before #437: local noon in India.
      at('2026-10-16T06:30:00.000Z'),
      // Already a day.
      at('2026-10-16T00:00:00.000Z'),
      // Local noon in Hawaii, or in a zone 13 or 14 hours ahead the next day.
      at('2026-10-15T22:00:00.000Z'),
      // A deleted Expense keeps its day for its history and a restore.
      at('2026-10-14T12:00:00.000Z', { isDeleted: true }),
    ]);

    const audit = await migrateExpenseDates(client.db(db.dbName));
    expect(audit).toEqual({
      dryRun: true,
      scanned: 4,
      alreadyDays: 1,
      planned: 3,
      moved: 0,
      lateInUtcDay: 1,
      issues: [],
    });
    expect((await stored(ids[0])).date).toEqual(new Date('2026-10-16T06:30:00.000Z'));

    expect(await migrateExpenseDates(client.db(db.dbName), { apply: true })).toMatchObject({
      dryRun: false,
      planned: 3,
      moved: 3,
      lateInUtcDay: 1,
      issues: [],
    });
    const days = await Promise.all(Object.values(ids).map(stored));
    expect(days.map((row) => row.date.toISOString())).toEqual([
      '2026-10-16T00:00:00.000Z',
      '2026-10-16T00:00:00.000Z',
      '2026-10-15T00:00:00.000Z',
      '2026-10-14T00:00:00.000Z',
    ]);
    // Only the date moves: the same day, so no revision or change for anyone to review.
    expect(days[0]).toMatchObject({
      revision: 2,
      updatedAt: new Date('2026-10-16T18:00:00.000Z'),
    });

    expect(await migrateExpenseDates(client.db(db.dbName), { apply: true })).toMatchObject({
      scanned: 4,
      alreadyDays: 4,
      planned: 0,
      moved: 0,
    });
  });

  it('reports an Expense without a readable date and moves nothing while one remains', async () => {
    const { insertedIds: ids } = await expenses().insertMany([
      { description: 'Ferry', date: new Date('2026-10-16T06:30:00.000Z'), isDeleted: false },
      { description: 'Broken', date: 'not a date', isDeleted: false },
    ]);
    const report = await migrateExpenseDates(client.db(db.dbName), { apply: true });
    expect(report).toMatchObject({ planned: 1, moved: 0 });
    expect(report.issues).toEqual([{ id: String(ids[1]), reason: 'The date is not a date' }]);
    expect((await stored(ids[0])).date).toEqual(new Date('2026-10-16T06:30:00.000Z'));
  });
});
