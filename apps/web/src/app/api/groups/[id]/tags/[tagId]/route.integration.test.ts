/**
 * HTTP tests for renaming and deleting a Tag (#472) against a real, isolated MongoDB database
 * (`splitbook-test-group-tag-item-route`), with a real session (`signed-in-route.ts`).
 *
 * ADR 0009: a Tag keeps its identity when it is renamed, so a saved Expense still points at it;
 * an edit based on an older revision fails instead of overwriting a newer one; only an admin
 * manages Tags; and a Tag in use cannot be deleted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

const db = integrationTestDb('group-tag-item-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let tag: typeof import('./route');
let expense: typeof import('../../expenses/[expenseId]/route');

beforeAll(async () => {
  await connectSignedIn(db);
  // Tag changes use transactions (ADR 0009).
  await requireReplicaSet();
  tag = await import('./route');
  expense = await import('../../expenses/[expenseId]/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

interface StoredTag {
  _id: string;
  name: string;
  revision: number;
  isDeleted?: boolean;
}

/** A deleted Tag stays stored, marked deleted, so the names a member can pick leave it out. */
async function activeTagNames(groupId: string) {
  const stored = await groupService.getById(groupId);
  return (stored!.tags as unknown as StoredTag[])
    .filter((entry) => !entry.isDeleted)
    .map((entry) => entry.name);
}

async function tagsOf(groupId: string) {
  const stored = await groupService.getById(groupId);
  return (stored!.tags as unknown as StoredTag[]).map(({ _id, name, revision }) => ({
    id: String(_id),
    name,
    revision,
  }));
}

/** Alex's trip of Alex (admin) and Sam, with a ₹1,000.00 dinner saved under Food. */
async function coorgWeekendWithDinner() {
  const created = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  const dinner = await expenseService.create(
    groupId,
    {
      description: 'Dinner',
      amount: 1000,
      currency: 'INR',
      category: 'food',
      tag: 'Food',
      date: new Date('2026-10-10T12:00:00.000Z'),
      paidBy: [{ user: alex, amount: 1000 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }],
    },
    alex,
  );
  const tags = await tagsOf(groupId);
  const id = (name: string) => tags.find((entry) => entry.name === name)!.id;
  return { groupId, dinnerId: String(dinner._id), foodId: id('Food'), stayId: id('Stay') };
}

function renameTag(groupId: string, tagId: string, cookie: string, body: object) {
  return callRoute(tag.PATCH, {
    method: 'PATCH',
    path: `/api/groups/${groupId}/tags/${tagId}`,
    params: { id: groupId, tagId },
    cookie,
    body,
  });
}

function deleteTag(groupId: string, tagId: string, cookie: string, body: object) {
  return callRoute(tag.DELETE, {
    method: 'DELETE',
    path: `/api/groups/${groupId}/tags/${tagId}`,
    params: { id: groupId, tagId },
    cookie,
    body,
  });
}

describe('PATCH /api/groups/[id]/tags/[tagId]', () => {
  it('renames Food to Meals as the same Tag, which the saved dinner still points at', async () => {
    const { groupId, dinnerId, foodId } = await coorgWeekendWithDinner();
    const alexCookie = await signIn('alex');

    const renamed = await renameTag(groupId, foodId, alexCookie, {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e01',
      expectedRevision: 0,
      name: 'Meals',
    });

    expect(renamed.status).toBe(200);
    expect((await tagsOf(groupId)).find((entry) => entry.id === foodId)).toEqual({
      id: foodId,
      name: 'Meals',
      revision: 1,
    });
    const dinner = await callRoute(expense.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}/expenses/${dinnerId}`,
      params: { id: groupId, expenseId: dinnerId },
      cookie: await signIn('sam'),
    });
    expect(dinner.status).toBe(200);
    expect(dinner.body.data).toMatchObject({ tagId: foodId, tag: 'Meals' });
  });

  it('refuses a rename based on an older revision and keeps the newer name', async () => {
    const { groupId, foodId } = await coorgWeekendWithDinner();
    const alexCookie = await signIn('alex');
    await renameTag(groupId, foodId, alexCookie, {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e02',
      expectedRevision: 0,
      name: 'Meals',
    });

    const stale = await renameTag(groupId, foodId, alexCookie, {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e03',
      expectedRevision: 0,
      name: 'Dining',
    });

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: 'This Tag changed. Review its current state before applying your change.',
      code: 'TAG_CHANGED',
    });
    expect((await tagsOf(groupId)).find((entry) => entry.id === foodId)?.name).toBe('Meals');
  });

  it('refuses a rename from a member who is not an admin', async () => {
    const { groupId, foodId } = await coorgWeekendWithDinner();

    const refused = await renameTag(groupId, foodId, await signIn('sam'), {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e04',
      expectedRevision: 0,
      name: 'Meals',
    });

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'TAG_ADMIN_REQUIRED' });
    expect((await tagsOf(groupId)).find((entry) => entry.id === foodId)?.name).toBe('Food');
  });
});

describe('DELETE /api/groups/[id]/tags/[tagId]', () => {
  it('deletes a Tag no Expense uses', async () => {
    const { groupId, stayId } = await coorgWeekendWithDinner();

    const deleted = await deleteTag(groupId, stayId, await signIn('alex'), {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e05',
      expectedRevision: 0,
    });

    expect(deleted.status).toBe(200);
    expect(await activeTagNames(groupId)).toEqual(['General', 'Food', 'Transport', 'Activities']);
  });

  it('keeps a Tag the saved dinner uses', async () => {
    const { groupId, foodId } = await coorgWeekendWithDinner();

    const refused = await deleteTag(groupId, foodId, await signIn('alex'), {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e06',
      expectedRevision: 0,
    });

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: 'This Tag is used by Expenses or recurring templates and cannot be deleted.',
      code: 'TAG_IN_USE',
    });
    expect(await activeTagNames(groupId)).toContain('Food');
  });
});
