import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { expenseDraftService as drafts } from './expense-draft.service';
import { parseToReviewResponse } from '@splitbook/shared/to-review-read';
const identity = vi.hoisted(() => ({ id: 'a00000000000000000000001' as string | null }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: async () =>
        identity.id
          ? { user: { id: identity.id, name: 'Alex', email: 'alex@example.test' } }
          : null,
    },
  },
}));
import { GET } from '@/app/api/user/to-review/route';
import { GET as list } from '@/app/api/groups/[id]/drafts/route';
const testDb = integrationTestDb('to-review');
const alice = { id: 'a00000000000000000000001' },
  bob = { id: 'a00000000000000000000002' };
const groupId = 'b00000000000000000000001',
  secondId = 'b00000000000000000000002';
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const db = () => mongoose.connection.db!;
const values = {
  description: 'Taxi',
  category: 'transport',
  amount: 12.34,
  currency: 'INR',
  date: '2026-10-14',
  tag: 'Travel',
  paidBy: [{ user: alice.id, amount: 12.34 }],
  splitMethod: 'equal',
  splitBetween: [{ user: alice.id }],
};
beforeAll(async () => {
  await testDb.connect();
});
beforeEach(async () => {
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  identity.id = alice.id;
  await testDb.reset();
  await db()
    .collection('users')
    .insertMany(
      [alice, bob].map((user) => ({
        _id: oid(user.id),
        email: `${user.id}@example.test`,
        name: 'Alex',
      })),
    );
  await db()
    .collection('groups')
    .insertMany(
      [groupId, secondId].map((id, index) => ({
        _id: oid(id),
        name: index ? 'Home' : 'Weekend',
        defaultCurrency: 'INR',
        members: [alice, bob].map((user) => ({ user: oid(user.id) })),
        tags: [{ _id: new mongoose.Types.ObjectId(), name: 'Travel', isArchived: false }],
      })),
    );
});
afterAll(testDb.teardown);
const read = async () => parseToReviewResponse(await (await GET()).json());
it('reads only own active items across current Groups, with attribution, and never changes records', async () => {
  const [own] = await drafts.create(
    { ...alice, assistant: { name: 'Claude' } },
    groupId,
    { drafts: [values] },
    'request-own',
  );
  await drafts.create(alice, secondId, { drafts: [{}] }, 'request-other-group');
  await drafts.create(bob, groupId, { drafts: [values] }, 'request-bob');
  const [deleted] = await drafts.create(alice, groupId, { drafts: [{}] }, 'request-delete');
  await drafts.discard(alice, groupId, deleted.id, 0);
  const [saved] = await drafts.create(
    alice,
    groupId,
    { drafts: [{ ...values, description: 'Lunch' }] },
    'request-saved',
  );
  const review = await drafts.review(alice, groupId, saved.id);
  expect(
    (
      await drafts.save(alice, groupId, {
        drafts: [{ id: saved.id, revision: 0, review: review.review }],
      })
    )[0].status,
  ).toBe('saved');
  const before = await db().collection('expensedrafts').find().toArray();
  const response = await GET();
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const result = parseToReviewResponse(await response.json());
  expect(result.total).toBe(2);
  expect(result.groups.map((group) => [group.groupName, group.count])).toEqual([
    ['Home', 1],
    ['Weekend', 1],
  ]);
  expect(result.groups[1].items[0].draft).toEqual(own);
  expect(result.groups[1].items[0]).toMatchObject({ problems: [], duplicates: [] });
  expect(await db().collection('expensedrafts').find().toArray()).toEqual(before);
  const existing = await list(new Request('http://localhost'), {
    params: Promise.resolve({ id: groupId }),
  });
  expect((await existing.json()).data).toEqual([own]);
});
it('hides a left Group, includes it after rejoin, and excludes Groups being deleted', async () => {
  await drafts.create(alice, groupId, { drafts: [{}] }, 'request-kept');
  await db()
    .collection('groups')
    .updateOne({ _id: oid(groupId) }, { $set: { members: [{ user: oid(bob.id) }] } });
  expect(await read()).toEqual({ total: 0, groups: [] });
  await db()
    .collection('groups')
    .updateOne(
      { _id: oid(groupId) },
      { $set: { members: [{ user: oid(bob.id) }, { user: oid(alice.id), joinedAt: new Date() }] } },
    );
  expect((await read()).total).toBe(1);
  await db()
    .collection('groups')
    .updateOne({ _id: oid(groupId) }, { $set: { deletionRequestedAt: new Date() } });
  expect((await read()).total).toBe(0);
});
it('returns the same problems and duplicate warnings as the review step, including saved Expenses', async () => {
  const [first, second, incomplete] = await drafts.create(
    alice,
    groupId,
    { drafts: [values, values, {}] },
    'request-dupes',
  );
  await drafts.create(bob, groupId, { drafts: [values] }, 'request-private');
  const reviewed = await drafts.review(alice, groupId, first.id);
  expect(
    (
      await drafts.save(alice, groupId, {
        drafts: [
          { id: first.id, revision: 0, review: reviewed.review, acknowledgeDuplicates: true },
        ],
      })
    )[0].status,
  ).toBe('saved');
  const result = await read();
  const fresh = await drafts.review(alice, groupId, second.id);
  expect(result.groups[0].items[0]).toEqual({
    draft: fresh.draft,
    problems: fresh.problems,
    duplicates: fresh.duplicates,
  });
  expect(fresh.duplicates).toMatchObject([{ kind: 'expense', description: 'Taxi' }]);
  expect(result.groups[0].items[1].problems).toEqual(
    (await drafts.review(alice, groupId, incomplete.id)).problems,
  );
  await db()
    .collection('groups')
    .updateOne({ _id: oid(groupId) }, { $set: { defaultCurrency: 'USD' } });
  expect((await read()).groups[0].items[0].problems).toEqual(
    (await drafts.review(alice, groupId, second.id)).problems,
  );
  expect((await read()).groups[0].items[0].problems.length).toBeGreaterThan(0);
});
it('returns 401 signed out, the existing disabled refusal, and refuses an account being deleted', async () => {
  identity.id = null;
  expect((await GET()).status).toBe(401);
  identity.id = alice.id;
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'false');
  const response = await GET();
  const old = await list(new Request('http://localhost'), {
    params: Promise.resolve({ id: groupId }),
  });
  expect(response.status).toBe(old.status);
  expect(await response.json()).toEqual(await old.json());
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await db()
    .collection('users')
    .updateOne({ _id: oid(alice.id) }, { $set: { draftDeletionPending: true } });
  expect((await GET()).status).toBe(403);
});
