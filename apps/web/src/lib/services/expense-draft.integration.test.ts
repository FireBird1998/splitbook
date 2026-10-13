import {
  GET as expenseRecordRoute,
  PATCH as editExpenseRoute,
} from '@/app/api/groups/[id]/expenses/[expenseId]/route';
import { POST as createExpenseRoute } from '@/app/api/groups/[id]/expenses/route';
import { GET as userActivityRoute } from '@/app/api/user/activity/route';
import { parseExpensePageResponse } from '@splitbook/shared/expense-page-read';
import { parseExpenseRecordResponse } from '@splitbook/shared/expense-record-read';
import { parseActivityPageResponse } from '@splitbook/shared/activity-page-read';
import { parseUserActivityResponse } from '@splitbook/shared/user-activity-read';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { expenseDraftService as drafts } from './expense-draft.service';
import { requestGroupDeletion } from './group-cleanup.service';

const identity = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: async () =>
        identity.id
          ? {
              user: { id: identity.id, name: 'Test Member', email: 'test@example.test' },
            }
          : null,
    },
  },
}));
import { GET, POST } from '@/app/api/groups/[id]/drafts/route';
import { POST as reviewRoute } from '@/app/api/groups/[id]/drafts/review/route';
import { POST as saveRoute } from '@/app/api/groups/[id]/drafts/save/route';
import { removeAccountDrafts } from './draft-account-cleanup';
import { DELETE, PUT } from '@/app/api/groups/[id]/drafts/[draftId]/route';
import { GET as expenseListRoute } from '@/app/api/groups/[id]/expenses/route';
import { GET as activityRoute } from '@/app/api/groups/[id]/activity/route';

const testDb = integrationTestDb('persistent-drafts');
const groupId = 'c00000000000000000000001';
const alice = { id: 'a00000000000000000000001' };
const bob = { id: 'a00000000000000000000002' };
const stranger = { id: 'a00000000000000000000003' };
const group = new mongoose.Types.ObjectId(groupId);
const db = () => mongoose.connection.db!;
const batch = (count: number) => ({
  drafts: Array.from({ length: count }, (_, i) => ({
    description: `Taxi ${i}`,
    amount: 450,
  })),
});

beforeAll(async () => {
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await testDb.connect();
  const hello = await db().admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid')
    throw new Error(
      'Draft integration tests require TEST_MONGODB_URI pointing to an isolated replica set.',
    );
});
beforeEach(async () => {
  await testDb.reset();
  identity.id = alice.id;
  await db()
    .collection('users')
    .insertMany(
      [alice, bob].map(({ id }) => ({
        _id: new mongoose.Types.ObjectId(id),
        name: id,
        email: `${id}@example.test`,
      })),
    );
  await db()
    .collection('groups')
    .insertOne({
      _id: group,
      name: 'Test Group',
      isArchived: false,
      defaultCurrency: 'INR',
      members: [alice, bob].map(({ id }) => ({
        user: new mongoose.Types.ObjectId(id),
        role: 'admin',
      })),
    });
});
afterAll(testDb.teardown);

describe('persistent private expense Drafts', () => {
  it('retains multiple incomplete Drafts, without changing the ledger or filling missing facts', async () => {
    const created = await drafts.create(
      alice,
      groupId,
      { drafts: [{ amount: 450 }, {}] },
      'request-0001',
    );
    expect(created.map((row) => row.values)).toEqual([{ amount: 450 }, {}]);
    expect(await drafts.list(alice, groupId)).toEqual(created);
    expect(await drafts.list(bob, groupId)).toEqual([]);
    expect(created[0].missingFields).toEqual(expect.arrayContaining(['date', 'tagId', 'category']));
    const reviewed = await drafts.review(alice, groupId, created[0].id);
    expect(reviewed.problems).toEqual(
      expect.arrayContaining([
        'date: Choose the Expense date.',
        'tagId: Choose a Tag.',
        'category: Choose a Category.',
      ]),
    );
    expect(reviewed.problems.join(' ')).not.toMatch(/Invalid input|expected date|received Date/);
    expect(await db().collection('expenses').countDocuments()).toBe(0);
    expect(await db().collection('activities').countDocuments()).toBe(0);
    expect(JSON.stringify(created)).not.toMatch(/owner|requestKey|requestFingerprint/);
  });

  const context = { params: Promise.resolve({ id: groupId }) };
  const httpCreate = (count: number, key: string) =>
    POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(batch(count)),
      }),
      context,
    );
  const httpList = async () =>
    (await (await GET(new Request('http://localhost'), context)).json()).data;

  it('caps each member at 100 without blocking another member in the same Group', async () => {
    for (let i = 0; i < 10; i++) expect((await httpCreate(10, `request-${i}`)).status).toBe(201);
    const response = await httpCreate(1, 'request-over-limit');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'DRAFT_GROUP_LIMIT',
      error: 'You have 100 items waiting in this Group. Save or delete some before keeping more.',
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await httpList()).toHaveLength(100);
    identity.id = bob.id;
    expect((await httpCreate(1, 'request-bob')).status).toBe(201);
    expect(await httpList()).toHaveLength(1);
  });

  it('rejects an over-capacity HTTP batch in full and serializes concurrent creations at 95', async () => {
    for (let i = 0; i < 9; i++) await httpCreate(10, `request-${i}`);
    await httpCreate(5, 'request-last-five');
    expect((await httpCreate(6, 'request-over-batch')).status).toBe(409);
    expect(await httpList()).toHaveLength(95);
    const results = await Promise.all([
      httpCreate(5, 'request-racing-one'),
      httpCreate(5, 'request-racing-two'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await httpList()).toHaveLength(100);
  });

  it('returns member attribution for HTTP creation, edits and legacy records', async () => {
    const response = await httpCreate(1, 'request-attribution');
    const [created] = (await response.json()).data;
    expect(created).toMatchObject({
      preparedBy: { kind: 'member' },
      changedBy: { kind: 'member' },
    });
    const edited = await PUT(
      new Request('http://localhost', {
        method: 'PUT',
        headers: { 'X-Splitbook-Revision': '0' },
        body: JSON.stringify({ values: { amount: 99 } }),
      }),
      { params: Promise.resolve({ id: groupId, draftId: created.id }) },
    );
    expect((await edited.json()).data).toMatchObject({
      preparedBy: { kind: 'member' },
      changedBy: { kind: 'member' },
      revision: 1,
    });
    // Simulate a record written before attribution existed; reads need no migration.
    await db()
      .collection('expensedrafts')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(created.id) },
        { $unset: { preparedBy: '', changedBy: '' } },
      );
    expect(await httpList()).toMatchObject([
      {
        preparedBy: { kind: 'member' },
        changedBy: { kind: 'member' },
      },
    ]);
    const reviewed = await reviewRoute(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ ids: [created.id] }),
      }),
      context,
    );
    expect((await reviewed.json()).data[0].draft).toMatchObject({
      preparedBy: { kind: 'member' },
      changedBy: { kind: 'member' },
    });
  });

  it('replays concurrent creations exactly once and detects changed payloads under a key', async () => {
    const results = await Promise.all([
      drafts.create(alice, groupId, batch(2), 'request-replay'),
      drafts.create(alice, groupId, batch(2), 'request-replay'),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await drafts.list(alice, groupId)).toHaveLength(2);
    await expect(drafts.create(alice, groupId, batch(1), 'request-replay')).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('permanently erases discarded content, releases capacity and never resurrects it on retry', async () => {
    const [row] = await drafts.create(
      alice,
      groupId,
      { drafts: [{ notes: 'Private note' }] },
      'request-discard',
    );
    const discarded = await drafts.discard(alice, groupId, row.id, row.revision);
    expect(discarded.state).toBe('discarded');
    expect(await drafts.discard(alice, groupId, row.id, row.revision)).toEqual(discarded);
    const stored = await db()
      .collection('expensedrafts')
      .findOne({ _id: new mongoose.Types.ObjectId(row.id) });
    expect(stored).not.toHaveProperty('values');
    expect(JSON.stringify(stored)).not.toContain('Private note');
    expect(
      await drafts.create(
        alice,
        groupId,
        { drafts: [{ notes: 'Private note' }] },
        'request-discard',
      ),
    ).toEqual([discarded]);
    expect(await drafts.list(alice, groupId)).toEqual([]);
    await expect(drafts.replace(alice, groupId, row.id, { amount: 1 }, 1)).rejects.toThrow(
      'DRAFT_NOT_FOUND',
    );
  });

  it('protects ownership, requires revisions and rejects concurrent stale edits', async () => {
    const [row] = await drafts.create(alice, groupId, batch(1), 'request-edits');
    await expect(drafts.replace(bob, groupId, row.id, {}, 0)).rejects.toThrow('DRAFT_NOT_FOUND');
    await expect(drafts.discard(bob, groupId, row.id, 0)).rejects.toThrow('DRAFT_NOT_FOUND');
    await expect(drafts.replace(alice, groupId, row.id, {}, NaN)).rejects.toThrow(
      'REVISION_REQUIRED',
    );
    const results = await Promise.allSettled([
      drafts.replace(alice, groupId, row.id, { amount: 1 }, 0),
      drafts.replace(alice, groupId, row.id, { amount: 2 }, 0),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toMatchObject([
      { reason: new Error('STALE_REVISION') },
    ]);
    await expect(drafts.discard(alice, groupId, row.id, 0)).rejects.toThrow('STALE_REVISION');
  });

  it('rechecks membership, retains inaccessible Drafts and allows access after rejoining', async () => {
    await drafts.create(alice, groupId, batch(1), 'request-membership');
    await expect(drafts.list(stranger, groupId)).rejects.toThrow('FORBIDDEN');
    await db()
      .collection('groups')
      .updateOne({ _id: group }, { $set: { members: [] } });
    await expect(drafts.list(alice, groupId)).rejects.toThrow('FORBIDDEN');
    await expect(drafts.create(alice, groupId, batch(1), 'request-membership')).rejects.toThrow(
      'FORBIDDEN',
    );
    expect(await db().collection('expensedrafts').countDocuments()).toBe(1);
    await db()
      .collection('groups')
      .updateOne(
        { _id: group },
        {
          $set: {
            members: [{ user: new mongoose.Types.ObjectId(alice.id) }],
          },
        },
      );
    expect(await drafts.list(alice, groupId)).toHaveLength(1);
  });

  it('cleans active Drafts and discarded retry receipts when the Group is deleted', async () => {
    const [row] = await drafts.create(alice, groupId, batch(2), 'request-cleanup');
    await drafts.discard(alice, groupId, row.id, 0);
    await db()
      .collection('groups')
      .updateOne(
        { _id: group },
        {
          $set: {
            members: [{ user: new mongoose.Types.ObjectId(alice.id) }],
          },
        },
      );
    expect(await requestGroupDeletion(groupId, alice.id)).toMatchObject({ deleted: true });
    expect(await db().collection('expensedrafts').countDocuments()).toBe(0);
    await expect(drafts.create(alice, groupId, batch(1), 'request-too-late')).rejects.toThrow(
      'FORBIDDEN',
    );
  });

  it('converts the exact reviewed revision once, returns partial outcomes and retains incomplete entries', async () => {
    const tagId = new mongoose.Types.ObjectId();
    await db()
      .collection('groups')
      .updateOne(
        { _id: group },
        { $set: { tags: [{ _id: tagId, name: 'Travel', isArchived: false }] } },
      );
    const values = {
      description: 'Dinner',
      category: 'food',
      amount: 100,
      currency: 'INR',
      date: '2026-10-11',
      tagId: String(tagId),
      paidBy: [{ user: alice.id, amount: 100 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alice.id }, { user: bob.id }],
    };
    const created = await drafts.create(alice, groupId, { drafts: [values, {}] }, 'request-save');
    const reviewed = await Promise.all(created.map((row) => drafts.review(alice, groupId, row.id)));
    const command = {
      drafts: reviewed.map((row) => ({
        id: row.draft.id,
        revision: row.draft.revision,
        review: row.review,
      })),
    };
    const outcomes = await drafts.save(alice, groupId, command);
    expect(outcomes.map((row) => row.status)).toEqual(['saved', 'failed']);
    expect(await drafts.save(alice, groupId, command)).toEqual(outcomes);
    expect(await db().collection('expenses').countDocuments()).toBe(1);
    expect(await drafts.list(alice, groupId)).toHaveLength(1);
  });

  async function completeDrafts(count = 1) {
    const tagId = new mongoose.Types.ObjectId();
    await db()
      .collection('groups')
      .updateOne(
        { _id: group },
        { $set: { tags: [{ _id: tagId, name: 'Travel', isArchived: false }] } },
      );
    const values = {
      description: 'Taxi',
      category: 'transport',
      amount: 450,
      currency: 'INR',
      date: '2026-10-11',
      tagId: String(tagId),
      paidBy: [{ user: alice.id, amount: 450 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alice.id }, { user: bob.id }],
    };
    return drafts.create(
      alice,
      groupId,
      { drafts: Array.from({ length: count }, () => values) },
      'request-complete',
    );
  }
  const saveCommand = (
    review: Awaited<ReturnType<typeof drafts.review>>,
    acknowledgeDuplicates = false,
  ) => ({
    drafts: [
      {
        id: review.draft.id,
        revision: review.draft.revision,
        review: review.review,
        acknowledgeDuplicates,
      },
    ],
  });

  it.each(['assistant', 'member'] as const)(
    'carries only %s provenance through conversion and all four reads',
    async (kind) => {
      const [row] = await completeDrafts();
      const preparedBy = { kind: 'assistant', name: 'Claude' };
      if (kind === 'assistant')
        await db()
          .collection('expensedrafts')
          .updateOne({ _id: new mongoose.Types.ObjectId(row.id) }, { $set: { preparedBy } });
      const review = await drafts.review(alice, groupId, row.id);
      const outcomes = await drafts.save(alice, groupId, saveCommand(review));
      expect(outcomes[0].status).toBe('saved');
      const stored = await db().collection('expenses').findOne({ group });
      expect(stored).not.toBeNull();
      const expected = kind === 'assistant' ? preparedBy : undefined;
      expect(stored?.preparedBy).toEqual(expected);
      expect(String(stored?.createdBy)).toBe(alice.id);
      const expenseId = String(stored!._id);
      const item = { params: Promise.resolve({ id: groupId, expenseId }) };
      const request = () => new Request('http://localhost');
      const list = parseExpensePageResponse(
        await (await expenseListRoute(request(), context)).json(),
      );
      expect(list.expenses[0].preparedBy).toEqual(expected);
      const record = parseExpenseRecordResponse(
        await (await expenseRecordRoute(request(), item)).json(),
      );
      expect(record.preparedBy).toEqual(expected);
      const activity = parseActivityPageResponse(
        await (await activityRoute(request(), context)).json(),
      );
      expect(
        activity.activities.find((event) => event.type === 'expense_added')?.metadata?.preparedBy,
      ).toEqual(expected);
      const latest = parseUserActivityResponse(await (await userActivityRoute(request())).json());
      expect(
        latest.activities.find((event) => event.type === 'expense_added')?.metadata.preparedBy,
      ).toEqual(expected);
      const edited = await editExpenseRoute(
        new Request('http://localhost', {
          method: 'PATCH',
          headers: { 'X-Splitbook-Revision': String(record.revision) },
          body: JSON.stringify({
            description: 'Edited taxi',
            preparedBy: { kind: 'assistant', name: 'Forged' },
          }),
        }),
        item,
      );
      expect(edited.status).toBe(200);
      expect((await edited.json()).data.preparedBy).toEqual(expected);
      // The event keeps its own snapshot even if the source record is removed.
      await db().collection('expenses').deleteOne({ _id: stored!._id });
      const snapshot = parseUserActivityResponse(await (await userActivityRoute(request())).json());
      expect(
        snapshot.activities.find((event) => event.type === 'expense_added')?.metadata.preparedBy,
      ).toEqual(expected);
    },
  );

  it.each([false, true])(
    'form/API creation ignores forged attribution (forged: %s)',
    async (forged) => {
      const [row] = await completeDrafts();
      const response = await createExpenseRoute(
        new Request('http://localhost', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'form-request' },
          body: JSON.stringify({
            ...row.values,
            ...(forged ? { preparedBy: { kind: 'assistant', name: 'Forged' } } : {}),
          }),
        }),
        context,
      );
      expect(response.status).toBe(201);
      expect((await response.json()).data).not.toHaveProperty('preparedBy');
      expect(await db().collection('expenses').findOne({ group })).not.toHaveProperty('preparedBy');
    },
  );

  it('does not count saved or deleted items toward the HTTP member limit', async () => {
    const [row] = await completeDrafts();
    const reviewed = await reviewRoute(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ ids: [row.id] }),
      }),
      context,
    );
    const saved = await saveRoute(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify(saveCommand((await reviewed.json()).data[0])),
      }),
      context,
    );
    expect((await saved.json()).data[0].status).toBe('saved');
    const [discarded] = (await (await httpCreate(1, 'request-delete-capacity')).json()).data;
    expect(
      (
        await DELETE(
          new Request('http://localhost', {
            method: 'DELETE',
            headers: { 'X-Splitbook-Revision': '0' },
          }),
          { params: Promise.resolve({ id: groupId, draftId: discarded.id }) },
        )
      ).status,
    ).toBe(200);
    for (let i = 0; i < 10; i++)
      expect((await httpCreate(10, `request-refill-${i}`)).status).toBe(201);
    expect(await httpList()).toHaveLength(100);
  });

  it('keeps the assistant preparer while recording HTTP edits and deletion as the member', async () => {
    const [row] = await drafts.create(
      { ...alice, assistant: { name: 'Synthetic Assistant' } },
      groupId,
      batch(1),
      'assistant-prepared',
    );
    const item = { params: Promise.resolve({ id: groupId, draftId: row.id }) };
    const edited = await PUT(
      new Request('http://localhost', {
        method: 'PUT',
        headers: { 'X-Splitbook-Revision': '0' },
        body: JSON.stringify({ values: { amount: 123 } }),
      }),
      item,
    );
    expect((await edited.json()).data).toMatchObject({
      preparedBy: { kind: 'assistant', name: 'Synthetic Assistant' },
      changedBy: { kind: 'member' },
    });
    const removed = await DELETE(
      new Request('http://localhost', {
        method: 'DELETE',
        headers: { 'X-Splitbook-Revision': '1' },
      }),
      item,
    );
    expect((await removed.json()).data).toMatchObject({
      state: 'discarded',
      preparedBy: { kind: 'assistant', name: 'Synthetic Assistant' },
      changedBy: { kind: 'member' },
    });
  });

  it('keeps an unspecified Category unresolved until it is explicitly reviewed', async () => {
    const [complete] = await completeDrafts();
    const values = { ...complete.values };
    delete values.category;
    const row = await drafts.replace(alice, groupId, complete.id, values, complete.revision);
    expect(row.values).not.toHaveProperty('category');
    expect(row.missingFields).toContain('category');
    const review = await drafts.review(alice, groupId, row.id);
    expect(review.problems.some((problem) => problem.startsWith('category:'))).toBe(true);
    expect((await drafts.save(alice, groupId, saveCommand(review)))[0].status).toBe('failed');
    expect(await db().collection('expenses').countDocuments()).toBe(0);
    await drafts.replace(alice, groupId, row.id, { ...values, category: 'other' }, row.revision);
    const resolved = await drafts.review(alice, groupId, row.id);
    expect((await drafts.save(alice, groupId, saveCommand(resolved)))[0].status).toBe('saved');
    expect(await db().collection('expenses').findOne({ group })).toMatchObject({
      category: 'other',
    });
  });

  it('binds duplicate acknowledgment to this owner’s visible warning set and refuses stale warnings', async () => {
    const [first, second] = await completeDrafts(2);
    await drafts.create(bob, groupId, { drafts: [first.values] }, 'request-private-bob');
    const reviewed = await drafts.review(alice, groupId, first.id);
    expect(reviewed.duplicates.map((row) => row.id)).toEqual([second.id]);
    expect((await drafts.save(alice, groupId, saveCommand(reviewed)))[0].status).toBe('failed');
    await drafts.replace(alice, groupId, second.id, { ...second.values, notes: 'changed' }, 0);
    expect((await drafts.save(alice, groupId, saveCommand(reviewed, true)))[0].status).toBe(
      'failed',
    );
    const fresh = await drafts.review(alice, groupId, first.id);
    expect((await drafts.save(alice, groupId, saveCommand(fresh, true)))[0].status).toBe('saved');
    const next = await drafts.review(alice, groupId, second.id);
    expect(next.duplicates[0].kind).toBe('expense');
  });

  it('requires fresh review after rejoining and rejects stale edits before conversion', async () => {
    const [row] = await completeDrafts();
    const review = await drafts.review(alice, groupId, row.id);
    await db()
      .collection('groups')
      .updateOne({ _id: group }, { $set: { 'members.0.joinedAt': new Date() } });
    expect((await drafts.save(alice, groupId, saveCommand(review)))[0].status).toBe('failed');
    const fresh = await drafts.review(alice, groupId, row.id);
    await drafts.replace(alice, groupId, row.id, { ...row.values, amount: 460 }, 0);
    expect((await drafts.save(alice, groupId, saveCommand(fresh)))[0]).toMatchObject({
      status: 'failed',
      message: 'STALE_REVISION',
    });
    expect(await db().collection('expenses').countDocuments()).toBe(0);
  });

  it('has one terminal outcome when save races discard, without resurrecting content', async () => {
    const [row] = await completeDrafts();
    const reviewed = await drafts.review(alice, groupId, row.id);
    await Promise.allSettled([
      drafts.save(alice, groupId, saveCommand(reviewed)),
      drafts.discard(alice, groupId, row.id, 0),
    ]);
    const stored = await db()
      .collection('expensedrafts')
      .findOne({ _id: new mongoose.Types.ObjectId(row.id) });
    expect(['saved', 'discarded']).toContain(stored?.state);
    expect(stored).not.toHaveProperty('values');
    expect(await db().collection('expenses').countDocuments()).toBe(
      stored?.state === 'saved' ? 1 : 0,
    );
    expect(await drafts.list(alice, groupId)).toEqual([]);
  });

  it('removes account content and receipts while fencing concurrent future writes', async () => {
    await drafts.create(alice, groupId, batch(2), 'request-account');
    await drafts.create(bob, groupId, batch(1), 'request-other-account');
    await Promise.allSettled([
      removeAccountDrafts(alice.id),
      drafts.create(alice, groupId, batch(1), 'request-during-deletion'),
    ]);
    expect(
      await db()
        .collection('expensedrafts')
        .countDocuments({ owner: new mongoose.Types.ObjectId(alice.id) }),
    ).toBe(0);
    expect(await drafts.list(bob, groupId)).toHaveLength(1);
    await expect(drafts.create(alice, groupId, batch(1), 'request-late-account')).rejects.toThrow(
      'FORBIDDEN',
    );
  });

  it('reviews and saves through the authenticated HTTP boundary and denies assistant conversion', async () => {
    const [row] = await completeDrafts();
    const context = { params: Promise.resolve({ id: groupId }) };
    const review = await reviewRoute(
      new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ids: [row.id] }) }),
      context,
    );
    expect(review.status).toBe(200);
    expect(review.headers.get('Cache-Control')).toBe('private, no-store');
    const reviewed = (await review.json()).data[0];
    await expect(
      drafts.save({ ...alice, authorize: async () => {} }, groupId, saveCommand(reviewed)),
    ).rejects.toThrow('FORBIDDEN');
    const saved = await saveRoute(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify(saveCommand(reviewed)),
      }),
      context,
    );
    expect((await saved.json()).data[0].status).toBe('saved');
    expect(await db().collection('activities').countDocuments({ type: 'expense_added' })).toBe(1);
  });

  it('leaves no Drafts or replay receipts when creation races final Group deletion', async () => {
    await db()
      .collection('groups')
      .updateOne(
        { _id: group },
        { $set: { members: [{ user: new mongoose.Types.ObjectId(alice.id) }] } },
      );
    const outcomes = await Promise.allSettled([
      drafts.create(alice, groupId, batch(2), 'request-deletion-race'),
      requestGroupDeletion(groupId, alice.id),
    ]);
    expect(outcomes[1].status).toBe('fulfilled');
    expect(await db().collection('groups').countDocuments({ _id: group })).toBe(0);
    expect(await db().collection('expensedrafts').countDocuments({ group })).toBe(0);
  });

  it('enforces HTTP auth, validation, private responses and revision headers', async () => {
    const context = { params: Promise.resolve({ id: groupId }) };
    identity.id = null;
    expect((await GET(new Request('http://localhost'), context)).status).toBe(401);
    identity.id = alice.id;
    for (const input of [batch(11), { drafts: [{ owner: bob.id }] }]) {
      const response = await POST(
        new Request('http://localhost', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'request-invalid' },
          body: JSON.stringify(input),
        }),
        context,
      );
      expect(response.status).toBe(422);
    }
    expect(await drafts.list(alice, groupId)).toEqual([]);
    const oversized = await POST(
      new Request('http://localhost', { method: 'POST', body: ' '.repeat(128 * 1024 + 1) }),
      context,
    );
    expect(oversized.status).toBe(413);
    const crossOrigin = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { Origin: 'https://other.example', 'Idempotency-Key': 'request-foreign-origin' },
        body: JSON.stringify(batch(1)),
      }),
      context,
    );
    expect(crossOrigin.status).toBe(403);
    const [row] = await drafts.create(alice, groupId, batch(1), 'request-http');
    const item = { params: Promise.resolve({ id: groupId, draftId: row.id }) };
    expect(
      (await PUT(new Request('http://localhost', { method: 'PUT', body: '{"values":{}}' }), item))
        .status,
    ).toBe(428);
    const response = await DELETE(
      new Request('http://localhost', {
        method: 'DELETE',
        headers: { 'X-Splitbook-Revision': '0' },
      }),
      item,
    );
    expect(response.status).toBe(200);
    expect(await drafts.list(alice, groupId)).toEqual([]);
  });
  it.each(['projection', 'acknowledgment'] as const)(
    'keeps a reviewed Expense saved and replayable through an Activity %s outage',
    async (fault) => {
      const [row] = await completeDrafts();
      const reviewed = await drafts.review(alice, groupId, row.id);
      const command = saveCommand(reviewed);
      const context = { params: Promise.resolve({ id: groupId }) };
      const target = fault === 'projection' ? 'activities' : 'expenses';
      await db()
        .createCollection(target)
        .catch((error) => {
          if (error.code !== 48) throw error;
        });
      await db().command({
        collMod: target,
        validationLevel: 'strict',
        validationAction: 'error',
        validator: {
          $jsonSchema:
            fault === 'projection'
              ? { required: ['testProjectionPermit'] }
              : { properties: { pendingActivity: { bsonType: 'array', minItems: 1 } } },
        },
      });
      const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
      const save = async () =>
        saveRoute(
          new Request('http://localhost', { method: 'POST', body: JSON.stringify(command) }),
          context,
        );
      const list = async () =>
        (await (await expenseListRoute(new Request('http://localhost'), context)).json()).data;
      const activity = async () =>
        (await (await activityRoute(new Request('http://localhost'), context)).json()).data;
      try {
        const response = await save();
        expect(response.status).toBe(200);
        const outcomes = (await response.json()).data;
        expect(outcomes).toMatchObject([{ id: row.id, status: 'saved' }]);
        expect((await (await save()).json()).data).toEqual(outcomes);
        const saved = await list();
        expect(saved.pagination.total).toBe(1);
        expect(saved.expenses[0]).toMatchObject({
          _id: outcomes[0].expenseId,
          description: 'Taxi',
          amount: 450,
          currency: 'INR',
          splitBetween: [{ amount: 225 }, { amount: 225 }],
        });
        expect(await drafts.list(alice, groupId)).toEqual([]);
        expect((await activity()).activities).toHaveLength(fault === 'projection' ? 0 : 1);
      } finally {
        await db().command({ collMod: target, validator: {} });
        logs.mockRestore();
      }
      const recovered = (await activity()).activities;
      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({ type: 'expense_added', metadata: { amount: 450 } });
      expect((await activity()).activities).toHaveLength(1);
      expect((await list()).pagination.total).toBe(1);
    },
  );
  it('publishes nothing from an aborted Draft conversion and resolves its original retry once', async () => {
    const [row] = await completeDrafts();
    const reviewed = await drafts.review(alice, groupId, row.id);
    const command = saveCommand(reviewed);
    const context = { params: Promise.resolve({ id: groupId }) };
    await db().command({
      collMod: 'expensedrafts',
      validator: { state: 'active' },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    const save = async () =>
      (
        await (
          await saveRoute(
            new Request('http://localhost', { method: 'POST', body: JSON.stringify(command) }),
            context,
          )
        ).json()
      ).data;
    try {
      expect(await save()).toMatchObject([{ id: row.id, status: 'unresolved' }]);
      const expenses = (
        await (await expenseListRoute(new Request('http://localhost'), context)).json()
      ).data;
      const activity = (
        await (await activityRoute(new Request('http://localhost'), context)).json()
      ).data;
      expect(expenses.pagination.total).toBe(0);
      expect(activity.activities).toEqual([]);
      expect(await drafts.list(alice, groupId)).toEqual([row]);
    } finally {
      await db().command({ collMod: 'expensedrafts', validator: {} });
    }
    const outcomes = await save();
    expect(outcomes).toMatchObject([{ id: row.id, status: 'saved' }]);
    expect(await save()).toEqual(outcomes);
    const expenses = (
      await (await expenseListRoute(new Request('http://localhost'), context)).json()
    ).data;
    const activity = (await (await activityRoute(new Request('http://localhost'), context)).json())
      .data;
    expect(expenses.pagination.total).toBe(1);
    expect(activity.activities).toHaveLength(1);
    expect(activity.activities[0].metadata.expenseId).toBe(outcomes[0].expenseId);
  });
});
