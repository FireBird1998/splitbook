/**
 * HTTP tests for saving reviewed Drafts as Expenses (#473) against a real, isolated MongoDB
 * database (`splitbook-test-drafts-save-route`). Members sign in for real: a demo persona
 * sign-in through Better Auth's own handler returns the session cookie, and every route call
 * sends it back. `next/headers` is the only stand-in, because a handler called outside Next
 * has no request scope; it hands the route the headers of the request it is answering.
 *
 * A Draft stays out of the ledger until the member who keeps it saves it (ADR 0008), and a
 * save whose reply never arrived is retried with the same reviewed command and recorded once.
 * The ledger is read back through the balances route.
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

const db = integrationTestDb('drafts-save-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let auth: typeof import('@/lib/auth').auth;
let save: typeof import('./route');
let review: typeof import('../review/route');
let drafts: typeof import('../route');
let balances: typeof import('../../balances/route');

beforeAll(async () => {
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-draft-save-routes');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await db.connect();
  // Better Auth opens its client on the database MONGODB_URI names when it loads, so the
  // routes load only once connect has pointed MONGODB_URI at this file's database.
  ({ auth } = await import('@/lib/auth'));
  save = await import('./route');
  review = await import('../review/route');
  drafts = await import('../route');
  balances = await import('../../balances/route');
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

/**
 * Alex's and Sam's trip with an empty ledger, where Sam keeps a complete Draft of a ₹1,000.00
 * dinner Sam paid for, split equally with Alex, and has reviewed it.
 */
async function tripWithSamsReviewedDinner(samCookie: string) {
  const group = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  const stored = await Group.findById(groupId).lean();
  const food = stored!.tags.find((tag) => tag.name === 'Food')!;
  const created = await call(drafts.POST, groupId, '/drafts', {
    cookie: samCookie,
    body: {
      drafts: [
        {
          description: 'Dinner',
          category: 'food',
          amount: 1000,
          currency: 'INR',
          date: '2026-10-10',
          tagId: String(food._id),
          paidBy: [{ user: sam, amount: 1000 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alex }, { user: sam }],
        },
      ],
    },
    headers: { 'Idempotency-Key': 'draft-sam-dinner-0001' },
  });
  expect(created.status).toBe(201);
  const draftId: string = created.body.data[0].id;
  const reviewed = await call(review.POST, groupId, '/drafts/review', {
    cookie: samCookie,
    body: { ids: [draftId] },
  });
  expect(reviewed.body.data).toMatchObject([{ problems: [], duplicates: [] }]);
  const saveCommand = {
    drafts: [{ id: draftId, revision: 0, review: reviewed.body.data[0].review as string }],
  };
  return { groupId, draftId, saveCommand };
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

describe('POST /api/groups/[id]/drafts/save', () => {
  it('changes the ledger only when Sam saves the Draft', async () => {
    const samCookie = await signIn('sam');
    const alexCookie = await signIn('alex');
    const { groupId, draftId, saveCommand } = await tripWithSamsReviewedDinner(samCookie);
    expect(await debts(groupId, alexCookie)).toEqual([]);

    const saved = await call(save.POST, groupId, '/drafts/save', {
      cookie: samCookie,
      body: saveCommand,
    });

    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual([
      { id: draftId, status: 'saved', expenseId: expect.any(String) },
    ]);
    expect(await debts(groupId, alexCookie)).toEqual([{ from: alex, to: sam, amount: 500 }]);
    const waiting = await call(drafts.GET, groupId, '/drafts', { cookie: samCookie });
    expect(waiting.body.data).toEqual([]);
  });

  it('records the Expense once when a save whose reply was lost is retried', async () => {
    const samCookie = await signIn('sam');
    const { groupId, saveCommand } = await tripWithSamsReviewedDinner(samCookie);
    // The first reply never reaches Sam, so the save is Unconfirmed and Sam retries it as sent.
    const unconfirmed = await call(save.POST, groupId, '/drafts/save', {
      cookie: samCookie,
      body: saveCommand,
    });

    const retried = await call(save.POST, groupId, '/drafts/save', {
      cookie: samCookie,
      body: saveCommand,
    });

    expect(retried).toEqual(unconfirmed);
    expect(await debts(groupId, samCookie)).toEqual([{ from: alex, to: sam, amount: 500 }]);
  });

  it('does not let Alex save the Draft Sam keeps', async () => {
    const samCookie = await signIn('sam');
    const alexCookie = await signIn('alex');
    const { groupId, draftId, saveCommand } = await tripWithSamsReviewedDinner(samCookie);

    const refused = await call(save.POST, groupId, '/drafts/save', {
      cookie: alexCookie,
      body: saveCommand,
    });

    expect(refused.body.data).toEqual([
      { id: draftId, status: 'failed', message: 'DRAFT_NOT_FOUND' },
    ]);
    expect(await debts(groupId, alexCookie)).toEqual([]);
  });
});
