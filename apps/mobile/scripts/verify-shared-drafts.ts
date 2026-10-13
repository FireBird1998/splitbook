/** Local, synthetic cross-client Draft journey. No remote origin or database resets. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMobileController } from '../src/data';
import { FixtureActor, alexId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';
import { z } from 'zod';
import { toReviewPath } from '@splitbook/shared/api-paths';
import { toDateParam } from '@splitbook/shared/date';
import { buildToReview, summarizeReviewRun } from '@splitbook/shared/to-review';
import { parseToReviewResponse } from '@splitbook/shared/to-review-read';
import type { ExpenseDraftValues } from '@splitbook/shared/validators/expense-draft';

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
    loseDraftResponse = false,
    loseSaveResponse = false;
  const submitted: Array<{ key: string | null; body: string }> = [];
  const savedSubmissions: string[] = [];
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
        const saving = init.method === 'POST' && new URL(url).pathname.endsWith('/drafts/save');
        if (saving) savedSubmissions.push(String(init.body));
        const response = await fetch(url, { ...init, redirect: 'error' });
        if (saving && loseSaveResponse) {
          loseSaveResponse = false;
          assert.equal(response.status, 200);
          await response.arrayBuffer();
          throw new Error('Controlled loss of committed Save reply');
        }
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
  let secondGroupId: string | undefined;
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
    const secondGroup = z
      .object({ data: z.object({ _id: z.string(), tags: z.array(z.object({ _id: z.string() })) }) })
      .parse(
        await web.request(
          '/api/groups',
          'POST',
          {
            name: `QA To review EUR ${randomUUID()}`,
            description: 'Fictional cross-Group To review verification',
            category: 'other',
            defaultCurrency: 'EUR',
            alternateCurrencies: [],
          },
          201,
        ),
      ).data;
    secondGroupId = secondGroup._id;
    const secondClient = controller.sharedDrafts(secondGroupId);
    const complete = (description: string, amount: number): ExpenseDraftValues => ({
      description,
      amount,
      currency: 'INR',
      category: 'other',
      date: toDateParam(new Date()),
      tagId: group.tags[0]._id,
      paidBy: [{ user: alexId, amount }],
      splitMethod: 'equal',
      splitBetween: [{ user: alexId }],
    });
    const [ready] = await reopened.create(complete('Ready meal', 12.34));
    const [changedAfterReview] = await reopened.create(complete('Ready fare', 23.45));
    const [incomplete] = await reopened.create({ description: 'Needs lunch amount' });
    const [duplicate] = await reopened.create(complete('Possible duplicate', 34.56));
    const [otherDuplicate] = await reopened.create(complete('Possible duplicate', 34.56));
    const [eur] = await secondClient.create({
      ...complete('Euro museum', 45.67),
      currency: 'EUR',
      tagId: secondGroup.tags[0]._id,
    });
    const read = parseToReviewResponse(await web.request(toReviewPath()));
    const claude = read.groups
      .flatMap((row) => row.items)
      .find(
        (item) =>
          item.draft.preparedBy.kind === 'assistant' &&
          item.draft.preparedBy.name === 'Claude' &&
          item.draft.values?.description === 'Fictional Claude prepared lunch',
      );
    assert.ok(claude, 'The isolated seed must include a fictional Claude-prepared item');
    const all = buildToReview(read, [], new Date());
    assert.match(all.sourceSummary, /1 from Claude/);
    assert.ok(all.groups.some((row) => row.groupId === groupId && row.counts.total === 5));
    assert.ok(all.groups.some((row) => row.groupId === secondGroupId && row.counts.ready === 1));
    const groupRead = {
      total: 5,
      groups: read.groups.filter((row) => row.groupId === groupId),
    };
    const model = buildToReview(
      groupRead,
      [
        {
          id: 'fictional-device-only',
          groupId,
          groupName: 'Fictional local recovery',
          createdAt: new Date().toISOString(),
          values: complete('Unsaved on this phone', 99),
        },
      ],
      new Date(),
    );
    assert.deepEqual(model.counts, {
      total: 6,
      ready: 2,
      duplicate: 2,
      needsDetails: 1,
      onThisPhone: 1,
    });
    assert.deepEqual(
      new Set(model.ready.items.map((item) => item.draft.id)),
      new Set([ready.id, changedAfterReview.id]),
    );
    assert.deepEqual(
      model.ready.totals.map(({ currency, amountMinor }) => ({ currency, amountMinor })),
      [{ currency: 'INR', amountMinor: 3579 }],
    );
    assert.equal(model.ready.label, 'Save 2 ready');
    // A cross-Group read never authorizes saving. Confirm the fresh per-item reviewed versions.
    const readyReviews = await reopened.review(model.ready.items.map((item) => item.draft.id));
    const confirmation = buildToReview(
      {
        total: readyReviews.length,
        groups: [
          {
            groupId,
            groupName: 'Fictional confirmation',
            count: readyReviews.length,
            items: readyReviews,
          },
        ],
      },
      [],
      new Date(),
    );
    assert.equal(confirmation.ready.count, 2);
    assert.deepEqual(confirmation.ready.totals, model.ready.totals);
    await reopened.replace(changedAfterReview, {
      ...changedAfterReview.values,
      notes: 'Changed from another client after review',
    });
    const mixed = await reopened.save(readyReviews, []);
    assert.equal(mixed.find((item) => item.id === ready.id)?.status, 'saved');
    const stale = mixed.find((item) => item.id === changedAfterReview.id);
    assert.ok(
      stale?.status === 'failed' && stale.message.length > 0,
      'A changed reviewed version must fail and retain a reason',
    );
    assert.deepEqual(summarizeReviewRun(mixed), {
      saved: 1,
      deleted: 0,
      left: 1,
      label: 'Saved 1 · 1 left for later',
    });
    const left = await reopened.list();
    assert.deepEqual(
      new Set(left.map((item) => item.id)),
      new Set([changedAfterReview.id, incomplete.id, duplicate.id, otherDuplicate.id]),
    );

    const euroReviews = await secondClient.review([eur.id]);
    const euroConfirmation = buildToReview(
      {
        total: 1,
        groups: [
          {
            groupId: secondGroupId,
            groupName: 'Euro confirmation',
            count: 1,
            items: euroReviews,
          },
        ],
      },
      [],
      new Date(),
    );
    assert.deepEqual(
      euroConfirmation.ready.totals.map(({ currency, amountMinor }) => ({ currency, amountMinor })),
      [{ currency: 'EUR', amountMinor: 4567 }],
    );
    loseSaveResponse = true;
    await assert.rejects(() => secondClient.save(euroReviews, []));
    const retained = await secondClient.pending();
    assert.ok(retained, 'Lost Save reply must retain the exact reviewed versions');
    const sentBeforeCheck = savedSubmissions.length;
    const resumed = controller.sharedDrafts(secondGroupId);
    assert.equal(await resumed.pending(), retained);
    assert.equal(
      savedSubmissions.length,
      sentBeforeCheck,
      'Reopening the results cannot automatically resubmit',
    );
    const countExpenses = async (id: string) =>
      z
        .object({ data: z.object({ pagination: z.object({ total: z.number() }) }) })
        .parse(await web.request(`/api/groups/${id}/expenses`)).data.pagination.total;
    assert.equal(await countExpenses(secondGroupId), 1, 'The lost reply already committed once');
    const checked = await resumed.retry();
    assert.ok(checked?.kind === 'save' && checked.outcomes[0].status === 'saved');
    assert.equal(
      savedSubmissions.at(-1),
      savedSubmissions.at(-2),
      'Check again must send identical reviewed versions and identity',
    );
    assert.equal(await resumed.pending(), null);
    assert.equal(
      await countExpenses(secondGroupId),
      1,
      'Check again must not create a second Expense',
    );
    assert.equal(await countExpenses(groupId), 2, 'Only the ready unchanged item was added');
    const after = parseToReviewResponse(await web.request(toReviewPath()));
    assert.ok(!after.groups.some((row) => row.groupId === secondGroupId));
    assert.equal(after.groups.find((row) => row.groupId === groupId)?.count, 4);
    console.log(
      'PASS: web → native visibility; stale protection; permanent discard; newer local recovery retained without blocking collection; exact upload retry; cross-Group Claude attribution; shared ready selection and exact currency totals; mixed stale result; lost Save reply and Check again produce exactly one Expense.',
    );
  } finally {
    await controller.signOut();
    controller.dispose();
    if (groupId) await web.request(`/api/groups/${groupId}`, 'DELETE');
    if (secondGroupId) await web.request(`/api/groups/${secondGroupId}`, 'DELETE');
    await web.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
