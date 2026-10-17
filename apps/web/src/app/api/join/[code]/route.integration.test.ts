/**
 * HTTP tests for joining a Group by invite code (#472) against a real, isolated MongoDB database
 * (`splitbook-test-join-route`), with a real session (`signed-in-route.ts`).
 *
 * A signed-in person with a current code joins as a member; an expired code, or the code of an
 * archived Group, lets no one in. Anyone may preview the Group a code leads to.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Group from '@/lib/models/Group';
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

const db = integrationTestDb('join-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let join: typeof import('./route');
let group: typeof import('@/app/api/groups/[id]/route');

beforeAll(async () => {
  await connectSignedIn(db);
  join = await import('./route');
  group = await import('@/app/api/groups/[id]/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's trip of Alex and Sam, with a current invite code. Priya is not in it. */
async function coorgWeekendWithCode() {
  const created = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  const { inviteCode } = (await groupService.generateInviteCode(groupId, alex))!;
  return { groupId, code: inviteCode };
}

function joinWith(code: string, cookie: string) {
  return callRoute(join.POST, {
    method: 'POST',
    path: `/api/join/${code}`,
    params: { code },
    cookie,
  });
}

function preview(code: string) {
  return callRoute(join.GET, {
    method: 'GET',
    path: `/api/join/${code}`,
    params: { code },
    cookie: '',
  });
}

async function groupStatusFor(groupId: string, persona: DemoPersonaKey) {
  const read = await callRoute(group.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}`,
    params: { id: groupId },
    cookie: await signIn(persona),
  });
  return read.status;
}

const noSuchLink = {
  status: 404,
  body: { error: 'Invite link is invalid or expired not found', status: 404 },
};

describe('POST /api/join/[code]', () => {
  it('lets Priya join with a current code', async () => {
    const { groupId, code } = await coorgWeekendWithCode();

    const joined = await joinWith(code, await signIn('priya'));

    expect(joined).toEqual({
      status: 201,
      body: { data: { message: 'Joined group', groupId }, status: 201 },
    });
    expect(await groupStatusFor(groupId, 'priya')).toBe(200);
    expect((await preview(code)).body.data.memberCount).toBe(3);
  });

  it('adds no one when a member uses the code again', async () => {
    const { groupId, code } = await coorgWeekendWithCode();

    const again = await joinWith(code, await signIn('sam'));

    expect(again).toEqual({
      status: 200,
      body: { data: { message: 'Already a member', groupId }, status: 200 },
    });
    expect((await preview(code)).body.data.memberCount).toBe(2);
  });

  it('lets no one in with an expired code', async () => {
    const { groupId, code } = await coorgWeekendWithCode();
    await Group.updateOne(
      { _id: groupId },
      { $set: { inviteCodeExpiresAt: new Date('2026-01-01T00:00:00.000Z') } },
    );

    const refused = await joinWith(code, await signIn('priya'));

    expect(refused).toEqual(noSuchLink);
    expect(await groupStatusFor(groupId, 'priya')).toBe(403);
  });

  it('lets no one into an archived Group', async () => {
    const { groupId, code } = await coorgWeekendWithCode();
    await groupService.archive(groupId, alex);

    const refused = await joinWith(code, await signIn('priya'));

    expect(refused).toEqual(noSuchLink);
    expect(await groupStatusFor(groupId, 'priya')).toBe(403);
  });

  it('needs a session to join, though anyone may preview the Group', async () => {
    const { groupId, code } = await coorgWeekendWithCode();

    const refused = await joinWith(code, '');

    expect(refused).toEqual({ status: 401, body: { error: 'Unauthorized', status: 401 } });
    expect(await preview(code)).toEqual({
      status: 200,
      body: {
        data: { _id: groupId, name: 'Coorg Weekend', category: 'trip', memberCount: 2 },
        status: 200,
      },
    });
  });
});
