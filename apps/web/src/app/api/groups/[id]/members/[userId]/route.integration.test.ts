/**
 * HTTP tests for removing a member and changing a member's role (#472) against a real, isolated
 * MongoDB database (`splitbook-test-group-member-route`), with a real session
 * (`signed-in-route.ts`).
 *
 * Only an admin removes members or changes roles. An admin leaves through leave, not removal,
 * and the last admin cannot be made a member.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
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

const db = integrationTestDb('group-member-route');
const { alex, sam, priya } = DEMO_PERSONA_IDS;

let member: typeof import('./route');
let group: typeof import('../../route');

beforeAll(async () => {
  await connectSignedIn(db);
  member = await import('./route');
  group = await import('../../route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's trip, with Alex as its only admin and these people as members. */
async function coorgWeekend(...members: string[]) {
  const created = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  for (const user of members) await groupService.addMember(groupId, user);
  return groupId;
}

function removeMember(groupId: string, userId: string, cookie: string) {
  return callRoute(member.DELETE, {
    method: 'DELETE',
    path: `/api/groups/${groupId}/members/${userId}`,
    params: { id: groupId, userId },
    cookie,
  });
}

function changeRole(groupId: string, userId: string, cookie: string, role: 'admin' | 'member') {
  return callRoute(member.PATCH, {
    method: 'PATCH',
    path: `/api/groups/${groupId}/members/${userId}`,
    params: { id: groupId, userId },
    cookie,
    body: { role },
  });
}

async function readGroup(groupId: string, persona: DemoPersonaKey) {
  return callRoute(group.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}`,
    params: { id: groupId },
    cookie: await signIn(persona),
  });
}

/** Each member's role, as the Group reads for Alex. */
async function roles(groupId: string) {
  const read = await readGroup(groupId, 'alex');
  expect(read.status).toBe(200);
  return read.body.data.members.map((entry: { user: { _id: string }; role: string }) => ({
    user: entry.user._id,
    role: entry.role,
  }));
}

const forbidden = { status: 403, body: { error: 'Forbidden', status: 403 } };

describe('DELETE /api/groups/[id]/members/[userId]', () => {
  it('lets Alex, the admin, remove Sam, who then cannot read the Group', async () => {
    const groupId = await coorgWeekend(sam);

    const removed = await removeMember(groupId, sam, await signIn('alex'));

    expect(removed).toEqual({
      status: 200,
      body: { data: { message: 'Member removed' }, status: 200 },
    });
    expect(await roles(groupId)).toEqual([{ user: alex, role: 'admin' }]);
    expect((await readGroup(groupId, 'sam')).status).toBe(403);
  });

  it('refuses a member who is not an admin', async () => {
    const groupId = await coorgWeekend(sam, priya);

    const refused = await removeMember(groupId, priya, await signIn('sam'));

    expect(refused).toEqual(forbidden);
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
      { user: priya, role: 'member' },
    ]);
  });

  it('refuses someone who is not in the Group', async () => {
    const groupId = await coorgWeekend(sam);

    const refused = await removeMember(groupId, sam, await signIn('priya'));

    expect(refused).toEqual(forbidden);
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
    ]);
  });

  it('sends an admin who removes themselves to leave instead', async () => {
    const groupId = await coorgWeekend(sam);

    const refused = await removeMember(groupId, alex, await signIn('alex'));

    expect(refused).toEqual({
      status: 400,
      body: { error: 'You cannot remove yourself. Use leave group instead.', status: 400 },
    });
  });
});

describe('PATCH /api/groups/[id]/members/[userId]', () => {
  it('lets Alex make Sam an admin', async () => {
    const groupId = await coorgWeekend(sam);

    const promoted = await changeRole(groupId, sam, await signIn('alex'), 'admin');

    expect(promoted.status).toBe(200);
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'admin' },
    ]);
  });

  it('keeps the last admin an admin', async () => {
    const groupId = await coorgWeekend(sam);

    const refused = await changeRole(groupId, alex, await signIn('alex'), 'member');

    expect(refused).toEqual({
      status: 409,
      body: { error: 'Cannot demote the last admin. Promote another member first.', status: 409 },
    });
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
    ]);
  });

  it('refuses a role change from a member who is not an admin', async () => {
    const groupId = await coorgWeekend(sam);

    const refused = await changeRole(groupId, sam, await signIn('sam'), 'admin');

    expect(refused).toEqual(forbidden);
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
    ]);
  });
});
