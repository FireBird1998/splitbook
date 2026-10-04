/**
 * Integration test for a member's pending invitations (`GET /api/invitations`) on a freshly
 * started server instance, against a real, isolated MongoDB database
 * (`splitbook-test-invitations-cold`).
 *
 * A fresh serverless instance loads only the modules of the route it serves. The invitation
 * service populates who sent each invitation, so it must register the User model itself, or the
 * first read on that instance fails with MissingSchemaError (#186). This file therefore imports
 * no model, service or fixture helper: its records are raw documents, and the route is loaded
 * inside the test, after checking nothing has registered User.
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
        user: { id: 'b00000000000000000000002', name: 'Sam', email: 'sam@splitbook-test.local' },
      })),
    },
  },
}));

const db = integrationTestDb('invitations-cold');

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
    name: 'Cold start flat',
    category: 'home',
    defaultCurrency: 'INR',
    createdBy: alex,
    members: [{ user: alex, role: 'admin', joinedAt: at }],
    isArchived: false,
    createdAt: at,
    updatedAt: at,
  });
  // Alex invited Sam, and the invitation has not expired.
  await database.collection('invitations').insertOne({
    group,
    invitedBy: alex,
    invitedEmail: 'sam@splitbook-test.local',
    status: 'pending',
    token: 'cold-start-invitation-token',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: at,
    updatedAt: at,
  });
});
afterAll(db.teardown);

it('lists pending invitations on a fresh instance where no other route registered the User model', async () => {
  expect(mongoose.modelNames()).not.toContain('User');

  const { GET } = await import('./route');
  const response = await GET();

  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data).toMatchObject([
    {
      invitedEmail: 'sam@splitbook-test.local',
      status: 'pending',
      group: { name: 'Cold start flat', category: 'home' },
      invitedBy: { _id: String(alex), name: 'Alex' },
    },
  ]);
});
