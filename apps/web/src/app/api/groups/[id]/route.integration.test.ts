/**
 * HTTP tests for one Group: reading, changing and archiving it (#472), against a real, isolated
 * MongoDB database (`splitbook-test-group-item-route`), with a real session
 * (`signed-in-route.ts`).
 *
 * Members read a Group and only its admin changes or archives it. Deletion follows ADR 0007:
 * a confirmed final-member leave removes the Group, and once its deletion is claimed every
 * Group write is refused, so a late writer cannot change a Group that is being removed.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Group from '@/lib/models/Group';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  requireReplicaSet,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
// Leaving schedules the removal of a Group whose deletion is pending with after() (ADR 0007).
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);

const db = integrationTestDb('group-item-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let group: typeof import('./route');
let leave: typeof import('./leave/route');

beforeAll(async () => {
  await connectSignedIn(db);
  // Deletion claims need transactions (ADR 0007).
  await requireReplicaSet();
  group = await import('./route');
  leave = await import('./leave/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's trip, with Alex as its admin and Sam as a member. */
async function coorgWeekend() {
  const created = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

function readGroup(groupId: string, cookie: string) {
  return callRoute(group.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}`,
    params: { id: groupId },
    cookie,
  });
}

function changeGroup(groupId: string, cookie: string, body: object) {
  return callRoute(group.PATCH, {
    method: 'PATCH',
    path: `/api/groups/${groupId}`,
    params: { id: groupId },
    cookie,
    body,
  });
}

function archiveGroup(groupId: string, cookie: string) {
  return callRoute(group.DELETE, {
    method: 'DELETE',
    path: `/api/groups/${groupId}`,
    params: { id: groupId },
    cookie,
  });
}

const forbidden = { status: 403, body: { error: 'Forbidden', status: 403 } };

describe('GET /api/groups/[id]', () => {
  it('shows the Group to its members and refuses anyone else', async () => {
    const groupId = await coorgWeekend();

    const read = await readGroup(groupId, await signIn('sam'));
    const refused = await readGroup(groupId, await signIn('priya'));

    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ _id: groupId, name: 'Coorg Weekend' });
    expect(refused).toEqual(forbidden);
  });
});

describe('PATCH /api/groups/[id]', () => {
  it('lets the admin rename the Group and refuses a member who is not the admin', async () => {
    const groupId = await coorgWeekend();

    const renamed = await changeGroup(groupId, await signIn('alex'), {
      name: 'Coorg Long Weekend',
    });
    const refused = await changeGroup(groupId, await signIn('sam'), { name: 'Sam’s Weekend' });

    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ name: 'Coorg Long Weekend' });
    expect(refused).toEqual(forbidden);
    const read = await readGroup(groupId, await signIn('sam'));
    expect(read.body.data.name).toBe('Coorg Long Weekend');
  });
});

describe('DELETE /api/groups/[id]', () => {
  it('lets the admin archive the Group and refuses a member who is not the admin', async () => {
    const groupId = await coorgWeekend();

    const refused = await archiveGroup(groupId, await signIn('sam'));
    const archived = await archiveGroup(groupId, await signIn('alex'));

    expect(refused).toEqual(forbidden);
    expect(archived).toEqual({
      status: 200,
      body: { data: { message: 'Group archived' }, status: 200 },
    });
    const read = await readGroup(groupId, await signIn('alex'));
    expect(read.body.data).toMatchObject({ name: 'Coorg Weekend', isArchived: true });
  });
});

describe('Group deletion (ADR 0007)', () => {
  it('refuses to change or archive a Group whose deletion another server has claimed', async () => {
    const groupId = await coorgWeekend();
    await Group.updateOne({ _id: groupId }, { $set: { deletionRequestedAt: new Date() } });
    const alexCookie = await signIn('alex');

    const renamed = await changeGroup(groupId, alexCookie, { name: 'Late rename' });
    const archived = await archiveGroup(groupId, alexCookie);

    expect([renamed, archived]).toEqual([forbidden, forbidden]);
    const stored = await Group.findById(groupId).lean();
    expect([stored?.name, stored?.isArchived]).toEqual(['Coorg Weekend', false]);
  });

  it('removes the Group once its last member leaves and confirms the deletion', async () => {
    const created = await groupService.create(
      { name: 'Solo Trek', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
      alex,
    );
    const groupId = String(created._id);
    const alexCookie = await signIn('alex');

    const left = await callRoute(leave.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/leave`,
      params: { id: groupId },
      cookie: alexCookie,
      body: { deleteIfLastMember: true },
    });

    expect(left.status).toBe(200);
    expect(await readGroup(groupId, alexCookie)).toEqual({
      status: 404,
      body: { error: 'Group not found', status: 404 },
    });
  });
});
