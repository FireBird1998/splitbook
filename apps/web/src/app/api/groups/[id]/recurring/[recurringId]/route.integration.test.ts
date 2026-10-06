/**
 * Integration tests for a recurring Expense's edit and deletion route against a real, isolated
 * MongoDB database (`splitbook-test-recurring-revision-route`). Only the session is a stand-in.
 *
 * Clients send the revision they displayed in `X-Splitbook-Revision`; apps released before #186
 * send it in `If-Match`, which the route still reads.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from '@/lib/services/group.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { DELETE, PATCH } from './route';

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

// Recurring Expenses are off unless switched on (#289); this file covers them switched on.
vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');

const db = integrationTestDb('recurring-revision-route');
const { alice, bob } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob');
  session.userId = alice;
});
afterAll(db.teardown);

/** A monthly Rent at revision 0 that starts next month, as its Group's admin sees it. */
async function monthlyRent() {
  const group = await groupService.create(
    { name: 'Revision flat', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  const now = new Date();
  const template = await recurringExpenseService.create(
    groupId,
    {
      description: 'Rent',
      amount: 30000,
      currency: 'INR',
      category: 'housing',
      tag: 'Rent',
      paidBy: [{ user: alice, amount: 30000 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alice }, { user: bob }],
      dayOfMonth: 1,
      startsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    },
    alice,
  );
  const recurringId = String(template!._id);
  const context = { params: Promise.resolve({ id: groupId, recurringId }) };
  const url = `http://localhost/api/groups/${groupId}/recurring/${recurringId}`;

  const edit = async (change: Record<string, unknown>, headers: Record<string, string>) => {
    const response = await PATCH(
      new Request(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(change),
      }),
      context,
    );
    return { status: response.status, body: await response.json() };
  };
  const remove = async (headers: Record<string, string>) => {
    const response = await DELETE(new Request(url, { method: 'DELETE', headers }), context);
    return { status: response.status, body: await response.json() };
  };
  const stored = async () => {
    const row = await RecurringExpense.findById(recurringId).lean();
    return row && { description: row.description, isPaused: row.isPaused, revision: row.revision };
  };
  return { edit, remove, stored };
}

const stale = { status: 409, body: { code: 'STALE_REVISION', status: 409 } };
const required = { status: 428, body: { code: 'REVISION_REQUIRED', status: 428 } };

describe('PATCH and DELETE /api/groups/[id]/recurring/[recurringId] revision headers', () => {
  it('edit, pause and delete with the revision sent in X-Splitbook-Revision', async () => {
    const { edit, remove, stored } = await monthlyRent();

    expect(await edit({ description: 'Flat rent' }, { 'X-Splitbook-Revision': '0' })).toMatchObject(
      { status: 200, body: { data: { description: 'Flat rent', revision: 1 } } },
    );
    expect(await edit({ isPaused: true }, { 'X-Splitbook-Revision': '1' })).toMatchObject({
      status: 200,
      body: { data: { isPaused: true, revision: 2 } },
    });
    expect(await remove({ 'X-Splitbook-Revision': '2' })).toEqual({
      status: 200,
      body: { data: { message: 'Recurring expense deleted' }, status: 200 },
    });
    expect(await stored()).toBeNull();
  });

  it('still accept an older client’s If-Match alone, with the same outcomes as before', async () => {
    const { edit, remove, stored } = await monthlyRent();

    expect(await edit({ description: 'Older app rent' }, { 'If-Match': '0' })).toMatchObject({
      status: 200,
      body: { data: { description: 'Older app rent', revision: 1 } },
    });
    expect(await edit({ isPaused: true }, { 'If-Match': '0' })).toMatchObject(stale);
    expect(await remove({ 'If-Match': '0' })).toMatchObject(stale);
    expect(await edit({ isPaused: true }, {})).toMatchObject(required);
    expect(await remove({})).toMatchObject(required);
    expect(await stored()).toEqual({
      description: 'Older app rent',
      isPaused: false,
      revision: 1,
    });

    expect(await remove({ 'If-Match': '1' })).toEqual({
      status: 200,
      body: { data: { message: 'Recurring expense deleted' }, status: 200 },
    });
    expect(await stored()).toBeNull();
  });
});
