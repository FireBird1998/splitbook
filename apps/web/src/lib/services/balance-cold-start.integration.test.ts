import { afterAll, beforeAll, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { balanceService } from './balance.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

const db = integrationTestDb('balance-cold-start');
const userId = new mongoose.Types.ObjectId('a00000000000000000000001');
beforeAll(async () => {
  await db.connect();
  await db.reset();
  // Raw fixtures must not register User and mask the cold-worker import dependency.
  const database = mongoose.connection.db!;
  await database
    .collection('users')
    .insertOne({ _id: userId, name: 'Cold start user', email: 'cold@example.test' });
  await database.collection('groups').insertOne({
    name: 'Cold start household',
    category: 'home',
    defaultCurrency: 'INR',
    createdAt: new Date('2026-09-30T00:00:00Z'),
    updatedAt: new Date('2026-09-30T00:00:00Z'),
    createdBy: userId,
    members: [{ user: userId, role: 'admin' }],
    isArchived: false,
  });
});
afterAll(db.teardown);
it('loads balances in a cold worker without another service registering User first', async () => {
  await expect(balanceService.getUserBalances(userId.toString())).resolves.toMatchObject({
    buckets: [],
  });
});
