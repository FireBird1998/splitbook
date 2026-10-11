/** Local, synthetic cross-client Draft journey. No remote origin or database resets. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMobileController } from '../src/data';
import { FixtureActor, alexId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';
import { z } from 'zod';

async function main() {
  const origin = localOrigin();
  const web = new FixtureActor(origin);
  const memory = () => {
    const rows = new Map<string, unknown>();
    return {
      load: async (account: string, group: string) => rows.get(`${account}:${group}`) ?? null,
      save: async (account: string, group: string, value: unknown) => {
        rows.set(`${account}:${group}`, value);
      },
      remove: async (account: string, group: string) => {
        rows.delete(`${account}:${group}`);
      },
      clear: async () => {
        rows.clear();
      },
    };
  };
  const drafts = memory(),
    requests = memory();
  let cookie: string | null = null,
    account: string | null = null,
    cleanup = false,
    loseDraftResponse = false;
  const submitted: Array<{ key: string | null; body: string }> = [];
  const controller = createMobileController(
    { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
    {
      fetch: async (url, init) => {
        assert.equal(new URL(url).origin, origin);
        const creation = init.method === 'POST' && new URL(url).pathname.endsWith('/drafts');
        if (creation)
          submitted.push({
            key: new Headers(init.headers).get('Idempotency-Key'),
            body: String(init.body),
          });
        const response = await fetch(url, { ...init, redirect: 'error' });
        if (creation && loseDraftResponse) {
          loseDraftResponse = false;
          assert.equal(response.status, 201);
          await response.arrayBuffer();
          throw new Error('Controlled loss of committed Draft reply');
        }
        return response;
      },
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      expenseDrafts: drafts,
      draftRequests: requests,
      newSubmissionKey: randomUUID,
      accountLocal: {
        owner: {
          load: async () => account,
          save: async (value) => {
            account = value;
          },
          clear: async () => {
            account = null;
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
        stores: [drafts, requests],
      },
    },
  );
  let groupId: string | undefined;
  try {
    await web.signIn('alex');
    await controller.signIn('alex');
    const group = z
      .object({ data: z.object({ _id: z.string(), tags: z.array(z.object({ _id: z.string() })) }) })
      .parse(
        await web.request(
          '/api/groups',
          'POST',
          {
            name: `QA Drafts ${randomUUID()}`,
            description: 'Fictional shared Draft verification',
            category: 'home',
            defaultCurrency: 'INR',
            alternateCurrencies: [],
          },
          201,
        ),
      ).data;
    groupId = group._id;
    await web.request(
      `/api/groups/${groupId}/drafts`,
      'POST',
      { drafts: [{ description: 'From web', amount: 450 }] },
      201,
      undefined,
      { 'Idempotency-Key': randomUUID() },
    );
    const client = controller.sharedDrafts(groupId);
    const [fromWeb] = await client.list();
    assert.equal(fromWeb.values?.description, 'From web');
    const changed = await client.replace(fromWeb, {
      ...fromWeb.values,
      notes: 'Corrected on Android',
    });
    await assert.rejects(() => client.replace(fromWeb, { amount: 999 }));
    await client.discard(changed);
    assert.equal((await client.list()).length, 0);

    await controller.openExpense(groupId);
    assert.equal(controller.getSnapshot().expense.status, 'editing');
    await controller.updateExpenseDraft({
      description: 'Android recovery upload',
      amount: '25',
      tagId: group.tags[0]._id,
    });
    loseDraftResponse = true;
    await assert.rejects(() => controller.keepExpenseAsSharedDraft());
    assert.ok(await requests.load(alexId, groupId));
    assert.ok(await drafts.load(alexId, groupId));
    assert.equal(submitted.length, 1);
    const reopened = controller.sharedDrafts(groupId);
    assert.ok(await reopened.pending());
    assert.equal(submitted.length, 1, 'Reading pending state must never retry automatically');
    await controller.updateExpenseDraft({ description: 'Newer local correction after upload' });
    const localAfterCorrection = await drafts.load(alexId, groupId);
    const acknowledgment = await reopened.retry();
    assert.equal(acknowledgment?.kind, 'create');
    assert.ok(acknowledgment?.kind === 'create' && acknowledgment.localDraftRetained);
    assert.deepEqual(submitted[1], submitted[0]);
    assert.deepEqual(
      await drafts.load(alexId, groupId),
      localAfterCorrection,
      'A confirmed upload must preserve newer local recovery',
    );
    assert.equal(await reopened.pending(), null);
    const [separateDraft] = await reopened.create({ description: 'Separate incomplete Draft' });
    await reopened.discard(separateDraft);
    const collection = await reopened.list();
    assert.equal(collection.length, 1);
    assert.equal(collection[0].values?.description, 'Android recovery upload');
    const reviews = await reopened.review(collection.map((row) => row.id));
    assert.deepEqual(reviews[0].problems, []);
    const outcome = await reopened.save(reviews, []);
    assert.equal(outcome[0].status, 'saved');
    assert.equal((await reopened.list()).length, 0);
    const expenses = z
      .object({ data: z.object({ pagination: z.object({ total: z.number() }) }) })
      .parse(await web.request(`/api/groups/${groupId}/expenses`));
    assert.equal(expenses.data.pagination.total, 1);
    console.log(
      'PASS: web → native visibility; stale protection; permanent discard; newer local recovery retained without blocking collection; exact lost-response retry; native review/save produces one Expense.',
    );
  } finally {
    await controller.signOut();
    controller.dispose();
    if (groupId) await web.request(`/api/groups/${groupId}`, 'DELETE');
    await web.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
