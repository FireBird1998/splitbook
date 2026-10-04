/**
 * Integration test for Home totals (`GET /api/user/balances`) on a freshly started server
 * instance, against a real, isolated MongoDB database (`splitbook-test-user-balances-cold`).
 *
 * A fresh serverless instance loads only the modules of the route it serves. The balance
 * service populates each Group's members, so it must register the User model itself, or the
 * first Home read on that instance fails with MissingSchemaError (#186). This file therefore
 * imports no model, service or fixture helper: its records are raw documents, and the route is
 * loaded inside the test, after checking nothing has registered User.
 */

import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

const alex = new mongoose.Types.ObjectId('b00000000000000000000001');
const sam = new mongoose.Types.ObjectId('b00000000000000000000002');

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: 'b00000000000000000000001', name: 'Alex', email: 'alex@splitbook-test.local' },
      })),
    },
  },
}));

const db = integrationTestDb('user-balances-cold');

beforeAll(async () => {
  await db.connect();
  await db.reset();
  const database = mongoose.connection.db!;
  const at = new Date('2026-09-01T12:00:00Z');
  await database.collection('users').insertMany([
    { _id: alex, name: 'Alex', email: 'alex@splitbook-test.local' },
    { _id: sam, name: 'Sam', email: 'sam@splitbook-test.local' },
  ]);
  const { insertedId: group } = await database.collection('groups').insertOne({
    name: 'Cold start trip',
    category: 'trip',
    defaultCurrency: 'INR',
    createdBy: alex,
    members: [
      { user: alex, role: 'admin', joinedAt: at },
      { user: sam, role: 'member', joinedAt: at },
    ],
    isArchived: false,
    createdAt: at,
    updatedAt: at,
  });
  // Alex paid ₹90 for both of them, so Sam owes Alex ₹45.
  await database.collection('expenses').insertOne({
    group,
    description: 'Dinner',
    amount: 90,
    amountMinor: 9000,
    currency: 'INR',
    moneyVersion: 1,
    category: 'food',
    date: at,
    paidBy: [{ user: alex, amount: 90, amountMinor: 9000 }],
    splitMethod: 'equal',
    splitBetween: [
      { user: alex, amount: 45, amountMinor: 4500 },
      { user: sam, amount: 45, amountMinor: 4500 },
    ],
    createdBy: alex,
    isDeleted: false,
    revision: 0,
    createdAt: at,
    updatedAt: at,
  });
});
afterAll(db.teardown);

it('returns Home totals on a fresh instance where no other route registered the User model', async () => {
  expect(mongoose.modelNames()).not.toContain('User');

  const { GET } = await import('./route');
  const response = await GET();

  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.buckets).toEqual([{ currency: 'INR', youOwe: 0, youAreOwed: 45, net: 45 }]);
  expect(data.groups).toMatchObject([
    {
      name: 'Cold start trip',
      balances: [
        {
          currency: 'INR',
          balance: 45,
          settlement: { counterpartyId: String(sam), counterpartyName: 'Sam', amount: 45 },
        },
      ],
    },
  ]);
});
