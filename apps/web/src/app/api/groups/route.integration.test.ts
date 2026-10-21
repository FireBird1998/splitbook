/**
 * HTTP tests for creating and listing Groups (#472) against a real, isolated MongoDB database
 * (`splitbook-test-groups-collection-route`), with a real session (`signed-in-route.ts`).
 *
 * The member who creates a Group is its admin, and each member's list holds only the Groups
 * they belong to.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
// The list schedules recovery of requested Group deletions with after() (ADR 0007).
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);

const db = integrationTestDb('groups-collection-route');
const { alex } = DEMO_PERSONA_IDS;

let groups: typeof import('./route');

beforeAll(async () => {
  await connectSignedIn(db);
  groups = await import('./route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

const coorgWeekend = {
  name: 'Coorg Weekend',
  category: 'trip',
  defaultCurrency: 'INR',
  alternateCurrencies: [],
};

function createGroup(cookie: string, body: object, headers?: Record<string, string>) {
  return callRoute(groups.POST, { method: 'POST', path: '/api/groups', cookie, body, headers });
}

async function listedNames(cookie: string) {
  const listed = await callRoute(groups.GET, { method: 'GET', path: '/api/groups', cookie });
  expect(listed.status).toBe(200);
  return listed.body.data.map((group: { name: string }) => group.name);
}

describe('POST and GET /api/groups', () => {
  it('creates a Group with Alex as its admin, listed for Alex and not for Sam', async () => {
    const alexCookie = await signIn('alex');

    const created = await createGroup(alexCookie, coorgWeekend);

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: 'Coorg Weekend',
      category: 'trip',
      defaultCurrency: 'INR',
      members: [{ user: { _id: alex, name: 'Alex Rivera' }, role: 'admin' }],
    });
    expect(await listedNames(alexCookie)).toEqual(['Coorg Weekend']);
    expect(await listedNames(await signIn('sam'))).toEqual([]);
  });

  it('returns the first Group when the same creation key is posted again', async () => {
    const alexCookie = await signIn('alex');
    const post = () =>
      createGroup(alexCookie, coorgWeekend, { 'Idempotency-Key': 'group-coorg-0001' });

    const first = await post();
    const retried = await post();

    expect([first.status, retried.status]).toEqual([201, 201]);
    expect(retried.body.data._id).toBe(first.body.data._id);
    expect(await listedNames(alexCookie)).toEqual(['Coorg Weekend']);
  });

  // #723: a new Trip's extra currencies, chosen while it is set up, kept on a retried creation.
  it('keeps a new Trip’s extra currencies, and a retry returns the same Trip', async () => {
    const alexCookie = await signIn('alex');
    const lisbonAndTokyo = {
      ...coorgWeekend,
      name: 'Lisbon & Tokyo',
      alternateCurrencies: ['EUR', 'JPY'],
    };
    const post = () =>
      createGroup(alexCookie, lisbonAndTokyo, { 'Idempotency-Key': 'group-lisbon-0001' });

    const first = await post();
    const retried = await post();

    expect([first.status, retried.status]).toEqual([201, 201]);
    expect(first.body.data.alternateCurrencies).toEqual(['EUR', 'JPY']);
    expect(retried.body.data).toMatchObject({
      _id: first.body.data._id,
      alternateCurrencies: ['EUR', 'JPY'],
    });
  });

  it('refuses a Group without a session', async () => {
    const refused = await createGroup('', coorgWeekend);

    expect(refused).toEqual({ status: 401, body: { error: 'Unauthorized', status: 401 } });
  });
});
