/**
 * Integration tests for an Expense's edit and deletion route against a real, isolated MongoDB
 * database (`splitbook-test-expense-revision-route`). Only the session is a stand-in.
 *
 * Clients send the revision they displayed in `X-Splitbook-Revision`. Staging's host read
 * `If-Match` as an HTTP precondition and answered 412 after the route had saved (#186), so the
 * route prefers the new header and still reads `If-Match` from older clients.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Expense from '@/lib/models/Expense';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
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

const db = integrationTestDb('expense-revision-route');
const { alice, bob } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob');
  session.userId = bob;
});
afterAll(db.teardown);

/** A shared Expense at revision 0, as a member other than its creator sees it. */
async function sharedDinner() {
  const group = await groupService.create(
    { name: 'Revision trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  const expense = await expenseService.create(
    groupId,
    {
      description: 'Shared dinner',
      amount: 90,
      currency: 'INR',
      category: 'food',
      tag: 'Food',
      date: new Date('2026-09-01T12:00:00Z'),
      paidBy: [{ user: alice, amount: 90 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alice }, { user: bob }],
    },
    alice,
  );
  const expenseId = String(expense._id);
  const context = { params: Promise.resolve({ id: groupId, expenseId }) };
  const url = `http://localhost/api/groups/${groupId}/expenses/${expenseId}`;

  const edit = async (description: string, headers: Record<string, string>) => {
    const response = await PATCH(
      new Request(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ description }),
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
    const row = await Expense.findById(expenseId).lean();
    return { description: row!.description, revision: row!.revision, isDeleted: row!.isDeleted };
  };
  return { edit, remove, stored };
}

const stale = { status: 409, body: { code: 'STALE_REVISION', status: 409 } };
const required = { status: 428, body: { code: 'REVISION_REQUIRED', status: 428 } };

describe('PATCH and DELETE /api/groups/[id]/expenses/[expenseId] revision headers', () => {
  it('edit and delete with the revision sent in X-Splitbook-Revision', async () => {
    const { edit, remove, stored } = await sharedDinner();

    const edited = await edit('Corrected dinner', { 'X-Splitbook-Revision': '0' });
    expect(edited).toMatchObject({
      status: 200,
      body: { data: { description: 'Corrected dinner', revision: 1 } },
    });
    expect(await remove({ 'X-Splitbook-Revision': '1' })).toEqual({
      status: 200,
      body: { data: { message: 'Expense deleted', revision: 2 }, status: 200 },
    });
    expect(await stored()).toEqual({
      description: 'Corrected dinner',
      revision: 2,
      isDeleted: true,
    });
  });

  it('still accept an older client’s If-Match, and use X-Splitbook-Revision when both are sent', async () => {
    const { edit, remove, stored } = await sharedDinner();

    expect(await edit('Older app edit', { 'If-Match': '0' })).toMatchObject({
      status: 200,
      body: { data: { revision: 1 } },
    });
    // Both sent: the new header decides, whichever of the two is current.
    expect(
      await edit('Stale in the new header', { 'X-Splitbook-Revision': '0', 'If-Match': '1' }),
    ).toMatchObject(stale);
    expect(
      await edit('Current in the new header', { 'X-Splitbook-Revision': '1', 'If-Match': '0' }),
    ).toMatchObject({ status: 200, body: { data: { revision: 2 } } });
    expect(await remove({ 'If-Match': '2' })).toMatchObject({
      status: 200,
      body: { data: { revision: 3 } },
    });
    expect(await stored()).toEqual({
      description: 'Current in the new header',
      revision: 3,
      isDeleted: true,
    });
  });

  it('refuse a stale revision with 409 and a missing or malformed one with 428, changing nothing', async () => {
    const { edit, remove, stored } = await sharedDinner();
    await edit('Saved by someone else', { 'X-Splitbook-Revision': '0' });
    const before = await stored();

    expect(await edit('Stale edit', { 'X-Splitbook-Revision': '0' })).toMatchObject(stale);
    expect(await remove({ 'X-Splitbook-Revision': '0' })).toMatchObject(stale);
    expect(await edit('Stale older app edit', { 'If-Match': '0' })).toMatchObject(stale);
    expect(await edit('Unversioned edit', {})).toMatchObject(required);
    expect(await remove({})).toMatchObject(required);
    // A malformed new header is refused rather than replaced by If-Match.
    for (const value of ['abc', '-1', '1.5']) {
      expect(
        await edit('Malformed edit', { 'X-Splitbook-Revision': value, 'If-Match': '1' }),
      ).toMatchObject(required);
      expect(await remove({ 'X-Splitbook-Revision': value, 'If-Match': '1' })).toMatchObject(
        required,
      );
    }
    expect(await stored()).toEqual(before);
  });
});
