/**
 * HTTP tests for reviewing Drafts before they are saved (#473) against a real, isolated MongoDB
 * database (`splitbook-test-drafts-review-route`), with a real session (`signed-in-route.ts`).
 *
 * A review names every missing fact and every possible duplicate (ADR 0008); it never fills a
 * fact in or saves anything.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Group from '@/lib/models/Group';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { expenseService } from '@/lib/services/expense.service';
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

const db = integrationTestDb('drafts-review-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let review: typeof import('./route');
let drafts: typeof import('../route');

beforeAll(async () => {
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await connectSignedIn(db);
  await requireReplicaSet();
  review = await import('./route');
  drafts = await import('../route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's and Sam's trip with an empty ledger. */
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

/** A ₹1,000.00 dinner on 10 October that Sam paid for, split equally with Alex. */
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

/** Sam keeps one Draft with these values; returns its id. */
async function samKeeps(groupId: string, samCookie: string, values: object): Promise<string> {
  const created = await callRoute(drafts.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts`,
    params: { id: groupId },
    cookie: samCookie,
    body: { drafts: [values] },
    headers: { 'Idempotency-Key': 'draft-sam-0001' },
  });
  expect(created.status).toBe(201);
  return created.body.data[0].id;
}

function reviewDrafts(groupId: string, cookie: string, ids: string[]) {
  return callRoute(review.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts/review`,
    params: { id: groupId },
    cookie,
    body: { ids },
  });
}

describe('POST /api/groups/[id]/drafts/review', () => {
  it('finds nothing to fix in a complete Draft', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const samCookie = await signIn('sam');
    const draftId = await samKeeps(groupId, samCookie, samsDinner(foodTagId));

    const reviewed = await reviewDrafts(groupId, samCookie, [draftId]);

    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data).toEqual([
      expect.objectContaining({
        draft: expect.objectContaining({ id: draftId, revision: 0 }),
        review: expect.any(String),
        problems: [],
        duplicates: [],
      }),
    ]);
  });

  it('names each missing fact of an incomplete Draft without filling any in', async () => {
    const { groupId } = await emptyTrip();
    const samCookie = await signIn('sam');
    const draftId = await samKeeps(groupId, samCookie, { description: 'Taxi', amount: 450 });

    const reviewed = await reviewDrafts(groupId, samCookie, [draftId]);

    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data[0].problems).toEqual([
      'currency: Choose a currency.',
      'date: Choose the Expense date.',
      'paidBy: Choose who paid.',
      'splitMethod: Choose a split method.',
      'splitBetween: Choose who shared this Expense.',
      'tagId: Choose a Tag.',
    ]);
    expect(reviewed.body.data[0].draft.values).toEqual({ description: 'Taxi', amount: 450 });
  });

  it('warns that a Draft looks like an Expense already in the ledger', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const saved = await expenseService.create(
      groupId,
      {
        description: 'Dinner',
        amount: 1000,
        currency: 'INR',
        category: 'food',
        tag: 'Food',
        date: new Date('2026-10-10T12:00:00.000Z'),
        paidBy: [{ user: sam, amount: 1000 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
      sam,
    );
    const samCookie = await signIn('sam');
    const draftId = await samKeeps(groupId, samCookie, samsDinner(foodTagId));

    const reviewed = await reviewDrafts(groupId, samCookie, [draftId]);

    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data[0].duplicates).toEqual([
      { kind: 'expense', id: String(saved._id), description: 'Dinner' },
    ]);
  });

  it('names the share left out of an exact split at its row, not the amount (#497)', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const samCookie = await signIn('sam');
    // An assistant can keep a Draft whose split has a share nobody entered.
    const draftId = await samKeeps(groupId, samCookie, {
      ...samsDinner(foodTagId),
      splitMethod: 'exact',
      splitBetween: [{ user: alex }, { user: sam, amount: 500 }],
    });

    const reviewed = await reviewDrafts(groupId, samCookie, [draftId]);

    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data[0].problems).toEqual([
      'splitBetween.0.amount: Enter an amount for each person in the split',
    ]);
  });

  it('lists a present amount as wrong, not missing, when the split does not add up (#506)', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const samCookie = await signIn('sam');
    // ₹1,000 split 300 / 300: the amount is there, the split is short by ₹400.
    const draftId = await samKeeps(groupId, samCookie, {
      ...samsDinner(foodTagId),
      splitMethod: 'exact',
      splitBetween: [
        { user: alex, amount: 300 },
        { user: sam, amount: 300 },
      ],
    });

    const reviewed = await reviewDrafts(groupId, samCookie, [draftId]);

    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data[0].problems).toEqual([
      'amount: Split amounts must add up to the expense amount',
    ]);
    expect(reviewed.body.data[0].draft.missingFields).toEqual([]);
  });

  it('does not let Alex review the Draft Sam keeps', async () => {
    const { groupId, foodTagId } = await emptyTrip();
    const draftId = await samKeeps(groupId, await signIn('sam'), samsDinner(foodTagId));

    const refused = await reviewDrafts(groupId, await signIn('alex'), [draftId]);

    expect(refused).toEqual({
      status: 404,
      body: { error: 'Draft not found', status: 404, code: 'DRAFT_NOT_FOUND' },
    });
  });
});
