/**
 * HTTP tests for a Group's invite link (#472) against a real, isolated MongoDB database
 * (`splitbook-test-invite-link-route`), with a real session (`signed-in-route.ts`).
 *
 * Any member may make the link and read it; a new link replaces the old one, whose code then
 * joins no one.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  APP_URL,
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('invite-link-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let inviteLink: typeof import('./route');
let join: typeof import('@/app/api/join/[code]/route');

beforeAll(async () => {
  await connectSignedIn(db);
  inviteLink = await import('./route');
  join = await import('@/app/api/join/[code]/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's trip, with Alex as its admin and Sam as a member. Priya is not in it. */
async function coorgWeekend() {
  const created = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

function makeLink(groupId: string, cookie: string) {
  return callRoute(inviteLink.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/invite-link`,
    params: { id: groupId },
    cookie,
    body: {},
  });
}

function readLink(groupId: string, cookie: string) {
  return callRoute(inviteLink.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/invite-link`,
    params: { id: groupId },
    cookie,
  });
}

describe('POST and GET /api/groups/[id]/invite-link', () => {
  it('lets Sam make a link that every member then reads', async () => {
    const groupId = await coorgWeekend();

    const made = await makeLink(groupId, await signIn('sam'));

    expect(made.status).toBe(201);
    const { inviteCode, inviteUrl } = made.body.data;
    expect(inviteCode).toMatch(/^[0-9a-f]{8}$/);
    expect(inviteUrl).toBe(`${APP_URL}/join/${inviteCode}`);
    const read = await readLink(groupId, await signIn('alex'));
    expect(read.body.data).toMatchObject({ inviteCode, inviteUrl });
  });

  it('replaces the old link, whose code then joins no one', async () => {
    const groupId = await coorgWeekend();
    const alexCookie = await signIn('alex');
    const first = (await makeLink(groupId, alexCookie)).body.data.inviteCode;

    const second = (await makeLink(groupId, alexCookie)).body.data.inviteCode;

    expect(second).not.toBe(first);
    expect((await readLink(groupId, alexCookie)).body.data.inviteCode).toBe(second);
    const joined = await callRoute(join.POST, {
      method: 'POST',
      path: `/api/join/${first}`,
      params: { code: first },
      cookie: await signIn('priya'),
    });
    expect(joined.status).toBe(404);
  });

  it('shows no link before anyone makes one', async () => {
    const groupId = await coorgWeekend();

    const read = await readLink(groupId, await signIn('sam'));

    expect(read).toEqual({
      status: 200,
      body: { data: { inviteCode: null, inviteUrl: null, expiresAt: null }, status: 200 },
    });
  });

  it('refuses someone who is not in the Group, to make or to read the link', async () => {
    const groupId = await coorgWeekend();
    const priyaCookie = await signIn('priya');

    const made = await makeLink(groupId, priyaCookie);
    const read = await readLink(groupId, priyaCookie);

    const forbidden = { status: 403, body: { error: 'Forbidden', status: 403 } };
    expect([made, read]).toEqual([forbidden, forbidden]);
  });
});
