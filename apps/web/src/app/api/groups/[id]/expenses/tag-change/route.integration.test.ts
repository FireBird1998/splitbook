/**
 * Integration tests for changing several Expenses' Tag in one request (#610), against a real,
 * isolated MongoDB replica set (`splitbook-test-expense-tag-change`). Only the session is a
 * stand-in. Each Expense is changed on its own, under a single edit's rules, and the reply says
 * what happened to each.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Activity from '@/lib/models/Activity';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { POST } from './route';

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

const db = integrationTestDb('expense-tag-change');
const { alice, bob, carol } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol');
  session.userId = bob;
});
afterAll(db.teardown);

/** Maple House, a Household of Alice and Bob, with three Groceries Expenses at revision 0. */
async function household() {
  const group = await groupService.create(
    { name: 'Maple House', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  const ids: string[] = [];
  for (const [description, amount] of [
    ['Weekly groceries', 1240.5],
    ['Milk and bread', 186],
    ['Water cans', 320],
  ] as const) {
    const expense = await expenseService.create(
      groupId,
      {
        description,
        amount,
        currency: 'INR',
        category: 'food',
        tag: 'Groceries',
        date: new Date('2026-09-14T12:00:00Z'),
        paidBy: [{ user: alice, amount }],
        splitMethod: 'equal',
        splitBetween: [{ user: alice }, { user: bob }],
      },
      alice,
    );
    ids.push(String(expense._id));
  }
  const tags = (await Group.findById(groupId).lean())!.tags;
  const tagId = (name: string) => String(tags.find((tag) => tag.name === name)!._id);
  const change = async (body: unknown) => {
    const response = await POST(
      new Request(`http://localhost/api/groups/${groupId}/expenses/tag-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: groupId }) },
    );
    return { status: response.status, body: await response.json() };
  };
  /** Each Expense's Tag, revision and number of history entries, in the order created. */
  const stored = async () =>
    Promise.all(
      ids.map(async (id) => {
        const row = await Expense.findById(id).lean();
        return { tag: row!.tag, revision: row!.revision, edits: row!.editHistory.length };
      }),
    );
  const tagChanges = async () =>
    (await Activity.find({ group: groupId, type: 'expense_updated' }).lean()).map((event) => ({
      actor: String(event.actor),
      expenseId: event.metadata.expenseId,
      tag: (event.metadata.changes as { tag?: unknown } | undefined)?.tag,
    }));
  return { groupId, ids, tagId, change, stored, tagChanges };
}

describe('POST /api/groups/[id]/expenses/tag-change', () => {
  it('changes every Expense listed to the Tag, each with its own history entry and Activity event', async () => {
    const { ids, tagId, change, stored, tagChanges } = await household();

    const reply = await change({
      tagId: tagId('Household'),
      expenses: ids.map((id) => ({ id, revision: 0 })),
    });

    expect(reply).toEqual({
      status: 200,
      body: {
        status: 200,
        data: {
          tagId: tagId('Household'),
          results: ids.map((expenseId) => ({ expenseId, outcome: 'changed', revision: 1 })),
        },
      },
    });
    expect(await stored()).toEqual([
      { tag: 'Household', revision: 1, edits: 1 },
      { tag: 'Household', revision: 1, edits: 1 },
      { tag: 'Household', revision: 1, edits: 1 },
    ]);
    const edit = (await Expense.findById(ids[0]).lean())!.editHistory[0];
    expect(String(edit.editedBy)).toBe(bob);
    // As a single edit records it, read as the history's JSON is.
    expect(JSON.parse(JSON.stringify(edit.changes))).toEqual({
      tag: { old: 'Groceries', new: 'Household' },
      tagId: { old: tagId('Groceries'), new: tagId('Household') },
    });
    expect(await tagChanges()).toEqual(
      expect.arrayContaining(
        ids.map((expenseId) => ({
          actor: bob,
          expenseId,
          tag: { old: 'Groceries', new: 'Household' },
        })),
      ),
    );
    expect(await tagChanges()).toHaveLength(3);
  });

  it('changes the rest when one was changed elsewhere and one was deleted, and says so for each', async () => {
    const { groupId, ids, tagId, change, stored } = await household();
    const [renamed, deleted, kept] = ids;
    await expenseService.update(
      { actorId: alice, groupId, expenseId: renamed },
      { description: 'Weekly groceries (big shop)' },
      0,
    );
    await expenseService.delete({ actorId: alice, groupId, expenseId: deleted }, 0);

    const reply = await change({
      tagId: tagId('Household'),
      expenses: ids.map((id) => ({ id, revision: 0 })),
    });

    expect(reply.status).toBe(200);
    expect(reply.body.data.results).toEqual([
      { expenseId: renamed, outcome: 'changed-elsewhere' },
      { expenseId: deleted, outcome: 'unavailable' },
      { expenseId: kept, outcome: 'changed', revision: 1 },
    ]);
    expect(await stored()).toEqual([
      { tag: 'Groceries', revision: 1, edits: 1 },
      { tag: 'Groceries', revision: 1, edits: 0 },
      { tag: 'Household', revision: 1, edits: 1 },
    ]);
  });

  it('reports an Expense already on the Tag as unchanged, so a retry edits nothing twice', async () => {
    const { ids, tagId, change, stored, tagChanges } = await household();
    const body = { tagId: tagId('Household'), expenses: ids.map((id) => ({ id, revision: 0 })) };
    await change(body);

    const retry = await change(body);

    expect(retry.status).toBe(200);
    expect(retry.body.data.results).toEqual(
      ids.map((expenseId) => ({ expenseId, outcome: 'unchanged', revision: 1 })),
    );
    expect(await stored()).toEqual([
      { tag: 'Household', revision: 1, edits: 1 },
      { tag: 'Household', revision: 1, edits: 1 },
      { tag: 'Household', revision: 1, edits: 1 },
    ]);
    expect(await tagChanges()).toHaveLength(3);
  });

  it('leaves an Expense of another Group as it is, and says it is unavailable here', async () => {
    const { ids, tagId, change } = await household();
    // Bob is a member of Goa Trip too, so only the Group in the address keeps its Expense out.
    const goa = String(
      (
        await groupService.create(
          { name: 'Goa Trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
          bob,
        )
      )._id,
    );
    const ferry = String(
      (
        await expenseService.create(
          goa,
          {
            description: 'Ferry',
            amount: 200,
            currency: 'INR',
            category: 'transport',
            tag: 'Transport',
            date: new Date('2026-09-14T12:00:00Z'),
            paidBy: [{ user: bob, amount: 200 }],
            splitMethod: 'equal',
            splitBetween: [{ user: bob }],
          },
          bob,
        )
      )._id,
    );
    const before = await Expense.findById(ferry).lean();

    const reply = await change({
      tagId: tagId('Household'),
      expenses: [
        { id: ferry, revision: 0 },
        { id: ids[0], revision: 0 },
      ],
    });

    expect(reply.status).toBe(200);
    expect(reply.body.data.results).toEqual([
      { expenseId: ferry, outcome: 'unavailable' },
      { expenseId: ids[0], outcome: 'changed', revision: 1 },
    ]);
    const after = await Expense.findById(ferry).lean();
    expect({
      tag: after!.tag,
      tagId: String(after!.tagId),
      revision: after!.revision,
      edits: after!.editHistory.length,
    }).toEqual({
      tag: 'Transport',
      tagId: String(before!.tagId),
      revision: 0,
      edits: 0,
    });
  });

  it('refuses an Archived Tag, a Tag not in the Group, an archived Group, a non-member and an oversized or repeated list, changing nothing', async () => {
    const { groupId, ids, tagId, change, stored } = await household();
    const all = ids.map((id) => ({ id, revision: 0 }));
    const before = await stored();

    await Group.updateOne(
      { _id: groupId, 'tags._id': tagId('Household') },
      { $set: { 'tags.$.isArchived': true } },
    );
    expect(await change({ tagId: tagId('Household'), expenses: all })).toMatchObject({
      status: 422,
      body: { code: 'INVALID_TAG' },
    });
    expect(await change({ tagId: 'c0000000000000000000000f', expenses: all })).toMatchObject({
      status: 422,
      body: { code: 'INVALID_TAG' },
    });

    const tooMany = Array.from({ length: 101 }, (_, index) => ({
      id: index.toString(16).padStart(24, '0'),
      revision: 0,
    }));
    expect(await change({ tagId: tagId('Rent'), expenses: tooMany })).toMatchObject({
      status: 422,
      body: { code: 'VALIDATION_ERROR' },
    });
    expect(await change({ tagId: tagId('Rent'), expenses: [all[0], all[0]] })).toMatchObject({
      status: 422,
      body: { code: 'VALIDATION_ERROR' },
    });
    expect(await change({ tagId: tagId('Rent'), expenses: [] })).toMatchObject({
      status: 422,
      body: { code: 'VALIDATION_ERROR' },
    });

    session.userId = carol;
    expect(await change({ tagId: tagId('Rent'), expenses: all })).toMatchObject({ status: 403 });

    session.userId = bob;
    await groupService.archive(groupId, alice);
    expect(await change({ tagId: tagId('Rent'), expenses: all })).toMatchObject({
      status: 409,
      body: { code: 'GROUP_ARCHIVED' },
    });

    expect(await stored()).toEqual(before);
  });
});
