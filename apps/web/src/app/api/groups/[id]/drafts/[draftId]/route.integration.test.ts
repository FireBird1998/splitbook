/**
 * HTTP tests for editing and discarding one Draft (#473) against a real, isolated MongoDB
 * database (`splitbook-test-draft-item-route`), with a real session (`signed-in-route.ts`).
 *
 * An edit names the revision it was based on, so an edit based on an old version fails rather
 * than overwrite a newer one, and discard is permanent (ADR 0008).
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

const db = integrationTestDb('draft-item-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let draft: typeof import('./route');
let drafts: typeof import('../route');

beforeAll(async () => {
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await connectSignedIn(db);
  await requireReplicaSet();
  draft = await import('./route');
  drafts = await import('../route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's and Sam's trip, where Sam keeps an unfinished Draft of a ₹450.00 taxi. */
async function tripWithSamsTaxi(samCookie: string) {
  const group = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  const created = await callRoute(drafts.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts`,
    params: { id: groupId },
    cookie: samCookie,
    body: { drafts: [{ description: 'Taxi', amount: 450 }] },
    headers: { 'Idempotency-Key': 'draft-sam-taxi-0001' },
  });
  expect(created.status).toBe(201);
  return { groupId, draftId: created.body.data[0].id as string };
}

function editDraft(
  groupId: string,
  draftId: string,
  cookie: string,
  values: object,
  revision: number,
) {
  return callRoute(draft.PUT, {
    method: 'PUT',
    path: `/api/groups/${groupId}/drafts/${draftId}`,
    params: { id: groupId, draftId },
    cookie,
    body: { values },
    headers: { 'X-Splitbook-Revision': String(revision) },
  });
}

async function samsDrafts(groupId: string, samCookie: string) {
  const listed = await callRoute(drafts.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/drafts`,
    params: { id: groupId },
    cookie: samCookie,
  });
  return listed.body.data as { id: string; revision: number; values: object }[];
}

describe('PUT /api/groups/[id]/drafts/[draftId]', () => {
  it('replaces the Draft when the edit is based on the revision Sam last saw', async () => {
    const samCookie = await signIn('sam');
    const { groupId, draftId } = await tripWithSamsTaxi(samCookie);

    const edited = await editDraft(
      groupId,
      draftId,
      samCookie,
      { description: 'Airport taxi', amount: 650 },
      0,
    );

    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({
      id: draftId,
      revision: 1,
      values: { description: 'Airport taxi', amount: 650 },
    });
    expect(await samsDrafts(groupId, samCookie)).toMatchObject([
      { id: draftId, revision: 1, values: { description: 'Airport taxi', amount: 650 } },
    ]);
  });

  it('refuses an edit based on an older revision and keeps the newer one', async () => {
    const samCookie = await signIn('sam');
    const { groupId, draftId } = await tripWithSamsTaxi(samCookie);
    const edit = (description: string) =>
      editDraft(groupId, draftId, samCookie, { description, amount: 450 }, 0);
    expect((await edit('Taxi to the falls')).status).toBe(200);

    const stale = await edit('Taxi back');

    expect(stale).toEqual({
      status: 409,
      body: {
        error:
          'This record changed while you were editing. Reload the latest version before saving.',
        status: 409,
        code: 'STALE_REVISION',
      },
    });
    expect(await samsDrafts(groupId, samCookie)).toMatchObject([
      { revision: 1, values: { description: 'Taxi to the falls', amount: 450 } },
    ]);
  });

  it('does not let Alex edit the Draft Sam keeps', async () => {
    const samCookie = await signIn('sam');
    const { groupId, draftId } = await tripWithSamsTaxi(samCookie);

    const refused = await editDraft(
      groupId,
      draftId,
      await signIn('alex'),
      { description: 'Not my taxi', amount: 1 },
      0,
    );

    expect(refused).toEqual({
      status: 404,
      body: { error: 'Draft not found', status: 404, code: 'DRAFT_NOT_FOUND' },
    });
    expect(await samsDrafts(groupId, samCookie)).toMatchObject([
      { revision: 0, values: { description: 'Taxi', amount: 450 } },
    ]);
  });
});

describe('DELETE /api/groups/[id]/drafts/[draftId]', () => {
  it('discards the Draft for good: it leaves the list and cannot be edited back', async () => {
    const samCookie = await signIn('sam');
    const { groupId, draftId } = await tripWithSamsTaxi(samCookie);

    const discarded = await callRoute(draft.DELETE, {
      method: 'DELETE',
      path: `/api/groups/${groupId}/drafts/${draftId}`,
      params: { id: groupId, draftId },
      cookie: samCookie,
      headers: { 'X-Splitbook-Revision': '0' },
    });

    expect(discarded.status).toBe(200);
    expect(discarded.body.data).toMatchObject({ id: draftId, state: 'discarded', revision: 1 });
    expect(await samsDrafts(groupId, samCookie)).toEqual([]);
    const revived = await editDraft(
      groupId,
      draftId,
      samCookie,
      { description: 'Taxi', amount: 450 },
      1,
    );
    expect(revived).toEqual({
      status: 404,
      body: { error: 'Draft not found', status: 404, code: 'DRAFT_NOT_FOUND' },
    });
  });
});
