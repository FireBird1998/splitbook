/** Authenticated route boundary, real isolated MongoDB; only Better Auth's session is a stand-in. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { GET, POST } from './route';
import { GET as CHECK } from './[requestId]/route';
import type { TagActionResult, TagCommand, TagSnapshot } from '@splitbook/shared/tag-management';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.userId
          ? {
              user: { id: session.userId, name: 'Tester', email: 'tester@splitbook-test.local' },
            }
          : null,
      ),
    },
  },
}));
const db = integrationTestDb('tag-actions-route');
const { alice, bob, carol } = TEST_USER_IDS;
beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol');
  session.userId = alice;
});
afterAll(db.teardown);
async function fixture() {
  const group = await groupService.create(
    { name: 'Fictional cabin', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  return String(group._id);
}
async function snapshot(id: string): Promise<TagSnapshot> {
  const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  return (await response.json()).data;
}
async function submit(id: string, command: TagCommand) {
  const response = await POST(
    new Request('http://localhost', { method: 'POST', body: JSON.stringify(command) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}
async function check(id: string, requestId: string): Promise<TagActionResult> {
  const response = await CHECK(new Request('http://localhost'), {
    params: Promise.resolve({ id, requestId }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).data;
}
it('creates a Tag once, checks without applying, and replays its exact receipt', async () => {
  const id = await fixture();
  const command: TagCommand = {
    requestId: randomUUID(),
    intent: { action: 'create', name: 'Villa' },
  };
  expect(await check(id, command.requestId)).toMatchObject({ state: 'not-applied' });
  expect((await snapshot(id)).tags.some((tag) => tag.name === 'Villa')).toBe(false);
  const first = await submit(id, command);
  expect(first.status).toBe(200);
  expect(first.body.data).toMatchObject({
    state: 'applied',
    requestId: command.requestId,
    receipt: { intent: command.intent },
  });
  expect(await check(id, command.requestId)).toEqual(first.body.data);
  expect((await submit(id, command)).body.data).toEqual(first.body.data);
  expect((await snapshot(id)).tags.filter((tag) => tag.name === 'Villa')).toHaveLength(1);
});
it('rejects a stale rename and recovers the confirmed earlier action separately from current state', async () => {
  const id = await fixture();
  const original = (await snapshot(id)).tags[0];
  const command: TagCommand = {
    requestId: randomUUID(),
    intent: {
      action: 'rename',
      tagId: original.id,
      expectedRevision: original.revision,
      name: 'Villa',
    },
  };
  const first = await submit(id, command);
  expect(first.status).toBe(200);
  const superseding: TagCommand = {
    requestId: randomUUID(),
    intent: {
      action: 'rename',
      tagId: original.id,
      expectedRevision: original.revision + 1,
      name: 'Cabin',
    },
  };
  expect((await submit(id, superseding)).status).toBe(200);
  const stale = await submit(id, { ...command, requestId: randomUUID() });
  expect(stale).toMatchObject({
    status: 409,
    body: {
      code: 'TAG_CHANGED',
      snapshot: {
        tags: expect.arrayContaining([expect.objectContaining({ id: original.id, name: 'Cabin' })]),
      },
    },
  });
  const recovered = await check(id, command.requestId);
  expect(recovered).toMatchObject({
    state: 'applied',
    receipt: { intent: command.intent },
    snapshot: {
      tags: expect.arrayContaining([
        expect.objectContaining({
          id: original.id,
          name: 'Cabin',
          revision: original.revision + 2,
        }),
      ]),
    },
  });
  expect((await submit(id, command)).body.data).toEqual(recovered);
  expect(
    await submit(id, {
      ...command,
      intent: {
        action: 'rename',
        tagId: original.id,
        expectedRevision: original.revision,
        name: 'Other',
      },
    }),
  ).toMatchObject({ status: 409, body: { code: 'REQUEST_KEY_REUSED' } });
});
it('reserves archived names, restores the same identity, and prevents concurrent retirement of every active Tag', async () => {
  const id = await fixture();
  const tags = (await snapshot(id)).tags;
  const first = tags[0];
  const archive: TagCommand = {
    requestId: randomUUID(),
    intent: { action: 'archive', tagId: first.id, expectedRevision: first.revision },
  };
  expect((await submit(id, archive)).status).toBe(200);
  expect(
    await submit(id, {
      requestId: randomUUID(),
      intent: { action: 'create', name: first.name.toLowerCase() },
    }),
  ).toMatchObject({
    status: 409,
    body: {
      code: 'TAG_EXISTS',
      existingTagId: first.id,
      snapshot: {
        tags: expect.arrayContaining([expect.objectContaining({ id: first.id, isArchived: true })]),
      },
    },
  });
  expect(
    (
      await submit(id, {
        requestId: randomUUID(),
        intent: { action: 'restore', tagId: first.id, expectedRevision: 1 },
      })
    ).status,
  ).toBe(200);
  for (const tag of tags.slice(2))
    expect(
      (
        await submit(id, {
          requestId: randomUUID(),
          intent: { action: 'archive', tagId: tag.id, expectedRevision: tag.revision },
        })
      ).status,
    ).toBe(200);
  const remaining = (await snapshot(id)).tags.filter((tag) => !tag.isArchived && !tag.isDeleted);
  expect(remaining).toHaveLength(2);
  const results = await Promise.all(
    remaining.map((tag) =>
      submit(id, {
        requestId: randomUUID(),
        intent: { action: 'delete', tagId: tag.id, expectedRevision: tag.revision },
      }),
    ),
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(results.find((result) => result.status === 409)?.body.code).toBe('LAST_ACTIVE_TAG');
  expect((await snapshot(id)).tags.filter((tag) => !tag.isArchived && !tag.isDeleted)).toHaveLength(
    1,
  );
  expect(await check(id, archive.requestId)).toMatchObject({
    state: 'applied',
    receipt: { intent: archive.intent },
  });
});
it('separates admin loss from membership loss and scopes receipts to the submitting account', async () => {
  const id = await fixture();
  await groupService.addMember(id, bob, 'admin');
  await groupService.addMember(id, carol);
  const command: TagCommand = {
    requestId: randomUUID(),
    intent: { action: 'create', name: 'Villa' },
  };
  expect((await submit(id, command)).status).toBe(200);
  session.userId = bob;
  expect(await check(id, command.requestId)).toMatchObject({ state: 'not-applied' });
  await groupService.updateMemberRole(id, alice, 'member', bob);
  session.userId = alice;
  expect((await snapshot(id)).canManage).toBe(false);
  expect(await check(id, command.requestId)).toMatchObject({
    state: 'applied',
    snapshot: { canManage: false },
  });
  expect(await submit(id, command)).toMatchObject({
    status: 403,
    body: { code: 'TAG_ADMIN_REQUIRED' },
  });
  await groupService.removeMember(id, alice, bob);
  const response = await CHECK(new Request('http://localhost'), {
    params: Promise.resolve({ id, requestId: command.requestId }),
  });
  expect(response.status).toBe(403);
  expect((await response.json()).code).not.toBe('TAG_ADMIN_REQUIRED');
});
it('rejects old forms without their request identity and reviewed version', async () => {
  const { POST: oldCreate } = await import('../tags/route');
  const { PATCH: oldUpdate, DELETE: oldDelete } = await import('../tags/[tagId]/route');
  const id = await fixture();
  const tagId = (await snapshot(id)).tags[0].id;
  for (const [method, handler, body] of [
    ['POST', oldCreate, { name: 'Villa' }],
    ['PATCH', oldUpdate, { name: 'Villa' }],
    ['DELETE', oldDelete, undefined],
  ] as const) {
    const response = await handler(
      new Request('http://localhost', { method, ...(body ? { body: JSON.stringify(body) } : {}) }),
      { params: Promise.resolve({ id, tagId }) },
    );
    expect(response.status).toBe(428);
  }
});
it('removes account-owned recovery receipts and refuses later actions when account cleanup starts', async () => {
  const { removeAccountDrafts } = await import('@/lib/services/draft-account-cleanup');
  const id = await fixture();
  const command: TagCommand = {
    requestId: randomUUID(),
    intent: { action: 'create', name: 'Villa' },
  };
  expect((await submit(id, command)).status).toBe(200);
  await removeAccountDrafts(alice);
  expect(await check(id, command.requestId)).toMatchObject({ state: 'not-applied' });
  expect(
    (await submit(id, { requestId: randomUUID(), intent: { action: 'create', name: 'Cabin' } }))
      .status,
  ).toBe(403);
});

it.each(['create', 'rename', 'archive', 'restore', 'delete'] as const)(
  'recovers a lost %s reply after later changes without replaying its effect',
  async (action) => {
    const id = await fixture();
    const tag = (await snapshot(id)).tags[0];
    if (action === 'restore')
      expect(
        (
          await submit(id, {
            requestId: randomUUID(),
            intent: { action: 'archive', tagId: tag.id, expectedRevision: tag.revision },
          })
        ).status,
      ).toBe(200);
    const intent: TagCommand['intent'] =
      action === 'create'
        ? { action, name: 'Villa' }
        : action === 'rename'
          ? { action, tagId: tag.id, expectedRevision: tag.revision, name: 'Villa' }
          : {
              action,
              tagId: tag.id,
              expectedRevision: action === 'restore' ? tag.revision + 1 : tag.revision,
            };
    const command = { requestId: randomUUID(), intent };
    const first = await submit(id, command);
    expect(first.status).toBe(200);
    const receipt = first.body.data.receipt;
    if (action === 'delete') {
      expect(
        (
          await submit(id, {
            requestId: randomUUID(),
            intent: { action: 'create', name: tag.name },
          })
        ).status,
      ).toBe(200);
    } else {
      const latest = (await snapshot(id)).tags.find((item) => item.id === receipt.tagId)!;
      expect(
        (
          await submit(id, {
            requestId: randomUUID(),
            intent: {
              action: 'rename',
              tagId: latest.id,
              expectedRevision: latest.revision,
              name: 'Later saved name',
            },
          })
        ).status,
      ).toBe(200);
    }
    const before = await snapshot(id);
    expect(await check(id, command.requestId)).toEqual({
      state: 'applied',
      requestId: command.requestId,
      receipt,
      snapshot: before,
    });
    expect((await submit(id, command)).body.data).toEqual({
      state: 'applied',
      requestId: command.requestId,
      receipt,
      snapshot: before,
    });
    expect(await snapshot(id)).toEqual(before);
  },
);

it('keeps an unapplied stale action unapplied when checked and explicitly retried', async () => {
  const id = await fixture();
  const tag = (await snapshot(id)).tags[0];
  const neverSent: TagCommand = {
    requestId: randomUUID(),
    intent: { action: 'archive', tagId: tag.id, expectedRevision: tag.revision },
  };
  expect(
    (
      await submit(id, {
        requestId: randomUUID(),
        intent: {
          action: 'rename',
          tagId: tag.id,
          expectedRevision: tag.revision,
          name: 'Changed elsewhere',
        },
      })
    ).status,
  ).toBe(200);
  const before = await snapshot(id);
  expect(await check(id, neverSent.requestId)).toMatchObject({
    state: 'not-applied',
    snapshot: before,
  });
  expect(await submit(id, neverSent)).toMatchObject({
    status: 409,
    body: { code: 'TAG_CHANGED', snapshot: before },
  });
  expect(await check(id, neverSent.requestId)).toMatchObject({
    state: 'not-applied',
    snapshot: before,
  });
});

it('isolates request identities by Group and admits one winner to a duplicate-name race', async () => {
  const id = await fixture();
  const other = await fixture();
  const command: TagCommand = {
    requestId: randomUUID(),
    intent: { action: 'create', name: 'Villa' },
  };
  expect((await submit(id, command)).status).toBe(200);
  expect(await check(other, command.requestId)).toMatchObject({ state: 'not-applied' });
  const results = await Promise.all([
    submit(other, command),
    submit(other, { requestId: randomUUID(), intent: { action: 'create', name: 'vILLA' } }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(results.find((result) => result.status === 409)?.body.code).toBe('TAG_EXISTS');
  expect(
    (await snapshot(other)).tags.filter((tag) => tag.name.toLowerCase() === 'villa'),
  ).toHaveLength(1);
});

it('reads historical zero-active Groups and repairs one explicitly', async () => {
  const { default: Group } = await import('@/lib/models/Group');
  const id = await fixture();
  await Group.updateOne({ _id: id }, { $set: { 'tags.$[].isArchived': true } });
  const before = await snapshot(id);
  expect(before.tags.filter((tag) => !tag.isArchived && !tag.isDeleted)).toHaveLength(0);
  const restored = before.tags[0];
  expect(
    (
      await submit(id, {
        requestId: randomUUID(),
        intent: { action: 'restore', tagId: restored.id, expectedRevision: restored.revision },
      })
    ).status,
  ).toBe(200);
  expect(
    (await snapshot(id)).tags
      .filter((tag) => !tag.isArchived && !tag.isDeleted)
      .map((tag) => tag.id),
  ).toEqual([restored.id]);
  const response = await submit(id, {
    requestId: randomUUID(),
    intent: { action: 'archive', tagId: restored.id, expectedRevision: restored.revision + 1 },
  });
  expect(response).toMatchObject({ status: 409, body: { code: 'LAST_ACTIVE_TAG' } });
});

it('reads a pre-Tag historical Group without inventing Tags and allows explicit creation', async () => {
  const { default: Group } = await import('@/lib/models/Group');
  const id = await fixture();
  await Group.updateOne({ _id: id }, { $unset: { tags: '' } });
  expect(await snapshot(id)).toEqual({ canManage: true, tags: [] });
  expect(
    (
      await submit(id, {
        requestId: randomUUID(),
        intent: { action: 'create', name: 'First explicit Tag' },
      })
    ).status,
  ).toBe(200);
  expect((await snapshot(id)).tags.map((tag) => tag.name)).toEqual(['First explicit Tag']);
});
