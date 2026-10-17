/**
 * HTTP tests for reviewing Drafts before they are saved (#473) against a real, isolated MongoDB
 * database (`splitbook-test-drafts-review-route`). Members sign in for real: a demo persona
 * sign-in through Better Auth's own handler returns the session cookie, and every route call
 * sends it back. `next/headers` is the only stand-in, because a handler called outside Next
 * has no request scope; it hands the route the headers of the request it is answering.
 *
 * A review names every missing fact and every possible duplicate (ADR 0008); it never fills a
 * fact in or saves anything.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Group from '@/lib/models/Group';
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

const db = integrationTestDb('drafts-review-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let auth: typeof import('@/lib/auth').auth;
let review: typeof import('./route');
let drafts: typeof import('../route');

beforeAll(async () => {
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-draft-review-routes');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await db.connect();
  // Better Auth opens its client on the database MONGODB_URI names when it loads, so the
  // routes load only once connect has pointed MONGODB_URI at this file's database.
  ({ auth } = await import('@/lib/auth'));
  review = await import('./route');
  drafts = await import('../route');
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

/** Alex's and Sam's trip with an empty ledger. */
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

/** A ₹1,000.00 dinner on 10 October that Sam paid for, split equally with Alex. */
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

/** Sam keeps one Draft with these values; returns its id. */
async function samKeeps(groupId: string, samCookie: string, values: object): Promise<string> {
  const created = await call(drafts.POST, groupId, '/drafts', {
    cookie: samCookie,
    body: { drafts: [values] },
    headers: { 'Idempotency-Key': 'draft-sam-0001' },
  });
  expect(created.status).toBe(201);
  return created.body.data[0].id;
}

describe('POST /api/groups/[id]/drafts/review', () => {
  it('finds nothing to fix in a complete Draft', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const samCookie = await signIn('sam');
    const draftId = await samKeeps(groupId, samCookie, samsDinner(foodTagId));

    const reviewed = await call(review.POST, groupId, '/drafts/review', {
      cookie: samCookie,
      body: { ids: [draftId] },
    });

    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data).toEqual([
      expect.objectContaining({
        draft: expect.objectContaining({ id: draftId, revision: 0 }),
        review: expect.any(String),
        problems: [],
        duplicates: [],
      }),
    ]);
  });

  it('names each missing fact of an incomplete Draft without filling any in', async () => {
    const { groupId } = await emptyTrip();
    const samCookie = await signIn('sam');
    const draftId = await samKeeps(groupId, samCookie, { description: 'Taxi', amount: 450 });

    const reviewed = await call(review.POST, groupId, '/drafts/review', {
      cookie: samCookie,
      body: { ids: [draftId] },
    });

    expect(reviewed.body.data[0].problems).toEqual([
      'currency: Choose a currency.',
      'date: Choose the Expense date.',
      'paidBy: Choose who paid.',
      'splitMethod: Choose a split method.',
      'splitBetween: Choose who shared this Expense.',
      'tagId: Choose a Tag.',
    ]);
    expect(reviewed.body.data[0].draft.values).toEqual({ description: 'Taxi', amount: 450 });
  });

  it('warns that a Draft looks like an Expense already in the ledger', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const saved = await expenseService.create(
      groupId,
      {
        description: 'Dinner',
        amount: 1000,
        currency: 'INR',
        category: 'food',
        tag: 'Food',
        date: new Date('2026-10-10T12:00:00.000Z'),
        paidBy: [{ user: sam, amount: 1000 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
      sam,
    );
    const samCookie = await signIn('sam');
    const draftId = await samKeeps(groupId, samCookie, samsDinner(foodTagId));

    const reviewed = await call(review.POST, groupId, '/drafts/review', {
      cookie: samCookie,
      body: { ids: [draftId] },
    });

    expect(reviewed.body.data[0].duplicates).toEqual([
      { kind: 'expense', id: String(saved._id), description: 'Dinner' },
    ]);
  });

  it('does not let Alex review the Draft Sam keeps', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const draftId = await samKeeps(groupId, await signIn('sam'), samsDinner(foodTagId));

    const refused = await call(review.POST, groupId, '/drafts/review', {
      cookie: await signIn('alex'),
      body: { ids: [draftId] },
    });

    expect(refused).toEqual({
      status: 404,
      body: { error: 'Draft not found', status: 404, code: 'DRAFT_NOT_FOUND' },
    });
  });
});
