/**
 * HTTP tests for creating a Tag (#472) against a real, isolated MongoDB database
 * (`splitbook-test-group-tags-route`), with a real session (`signed-in-route.ts`).
 *
 * ADR 0009: only an admin manages Tags, a name is unique in its Group whatever its case, and a
 * retried request creates the Tag once. The route answers with the Group.
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

const db = integrationTestDb('group-tags-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let tags: typeof import('./route');

beforeAll(async () => {
  await connectSignedIn(db);
  // Tag changes use transactions (ADR 0009).
  await requireReplicaSet();
  tags = await import('./route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's trip of Alex (admin) and Sam, with a trip's default Tags. */
async function coorgWeekend() {
  const created = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

function createTag(groupId: string, cookie: string, body: object) {
  return callRoute(tags.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/tags`,
    params: { id: groupId },
    cookie,
    body,
  });
}

interface StoredTag {
  _id: string;
  name: string;
  isArchived: boolean;
}

async function tagNames(groupId: string) {
  const stored = await groupService.getById(groupId);
  return (stored!.tags as unknown as StoredTag[]).map((tag) => tag.name);
}

const TRIP_TAGS = ['General', 'Food', 'Transport', 'Stay', 'Activities'];

describe('POST /api/groups/[id]/tags', () => {
  it('lets Alex, the admin, add a Tag once, however often the request is retried', async () => {
    const groupId = await coorgWeekend();
    const alexCookie = await signIn('alex');
    const request = { requestId: '7b0b0e43-6d61-4d55-9c43-1f4c3a2b9e01', name: 'Snacks' };

    const created = await createTag(groupId, alexCookie, request);
    const retried = await createTag(groupId, alexCookie, request);

    expect([created.status, retried.status]).toEqual([200, 200]);
    const snacks = (created.body.data.tags as StoredTag[]).find((tag) => tag.name === 'Snacks');
    expect(snacks).toMatchObject({ name: 'Snacks', isArchived: false });
    expect(await tagNames(groupId)).toEqual([...TRIP_TAGS, 'Snacks']);
  });

  it('refuses a member who is not an admin', async () => {
    const groupId = await coorgWeekend();

    const refused = await createTag(groupId, await signIn('sam'), {
      requestId: '7b0b0e43-6d61-4d55-9c43-1f4c3a2b9e02',
      name: 'Snacks',
    });

    expect(refused.status).toBe(403);
    // The refusal carries the current Tags, marked as ones Sam cannot manage.
    expect(refused.body).toMatchObject({
      error: 'Only Group admins can manage Tags.',
      code: 'TAG_ADMIN_REQUIRED',
      snapshot: { canManage: false },
    });
    expect(await tagNames(groupId)).toEqual(TRIP_TAGS);
  });

  it('refuses a name the Group already has, whatever its case', async () => {
    const groupId = await coorgWeekend();
    const stored = await groupService.getById(groupId);
    const food = (stored!.tags as unknown as StoredTag[]).find((tag) => tag.name === 'Food')!;

    const refused = await createTag(groupId, await signIn('alex'), {
      requestId: '7b0b0e43-6d61-4d55-9c43-1f4c3a2b9e03',
      name: 'food',
    });

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: 'A Tag with this name already exists. Archived Tags can be restored.',
      code: 'TAG_EXISTS',
      existingTagId: String(food._id),
    });
    expect(await tagNames(groupId)).toEqual(TRIP_TAGS);
  });

  it('asks for a request identity before it changes anything', async () => {
    const groupId = await coorgWeekend();

    const refused = await createTag(groupId, await signIn('alex'), { name: 'Snacks' });

    expect(refused).toEqual({
      status: 428,
      body: {
        error: 'Reload Tag management before making this change.',
        status: 428,
        code: 'TAG_PRECONDITION_REQUIRED',
      },
    });
    expect(await tagNames(groupId)).toEqual(TRIP_TAGS);
  });
});
