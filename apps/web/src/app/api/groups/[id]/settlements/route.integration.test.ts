/**
 * HTTP tests for recording a Settlement (#473) against a real, isolated MongoDB database
 * (`splitbook-test-settlements-route`). Members sign in for real: a demo persona sign-in
 * through Better Auth's own handler returns the session cookie, and every route call sends it
 * back. `next/headers` is the only stand-in, because a handler called outside Next has no
 * request scope; it hands the route the headers of the request it is answering.
 *
 * The balance is read back through the balances route, the way a member sees it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import User from '@/lib/models/User';
import { DEMO_PERSONAS, DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

const APP_URL = 'http://localhost:3000';

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => request.headers }));

type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

const db = integrationTestDb('settlements-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let auth: typeof import('@/lib/auth').auth;
let settlements: typeof import('./route');
let balances: typeof import('../balances/route');

beforeAll(async () => {
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-settlement-routes');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  await db.connect();
  // Better Auth opens its client on the database MONGODB_URI names when it loads, so the
  // routes load only once connect has pointed MONGODB_URI at this file's database.
  ({ auth } = await import('@/lib/auth'));
  settlements = await import('./route');
  balances = await import('../balances/route');
});
beforeEach(async () => {
  await db.reset();
  await User.insertMany(
    DEMO_PERSONAS.map((persona) => ({
      _id: new mongoose.Types.ObjectId(persona.id),
      name: persona.name,
      email: persona.email,
      preferredCurrency: 'INR',
    })),
  );
});
afterAll(async () => {
  await db.teardown();
  vi.unstubAllEnvs();
});

/** Sign in as a demo persona and return the cookies a browser would send back. */
async function signIn(persona: DemoPersonaKey): Promise<string> {
  const response = await auth.handler(
    new Request(`${APP_URL}/api/auth/demo-persona/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ personaId: persona }),
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

async function call(
  handler: Handler,
  groupId: string,
  path: string,
  init: { cookie: string; body?: unknown; headers?: Record<string, string> },
) {
  const httpRequest = new Request(`${APP_URL}/api/groups/${groupId}${path}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: { cookie: init.cookie, 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  request.headers = httpRequest.headers;
  const response = await handler(httpRequest, { params: Promise.resolve({ id: groupId }) });
  return { status: response.status, body: await response.json() };
}

interface Balances {
  balances: { user: { _id: string }; balance: number }[];
  debts: { from: { _id: string }; to: { _id: string }; amount: number }[];
}

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

async function readBalances(groupId: string, cookie: string): Promise<Balances> {
  const { status, body } = await call(balances.GET, groupId, '/balances', { cookie });
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
    const samCookie = await signIn('sam');
    expect(debtsOf(await readBalances(groupId, samCookie))).toEqual([
      { from: sam, to: alex, amount: 500 },
    ]);

    const recorded = await call(settlements.POST, groupId, '/settlements', {
      cookie: samCookie,
      body: { paidTo: alex, amount: 123.45, currency: 'INR' },
    });

    expect(recorded.status).toBe(201);
    expect(recorded.body.data).toMatchObject({
      amount: 123.45,
      currency: 'INR',
      paidBy: { _id: sam },
      paidTo: { _id: alex },
    });
    const after = await readBalances(groupId, await signIn('alex'));
    expect(balanceOf(after, sam)).toBe(-376.55);
    expect(balanceOf(after, alex)).toBe(376.55);
    expect(debtsOf(after)).toEqual([{ from: sam, to: alex, amount: 376.55 }]);
  });

  it('refuses a Settlement from someone who is not in the Group and records nothing', async () => {
    const groupId = await tripWhereSamOwesAlex500();

    const refused = await call(settlements.POST, groupId, '/settlements', {
      cookie: await signIn('priya'),
      body: { paidBy: sam, paidTo: alex, amount: 123.45, currency: 'INR' },
    });

    expect(refused).toEqual({ status: 403, body: { error: 'Forbidden', status: 403 } });
    const alexCookie = await signIn('alex');
    const listed = await call(settlements.GET, groupId, '/settlements', { cookie: alexCookie });
    expect(listed.body.data).toEqual([]);
    expect(debtsOf(await readBalances(groupId, alexCookie))).toEqual([
      { from: sam, to: alex, amount: 500 },
    ]);
  });

  it('records a Settlement once when the same idempotency key is posted twice', async () => {
    const groupId = await tripWhereSamOwesAlex500();
    const samCookie = await signIn('sam');
    const post = () =>
      call(settlements.POST, groupId, '/settlements', {
        cookie: samCookie,
        body: { paidTo: alex, amount: 123.45, currency: 'INR' },
        headers: { 'Idempotency-Key': 'settle-sam-alex-0001' },
      });

    const first = await post();
    const retried = await post();

    expect([first.status, retried.status]).toEqual([201, 201]);
    expect(retried.body.data._id).toBe(first.body.data._id);
    const listed = await call(settlements.GET, groupId, '/settlements', { cookie: samCookie });
    expect(listed.body.data.map((settlement: { _id: string }) => settlement._id)).toEqual([
      first.body.data._id,
    ]);
    expect(debtsOf(await readBalances(groupId, samCookie))).toEqual([
      { from: sam, to: alex, amount: 376.55 },
    ]);
  });
});
