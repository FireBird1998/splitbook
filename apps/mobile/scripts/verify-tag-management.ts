/** Fictional loopback-only Tag lifecycle verification through authenticated HTTP. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  tagActionResultSchema,
  tagCommandSchema,
  tagSnapshotSchema,
} from '@splitbook/shared/tag-management';
import { createMobileController } from '../src/data';
import { FixtureActor, samId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';
import { reportVerifierFailure } from './verify-report';

/** The same memory survives two controllers, as device stores survive a process restart. */
async function verifyAndroidRestart(
  origin: string,
  groupId: string,
  actor: FixtureActor,
  other: FixtureActor,
) {
  const memory = () => {
    const rows = new Map<string, unknown>();
    return {
      load: async (accountId: string, id: string) =>
        structuredClone(rows.get(`${accountId}:${id}`) ?? null),
      save: async (accountId: string, id: string, value: unknown) => {
        rows.set(`${accountId}:${id}`, structuredClone(value));
      },
      remove: async (accountId: string, id: string) => {
        rows.delete(`${accountId}:${id}`);
      },
      clear: async () => {
        rows.clear();
      },
      keys: async (accountId: string) =>
        [...rows.keys()]
          .filter((key) => key.startsWith(`${accountId}:`))
          .map((key) => key.slice(accountId.length + 1)),
    };
  };
  const tagRequests = memory(),
    expenseDrafts = memory();
  let cookie: string | null = null,
    accountId: string | null = null,
    cleanup = false,
    loseReply = true;
  const path = `/api/groups/${groupId}/tag-actions`;
  const submitted: string[] = [];
  const boot = () =>
    createMobileController(
      { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
      {
        fetch: async (url, init) => {
          assert.equal(
            new URL(url).origin,
            origin,
            'Android must only contact the guarded loopback origin.',
          );
          const tagWrite = init.method === 'POST' && new URL(url).pathname === path;
          if (tagWrite) submitted.push(String(init.body));
          const response = await fetch(url, { ...init, redirect: 'error' });
          if (tagWrite && loseReply) {
            loseReply = false;
            assert.equal(
              response.status,
              200,
              'Only a committed fictional Tag reply may be dropped.',
            );
            await response.arrayBuffer();
            throw new TypeError('Controlled loss of committed Android Tag reply');
          }
          return response;
        },
        tagRequests,
        expenseDrafts,
        newSubmissionKey: randomUUID,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        accountLocal: {
          owner: {
            load: async () => accountId,
            save: async (value) => {
              accountId = value;
            },
            clear: async () => {
              accountId = null;
            },
          },
          cleanupMarker: {
            load: async () => cleanup,
            mark: async () => {
              cleanup = true;
            },
            clear: async () => {
              cleanup = false;
            },
          },
          stores: [tagRequests, expenseDrafts],
        },
      },
    );
  let controller = boot();
  try {
    await controller.signIn('alex');
    assert.equal(controller.getSnapshot().auth.status, 'authenticated');
    const first = controller.groupTags(groupId);
    await assert.rejects(() => first.submit({ action: 'create', name: 'Android villa' }));
    assert.equal(submitted.length, 1);
    const original = tagCommandSchema.parse(JSON.parse(submitted[0]));
    assert.deepEqual(await first.pending(), original);
    controller.dispose();

    // Receipts belong to their actor. Another admin sees no receipt but can rename the Tag.
    const foreign = z
      .object({ data: tagActionResultSchema })
      .parse(await other.request(`${path}/${original.requestId}`)).data;
    assert.equal(foreign.state, 'not-applied');
    const observed = z
      .object({ data: tagActionResultSchema })
      .parse(await actor.request(`${path}/${original.requestId}`)).data;
    assert.equal(observed.state, 'applied');
    if (observed.state !== 'applied') throw new Error('The dropped Android action did not commit.');
    const tagId = observed.receipt.tagId;
    await other.changeTag(groupId, { action: 'rename', tagId, name: 'Android lodge' });

    controller = boot();
    await controller.restore();
    assert.equal(controller.getSnapshot().auth.status, 'authenticated');
    assert.equal(submitted.length, 1, 'Restoring a session must never replay a Tag action.');
    const reopened = controller.groupTags(groupId);
    assert.deepEqual(await reopened.pending(), original);
    assert.equal(submitted.length, 1, 'Reading recovery must never replay a Tag action.');
    const checked = await reopened.check();
    assert.equal(submitted.length, 1, 'Check must be read-only.');
    assert.equal(checked.state, 'applied');
    if (checked.state !== 'applied')
      throw new Error('Android could not confirm the committed action.');
    assert.deepEqual(checked.receipt.intent, original.intent);
    assert.equal(checked.receipt.tagId, tagId);
    assert.equal(checked.snapshot.tags.find((tag) => tag.id === tagId)?.name, 'Android lodge');

    const retried = await reopened.retry();
    assert.equal(submitted.length, 2);
    assert.equal(
      submitted[1],
      submitted[0],
      'Android Retry must send the identical original command.',
    );
    assert.equal(retried.state, 'applied');
    if (retried.state !== 'applied')
      throw new Error('Android could not recover its original receipt.');
    assert.equal(retried.receipt.tagId, tagId);
    assert.deepEqual(retried.receipt.intent, original.intent);
    assert.equal(retried.snapshot.tags.filter((tag) => tag.id === tagId).length, 1);
    assert.equal(retried.snapshot.tags.find((tag) => tag.id === tagId)?.name, 'Android lodge');
    assert.equal(
      retried.snapshot.tags.some((tag) => !tag.isDeleted && tag.name === 'Android villa'),
      false,
    );
    await reopened.acknowledge();
    assert.equal(await reopened.pending(), null);

    await controller.openExpense(groupId);
    assert.equal(controller.getSnapshot().expense.status, 'editing');
    const currentTag = controller
      .getSnapshot()
      .expense.context?.tags.find((tag) => tag.id === tagId);
    assert.equal(currentTag?.name, 'Android lodge');
    assert.equal(currentTag?.isArchived, false);
    await controller.updateExpenseDraft({ tagId });
    assert.equal(controller.getSnapshot().expense.draft?.tagId, tagId);
    console.log(
      'PASS Android controller restart retains exact intent; Check is read-only; explicit Retry preserves identity and later rename; Expense selects the current active Tag.',
    );
  } finally {
    try {
      await controller.signOut();
    } finally {
      controller.dispose();
    }
  }
}

async function main() {
  const actor = new FixtureActor(localOrigin());
  const other = new FixtureActor(localOrigin());
  let groupId: string | undefined;
  const run = randomUUID();
  try {
    await actor.signIn('alex');
    await other.signIn('sam');
    groupId = z.object({ data: z.object({ _id: z.string() }) }).parse(
      await actor.request(
        '/api/groups',
        'POST',
        {
          name: `QA Tags ${run}`,
          description: `Fictional Tag verification ${run}`,
          category: 'home',
          defaultCurrency: 'INR',
          alternateCurrencies: [],
        },
        201,
      ),
    ).data._id;
    const path = `/api/groups/${groupId}/tag-actions`;
    const invite = z
      .object({ data: z.object({ inviteCode: z.string() }) })
      .parse(await actor.request(`/api/groups/${groupId}/invite-link`, 'POST', {}, 201))
      .data.inviteCode;
    await other.request(`/api/join/${invite}`, 'POST', undefined, 201);
    const denied = z.object({ code: z.string() }).parse(
      await other.request(
        path,
        'POST',
        {
          requestId: randomUUID(),
          intent: { action: 'create', name: 'Member cannot create' },
        },
        403,
      ),
    );
    assert.equal(denied.code, 'TAG_ADMIN_REQUIRED');
    await other.request(`/api/groups/${groupId}`);
    await actor.request(`/api/groups/${groupId}/members/${samId}`, 'PATCH', { role: 'admin' });
    await verifyAndroidRestart(localOrigin(), groupId, actor, other);
    const command = { requestId: randomUUID(), intent: { action: 'create', name: 'Villa' } };
    const before = z
      .object({ data: tagActionResultSchema })
      .parse(await actor.request(`${path}/${command.requestId}`)).data;
    assert.equal(before.state, 'not-applied');
    assert.equal(
      before.snapshot.tags.some((tag) => tag.name === 'Villa'),
      false,
    );
    const result = z
      .object({ data: tagActionResultSchema })
      .parse(await actor.request(path, 'POST', command)).data;
    assert.equal(result.state, 'applied');
    if (result.state !== 'applied') throw new Error('Create was not applied');
    const id = result.receipt.tagId;
    assert.equal(result.snapshot.tags.find((tag) => tag.id === id)?.name, 'Villa');
    await other.changeTag(groupId, { action: 'rename', tagId: id, name: 'Lodge' });
    const checked = z
      .object({ data: tagActionResultSchema })
      .parse(await actor.request(`${path}/${command.requestId}`)).data;
    assert.equal(checked.state, 'applied');
    if (checked.state !== 'applied') throw new Error('Committed action was not confirmed');
    assert.equal(checked.receipt.tagId, id);
    assert.deepEqual(checked.receipt.intent, command.intent);
    assert.equal(checked.snapshot.tags.find((tag) => tag.id === id)?.name, 'Lodge');
    const retried = z
      .object({ data: tagActionResultSchema })
      .parse(await actor.request(path, 'POST', command)).data;
    assert.equal(retried.state, 'applied');
    const current = z.object({ data: tagSnapshotSchema }).parse(await actor.request(path)).data;
    assert.equal(current.tags.filter((tag) => tag.id === id).length, 1);
    assert.equal(
      current.tags.some((tag) => tag.name === 'Villa'),
      false,
    );
    assert.equal(current.tags.find((tag) => tag.id === id)?.name, 'Lodge');
    console.log('PASS Tag creation Check and exact Retry preserve identity after a later rename.');
    for (const action of ['archive', 'restore', 'rename', 'delete'] as const) {
      const reviewed = z
        .object({ data: tagSnapshotSchema })
        .parse(await actor.request(path))
        .data.tags.find((tag) => tag.id === id)!;
      const intent =
        action === 'rename'
          ? { action, tagId: id, expectedRevision: reviewed.revision, name: 'Cabin' }
          : { action, tagId: id, expectedRevision: reviewed.revision };
      const request = { requestId: randomUUID(), intent };
      // Discard the successful reply, as a client interrupted before receiving it would.
      await actor.request(path, 'POST', request);
      if (action === 'archive') await other.changeTag(groupId, { action: 'restore', tagId: id });
      if (action === 'restore') await other.changeTag(groupId, { action: 'archive', tagId: id });
      if (action === 'rename')
        await other.changeTag(groupId, { action: 'rename', tagId: id, name: 'Later cabin' });
      if (action === 'delete')
        await other.changeTag(groupId, { action: 'create', name: 'Later cabin' });
      const saved = z.object({ data: tagSnapshotSchema }).parse(await actor.request(path)).data;
      const reconnected = new FixtureActor(localOrigin());
      try {
        await reconnected.signIn('alex');
        const checkedAgain = z
          .object({ data: tagActionResultSchema })
          .parse(await reconnected.request(`${path}/${request.requestId}`)).data;
        assert.equal(checkedAgain.state, 'applied');
        if (checkedAgain.state !== 'applied')
          throw new Error('The interrupted action was not recovered.');
        assert.equal(checkedAgain.receipt.tagId, id);
        assert.deepEqual(checkedAgain.receipt.intent, intent);
        const retriedAgain = z
          .object({ data: tagActionResultSchema })
          .parse(await reconnected.request(path, 'POST', request)).data;
        assert.equal(retriedAgain.state, 'applied');
        assert.deepEqual(
          retriedAgain.snapshot,
          saved,
          'Retry overwrote the subsequent admin change.',
        );
        console.log(
          `PASS ${action} recovery after reconnect preserves the subsequent admin change.`,
        );
      } finally {
        await reconnected.close();
      }
    }
    // Two admins retire different Tags concurrently; one active Tag must survive.
    const active = z
      .object({ data: tagSnapshotSchema })
      .parse(await actor.request(path))
      .data.tags.filter((tag) => !tag.isArchived && !tag.isDeleted);
    for (const tag of active.slice(2))
      await actor.changeTag(groupId, { action: 'archive', tagId: tag.id });
    const pair = z
      .object({ data: tagSnapshotSchema })
      .parse(await actor.request(path))
      .data.tags.filter((tag) => !tag.isArchived && !tag.isDeleted);
    assert.equal(pair.length, 2);
    const retire = pair.map((tag, index) => ({
      requestId: randomUUID(),
      intent: {
        action: index === 0 ? 'archive' : 'delete',
        tagId: tag.id,
        expectedRevision: tag.revision,
      },
    }));
    const actors = [actor, other];
    const outcomes = await Promise.allSettled(
      retire.map((command, index) => actors[index].request(path, 'POST', command)),
    );
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    const refused = outcomes.findIndex((outcome) => outcome.status === 'rejected');
    assert.equal(
      z
        .object({ code: z.string() })
        .parse(await actors[refused].request(path, 'POST', retire[refused], 409)).code,
      'LAST_ACTIVE_TAG',
    );
    const final = z.object({ data: tagSnapshotSchema }).parse(await actor.request(path)).data;
    assert.equal(final.tags.filter((tag) => !tag.isArchived && !tag.isDeleted).length, 1);
    console.log('PASS Concurrent archive/delete retain an active Tag.');
  } finally {
    try {
      if (groupId) {
        const owned = z
          .object({ data: z.object({ name: z.string(), description: z.string() }) })
          .parse(await actor.request(`/api/groups/${groupId}`)).data;
        assert.equal(owned.name, `QA Tags ${run}`);
        assert.equal(owned.description, `Fictional Tag verification ${run}`);
        await actor.request(`/api/groups/${groupId}`, 'DELETE');
      }
    } finally {
      await Promise.allSettled([actor.close(), other.close()]).then((closed) => {
        const failure = closed.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      });
    }
  }
}
void main().catch((error: unknown) => reportVerifierFailure(error));
