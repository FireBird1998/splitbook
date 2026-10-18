/**
 * Writes to an archived Group (#578, from #184), over HTTP with a real session
 * (`signed-in-route.ts`), against a real, isolated MongoDB replica set
 * (`splitbook-test-archived-group-writes`).
 *
 * Once an admin archives a Group, it takes no new Expense, edit, deletion, payment, To review
 * save or assistant preparation: each answers 409 GROUP_ARCHIVED and leaves the database as it
 * was. Reads are unchanged, and a save recorded before the archive is still confirmed on retry.
 */

import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Group from '@/lib/models/Group';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { withGroupMutation } from '@/lib/group-mutation';
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
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);

const db = integrationTestDb('archived-group-writes');
const { alex, sam } = DEMO_PERSONA_IDS;

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;
let routes: Record<string, Handler>;
let services: {
  group: typeof import('@/lib/services/group.service').groupService;
  expense: typeof import('@/lib/services/expense.service').expenseService;
  draft: typeof import('@/lib/services/expense-draft.service').expenseDraftService;
  settlement: typeof import('@/lib/services/settlement.service').settlementService;
};

beforeAll(async () => {
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await connectSignedIn(db);
  await requireReplicaSet();
  routes = {
    expenses: (await import('./expenses/route')).POST as Handler,
    expensePatch: (await import('./expenses/[expenseId]/route')).PATCH as Handler,
    expenseDelete: (await import('./expenses/[expenseId]/route')).DELETE as Handler,
    expenseRead: (await import('./expenses/[expenseId]/route')).GET as Handler,
    settlements: (await import('./settlements/route')).POST as Handler,
    review: (await import('./drafts/review/route')).POST as Handler,
    save: (await import('./drafts/save/route')).POST as Handler,
  };
  services = {
    group: (await import('@/lib/services/group.service')).groupService,
    expense: (await import('@/lib/services/expense.service')).expenseService,
    draft: (await import('@/lib/services/expense-draft.service')).expenseDraftService,
    settlement: (await import('@/lib/services/settlement.service')).settlementService,
  };
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** A taxi Sam paid for, a different expense from the dinner. */
const taxi = {
  description: 'Taxi',
  amount: 300,
  currency: 'INR',
  category: 'transport',
  date: '2026-10-11',
  tag: 'Transport',
  paidBy: [{ user: sam, amount: 300 }],
  splitMethod: 'equal',
  splitBetween: [{ user: alex }, { user: sam }],
};

const dinner = (payer: string) => ({
  description: 'Dinner',
  amount: 1000,
  currency: 'INR',
  category: 'food',
  date: '2026-10-10',
  tag: 'Food',
  paidBy: [{ user: payer, amount: 1000 }],
  splitMethod: 'equal',
  splitBetween: [{ user: alex }, { user: sam }],
});

/**
 * Alex's (admin) and Sam's trip with one ₹1,000.00 dinner and Sam's ₹200.00 payment to Alex,
 * archived by Alex after Sam kept a reviewed Draft of a ₹300.00 taxi. Sam is signed in.
 */
async function archivedTrip({ savedFirst = false } = {}) {
  const group = await services.group.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await services.group.addMember(groupId, sam);
  const expense = await services.expense.create(
    groupId,
    { ...dinner(alex), date: new Date('2026-10-10T00:00:00.000Z') } as never,
    alex,
    'dinner-before-archive',
  );
  const payment = await services.settlement.create(
    groupId,
    { paidTo: alex, amount: 200, currency: 'INR' },
    sam,
    'payment-before-archive',
  );
  const [draft] = await services.draft.create(
    { id: sam },
    groupId,
    { drafts: [taxi] },
    'draft-before-archive',
  );
  const cookie = await signIn('sam');
  const reviewed = await callRoute(routes.review, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts/review`,
    params: { id: groupId },
    cookie,
    body: { ids: [draft.id] },
  } as never);
  expect(reviewed.body.data).toMatchObject([{ problems: [], duplicates: [] }]);
  const save = { drafts: [{ id: draft.id, revision: 0, review: reviewed.body.data[0].review }] };
  const saved = savedFirst ? await saveItems(groupId, cookie, save) : undefined;
  await services.group.archive(groupId, alex);
  return {
    groupId,
    expenseId: String(expense._id),
    paymentId: String(payment._id),
    cookie,
    save,
    saved,
  };
}

function saveItems(groupId: string, cookie: string, body: object) {
  return callRoute(routes.save, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts/save`,
    params: { id: groupId },
    cookie,
    body,
  } as never);
}

/** Every document in the database, by collection, to show a refusal changed nothing. */
async function everything() {
  const database = mongoose.connection.db!;
  const names = (await database.listCollections().toArray()).map(({ name }) => name).sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await database.collection(name).find().toArray()]),
    ),
  );
}

/** The refusal every write to an archived Group answers. */
const archived = {
  status: 409,
  body: {
    error: 'This Group was archived, so nothing more can be saved in it.',
    code: 'GROUP_ARCHIVED',
    status: 409,
  },
};

describe('writes to an archived Group (#578)', () => {
  it('refuse a new Expense, and change nothing', async () => {
    const { groupId, cookie } = await archivedTrip();
    const before = await everything();

    const answer = await callRoute(routes.expenses, {
      method: 'POST',
      path: `/api/groups/${groupId}/expenses`,
      params: { id: groupId },
      cookie,
      body: dinner(sam),
      headers: { 'Idempotency-Key': 'dinner-after-archive' },
    } as never);

    expect(answer).toEqual(archived);
    expect(await everything()).toEqual(before);
  });

  it('refuse an edit of an Expense, and change nothing', async () => {
    const { groupId, expenseId, cookie } = await archivedTrip();
    const before = await everything();

    const answer = await callRoute(routes.expensePatch, {
      method: 'PATCH',
      path: `/api/groups/${groupId}/expenses/${expenseId}`,
      params: { id: groupId, expenseId },
      cookie,
      body: { description: 'Dinner at the lake' },
      headers: { 'X-Splitbook-Revision': '0' },
    } as never);

    expect(answer).toEqual(archived);
    expect(await everything()).toEqual(before);
  });

  it('refuse deleting an Expense, and change nothing', async () => {
    const { groupId, expenseId, cookie } = await archivedTrip();
    const before = await everything();

    const answer = await callRoute(routes.expenseDelete, {
      method: 'DELETE',
      path: `/api/groups/${groupId}/expenses/${expenseId}`,
      params: { id: groupId, expenseId },
      cookie,
      headers: { 'X-Splitbook-Revision': '0' },
    } as never);

    expect(answer).toEqual(archived);
    expect(await everything()).toEqual(before);
  });

  it('refuse a payment, and change nothing', async () => {
    const { groupId, cookie } = await archivedTrip();
    const before = await everything();

    const answer = await callRoute(routes.settlements, {
      method: 'POST',
      path: `/api/groups/${groupId}/settlements`,
      params: { id: groupId },
      cookie,
      body: { paidTo: alex, amount: 500, currency: 'INR' },
      headers: { 'Idempotency-Key': 'payment-after-archive' },
    } as never);

    expect(answer).toEqual(archived);
    expect(await everything()).toEqual(before);
  });

  it('refuse saving a reviewed To review item, and change nothing', async () => {
    const { groupId, cookie, save } = await archivedTrip();
    const before = await everything();

    const answer = await saveItems(groupId, cookie, save);

    expect(answer).toEqual(archived);
    expect(await everything()).toEqual(before);
  });

  it('refuse an assistant preparing or changing an item, and change nothing', async () => {
    const { groupId } = await archivedTrip();
    const assistant = { id: sam, assistant: { name: 'Claude' }, authorize: async () => {} };
    const [kept] = (await mongoose.connection
      .db!.collection('expensedrafts')
      .find()
      .toArray()) as Array<{ _id: unknown }>;
    const before = await everything();

    await expect(
      services.draft.create(assistant, groupId, { drafts: [taxi] }, 'assistant-after'),
    ).rejects.toThrow('GROUP_ARCHIVED');
    await expect(
      services.draft.replace(assistant, groupId, String(kept._id), { ...taxi, amount: 400 }, 0),
    ).rejects.toThrow('GROUP_ARCHIVED');
    expect(await everything()).toEqual(before);
  });

  it('still read, and confirm an Expense or payment recorded before the archive when retried', async () => {
    const { groupId, expenseId, paymentId, cookie } = await archivedTrip();
    const alexCookie = await signIn('alex');

    const read = await callRoute(routes.expenseRead, {
      method: 'GET',
      path: `/api/groups/${groupId}/expenses/${expenseId}`,
      params: { id: groupId, expenseId },
      cookie,
    } as never);
    const retried = await callRoute(routes.expenses, {
      method: 'POST',
      path: `/api/groups/${groupId}/expenses`,
      params: { id: groupId },
      cookie: alexCookie,
      body: dinner(alex),
      headers: { 'Idempotency-Key': 'dinner-before-archive' },
    } as never);

    const paid = await callRoute(routes.settlements, {
      method: 'POST',
      path: `/api/groups/${groupId}/settlements`,
      params: { id: groupId },
      cookie,
      body: { paidTo: alex, amount: 200, currency: 'INR' },
      headers: { 'Idempotency-Key': 'payment-before-archive' },
    } as never);

    expect([read.status, read.body.data.description]).toEqual([200, 'Dinner']);
    expect([retried.status, retried.body.data._id]).toEqual([201, expenseId]);
    expect([paid.status, paid.body.data._id]).toEqual([201, paymentId]);
  });
});

describe('a To review save recorded before the archive (#578)', () => {
  it('is still confirmed when it is retried', async () => {
    const { groupId, cookie, save, saved } = await archivedTrip({ savedFirst: true });

    const retried = await saveItems(groupId, cookie, save);

    expect(retried.status).toBe(200);
    expect(retried.body.data).toEqual(saved!.body.data);
    expect(retried.body.data).toMatchObject([{ status: 'saved' }]);
  });
});

describe('the Group fence a ledger write takes (#578)', () => {
  it('refuses an archived Group inside the write, so an archive that wins a race stops it', async () => {
    const group = await services.group.create(
      { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
      alex,
    );
    const groupId = String(group._id);
    // Archived after any check made before the write began.
    await Group.updateOne({ _id: groupId }, { $set: { isArchived: true } });
    let wrote = false;

    await expect(
      withGroupMutation(groupId, async () => (wrote = true), { ledger: true }),
    ).rejects.toThrow('GROUP_ARCHIVED');
    expect(wrote).toBe(false);
    // Anything else the Group records, such as its own Activity, still goes through.
    await withGroupMutation(groupId, async () => (wrote = true));
    expect(wrote).toBe(true);
  });
});
