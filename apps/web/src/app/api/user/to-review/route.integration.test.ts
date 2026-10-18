/**
 * HTTP tests for To review, the member's Drafts across Groups (#473), against a real, isolated
 * MongoDB database (`splitbook-test-to-review-route`), with a real session
 * (`signed-in-route.ts`).
 *
 * To review is where Finish later leads: it lists only the signed-in member's own Drafts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

const db = integrationTestDb('to-review-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let toReview: typeof import('./route');
let drafts: typeof import('@/app/api/groups/[id]/drafts/route');

beforeAll(async () => {
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await connectSignedIn(db);
  await requireReplicaSet();
  toReview = await import('./route');
  drafts = await import('@/app/api/groups/[id]/drafts/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

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
  const created = await callRoute(drafts.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts`,
    params: { id: groupId },
    cookie: samCookie,
    body: { drafts: descriptions.map((description) => ({ description, amount: 450 })) },
    headers: { 'Idempotency-Key': `draft-sam-${descriptions.join('-').toLowerCase()}` },
  });
  expect(created.status).toBe(201);
  return created.body.data.map((draft: { id: string }) => draft.id) as string[];
}

function readToReview(cookie: string) {
  return callRoute(toReview.GET, { method: 'GET', path: '/api/user/to-review', cookie });
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
    // Created out of name order, so only the name puts Coorg Weekend first.
    const flat = await groupWithSam('Lakeview Flat', 'home');
    const trip = await groupWithSam('Coorg Weekend', 'trip');
    const flatDrafts = await samKeeps(flat, samCookie, 'Plumber');
    const tripDrafts = await samKeeps(trip, samCookie, 'Taxi', 'Ferry');

    const listed = await readToReview(samCookie);

    expect(listed.status).toBe(200);
    expect(summary(listed.body.data)).toEqual({
      total: 3,
      groups: [
        { groupId: trip, groupName: 'Coorg Weekend', count: 2, drafts: tripDrafts },
        { groupId: flat, groupName: 'Lakeview Flat', count: 1, drafts: flatDrafts },
      ],
    });
    // Each Group names its currency, which a Draft without one takes (#512).
    expect(listed.body.data.groups.map((group: { currency: string }) => group.currency)).toEqual([
      'INR',
      'INR',
    ]);
    // And its kind, which names its currency: the Trip currency (#596).
    expect(listed.body.data.groups.map((group: { category: string }) => group.category)).toEqual([
      'trip',
      'home',
    ]);
  });

  it('shows Alex none of the Drafts Sam keeps in Alex’s Group', async () => {
    const trip = await groupWithSam('Coorg Weekend', 'trip');
    await samKeeps(trip, await signIn('sam'), 'Taxi');

    const listed = await readToReview(await signIn('alex'));

    expect(listed).toEqual({ status: 200, body: { data: { groups: [], total: 0 }, status: 200 } });
  });

  it('refuses a request without a session', async () => {
    const listed = await readToReview('');

    expect(listed).toEqual({ status: 401, body: { error: 'Unauthorized', status: 401 } });
  });
});
