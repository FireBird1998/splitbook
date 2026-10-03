/**
 * Integration tests for the Group Activity route against a real, isolated MongoDB database
 * (`splitbook-test-activity-route`). Only the session is a stand-in; membership, pagination
 * and the Expense filter run against stored events.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { GET } from './route';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.userId
          ? { user: { id: session.userId, name: 'Tester', email: 'tester@splitbook-test.local' } }
          : null,
      ),
    },
  },
}));

const db = integrationTestDb('activity-route');
const { alice, bob, carol, dave } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = null;
});
afterAll(db.teardown);

interface ActivityPage {
  activities: {
    _id: string;
    type: string;
    actor: { name: string };
    metadata: { expenseId?: string; description?: string; changes?: Record<string, unknown> };
  }[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

async function readActivity(groupId: string, userId: string | null, query = '') {
  session.userId = userId;
  const request = new Request(`http://localhost/api/groups/${groupId}/activity${query}`);
  const response = await GET(request, { params: Promise.resolve({ id: groupId }) });
  return { status: response.status, body: await response.json() };
}

async function page(groupId: string, userId: string, query: string): Promise<ActivityPage> {
  const { status, body } = await readActivity(groupId, userId, query);
  expect(status).toBe(200);
  return body.data;
}

async function createGroup(name: string, creator: string, ...members: string[]) {
  const group = await groupService.create(
    { name, category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    creator,
  );
  const groupId = String(group._id);
  for (const member of members) await groupService.addMember(groupId, member);
  return groupId;
}

const command = (description: string, payer: string, members: string[]) => ({
  description,
  amount: 120,
  currency: 'INR',
  category: 'transport',
  tag: 'General',
  date: new Date('2026-09-20'),
  paidBy: [{ user: payer, amount: 120 }],
  splitMethod: 'equal' as const,
  splitBetween: members.map((user) => ({ user })),
});

/** A Group with one Expense edited twice and deleted, beside another Expense. */
async function fixture() {
  const groupId = await createGroup('Ferry Trip', alice, bob);
  const ferry = command('Ferry tickets', alice, [alice, bob]);
  const created = await expenseService.create(groupId, ferry, alice);
  const expenseId = String(created._id);
  await expenseService.update(
    { actorId: bob, groupId, expenseId },
    { ...ferry, amount: 150, paidBy: [{ user: alice, amount: 150 }] },
    0,
  );
  await expenseService.update(
    { actorId: alice, groupId, expenseId },
    { description: 'Ferry and bus' },
    1,
  );
  await expenseService.delete({ actorId: bob, groupId, expenseId }, 2);
  await expenseService.create(groupId, command('Dinner', bob, [alice, bob]), bob);
  return { groupId, expenseId };
}

describe('GET /api/groups/[id]/activity filtered to one Expense', () => {
  it('pages through only that Expense’s events, newest first, in the unfiltered shape', async () => {
    const { groupId, expenseId } = await fixture();

    const first = await page(groupId, alice, `?expenseId=${expenseId}&page=1&limit=3`);
    const second = await page(groupId, alice, `?expenseId=${expenseId}&page=2&limit=3`);
    expect(first.pagination).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
    expect(second.pagination).toEqual({ page: 2, limit: 3, total: 4, totalPages: 2 });
    const filtered = [...first.activities, ...second.activities];
    expect(filtered.map((event) => [event.type, event.actor.name])).toEqual([
      ['expense_deleted', 'Bob Tester'],
      ['expense_updated', 'Alice Tester'],
      ['expense_updated', 'Bob Tester'],
      ['expense_added', 'Alice Tester'],
    ]);
    expect(filtered[2].metadata.changes?.amount).toEqual({ old: 120, new: 150 });

    // Exactly the Group feed's events about this Expense, field for field.
    const feed = await page(groupId, alice, '?page=1&limit=50');
    expect(feed.activities.map((event) => event.type)).toContain('member_joined');
    expect(filtered).toEqual(
      feed.activities.filter((event) => event.metadata?.expenseId === expenseId),
    );
  });

  it('returns an empty page for an unknown Expense or one from another Group', async () => {
    const { groupId } = await fixture();
    // Alice belongs to both Groups; the other Group's Expense still isn’t this Group’s.
    const otherGroupId = await createGroup('Cabin', carol, alice);
    const elsewhere = await expenseService.create(
      otherGroupId,
      command('Firewood', carol, [alice, carol]),
      carol,
    );
    const empty = { activities: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

    for (const expenseId of [String(elsewhere._id), 'b000000000000000000000ff', 'not-an-id', ''])
      expect(await page(groupId, alice, `?expenseId=${expenseId}`)).toEqual(empty);
    expect(
      (await page(otherGroupId, alice, `?expenseId=${elsewhere._id}`)).activities.map(
        (event) => event.metadata.description,
      ),
    ).toEqual(['Firewood']);
  });

  it('keeps the Group-membership authorization of the unfiltered feed', async () => {
    const { groupId, expenseId } = await fixture();

    expect(await readActivity(groupId, dave, `?expenseId=${expenseId}`)).toEqual({
      status: 403,
      body: { error: 'Forbidden', status: 403 },
    });
    expect(await readActivity(groupId, null, `?expenseId=${expenseId}`)).toEqual({
      status: 401,
      body: { error: 'Unauthorized', status: 401 },
    });
  });
});
