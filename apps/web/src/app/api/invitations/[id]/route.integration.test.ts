/**
 * HTTP tests for answering an email invitation (#472) against a real, isolated MongoDB database
 * (`splitbook-test-invitation-answer-route`), with a real session (`signed-in-route.ts`).
 *
 * Only the person invited can answer: accepting makes them a member, declining leaves them
 * outside, and an invitation is answered once, before it expires.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Invitation from '@/lib/models/Invitation';
import { DEMO_PERSONAS, DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { invitationService } from '@/lib/services/invitation.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('invitation-answer-route');
const { alex } = DEMO_PERSONA_IDS;

let answer: typeof import('./route');
let group: typeof import('@/app/api/groups/[id]/route');

beforeAll(async () => {
  await connectSignedIn(db);
  answer = await import('./route');
  group = await import('@/app/api/groups/[id]/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's trip, and Alex's pending email invitation to Priya. */
async function priyaInvitedToCoorgWeekend() {
  const created = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  const priya = DEMO_PERSONAS.find((persona) => persona.key === 'priya')!;
  const invitation = await invitationService.create(groupId, priya.email, alex);
  return { groupId, invitationId: String(invitation._id) };
}

function answerInvitation(invitationId: string, cookie: string, action: 'accept' | 'decline') {
  return callRoute(answer.POST, {
    method: 'POST',
    path: `/api/invitations/${invitationId}`,
    params: { id: invitationId },
    cookie,
    body: { action },
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

describe('POST /api/invitations/[id]', () => {
  it('makes Priya a member when Priya accepts', async () => {
    const { groupId, invitationId } = await priyaInvitedToCoorgWeekend();
    expect(await groupStatusFor(groupId, 'priya')).toBe(403);

    const accepted = await answerInvitation(invitationId, await signIn('priya'), 'accept');

    expect(accepted).toEqual({
      status: 200,
      body: { data: { message: 'Invitation accepted' }, status: 200 },
    });
    expect(await groupStatusFor(groupId, 'priya')).toBe(200);
  });

  it('leaves Priya outside the Group when Priya declines', async () => {
    const { groupId, invitationId } = await priyaInvitedToCoorgWeekend();

    const declined = await answerInvitation(invitationId, await signIn('priya'), 'decline');

    expect(declined).toEqual({
      status: 200,
      body: { data: { message: 'Invitation declined' }, status: 200 },
    });
    expect(await groupStatusFor(groupId, 'priya')).toBe(403);
  });

  it('does not let Sam answer the invitation sent to Priya', async () => {
    const { groupId, invitationId } = await priyaInvitedToCoorgWeekend();

    const refused = await answerInvitation(invitationId, await signIn('sam'), 'accept');

    expect(refused).toEqual({ status: 404, body: { error: 'Invitation not found', status: 404 } });
    expect(await groupStatusFor(groupId, 'sam')).toBe(403);
    const stored = await Invitation.findById(invitationId).lean();
    expect(stored?.status).toBe('pending');
  });

  it('answers an invitation once', async () => {
    const { groupId, invitationId } = await priyaInvitedToCoorgWeekend();
    const priyaCookie = await signIn('priya');
    await answerInvitation(invitationId, priyaCookie, 'decline');

    const again = await answerInvitation(invitationId, priyaCookie, 'accept');

    expect(again).toEqual({
      status: 400,
      body: { error: 'Invitation is no longer pending', status: 400 },
    });
    expect(await groupStatusFor(groupId, 'priya')).toBe(403);
  });

  it('refuses an invitation that has expired', async () => {
    const { groupId, invitationId } = await priyaInvitedToCoorgWeekend();
    await Invitation.updateOne(
      { _id: invitationId },
      { $set: { expiresAt: new Date('2026-01-01T00:00:00.000Z') } },
    );

    const expired = await answerInvitation(invitationId, await signIn('priya'), 'accept');

    expect(expired).toEqual({
      status: 410,
      body: { error: 'Invitation has expired', status: 410 },
    });
    expect(await groupStatusFor(groupId, 'priya')).toBe(403);
  });
});
