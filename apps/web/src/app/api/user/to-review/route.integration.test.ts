/**
 * HTTP tests for To review, the member's Drafts across Groups (#473), against a real, isolated
 * MongoDB database (`splitbook-test-to-review-route`). Members sign in for real: a demo persona
 * sign-in through Better Auth's own handler returns the session cookie, and every route call
 * sends it back. `next/headers` is the only stand-in, because a handler called outside Next has
 * no request scope; it hands the route the headers of the request it is answering.
 *
 * To review is where Finish later leads: it lists only the signed-in member's own Drafts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
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

const db = integrationTestDb('to-review-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let auth: typeof import('@/lib/auth').auth;
let toReview: typeof import('./route');
let drafts: typeof import('@/app/api/groups/[id]/drafts/route');

beforeAll(async () => {
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-to-review-routes');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await db.connect();
  // Better Auth opens its client on the database MONGODB_URI names when it loads, so the
  // routes load only once connect has pointed MONGODB_URI at this file's database.
  ({ auth } = await import('@/lib/auth'));
  toReview = await import('./route');
  drafts = await import('@/app/api/groups/[id]/drafts/route');
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
  path: string,
  init: { cookie: string; body?: unknown; headers?: Record<string, string>; groupId?: string },
) {
  const httpRequest = new Request(`${APP_URL}/api${path}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: { cookie: init.cookie, 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  request.headers = httpRequest.headers;
  const params = Promise.resolve({ id: init.groupId ?? '' });
  const response = await handler(httpRequest, { params });
  return { status: response.status, body: await response.json() };
}

/** A Group of Alex's that Sam belongs to. */
async function groupWithSam(name: string, category: 'trip' | 'home') {
  const group = await groupService.create(
    { name, category, defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

/** Sam keeps unfinished Drafts with these descriptions in one Group; returns their ids. */
async function samKeeps(groupId: string, samCookie: string, ...descriptions: string[]) {
  const created = await call(drafts.POST, `/groups/${groupId}/drafts`, {
    groupId,
    cookie: samCookie,
    body: { drafts: descriptions.map((description) => ({ description, amount: 450 })) },
    headers: { 'Idempotency-Key': `draft-sam-${descriptions.join('-').toLowerCase()}` },
  });
  expect(created.status).toBe(201);
  return created.body.data.map((draft: { id: string }) => draft.id) as string[];
}

interface ToReview {
  total: number;
  groups: {
    groupId: string;
    groupName: string;
    count: number;
    items: { draft: { id: string } }[];
  }[];
}

function summary(data: ToReview) {
  return {
    total: data.total,
    groups: data.groups.map((group) => ({
      groupId: group.groupId,
      groupName: group.groupName,
      count: group.count,
      drafts: group.items.map((item) => item.draft.id),
    })),
  };
}

describe('GET /api/user/to-review', () => {
  it('lists Sam’s Drafts from every Group Sam is in, by Group name', async () => {
    const samCookie = await signIn('sam');
    const trip = await groupWithSam('Coorg Weekend', 'trip');
    const flat = await groupWithSam('Lakeview Flat', 'home');
    const flatDrafts = await samKeeps(flat, samCookie, 'Plumber');
    const tripDrafts = await samKeeps(trip, samCookie, 'Taxi', 'Ferry');

    const listed = await call(toReview.GET, '/user/to-review', { cookie: samCookie });

    expect(listed.status).toBe(200);
    expect(summary(listed.body.data)).toEqual({
      total: 3,
      groups: [
        { groupId: trip, groupName: 'Coorg Weekend', count: 2, drafts: tripDrafts },
        { groupId: flat, groupName: 'Lakeview Flat', count: 1, drafts: flatDrafts },
      ],
    });
  });

  it('shows Alex none of the Drafts Sam keeps in Alex’s Group', async () => {
    const trip = await groupWithSam('Coorg Weekend', 'trip');
    await samKeeps(trip, await signIn('sam'), 'Taxi');

    const listed = await call(toReview.GET, '/user/to-review', { cookie: await signIn('alex') });

    expect(listed).toEqual({ status: 200, body: { data: { groups: [], total: 0 }, status: 200 } });
  });

  it('refuses a request without a session', async () => {
    const listed = await call(toReview.GET, '/user/to-review', { cookie: '' });

    expect(listed).toEqual({ status: 401, body: { error: 'Unauthorized', status: 401 } });
  });
});
