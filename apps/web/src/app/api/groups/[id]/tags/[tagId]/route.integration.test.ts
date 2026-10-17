/**
 * HTTP tests for renaming, archiving and deleting a Tag (#472) against a real, isolated MongoDB
 * database (`splitbook-test-group-tag-item-route`), with a real session (`signed-in-route.ts`).
 *
 * ADR 0009: a Tag keeps its identity when it is renamed or archived, so a saved Expense still
 * points at it; an edit based on an older revision fails instead of overwriting a newer one;
 * only an admin manages Tags; and a Tag in use cannot be deleted. Tags are read back through
 * the Group, as a member reads them.
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
let group: typeof import('../../route');
let expense: typeof import('../../expenses/[expenseId]/route');

beforeAll(async () => {
  await connectSignedIn(db);
  // Tag changes use transactions (ADR 0009).
  await requireReplicaSet();
  tag = await import('./route');
  group = await import('../../route');
  expense = await import('../../expenses/[expenseId]/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

interface Tag {
  _id: string;
  name: string;
  revision: number;
  isArchived: boolean;
  isDeleted?: boolean;
}

/** The Group's Tags as Alex reads them, deleted ones included (they stay stored, marked). */
async function tagsOf(groupId: string): Promise<Tag[]> {
  const read = await callRoute(group.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}`,
    params: { id: groupId },
    cookie: await signIn('alex'),
  });
  expect(read.status).toBe(200);
  return read.body.data.tags;
}

async function tagById(groupId: string, tagId: string) {
  const found = (await tagsOf(groupId)).find((entry) => entry._id === tagId)!;
  return { name: found.name, revision: found.revision, isArchived: found.isArchived };
}

/** The names a member can still pick: neither archived nor deleted. */
async function activeTagNames(groupId: string) {
  return (await tagsOf(groupId))
    .filter((entry) => !entry.isArchived && !entry.isDeleted)
    .map((entry) => entry.name);
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
  const id = (name: string) => tags.find((entry) => entry.name === name)!._id;
  return { groupId, dinnerId: String(dinner._id), foodId: id('Food'), stayId: id('Stay') };
}

function changeTag(groupId: string, tagId: string, cookie: string, body: object) {
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

/** The saved dinner's Tag, as Sam reads the Expense. */
async function dinnersTag(groupId: string, dinnerId: string) {
  const read = await callRoute(expense.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/expenses/${dinnerId}`,
    params: { id: groupId, expenseId: dinnerId },
    cookie: await signIn('sam'),
  });
  expect(read.status).toBe(200);
  return { tagId: read.body.data.tagId, tag: read.body.data.tag };
}

describe('PATCH /api/groups/[id]/tags/[tagId]', () => {
  it('renames Food to Meals as the same Tag, which the saved dinner still points at', async () => {
    const { groupId, dinnerId, foodId } = await coorgWeekendWithDinner();

    const renamed = await changeTag(groupId, foodId, await signIn('alex'), {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e01',
      expectedRevision: 0,
      name: 'Meals',
    });

    expect(renamed.status).toBe(200);
    expect(await tagById(groupId, foodId)).toEqual({
      name: 'Meals',
      revision: 1,
      isArchived: false,
    });
    expect(await dinnersTag(groupId, dinnerId)).toEqual({ tagId: foodId, tag: 'Meals' });
  });

  it('archives Food as the same Tag, which the saved dinner still points at', async () => {
    const { groupId, dinnerId, foodId } = await coorgWeekendWithDinner();

    const archived = await changeTag(groupId, foodId, await signIn('alex'), {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e07',
      expectedRevision: 0,
      isArchived: true,
    });

    expect(archived.status).toBe(200);
    expect(await tagById(groupId, foodId)).toEqual({ name: 'Food', revision: 1, isArchived: true });
    expect(await activeTagNames(groupId)).toEqual(['General', 'Transport', 'Stay', 'Activities']);
    expect(await dinnersTag(groupId, dinnerId)).toEqual({ tagId: foodId, tag: 'Food' });
  });

  it('refuses a rename based on an older revision and keeps the newer name', async () => {
    const { groupId, foodId } = await coorgWeekendWithDinner();
    const alexCookie = await signIn('alex');
    await changeTag(groupId, foodId, alexCookie, {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e02',
      expectedRevision: 0,
      name: 'Meals',
    });

    const stale = await changeTag(groupId, foodId, alexCookie, {
      requestId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e03',
      expectedRevision: 0,
      name: 'Dining',
    });

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: 'This Tag changed. Review its current state before applying your change.',
      code: 'TAG_CHANGED',
    });
    expect((await tagById(groupId, foodId)).name).toBe('Meals');
  });

  it('refuses a rename from a member who is not an admin, or from someone outside', async () => {
    const { groupId, foodId } = await coorgWeekendWithDinner();
    const rename = async (persona: 'sam' | 'priya', requestId: string) =>
      changeTag(groupId, foodId, await signIn(persona), {
        requestId,
        expectedRevision: 0,
        name: 'Meals',
      });

    const bySam = await rename('sam', '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e04');
    const byPriya = await rename('priya', '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e08');

    expect([bySam.status, bySam.body.code]).toEqual([403, 'TAG_ADMIN_REQUIRED']);
    expect([byPriya.status, byPriya.body.code]).toEqual([403, 'FORBIDDEN']);
    expect((await tagById(groupId, foodId)).name).toBe('Food');
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
