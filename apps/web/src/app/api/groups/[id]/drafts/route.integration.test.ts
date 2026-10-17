/**
 * HTTP tests for a member's Draft collection in a Group (#473) against a real, isolated MongoDB
 * database (`splitbook-test-drafts-route`). Members sign in for real: a demo persona sign-in
 * through Better Auth's own handler returns the session cookie, and every route call sends it
 * back. `next/headers` is the only stand-in, because a handler called outside Next has no
 * request scope; it hands the route the headers of the request it is answering.
 *
 * A Draft is unfinished information (ADR 0008): it is private to the member who keeps it and
 * stays out of the ledger, which is read back through the balances route.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Group from '@/lib/models/Group';
import User from '@/lib/models/User';
import { DEMO_PERSONAS, DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

const APP_URL = 'http://localhost:3000';

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => request.headers }));

type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

const db = integrationTestDb('drafts-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let auth: typeof import('@/lib/auth').auth;
let drafts: typeof import('./route');
let balances: typeof import('../balances/route');

beforeAll(async () => {
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-draft-routes');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await db.connect();
  // Better Auth opens its client on the database MONGODB_URI names when it loads, so the
  // routes load only once connect has pointed MONGODB_URI at this file's database.
  ({ auth } = await import('@/lib/auth'));
  drafts = await import('./route');
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

/** Alex's and Sam's trip, with nothing in its ledger yet. */
async function emptyTrip() {
  const group = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  const stored = await Group.findById(groupId).lean();
  const food = stored!.tags.find((tag) => tag.name === 'Food')!;
  return { groupId, foodTagId: String(food._id) };
}

/** A complete Draft of a ₹1,000.00 dinner Sam paid for, split equally with Alex. */
function samsDinner(foodTagId: string) {
  return {
    description: 'Dinner',
    category: 'food',
    amount: 1000,
    currency: 'INR',
    date: '2026-10-10',
    tagId: foodTagId,
    paidBy: [{ user: sam, amount: 1000 }],
    splitMethod: 'equal',
    splitBetween: [{ user: alex }, { user: sam }],
  };
}

describe('POST and GET /api/groups/[id]/drafts', () => {
  it('keeps a Draft for Sam alone and out of the ledger', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const samCookie = await signIn('sam');

    const created = await call(drafts.POST, groupId, '/drafts', {
      cookie: samCookie,
      body: { drafts: [samsDinner(foodTagId)] },
      headers: { 'Idempotency-Key': 'draft-sam-dinner-0001' },
    });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject([
      { revision: 0, values: samsDinner(foodTagId), missingFields: [] },
    ]);
    const samsList = await call(drafts.GET, groupId, '/drafts', { cookie: samCookie });
    expect(samsList.body.data).toEqual(created.body.data);
    const alexCookie = await signIn('alex');
    const alexsList = await call(drafts.GET, groupId, '/drafts', { cookie: alexCookie });
    expect(alexsList).toEqual({ status: 200, body: { data: [], status: 200 } });
    const ledger = await call(balances.GET, groupId, '/balances', { cookie: alexCookie });
    expect(ledger.body.data).toMatchObject({ currency: 'INR', balances: [], debts: [] });
  });

  it('returns the original Draft when the same creation key is posted again', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const samCookie = await signIn('sam');
    const post = () =>
      call(drafts.POST, groupId, '/drafts', {
        cookie: samCookie,
        body: { drafts: [samsDinner(foodTagId)] },
        headers: { 'Idempotency-Key': 'draft-sam-dinner-0001' },
      });

    const first = await post();
    const retried = await post();

    expect([first.status, retried.status]).toEqual([201, 201]);
    expect(retried.body.data).toEqual(first.body.data);
    const listed = await call(drafts.GET, groupId, '/drafts', { cookie: samCookie });
    expect(listed.body.data).toHaveLength(1);
  });

  it('refuses a Draft from someone who is not in the Group', async () => {
    const { groupId, foodTagId } = await emptyTrip();

    const refused = await call(drafts.POST, groupId, '/drafts', {
      cookie: await signIn('priya'),
      body: { drafts: [samsDinner(foodTagId)] },
      headers: { 'Idempotency-Key': 'draft-priya-dinner-0001' },
    });

    expect(refused).toEqual({
      status: 403,
      body: { error: 'Forbidden', status: 403, code: 'FORBIDDEN' },
    });
    const listed = await call(drafts.GET, groupId, '/drafts', { cookie: await signIn('sam') });
    expect(listed.body.data).toEqual([]);
  });
});
