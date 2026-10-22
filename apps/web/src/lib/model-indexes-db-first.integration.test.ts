/**
 * #856: every model gets its schema indexes on a fresh database even when db.ts loads before the
 * models, as most services import them. Before, the global `bufferCommands: false` of #846 made
 * a model compiled with no connection open fail its first init(), which Mongoose keeps, so its
 * autoCreate and autoIndex never ran, unique indexes included. A collection that exists without
 * its indexes, as such a database holds them, gets them on the next start. Its database is
 * `splitbook-test-model-indexes-db-first`.
 */

// db.ts first, on purpose: it loads before the models, as in most services.
import '@/lib/db';
import { MongoClient, ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { afterAll, beforeAll, expect, it } from 'vitest';
import Activity from '@/lib/models/Activity';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import Invitation from '@/lib/models/Invitation';
import ProductSwitch from '@/lib/models/ProductSwitch';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Settlement from '@/lib/models/Settlement';
import User from '@/lib/models/User';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { MODEL_INDEXES, modelIndexes } from '@/lib/test-utils/model-indexes';

const db = integrationTestDb('model-indexes-db-first');
const models = [
  Activity,
  Expense,
  Group,
  Invitation,
  ProductSwitch,
  RecurringExpense,
  Settlement,
  User,
];

beforeAll(async () => {
  // Two collections the code since #846 created without their indexes, holding a record each.
  const raw = new MongoClient(db.uri);
  await raw.connect();
  await raw.db().dropDatabase();
  await raw
    .db()
    .collection('invitations')
    .insertOne({
      token: 'fictional-invitation-token',
      invitedEmail: 'priya@example.test',
      status: 'pending',
      expiresAt: new Date('2026-11-01T00:00:00Z'),
    });
  await raw
    .db()
    .collection('activities')
    .insertOne({ group: new ObjectId(), createdAt: new Date() });
  await raw.close();
  await db.connect();
});
afterAll(db.teardown);

it('every model gets its schema indexes once connected, on collections that already exist too', async () => {
  await Promise.all(models.map((model) => model.init()));
  expect(await modelIndexes(mongoose.connection.db!)).toEqual(MODEL_INDEXES);
  // Their records stay as they were.
  expect(await mongoose.connection.db!.collection('invitations').countDocuments()).toBe(1);
  expect(await mongoose.connection.db!.collection('activities').countDocuments()).toBe(1);
});
