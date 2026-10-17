/**
 * HTTP tests for a member's Draft collection in a Group (#473) against a real, isolated MongoDB
 * database (`splitbook-test-drafts-route`), with a real session (`signed-in-route.ts`).
 *
 * A Draft is unfinished information (ADR 0008): it is private to the member who keeps it and
 * stays out of the ledger, which is read back through the balances route.
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

const db = integrationTestDb('drafts-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let drafts: typeof import('./route');
let balances: typeof import('../balances/route');

beforeAll(async () => {
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await connectSignedIn(db);
  await requireReplicaSet();
  drafts = await import('./route');
  balances = await import('../balances/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's and Sam's trip, with nothing in its ledger yet. */
async function emptyTrip() {
  const group = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  const stored = await Group.findById(groupId).lean();
  const food = stored!.tags.find((tag) => tag.name === 'Food')!;
  return { groupId, foodTagId: String(food._id) };
}

/** A complete Draft of a ₹1,000.00 dinner Sam paid for, split equally with Alex. */
function samsDinner(foodTagId: string) {
  return {
    description: 'Dinner',
    category: 'food',
    amount: 1000,
    currency: 'INR',
    date: '2026-10-10',
    tagId: foodTagId,
    paidBy: [{ user: sam, amount: 1000 }],
    splitMethod: 'equal',
    splitBetween: [{ user: alex }, { user: sam }],
  };
}

function keepDrafts(groupId: string, cookie: string, values: object[], key: string) {
  return callRoute(drafts.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts`,
    params: { id: groupId },
    cookie,
    body: { drafts: values },
    headers: { 'Idempotency-Key': key },
  });
}

function listDrafts(groupId: string, cookie: string) {
  return callRoute(drafts.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/drafts`,
    params: { id: groupId },
    cookie,
  });
}

describe('POST and GET /api/groups/[id]/drafts', () => {
  it('keeps a Draft for Sam alone and out of the ledger', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const samCookie = await signIn('sam');

    const created = await keepDrafts(
      groupId,
      samCookie,
      [samsDinner(foodTagId)],
      'draft-sam-dinner-0001',
    );

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject([
      { revision: 0, values: samsDinner(foodTagId), missingFields: [] },
    ]);
    expect((await listDrafts(groupId, samCookie)).body.data).toEqual(created.body.data);
    const alexCookie = await signIn('alex');
    expect(await listDrafts(groupId, alexCookie)).toEqual({
      status: 200,
      body: { data: [], status: 200 },
    });
    const ledger = await callRoute(balances.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}/balances`,
      params: { id: groupId },
      cookie: alexCookie,
    });
    expect(ledger.body.data).toMatchObject({ currency: 'INR', balances: [], debts: [] });
  });

  it('returns the original Draft when the same creation key is posted again', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const samCookie = await signIn('sam');
    const post = () =>
      keepDrafts(groupId, samCookie, [samsDinner(foodTagId)], 'draft-sam-dinner-0001');

    const first = await post();
    const retried = await post();

    expect([first.status, retried.status]).toEqual([201, 201]);
    expect(retried.body.data).toEqual(first.body.data);
    expect((await listDrafts(groupId, samCookie)).body.data).toHaveLength(1);
  });

  it('refuses a Draft from someone who is not in the Group', async () => {
    const { groupId, foodTagId } = await emptyTrip();

    const refused = await keepDrafts(
      groupId,
      await signIn('priya'),
      [samsDinner(foodTagId)],
      'draft-priya-dinner-0001',
    );

    expect(refused).toEqual({
      status: 403,
      body: { error: 'Forbidden', status: 403, code: 'FORBIDDEN' },
    });
    expect((await listDrafts(groupId, await signIn('sam'))).body.data).toEqual([]);
  });
});
