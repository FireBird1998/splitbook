import mongoose from 'mongoose';
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { integrationTestDb } from './test-utils/integration-db';
import { groupService } from './services/group.service';
import { inventoryOrphanGroups } from './group-cleanup';
import { expenseService } from './services/expense.service';
const session = vi.hoisted(() => ({ userId: 'a00000000000000000000001' }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: {
          id: session.userId,
          name: 'Fictional standalone member',
          email: 'fictional@example.test',
        },
      }),
    },
  },
}));
import { POST as leaveRoute } from '@/app/api/groups/[id]/leave/route';
// Explicit separate standalone target; never silently skip topology coverage.
if (!process.env.STANDALONE_TEST_MONGODB_URI)
  throw new Error(
    'Explicit STANDALONE_TEST_MONGODB_URI is required for standalone compatibility coverage',
  );
vi.stubEnv('TEST_MONGODB_URI', process.env.STANDALONE_TEST_MONGODB_URI);
const db = integrationTestDb('orphan-cleanup-standalone');
beforeAll(async () => {
  await db.connect();
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (hello.setName || hello.msg === 'isdbgrid')
    throw new Error(
      'Standalone coverage requires STANDALONE_TEST_MONGODB_URI naming an isolated standalone Mongo server',
    );
});
beforeEach(db.reset);
afterAll(db.teardown);
it('refuses destructive consent before removing membership and preserves ordinary standalone writes', async () => {
  const group = await groupService.create(
    {
      name: 'Fictional standalone Trip',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
    session.userId,
  );
  const id = String(group._id);
  const response = await leaveRoute(
    new Request(`http://localhost/api/groups/${id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteIfLastMember: true }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('GROUP_DELETION_UNAVAILABLE');
  expect((await groupService.getById(id))?.members).toHaveLength(1);
  const expense = await expenseService.create(
    id,
    {
      description: 'Fictional lunch',
      amount: 20,
      currency: 'INR',
      category: 'food',
      date: new Date(),
      paidBy: [{ user: session.userId, amount: 20 }],
      splitBetween: [{ user: session.userId }],
      splitMethod: 'equal',
      tag: 'Food',
    },
    session.userId,
  );
  expect(expense.amount).toBe(20);
  expect((await inventoryOrphanGroups(mongoose.connection.db!, 'test')).groups).toEqual([]);
  expect(await mongoose.connection.db!.collection('groupdeletions').countDocuments()).toBe(0);
});

it('serves Tag reads but refuses changes that cannot commit an atomic receipt on standalone Mongo', async () => {
  const { GET, POST } = await import('@/app/api/groups/[id]/tag-actions/route');
  const { GET: check } = await import('@/app/api/groups/[id]/tag-actions/[requestId]/route');
  const { randomUUID } = await import('node:crypto');
  const group = await groupService.create(
    {
      name: 'Fictional standalone Tags',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
    session.userId,
  );
  const id = String(group._id);
  const context = { params: Promise.resolve({ id }) };
  const before = await (await GET(new Request('http://localhost'), context)).json();
  const command = { requestId: randomUUID(), intent: { action: 'create', name: 'Villa' } };
  const response = await POST(
    new Request('http://localhost', { method: 'POST', body: JSON.stringify(command) }),
    context,
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'TAG_TRANSACTIONS_REQUIRED' });
  expect(await (await GET(new Request('http://localhost'), context)).json()).toEqual(before);
  const checked = await check(new Request('http://localhost'), {
    params: Promise.resolve({ id, requestId: command.requestId }),
  });
  expect(checked.status).toBe(200);
  expect(await checked.json()).toMatchObject({ data: { state: 'not-applied' } });
});
