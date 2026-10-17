/**
 * HTTP tests for saving reviewed Drafts as Expenses (#473) against a real, isolated MongoDB
 * database (`splitbook-test-drafts-save-route`), with a real session (`signed-in-route.ts`).
 *
 * A Draft stays out of the ledger until the member who keeps it saves it (ADR 0008), and a
 * save whose reply never arrived is retried with the same reviewed command and recorded once.
 * The ledger is read back through the balances route.
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

const db = integrationTestDb('drafts-save-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let save: typeof import('./route');
let review: typeof import('../review/route');
let drafts: typeof import('../route');
let balances: typeof import('../../balances/route');

beforeAll(async () => {
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await connectSignedIn(db);
  await requireReplicaSet();
  save = await import('./route');
  review = await import('../review/route');
  drafts = await import('../route');
  balances = await import('../../balances/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/**
 * Alex's and Sam's trip with an empty ledger, where Sam keeps a complete Draft of a ₹1,000.00
 * dinner Sam paid for, split equally with Alex, and has reviewed it.
 */
async function tripWithSamsReviewedDinner(samCookie: string) {
  const group = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  const stored = await Group.findById(groupId).lean();
  const food = stored!.tags.find((tag) => tag.name === 'Food')!;
  const created = await callRoute(drafts.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts`,
    params: { id: groupId },
    cookie: samCookie,
    body: {
      drafts: [
        {
          description: 'Dinner',
          category: 'food',
          amount: 1000,
          currency: 'INR',
          date: '2026-10-10',
          tagId: String(food._id),
          paidBy: [{ user: sam, amount: 1000 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alex }, { user: sam }],
        },
      ],
    },
    headers: { 'Idempotency-Key': 'draft-sam-dinner-0001' },
  });
  expect(created.status).toBe(201);
  const draftId: string = created.body.data[0].id;
  const reviewed = await callRoute(review.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts/review`,
    params: { id: groupId },
    cookie: samCookie,
    body: { ids: [draftId] },
  });
  expect(reviewed.body.data).toMatchObject([{ problems: [], duplicates: [] }]);
  const saveCommand = {
    drafts: [{ id: draftId, revision: 0, review: reviewed.body.data[0].review as string }],
  };
  return { groupId, draftId, saveCommand };
}

function saveDrafts(groupId: string, cookie: string, command: object) {
  return callRoute(save.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts/save`,
    params: { id: groupId },
    cookie,
    body: command,
  });
}

async function debts(groupId: string, cookie: string) {
  const { status, body } = await callRoute(balances.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/balances`,
    params: { id: groupId },
    cookie,
  });
  expect(status).toBe(200);
  return body.data.debts.map(
    (debt: { from: { _id: string }; to: { _id: string }; amount: number }) => ({
      from: debt.from._id,
      to: debt.to._id,
      amount: debt.amount,
    }),
  );
}

describe('POST /api/groups/[id]/drafts/save', () => {
  it('changes the ledger only when Sam saves the Draft', async () => {
    const samCookie = await signIn('sam');
    const alexCookie = await signIn('alex');
    const { groupId, draftId, saveCommand } = await tripWithSamsReviewedDinner(samCookie);
    expect(await debts(groupId, alexCookie)).toEqual([]);

    const saved = await saveDrafts(groupId, samCookie, saveCommand);

    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual([
      { id: draftId, status: 'saved', expenseId: expect.any(String) },
    ]);
    expect(await debts(groupId, alexCookie)).toEqual([{ from: alex, to: sam, amount: 500 }]);
    const waiting = await callRoute(drafts.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}/drafts`,
      params: { id: groupId },
      cookie: samCookie,
    });
    expect(waiting.body.data).toEqual([]);
  });

  it('records the Expense once when a save whose reply was lost is retried', async () => {
    const samCookie = await signIn('sam');
    const { groupId, saveCommand } = await tripWithSamsReviewedDinner(samCookie);
    // The first reply never reaches Sam, so the save is Unconfirmed and Sam retries it as sent.
    const unconfirmed = await saveDrafts(groupId, samCookie, saveCommand);

    const retried = await saveDrafts(groupId, samCookie, saveCommand);

    expect(retried).toEqual(unconfirmed);
    expect(await debts(groupId, samCookie)).toEqual([{ from: alex, to: sam, amount: 500 }]);
  });

  it('does not let Alex save the Draft Sam keeps', async () => {
    const samCookie = await signIn('sam');
    const alexCookie = await signIn('alex');
    const { groupId, draftId, saveCommand } = await tripWithSamsReviewedDinner(samCookie);

    const refused = await saveDrafts(groupId, alexCookie, saveCommand);

    expect(refused.status).toBe(200);
    expect(refused.body.data).toEqual([
      { id: draftId, status: 'failed', message: 'DRAFT_NOT_FOUND' },
    ]);
    expect(await debts(groupId, alexCookie)).toEqual([]);
  });
});
