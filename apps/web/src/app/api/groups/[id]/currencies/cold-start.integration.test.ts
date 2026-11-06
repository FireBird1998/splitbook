/**
 * Adding a currency to a Group on a freshly started server instance (#947), against a real,
 * isolated MongoDB replica set (`splitbook-test-group-currency-cold`).
 *
 * A fresh serverless instance loads only the modules of the route it serves. The currency
 * settings read populates each change's actor, so the route's own module chain must register
 * the User model, or the first add on that instance saves the currency and then fails with
 * MissingSchemaError. As in #186's test, this file imports no model, service or fixture helper:
 * its records are raw documents, and each route is loaded in a fresh module registry after
 * every model is dropped.
 */

import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

const alex = new mongoose.Types.ObjectId('b00000000000000000000001');
const sam = new mongoose.Types.ObjectId('b00000000000000000000002');
const groupId = new mongoose.Types.ObjectId('b00000000000000000000010');

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

const db = integrationTestDb('group-currency-cold');
const params = Promise.resolve({ id: String(groupId) });

beforeAll(async () => {
  await db.connect();
  await db.reset();
  const database = mongoose.connection.db!;
  await database.collection('users').insertMany([
    { _id: alex, name: 'Alex', email: 'alex@splitbook-test.local' },
    { _id: sam, name: 'Sam', email: 'sam@splitbook-test.local' },
  ]);
});
afterAll(db.teardown);

beforeEach(async () => {
  const at = new Date('2026-09-01T12:00:00Z');
  await mongoose.connection.db!.collection('groups').deleteMany({});
  await mongoose.connection.db!.collection('activities').deleteMany({});
  await mongoose.connection.db!.collection('groups').insertOne({
    _id: groupId,
    name: 'Cold start trip',
    category: 'trip',
    defaultCurrency: 'INR',
    alternateCurrencies: ['EUR'],
    createdBy: alex,
    members: [
      { user: alex, role: 'admin', joinedAt: at },
      { user: sam, role: 'member', joinedAt: at },
    ],
    isArchived: false,
    createdAt: at,
    updatedAt: at,
  });
  // A fresh instance: no model registered, and every module loaded again.
  for (const name of mongoose.modelNames()) mongoose.deleteModel(name);
  vi.resetModules();
});

const currencyInDatabase = async () =>
  (await mongoose.connection.db!.collection('groups').findOne({ _id: groupId }))
    ?.alternateCurrencies;

it('adds a currency through the Currencies section as the first request of a fresh instance', async () => {
  expect(mongoose.modelNames()).toEqual([]);

  const { POST } = await import('./route');
  const response = await POST(
    new Request(`http://localhost/api/groups/${groupId}/currencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'USD' }),
    }),
    { params },
  );

  expect(response.status).toBe(201);
  const { data } = await response.json();
  expect(data.extraCurrencies).toMatchObject([
    { code: 'EUR', added: null },
    { code: 'USD', added: { by: { _id: String(alex), name: 'Alex' } } },
  ]);
  expect(await currencyInDatabase()).toEqual(['EUR', 'USD']);
});

it('adds a currency through the Group update as the first request of a fresh instance', async () => {
  expect(mongoose.modelNames()).toEqual([]);

  const { PATCH } = await import('../route');
  const response = await PATCH(
    new Request(`http://localhost/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alternateCurrencies: ['EUR', 'USD'] }),
    }),
    { params },
  );

  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.alternateCurrencies).toEqual(['EUR', 'USD']);
  expect(data.members.map((member: { user: { name: string } }) => member.user.name)).toEqual([
    'Alex',
    'Sam',
  ]);
  expect(await currencyInDatabase()).toEqual(['EUR', 'USD']);
});
