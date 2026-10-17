/**
 * HTTP tests for inviting someone to a Group by email (#472) against a real, isolated MongoDB
 * database (`splitbook-test-group-invite-route`), with a real session (`signed-in-route.ts`).
 *
 * Any member may invite; the invitation waits in the invited person's pending invitations.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONAS, DEMO_PERSONA_IDS } from '@/lib/demo-personas';
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

const db = integrationTestDb('group-invite-route');
const { alex, sam } = DEMO_PERSONA_IDS;
const PRIYA_EMAIL = DEMO_PERSONAS.find((persona) => persona.key === 'priya')!.email;

let invite: typeof import('./route');
let invitations: typeof import('@/app/api/invitations/route');

beforeAll(async () => {
  await connectSignedIn(db);
  invite = await import('./route');
  invitations = await import('@/app/api/invitations/route');
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

function inviteByEmail(groupId: string, cookie: string, email: string) {
  return callRoute(invite.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/invite`,
    params: { id: groupId },
    cookie,
    body: { email },
  });
}

async function priyasPendingGroups() {
  const pending = await callRoute(invitations.GET, {
    method: 'GET',
    path: '/api/invitations',
    cookie: await signIn('priya'),
  });
  expect(pending.status).toBe(200);
  return pending.body.data.map((invitation: { group: { name: string } }) => invitation.group.name);
}

describe('POST /api/groups/[id]/invite', () => {
  it('lets a member invite Priya, whose pending invitations then hold it', async () => {
    const groupId = await coorgWeekend();

    const invited = await inviteByEmail(groupId, await signIn('sam'), PRIYA_EMAIL);

    expect(invited.status).toBe(201);
    expect(invited.body.data).toMatchObject({
      group: { _id: groupId, name: 'Coorg Weekend' },
      invitedEmail: PRIYA_EMAIL,
      status: 'pending',
    });
    expect(await priyasPendingGroups()).toEqual(['Coorg Weekend']);
  });

  it('does not invite the same address twice while the first invitation is pending', async () => {
    const groupId = await coorgWeekend();
    await inviteByEmail(groupId, await signIn('sam'), PRIYA_EMAIL);

    const again = await inviteByEmail(groupId, await signIn('alex'), 'Priya.Demo@splitbook.local');

    expect(again).toEqual({
      status: 409,
      body: { error: 'This person has already been invited', status: 409 },
    });
    expect(await priyasPendingGroups()).toEqual(['Coorg Weekend']);
  });

  it('refuses an invitation from someone who is not in the Group', async () => {
    const groupId = await coorgWeekend();

    const refused = await inviteByEmail(groupId, await signIn('priya'), PRIYA_EMAIL);

    expect(refused).toEqual({ status: 403, body: { error: 'Forbidden', status: 403 } });
    expect(await priyasPendingGroups()).toEqual([]);
  });

  it('refuses an address that is not an email', async () => {
    const groupId = await coorgWeekend();

    const refused = await inviteByEmail(groupId, await signIn('sam'), 'priya at splitbook');

    expect(refused).toEqual({ status: 422, body: { error: 'Invalid email address', status: 422 } });
  });
});
