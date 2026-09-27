import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { MongoClient } from 'mongodb';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { migrateLedgerMoney } from './ledger-money';

const db = integrationTestDb('ledger-money-migration');
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

function expense(amount = 100) {
  return {
    currency: 'INR',
    amount,
    paidBy: [{ user: 'alex', amount }],
    splitBetween: [
      { user: 'alex', amount: 33.34 },
      { user: 'sam', amount: 33.33 },
      { user: 'priya', amount: 33.33 },
    ],
    splitMethod: 'shares',
    isDeleted: false,
    editHistory: [{ changes: { description: { old: 'A', new: 'B' } } }],
  };
}

describe('ledger money migration', () => {
  it('audits without writing, preserves all historical values, and applies once', async () => {
    const database = client.db(db.dbName);
    const original = expense();
    const { insertedId } = await database.collection('expenses').insertOne(original);
    const before = await database.collection('expenses').findOne({ _id: insertedId });
    expect(await migrateLedgerMoney(database)).toMatchObject({
      dryRun: true,
      planned: 1,
      applied: 0,
      issues: [],
    });
    expect(await database.collection('expenses').findOne({ _id: insertedId })).toEqual(before);
    expect(await migrateLedgerMoney(database, { apply: true })).toMatchObject({
      applied: 1,
      issues: [],
    });
    const after = await database.collection('expenses').findOne({ _id: insertedId });
    expect(after).toMatchObject({ ...original, moneyVersion: 1, amountMinor: 10000 });
    expect(after!.splitBetween.map((row: { amountMinor: number }) => row.amountMinor)).toEqual([
      3334, 3333, 3333,
    ]);
    expect(await migrateLedgerMoney(database, { apply: true })).toMatchObject({
      planned: 0,
      applied: 0,
      issues: [],
    });
    expect(await database.collection('activities').countDocuments()).toBe(0);
  });

  it('reports invalid precision, missing cents, duplicate participants and drift before any write', async () => {
    const database = client.db(db.dbName);
    await database.collection('expenses').insertMany([
      expense(),
      { ...expense(), paidBy: [{ user: 'alex', amount: 1 }] },
      {
        ...expense(),
        splitBetween: ['alex', 'sam', 'priya'].map((user) => ({ user, amount: 33.33 })),
      },
      {
        ...expense(),
        paidBy: [
          { user: 'alex', amount: 50 },
          { user: 'alex', amount: 50 },
        ],
      },
      { ...expense(), currency: 'JPY', amount: 100.5 },
      { ...expense(), moneyVersion: 1, amountMinor: 1 },
    ]);
    const report = await migrateLedgerMoney(database, { apply: true });
    expect(report.issues).toHaveLength(5);
    expect(report.applied).toBe(0);
    expect(
      await database.collection('expenses').countDocuments({ moneyVersion: { $exists: false } }),
    ).toBe(5);
  });

  it('resumes after some records were already migrated and keeps zero-decimal currencies exact', async () => {
    const database = client.db(db.dbName);
    await database.collection('settlements').insertMany([
      { currency: 'JPY', amount: 100, amountMinor: 100, moneyVersion: 1 },
      { currency: 'JPY', amount: 101 },
    ]);
    expect(await migrateLedgerMoney(database, { apply: true })).toMatchObject({
      planned: 1,
      applied: 1,
      issues: [],
    });
    expect(await database.collection('settlements').findOne({ amount: 101 })).toMatchObject({
      amountMinor: 101,
      moneyVersion: 1,
    });
  });
});
