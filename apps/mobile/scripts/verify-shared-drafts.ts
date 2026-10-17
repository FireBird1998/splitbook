/** Local, synthetic cross-client Draft journey. No remote origin or database resets. */
import assert from 'node:assert/strict';
import { onlineManager } from '@tanstack/query-core';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMobileController } from '../src/data';
import { FixtureActor, alexId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';
import { z } from 'zod';
import { toReviewPath } from '@splitbook/shared/api-paths';
import { toDateParam } from '@splitbook/shared/date';
import { buildToReview, summarizeReviewRun } from '@splitbook/shared/to-review';
import { parseToReviewResponse } from '@splitbook/shared/to-review-read';
import type { ExpenseDraftValues } from '@splitbook/shared/validators/expense-draft';
import { observe, present, reportVerifierFailure } from './verify-report';

async function main() {
  process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED = 'true';
  const origin = localOrigin();
  const environment = await import(
    pathToFileURL(resolve(import.meta.dirname, 'dev-backend/environment.mjs')).href
  );
  assert.equal(origin, environment.origin, 'Use the backend variables printed by pnpm swarm up.');
  const { withIsolatedDatabase } = (await import(
    pathToFileURL(resolve(import.meta.dirname, 'dev-backend/database.mjs')).href
  )) as {
    withIsolatedDatabase: <T>(
      action: (database: {
        admin(): { command(value: { hello: 1 }): Promise<unknown> };
      }) => Promise<T>,
    ) => Promise<T>;
  };
  const hello = z
    .object({ setName: z.string().optional(), msg: z.string().optional() })
    .parse(await withIsolatedDatabase((database) => database.admin().command({ hello: 1 })));
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    console.error(
      'This verifier needs a replica-set MongoDB, because saving Drafts uses transactions.',
    );
    process.exitCode = 1;
    return;
  }
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
    loseSaveResponse = false,
    loseExpenseResponse = false;
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
        if (
          init.method === 'POST' &&
          new URL(url).pathname.endsWith('/expenses') &&
          loseExpenseResponse
        ) {
          loseExpenseResponse = false;
          assert.equal(response.status, 201);
          await response.arrayBuffer();
          throw new Error('Controlled loss of committed Expense reply');
        }

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
    await controller.keepExpenseAsSharedDraft();
    assert.equal(controller.getSnapshot().expense.finishLaterPending, true);
    present(
      await requests.load(alexId, groupId),
      'Finish later kept no pending upload request on this phone.',
    );
    present(await drafts.load(alexId, groupId), 'Finish later kept no local copy of the Expense.');
    assert.equal(submitted.length, 1);
    const reopened = controller.sharedDrafts(groupId);
    present(await reopened.pending(), 'The lost upload left nothing pending to check again.');
    assert.equal(submitted.length, 1, 'Reading pending state must never retry automatically');
    await controller.updateExpenseDraft({ description: 'Newer local correction after upload' });
    const localAfterCorrection = await drafts.load(alexId, groupId);
    const acknowledgment = await reopened.retry();
    assert.equal(acknowledgment?.kind, 'create');
    observe(
      acknowledgment?.kind === 'create' && acknowledgment.localDraftRetained,
      'Checking again did not confirm the upload and keep the newer local copy.',
      {
        kind: acknowledgment?.kind ?? null,
        kept: acknowledgment?.kind === 'create' ? acknowledgment.localDraftRetained : null,
      },
    );
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
    // Explicit offline Finish later never uploads on reconnect. Moving the phone item
    // keeps its local copy through a lost create reply, then acknowledges the same operation.
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      description: 'Phone-only groceries',
      amount: '17',
      tagId: group.tags[0]._id,
    });
    onlineManager.setOnline(false);
    const beforeOffline = submitted.length;
    await controller.keepExpenseAsSharedDraft();
    present(await drafts.load(alexId, groupId), 'Offline Finish later kept no local copy.');
    onlineManager.setOnline(true);
    await controller.refreshToReview();
    assert.equal(submitted.length, beforeOffline, 'Reconnecting never uploads phone entries');
    await controller.openExpense(groupId);
    loseDraftResponse = true;
    await controller.keepExpenseAsSharedDraft();
    present(await drafts.load(alexId, groupId), 'A lost create reply dropped the local copy.');
    present(await requests.load(alexId, groupId), 'A lost create reply left no pending request.');
    await controller.keepExpenseAsSharedDraft();
    assert.deepEqual(submitted.at(-1), submitted.at(-2));
    assert.equal(await drafts.load(alexId, groupId), null);
    const phoneDraft = (await reopened.list()).find(
      (item) => item.values?.description === 'Phone-only groceries',
    );
    present(phoneDraft, 'The phone item was not uploaded to To review.');
    assert.deepEqual(phoneDraft.preparedBy, { kind: 'member' });
    await reopened.discard(phoneDraft);

    // An uncertain financial save resolves first; Finish later cannot manufacture another
    // Draft or Expense for the same member action after its committed reply was lost.
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      description: 'Unconfirmed phone fare',
      amount: '18',
      tagId: group.tags[0]._id,
    });
    loseExpenseResponse = true;
    await controller.saveExpense();
    present(
      controller.getSnapshot().expense.attempt,
      'A lost save reply left no unconfirmed attempt.',
    );
    const beforeResolve = submitted.length;
    await controller.keepExpenseAsSharedDraft();
    assert.equal(submitted.length, beforeResolve);
    assert.equal(await drafts.load(alexId, groupId), null);
    const afterResolve = z
      .object({ data: z.object({ pagination: z.object({ total: z.number() }) }) })
      .parse(await web.request(`/api/groups/${groupId}/expenses`));
    assert.equal(
      afterResolve.data.pagination.total,
      2,
      'One earlier Expense and exactly one recovered Expense',
    );

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
    present(claude, 'The isolated seed must include a fictional Claude-prepared item');
    const all = buildToReview(read, [], new Date());
    assert.match(all.sourceSummary, /1 from Claude/);
    observe(
      all.groups.some((row) => row.groupId === groupId && row.counts.total === 5),
      'To review did not count 5 items in the first Group.',
      { counts: all.groups.map((row) => ({ groupId: row.groupId, counts: row.counts })) },
    );
    observe(
      all.groups.some((row) => row.groupId === secondGroupId && row.counts.ready === 1),
      'To review did not count 1 ready item in the second Group.',
      { counts: all.groups.map((row) => ({ groupId: row.groupId, counts: row.counts })) },
    );
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
    observe(
      stale?.status === 'failed' && stale.message.length > 0,
      'A changed reviewed version must fail and retain a reason',
      { status: stale?.status ?? null, reason: stale && 'message' in stale ? stale.message : null },
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
    present(retained, 'Lost Save reply must retain the exact reviewed versions');
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
    observe(
      checked?.kind === 'save' && checked.outcomes[0].status === 'saved',
      'Checking again did not confirm the lost Save.',
      {
        kind: checked?.kind ?? null,
        outcomes: checked?.kind === 'save' ? checked.outcomes.map((row) => row.status) : null,
      },
    );
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
    assert.equal(await countExpenses(groupId), 3, 'Only the ready unchanged item was added');
    const after = parseToReviewResponse(await web.request(toReviewPath()));
    observe(
      !after.groups.some((row) => row.groupId === secondGroupId),
      'The second Group still listed items after its Save.',
      { groups: after.groups.map((row) => ({ groupId: row.groupId, count: row.count })) },
    );
    assert.equal(after.groups.find((row) => row.groupId === groupId)?.count, 4);
    // Guided native review uses the shared client's exact version and replay identity.
    await controller.refreshToReview();
    await controller.startReviewRun(claude.draft.groupId);
    const run = controller.getSnapshot().toReview.run;
    present(run, 'The guided review did not start.');
    observe(
      run.items.some(
        (row) =>
          row.item.draft.preparedBy.kind === 'assistant' &&
          row.item.draft.preparedBy.name === 'Claude',
      ),
      'The guided review did not include the Claude-prepared item.',
      { prepared: run.items.map((row) => row.item.draft.preparedBy) },
    );
    while (
      controller.getSnapshot().toReview.run?.items[controller.getSnapshot().toReview.run!.index]
        ?.item.draft.id !== claude.draft.id
    ) {
      const before = controller.getSnapshot().toReview.run!.index;
      await controller.reviewRun()!.skip();
      assert.equal(controller.getSnapshot().toReview.run!.index, before + 1);
    }
    const beforeRun = await countExpenses(claude.draft.groupId);
    loseSaveResponse = true;
    await controller.reviewRun()!.save();
    assert.equal(controller.getSnapshot().toReview.run!.pending, true);
    assert.equal(await countExpenses(claude.draft.groupId), beforeRun + 1);
    await controller.reviewRun()!.retry();
    assert.equal(
      await countExpenses(claude.draft.groupId),
      beforeRun + 1,
      'Guided Check again creates exactly one Expense',
    );
    assert.equal(savedSubmissions.at(-1), savedSubmissions.at(-2));
    observe(
      controller
        .getSnapshot()
        .toReview.run!.outcomes.some((row) => row.id === claude.draft.id && row.status === 'saved'),
      'The guided review did not record the Claude item as saved.',
      {
        outcomes: controller
          .getSnapshot()
          .toReview.run!.outcomes.map((row) => ({ id: row.id, status: row.status })),
      },
    );
    await controller.closeReviewRun();
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
void main().catch((error: unknown) => reportVerifierFailure(error));
