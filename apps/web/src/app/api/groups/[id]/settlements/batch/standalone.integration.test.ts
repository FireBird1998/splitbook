import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';
vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);
if (!process.env.STANDALONE_TEST_MONGODB_URI)
  throw new Error('Settlement batch topology coverage needs STANDALONE_TEST_MONGODB_URI');
vi.stubEnv('TEST_MONGODB_URI', process.env.STANDALONE_TEST_MONGODB_URI);
const db = integrationTestDb('settlement-batch-standalone');
let batch: typeof import('./route');
let settlements: typeof import('../route');
beforeAll(async () => {
  await connectSignedIn(db);
  batch = await import('./route');
  settlements = await import('../route');
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));
it('refuses a batch on standalone MongoDB before recording any Settlement', async () => {
  const { alex, sam } = DEMO_PERSONA_IDS;
  const group = await groupService.create(
    {
      name: 'Fictional standalone batch',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: ['EUR'],
    },
    alex,
  );
  const id = String(group._id);
  await groupService.addMember(id, sam);
  for (const currency of ['EUR', 'INR'])
    await expenseService.create(
      id,
      {
        description: 'Fictional dinner',
        amount: 40,
        currency,
        category: 'food',
        tag: 'Food',
        date: new Date('2026-10-21T12:00:00Z'),
        paidBy: [{ user: alex, amount: 40 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
      alex,
    );
  const cookie = await signIn('sam');
  const refused = await callRoute(batch.POST, {
    method: 'POST',
    path: `/api/groups/${id}/settlements/batch`,
    params: { id },
    cookie,
    headers: { 'Idempotency-Key': 'standalone-batch-0001' },
    body: {
      paidTo: alex,
      paidCurrency: 'INR',
      settlements: [
        { currency: 'INR', amount: 20 },
        {
          currency: 'EUR',
          amount: 20,
          amountPaidMinor: 185000,
          appliedRate: '92.5',
          rateKind: 'entered',
        },
      ],
    },
  });
  expect(refused.status).toBe(503);
  expect(refused.body.code).toBe('SETTLEMENT_TRANSACTIONS_REQUIRED');
  const records = await callRoute(settlements.GET, {
    method: 'GET',
    path: `/api/groups/${id}/settlements`,
    params: { id },
    cookie,
  });
  expect(records.status).toBe(200);
  expect(records.body.data).toEqual([]);
});
