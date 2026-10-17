/**
 * HTTP tests for recording a Settlement (#473) against a real, isolated MongoDB database
 * (`splitbook-test-settlements-route`), with a real session (`signed-in-route.ts`).
 *
 * The balance is read back through the balances route, the way a member sees it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('settlements-route');
const { alex, sam, priya } = DEMO_PERSONA_IDS;

let settlements: typeof import('./route');
let balances: typeof import('../balances/route');

beforeAll(async () => {
  await connectSignedIn(db);
  settlements = await import('./route');
  balances = await import('../balances/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's and Sam's trip, where Sam owes Alex ₹500.00 for half of a ₹1,000.00 dinner. */
async function tripWhereSamOwesAlex500() {
  const group = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  await expenseService.create(
    groupId,
    {
      description: 'Dinner',
      amount: 1000,
      currency: 'INR',
      category: 'food',
      tag: 'Food',
      date: new Date('2026-10-10T12:00:00.000Z'),
      paidBy: [{ user: alex, amount: 1000 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }],
    },
    alex,
  );
  return groupId;
}

function recordSettlement(
  groupId: string,
  cookie: string,
  body: object,
  headers?: Record<string, string>,
) {
  return callRoute(settlements.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/settlements`,
    params: { id: groupId },
    cookie,
    body,
    headers,
  });
}

async function listedSettlementIds(groupId: string, cookie: string) {
  const listed = await callRoute(settlements.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/settlements`,
    params: { id: groupId },
    cookie,
  });
  expect(listed.status).toBe(200);
  return listed.body.data.map((settlement: { _id: string }) => settlement._id);
}

interface Balances {
  balances: { user: { _id: string }; balance: number }[];
  debts: { from: { _id: string }; to: { _id: string }; amount: number }[];
}

async function readBalances(groupId: string, persona: DemoPersonaKey): Promise<Balances> {
  const { status, body } = await callRoute(balances.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/balances`,
    params: { id: groupId },
    cookie: await signIn(persona),
  });
  expect(status).toBe(200);
  return body.data;
}

function balanceOf(data: Balances, userId: string) {
  return data.balances.find((entry) => entry.user._id === userId)?.balance;
}

function debtsOf(data: Balances) {
  return data.debts.map((debt) => ({ from: debt.from._id, to: debt.to._id, amount: debt.amount }));
}

describe('POST /api/groups/[id]/settlements', () => {
  it('shrinks what Sam owes by the ₹123.45 (12,345 paise) Sam pays', async () => {
    const groupId = await tripWhereSamOwesAlex500();
    expect(debtsOf(await readBalances(groupId, 'sam'))).toEqual([
      { from: sam, to: alex, amount: 500 },
    ]);

    const recorded = await recordSettlement(groupId, await signIn('sam'), {
      paidTo: alex,
      amount: 123.45,
      currency: 'INR',
    });

    expect(recorded.status).toBe(201);
    expect(recorded.body.data).toMatchObject({
      amount: 123.45,
      currency: 'INR',
      paidBy: { _id: sam },
      paidTo: { _id: alex },
    });
    const after = await readBalances(groupId, 'alex');
    expect(balanceOf(after, sam)).toBe(-376.55);
    expect(balanceOf(after, alex)).toBe(376.55);
    expect(debtsOf(after)).toEqual([{ from: sam, to: alex, amount: 376.55 }]);
  });

  it('refuses a Settlement from someone who is not in the Group and records nothing', async () => {
    const groupId = await tripWhereSamOwesAlex500();

    const refused = await recordSettlement(groupId, await signIn('priya'), {
      paidBy: sam,
      paidTo: alex,
      amount: 123.45,
      currency: 'INR',
    });

    expect(refused).toEqual({ status: 403, body: { error: 'Forbidden', status: 403 } });
    expect(await listedSettlementIds(groupId, await signIn('alex'))).toEqual([]);
    expect(debtsOf(await readBalances(groupId, 'alex'))).toEqual([
      { from: sam, to: alex, amount: 500 },
    ]);
  });

  it('refuses a Settlement paid to someone who is not in the Group', async () => {
    const groupId = await tripWhereSamOwesAlex500();
    const samCookie = await signIn('sam');

    const refused = await recordSettlement(groupId, samCookie, {
      paidTo: priya,
      amount: 123.45,
      currency: 'INR',
    });

    expect(refused).toEqual({
      status: 422,
      body: {
        error: 'Both payer and recipient must be group members',
        status: 422,
        code: 'INVALID_MEMBERS',
      },
    });
    expect(await listedSettlementIds(groupId, samCookie)).toEqual([]);
  });

  it('records a Settlement once when the same idempotency key is posted twice', async () => {
    const groupId = await tripWhereSamOwesAlex500();
    const samCookie = await signIn('sam');
    const post = () =>
      recordSettlement(
        groupId,
        samCookie,
        { paidTo: alex, amount: 123.45, currency: 'INR' },
        { 'Idempotency-Key': 'settle-sam-alex-0001' },
      );

    const first = await post();
    const retried = await post();

    expect([first.status, retried.status]).toEqual([201, 201]);
    expect(retried.body.data._id).toBe(first.body.data._id);
    expect(await listedSettlementIds(groupId, samCookie)).toEqual([first.body.data._id]);
    expect(debtsOf(await readBalances(groupId, 'sam'))).toEqual([
      { from: sam, to: alex, amount: 376.55 },
    ]);
  });
});
