/**
 * HTTP tests for input a route cannot read (#539), against a real, isolated MongoDB database
 * (`splitbook-test-bad-request`), with a real session (`signed-in-route.ts`).
 *
 * An id in the address that is not one answers 400 INVALID_ID, and a body that is not JSON
 * answers 400 INVALID_JSON, the same on every route: Groups, Expenses and recurring Expenses
 * stand in for the rest. Neither is a server fault, so neither is a 500.
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
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
// Reading the Group list schedules work with after().
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);

const db = integrationTestDb('bad-request');
const { alex, sam } = DEMO_PERSONA_IDS;

let groups: typeof import('@/app/api/groups/route');
let group: typeof import('@/app/api/groups/[id]/route');
let expenses: typeof import('@/app/api/groups/[id]/expenses/route');
let expense: typeof import('@/app/api/groups/[id]/expenses/[expenseId]/route');
let recurring: typeof import('@/app/api/groups/[id]/recurring/route');
let template: typeof import('@/app/api/groups/[id]/recurring/[recurringId]/route');

beforeAll(async () => {
  await connectSignedIn(db);
  groups = await import('@/app/api/groups/route');
  group = await import('@/app/api/groups/[id]/route');
  expenses = await import('@/app/api/groups/[id]/expenses/route');
  expense = await import('@/app/api/groups/[id]/expenses/[expenseId]/route');
  recurring = await import('@/app/api/groups/[id]/recurring/route');
  template = await import('@/app/api/groups/[id]/recurring/[recurringId]/route');
});
beforeEach(async () => {
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

const invalidId = { status: 400, body: { error: 'Invalid id', status: 400, code: 'INVALID_ID' } };
const invalidJson = {
  status: 400,
  body: { error: 'Invalid JSON body', status: 400, code: 'INVALID_JSON' },
};
/** A body cut off part way, as a dropped connection or a hand-written request sends it. */
const notJson = '{"name": "Lakeview';

/** Alex's Household with Sam, with Alex as its admin. */
async function household() {
  const created = await groupService.create(
    { name: 'Lakeview Flat', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

describe('an id in the address that is not one (#539)', () => {
  it('answers 400 INVALID_ID when reading a Group', async () => {
    expect(
      await callRoute(group.GET, {
        method: 'GET',
        path: '/api/groups/not-an-id',
        params: { id: 'not-an-id' },
        cookie: await signIn('alex'),
      }),
    ).toEqual(invalidId);
  });

  it('answers 400 INVALID_ID when changing an Expense', async () => {
    const groupId = await household();
    expect(
      await callRoute(expense.PATCH, {
        method: 'PATCH',
        path: `/api/groups/${groupId}/expenses/not-an-id`,
        params: { id: groupId, expenseId: 'not-an-id' },
        cookie: await signIn('alex'),
        headers: { 'X-Splitbook-Revision': '0' },
        body: { description: 'Groceries' },
      }),
    ).toEqual(invalidId);
  });

  it('answers 400 INVALID_ID when pausing a recurring Expense', async () => {
    const groupId = await household();
    expect(
      await callRoute(template.PATCH, {
        method: 'PATCH',
        path: `/api/groups/${groupId}/recurring/not-an-id`,
        params: { id: groupId, recurringId: 'not-an-id' },
        cookie: await signIn('alex'),
        headers: { 'X-Splitbook-Revision': '0' },
        body: { isPaused: true },
      }),
    ).toEqual(invalidId);
  });
});

describe('what a route checks before the address (#539)', () => {
  it('still answers a signed-out caller 401 first', async () => {
    expect(
      await callRoute(group.GET, {
        method: 'GET',
        path: '/api/groups/not-an-id',
        params: { id: 'not-an-id' },
        cookie: '',
      }),
    ).toEqual({ status: 401, body: { error: 'Unauthorized', status: 401 } });
  });

  it('still answers 409 RECURRING_EXPENSES_OFF first while recurring Expenses are off', async () => {
    const groupId = await household();
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'false');
    expect(
      await callRoute(template.PATCH, {
        method: 'PATCH',
        path: `/api/groups/${groupId}/recurring/not-an-id`,
        params: { id: groupId, recurringId: 'not-an-id' },
        cookie: await signIn('alex'),
        headers: { 'X-Splitbook-Revision': '0' },
        body: { isPaused: true },
      }),
    ).toEqual({
      status: 409,
      body: {
        error: 'Recurring Expenses are turned off.',
        status: 409,
        code: 'RECURRING_EXPENSES_OFF',
      },
    });
  });
});

describe('a body that is not JSON (#539)', () => {
  it('answers 400 INVALID_JSON when creating a Group, and creates none', async () => {
    const alexCookie = await signIn('alex');
    expect(
      await callRoute(groups.POST, {
        method: 'POST',
        path: '/api/groups',
        cookie: alexCookie,
        rawBody: notJson,
      }),
    ).toEqual(invalidJson);
    const listed = await callRoute(groups.GET, {
      method: 'GET',
      path: '/api/groups',
      cookie: alexCookie,
    });
    expect(listed.body.data).toEqual([]);
  });

  it('answers 400 INVALID_JSON when changing a Group', async () => {
    const groupId = await household();
    expect(
      await callRoute(group.PATCH, {
        method: 'PATCH',
        path: `/api/groups/${groupId}`,
        params: { id: groupId },
        cookie: await signIn('alex'),
        rawBody: notJson,
      }),
    ).toEqual(invalidJson);
  });

  it('answers 400 INVALID_JSON when adding an Expense', async () => {
    const groupId = await household();
    expect(
      await callRoute(expenses.POST, {
        method: 'POST',
        path: `/api/groups/${groupId}/expenses`,
        params: { id: groupId },
        cookie: await signIn('alex'),
        rawBody: notJson,
      }),
    ).toEqual(invalidJson);
  });

  it('answers 400 INVALID_JSON when adding a recurring Expense', async () => {
    const groupId = await household();
    expect(
      await callRoute(recurring.POST, {
        method: 'POST',
        path: `/api/groups/${groupId}/recurring`,
        params: { id: groupId },
        cookie: await signIn('alex'),
        rawBody: notJson,
      }),
    ).toEqual(invalidJson);
  });
});
