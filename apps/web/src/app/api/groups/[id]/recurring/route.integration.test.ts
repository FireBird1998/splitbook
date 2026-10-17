/**
 * HTTP tests for a Group's recurring Expenses collection (#473) against a real, isolated MongoDB
 * database (`splitbook-test-recurring-collection-route`). Members sign in for real: a demo
 * persona sign-in through Better Auth's own handler returns the session cookie, and every route
 * call sends it back. `next/headers` is the only stand-in, because a handler called outside Next
 * has no request scope; it hands the route the headers of the request it is answering.
 *
 * A recurring Expense passes the same gate as other ledger writes: only a Household admin
 * creates one, only members read the list, and while the product switch is off (#289) nothing
 * is created. A month that is already due reaches the ledger, read back through the balances
 * route. The item route's own test (`[recurringId]`) covers edits and deletion.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import User from '@/lib/models/User';
import { DEMO_PERSONAS, DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { toPeriod } from '@splitbook/shared/recurring-due-periods';

const APP_URL = 'http://localhost:3000';

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => request.headers }));

type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

const db = integrationTestDb('recurring-collection-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let auth: typeof import('@/lib/auth').auth;
let recurring: typeof import('./route');
let balances: typeof import('../balances/route');

beforeAll(async () => {
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-recurring-routes');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  await db.connect();
  // Better Auth opens its client on the database MONGODB_URI names when it loads, so the
  // routes load only once connect has pointed MONGODB_URI at this file's database.
  ({ auth } = await import('@/lib/auth'));
  recurring = await import('./route');
  balances = await import('../balances/route');
});
beforeEach(async () => {
  // Recurring Expenses are off unless switched on (#289); a test that needs them off says so.
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
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
  init: { cookie: string; body?: unknown },
) {
  const httpRequest = new Request(`${APP_URL}/api/groups/${groupId}${path}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: { cookie: init.cookie, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  request.headers = httpRequest.headers;
  const response = await handler(httpRequest, { params: Promise.resolve({ id: groupId }) });
  return { status: response.status, body: await response.json() };
}

/** Alex's and Sam's Household, with Alex as its admin and nothing in its ledger. */
async function household() {
  const group = await groupService.create(
    { name: 'Lakeview Flat', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

/** ₹30,000.00 Rent on the 1st, paid by Alex and split equally, starting this month. */
const monthlyRent = {
  description: 'Rent',
  amount: 30000,
  currency: 'INR',
  category: 'housing',
  tag: 'Rent',
  paidBy: [{ user: alex, amount: 30000 }],
  splitMethod: 'equal',
  splitBetween: [{ user: alex }, { user: sam }],
  dayOfMonth: 1,
  startsOn: `${toPeriod(new Date())}-01`,
};

async function rentTemplates(groupId: string, cookie: string) {
  const listed = await call(recurring.GET, groupId, '/recurring', { cookie });
  expect(listed.status).toBe(200);
  return listed.body.data.map((template: { description: string; amount: number }) => ({
    description: template.description,
    amount: template.amount,
  }));
}

async function debts(groupId: string, cookie: string) {
  const { status, body } = await call(balances.GET, groupId, '/balances', { cookie });
  expect(status).toBe(200);
  return body.data.debts.map(
    (debt: { from: { _id: string }; to: { _id: string }; amount: number }) => ({
      from: debt.from._id,
      to: debt.to._id,
      amount: debt.amount,
    }),
  );
}

describe('POST and GET /api/groups/[id]/recurring', () => {
  it('lets the Household admin add a monthly Rent whose due month reaches the ledger', async () => {
    const groupId = await household();

    const created = await call(recurring.POST, groupId, '/recurring', {
      cookie: await signIn('alex'),
      body: monthlyRent,
    });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ description: 'Rent', amount: 30000, dayOfMonth: 1 });
    const samCookie = await signIn('sam');
    expect(await rentTemplates(groupId, samCookie)).toEqual([
      { description: 'Rent', amount: 30000 },
    ]);
    expect(await debts(groupId, samCookie)).toEqual([{ from: sam, to: alex, amount: 15000 }]);
  });

  it('refuses a member who is not the admin and adds nothing', async () => {
    const groupId = await household();
    const samCookie = await signIn('sam');

    const refused = await call(recurring.POST, groupId, '/recurring', {
      cookie: samCookie,
      body: { ...monthlyRent, paidBy: [{ user: sam, amount: 30000 }] },
    });

    expect(refused).toEqual({ status: 403, body: { error: 'Forbidden', status: 403 } });
    expect(await rentTemplates(groupId, samCookie)).toEqual([]);
    expect(await debts(groupId, samCookie)).toEqual([]);
  });

  it('refuses someone who is not in the Household, to read or to add', async () => {
    const groupId = await household();
    const priyaCookie = await signIn('priya');

    const read = await call(recurring.GET, groupId, '/recurring', { cookie: priyaCookie });
    const added = await call(recurring.POST, groupId, '/recurring', {
      cookie: priyaCookie,
      body: monthlyRent,
    });

    expect([read, added]).toEqual([
      { status: 403, body: { error: 'Forbidden', status: 403 } },
      { status: 403, body: { error: 'Forbidden', status: 403 } },
    ]);
    expect(await rentTemplates(groupId, await signIn('alex'))).toEqual([]);
  });

  it('adds nothing and lists nothing while recurring Expenses are off', async () => {
    const groupId = await household();
    const alexCookie = await signIn('alex');
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'false');

    const refused = await call(recurring.POST, groupId, '/recurring', {
      cookie: alexCookie,
      body: monthlyRent,
    });

    expect(refused).toEqual({
      status: 409,
      body: {
        error: 'Recurring Expenses are turned off.',
        status: 409,
        code: 'RECURRING_EXPENSES_OFF',
      },
    });
    expect(await rentTemplates(groupId, alexCookie)).toEqual([]);
    expect(await debts(groupId, alexCookie)).toEqual([]);
  });
});
