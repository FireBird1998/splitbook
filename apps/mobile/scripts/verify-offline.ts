/** #59: public controller + real HTTP, with disk-backed restart and controlled network loss. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createMobileController } from '../src/data';
import type { SavedQueryRecords } from '../src/data/saved-copy-budget';
import { expensePagePath, activityPagePath, tagActionsPath } from '@splitbook/shared/api-paths';
import { expenseMonthRange } from '@splitbook/shared/expense-day';
import { waitForSavedQueries } from './offline-checkpoint';
import { FixtureActor, alexId, samId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';
import { observe, present, reportVerifierFailure } from './verify-report';

type Controller = ReturnType<typeof createMobileController>;

/**
 * The Tags screen over a Group, as Group options opens it: read until nothing is busy, then
 * `change` made there, if any, then closed. Returns what it showed last (#638).
 */
async function readTags(
  controller: Controller,
  groupId: string,
  change?: (manager: ReturnType<Controller['manageTags']>) => Promise<void>,
) {
  const settled = async () => {
    for (let wait = 0; controller.getSnapshot().tagManager.busy; wait++) {
      assert.ok(wait < 2_000, 'The Tags screen never finished reading.');
      await setTimeout(10);
    }
  };
  controller.openTags(groupId);
  const manager = controller.manageTags(groupId);
  const close = manager.open();
  try {
    await settled();
    if (change) {
      await change(manager);
      await settled();
    }
    return controller.getSnapshot().tagManager;
  } finally {
    close();
    controller.closeTags();
  }
}

/** Test controls exercise offline restoration; normal CLI verification runs every stage. */
interface OfflineVerificationOptions {
  waitForCopies?: typeof waitForSavedQueries;
  writeSavedQuery?: (path: string, write: () => Promise<void>) => Promise<void>;
  checkpointRead?: (path: string) => void;
  afterOfflineViews?: () => 'stop' | void;
  beforeCleanup?: () => void;
}

export async function verifyOffline(options: OfflineVerificationOptions = {}) {
  const origin = localOrigin(),
    alex = new FixtureActor(),
    sam = new FixtureActor();
  const directory = await mkdtemp(join(tmpdir(), 'splitbook-offline-'));
  const record = (name: string) => ({
    load: async (): Promise<unknown> =>
      JSON.parse(await readFile(join(directory, name), 'utf8').catch(() => 'null')),
    save: async (value: unknown) => {
      await writeFile(join(directory, name), JSON.stringify(value), { mode: 0o600 });
    },
    clear: async () => {
      await rm(join(directory, name), { force: true });
    },
  });
  const identity = record('identity'),
    // Per-query rows for every display read (#223), in a file of their own.
    rows = record('rows'),
    draft = record('draft'),
    // Kept Tag actions, by account and Group, as this phone keeps a change before sending it.
    tags = record('tags');
  const credentials = record('credentials'),
    accountOwner = record('owner');
  const owner = {
    load: async () =>
      z
        .string()
        .nullable()
        .parse(await accountOwner.load()),
    save: accountOwner.save,
    clear: accountOwner.clear,
  };
  const entries = async (file = rows) =>
    z.record(z.string(), z.unknown()).parse((await file.load()) ?? {});
  // The persister's rows are each written whole, as SQLite writes a row (#220). This file holds
  // them all, so its reads and writes take turns: the views' saved-copy queues write side by
  // side, and a write must never read the file half-written by another, or lose its rows.
  let rowsTurn: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = rowsTurn.then(operation, operation);
    rowsTurn = result.catch(() => undefined);
    return result;
  };
  const pendingWrites = new Set<Promise<void>>();
  const savedQueries: SavedQueryRecords = {
    load: (account, path) => inTurn(async () => (await entries(rows))[account + path] ?? null),
    save: (account, path, value) => {
      const write = () =>
        inTurn(async () => {
          const saved = await entries(rows);
          saved[account + path] = value;
          await rows.save(saved);
        });
      const pending = options.writeSavedQuery?.(path, write) ?? write();
      pendingWrites.add(pending);
      void pending.finally(() => pendingWrites.delete(pending)).catch(() => undefined);
      return pending;
    },
    remove: (account, path) =>
      inTurn(async () => {
        const saved = await entries(rows);
        delete saved[account + path];
        await rows.save(saved);
      }),
    clear: () => inTurn(rows.clear),
    list: (account) =>
      inTurn(async () =>
        Object.entries(await entries(rows))
          .filter(([key]) => key.startsWith(account))
          .map(([key, value]) => ({ groupId: key.slice(account.length), value })),
      ),
  };
  // Only checkpoint reads signal the controlled disk writer; preview and offline fallback
  // reads still use the unwrapped file store. A no-op checkpoint cannot release that writer.
  const checkpointRows: SavedQueryRecords = {
    ...savedQueries,
    load: (account, path) => {
      options.checkpointRead?.(path);
      return savedQueries.load(account, path);
    },
  };
  const tagRequests = {
    load: async (account: string, id: string) => (await entries(tags))[account + id] ?? null,
    save: async (account: string, id: string, value: unknown) => {
      await tags.save({ ...(await entries(tags)), [account + id]: value });
    },
    remove: async (account: string, id: string) => {
      const kept = await entries(tags);
      delete kept[account + id];
      await tags.save(kept);
    },
    clear: tags.clear,
    keys: async (account: string) =>
      Object.keys(await entries(tags))
        .filter((key) => key.startsWith(account))
        .map((key) => key.slice(account.length)),
  };
  const waitForCopies = options.waitForCopies ?? waitForSavedQueries;
  let offline = false,
    writes = 0,
    cleanup = false;
  const create = () =>
    createMobileController(
      { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
      {
        credentials: {
          ...credentials,
          load: async () =>
            z
              .string()
              .nullable()
              .parse(await credentials.load()),
        },
        offlineIdentity: identity,
        savedQueries,
        tagRequests,
        // A Tag change's request id, kept with it before it is sent.
        newSubmissionKey: randomUUID,
        expenseDrafts: {
          load: draft.load,
          save: async (_account, _group, value) => draft.save(value),
          remove: draft.clear,
          clear: draft.clear,
        },
        accountLocal: {
          owner,
          cleanupMarker: {
            load: async () => cleanup,
            mark: async () => {
              cleanup = true;
            },
            clear: async () => {
              cleanup = false;
            },
          },
          stores: [identity, rows, draft, tags],
        },
        fetch: async (url, init) => {
          assert.equal(new URL(url).origin, origin);
          if (offline) throw new Error('Controlled network loss');
          if (init.method !== 'GET' && !url.includes('/api/auth/')) writes++;
          return fetch(url, init);
        },
      },
    );
  let controller = create(),
    groupId: string | undefined;
  let openingActivity: Promise<void> | undefined;
  try {
    await alex.signIn('alex');
    await sam.signIn('sam');
    groupId = z
      .object({ data: z.object({ _id: z.string() }) })
      .parse(
        await alex.request(
          '/api/groups',
          'POST',
          { name: `QA59 ${randomUUID()}`, category: 'home', defaultCurrency: 'INR' },
          201,
        ),
      ).data._id;
    const path = `/api/groups/${groupId}`;
    const code = z
      .object({ data: z.object({ inviteCode: z.string() }) })
      .parse(await alex.request(`${path}/invite-link`, 'POST', {}, 201)).data.inviteCode;
    await sam.request(`/api/join/${code}`, 'POST', undefined, 201);
    await controller.signIn('sam');
    assert.equal(controller.getSnapshot().home.status, 'ready', 'Home after online sign-in');
    // A ready read is displayed before the background saved-copy queue reaches disk. Wait for
    // Home's copies now, because the later disposal cancels any copy still waiting to be written.
    await waitForCopies(checkpointRows, samId, ['/api/groups', '/api/user/balances']);
    await controller.openGroup(groupId);
    await controller.selectMonth('2026-08');
    await waitForCopies(checkpointRows, samId, [
      path,
      `${path}/balances`,
      expensePagePath(groupId, {
        page: 1,
        limit: 20,
        includeMemberBreakdown: true,
        ...expenseMonthRange('2026-08'),
      }),
    ]);
    let stopObservingActivity = () => {};
    const activityReady = new Promise<void>((done) => {
      stopObservingActivity = controller.subscribe(() => {
        if (controller.getSnapshot().activity.status === 'ready') {
          done();
        }
      });
    });
    // Activity may display before its command finishes draining the account's disk lease.
    // Checkpoint that displayed page without requiring the held disk write to finish first.
    openingActivity = controller.openActivity(groupId);
    try {
      await Promise.race([activityReady, openingActivity]);
    } finally {
      stopObservingActivity();
    }
    await waitForCopies(checkpointRows, samId, [activityPagePath(groupId, { page: 1, limit: 20 })]);
    const activity = controller.getSnapshot().activity.events.length;
    observe(activity > 0, 'Activity loaded no events to keep for offline.', { events: activity });
    controller.dispose();
    offline = true;
    controller = create();
    await controller.restore();
    assert.equal(controller.getSnapshot().auth.status, 'authenticated');
    assert.equal(controller.getSnapshot().home.status, 'ready', 'Home after offline restart');
    present(
      controller.getSnapshot().offline.refreshedAt,
      'The restored offline session said nothing about when it was last updated.',
    );
    await controller.openGroup(groupId);
    await controller.selectMonth('2026-08');
    assert.equal(
      controller.getSnapshot().financial.expenses.status,
      'ready',
      'Saved August Expenses after offline restart',
    );
    assert.equal(
      controller.getSnapshot().financial.balances.status,
      'ready',
      'Saved Balances after offline restart',
    );
    const savedBalances = controller.getSnapshot().financial.balances.data;
    await controller.selectMonth('2026-07');
    assert.equal(
      controller.getSnapshot().financial.balances.status,
      'ready',
      'Saved Balances in an unvisited Month',
    );
    assert.deepEqual(controller.getSnapshot().financial.balances.data, savedBalances);
    assert.equal(controller.getSnapshot().financial.expenses.status, 'error');
    assert.equal(controller.getSnapshot().financial.expenses.summary, null);
    await controller.openActivity(groupId);
    assert.equal(controller.getSnapshot().activity.events.length, activity);
    if (options.afterOfflineViews?.() === 'stop') return;
    await controller.openExpense(groupId);
    // A new Expense takes one of the saved Tags offline; saving it still needs a connection.
    const savedTag = controller
      .getSnapshot()
      .expense.context?.tags.find((tag) => !tag.isArchived && !tag.isDeleted);
    present(savedTag, 'The saved Group offered no Tag for a new Expense offline.');
    await controller.updateExpenseDraft({
      description: 'Prepared offline',
      amount: '12.00',
      tagId: savedTag.id,
    });
    assert.equal(
      controller.getSnapshot().expense.draft?.tagId,
      savedTag.id,
      'A saved Tag chosen for a new Expense offline',
    );
    await controller.saveExpense();
    assert.equal(writes, 0);
    controller.dispose();
    controller = create();
    await controller.restore();
    await controller.openExpense(groupId);
    controller.resumeExpenseDraft();
    assert.equal(controller.getSnapshot().expense.draft?.description, 'Prepared offline');
    offline = false;
    await controller.refresh();
    assert.equal(controller.getSnapshot().offline.active, false);
    assert.equal(controller.getSnapshot().expense.draft?.description, 'Prepared offline');
    assert.equal(writes, 0);
    await alex.request(`${path}/members/${samId}`, 'DELETE');
    await controller.refresh();
    assert.equal(controller.getSnapshot().expense.status, 'blocked');
    assert.notEqual(await draft.load(), null);
    await controller.back();
    await controller.refresh('pull');
    assert.equal(controller.getSnapshot().screen, 'groups');
    assert.equal(await draft.load(), null);
    controller.dispose();
    offline = true;
    controller = create();
    await controller.restore();
    await controller.openGroup(groupId);
    assert.equal(controller.getSnapshot().detail.data, null);
    await controller.signOut();
    controller.dispose();
    controller = create();
    await controller.restore();
    assert.equal(controller.getSnapshot().auth.user, null);
    assert.equal(await rows.load(), null);

    // #191: after a confirmed edit, offline the record and its Month show the edited Expense or
    // say they weren't saved on this device, never the version before, also after a restart.
    const tagId = z
      .object({ data: z.object({ tags: z.array(z.object({ _id: z.string() })).min(1) }) })
      .parse(await alex.request(path)).data.tags[0]._id;
    const expenseId = z.object({ data: z.object({ _id: z.string() }) }).parse(
      await alex.request(
        `${path}/expenses`,
        'POST',
        {
          description: 'Lakeside dinner',
          amount: 12,
          currency: 'INR',
          date: '2026-08-20T12:00:00.000Z',
          category: 'food',
          tagId,
          paidBy: [{ user: alexId, amount: 12 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alexId }],
        },
        201,
      ),
    ).data._id;
    const descriptions = () =>
      controller.getSnapshot().financial.expenses.data.map((expense) => expense.description);
    offline = false;
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.selectMonth('2026-08');
    observe(descriptions().includes('Lakeside dinner'), 'The August list lacked Lakeside dinner.', {
      descriptions: descriptions(),
    });
    await controller.openExpense(groupId, expenseId);
    assert.equal(controller.getSnapshot().expense.draft?.description, 'Lakeside dinner');
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Lakeside dinner, edited' });
    await controller.saveExpense();
    // Saved, back on the record it was opened from (#635), which reads it again; Back then
    // reads the Group's August Expenses again, as the save itself once did.
    assert.equal(controller.getSnapshot().expense.status, 'detail');
    assert.equal(controller.getSnapshot().expense.message, 'Expense updated.');
    await controller.back();
    assert.equal(controller.getSnapshot().screen, 'group');
    const notSaved = 'This view was not saved on this device. Connect to load it.';
    const readOffline = async () => {
      await controller.openExpense(groupId!, expenseId);
      const { expense } = controller.getSnapshot();
      if (expense.status === 'detail')
        assert.equal(expense.draft?.description, 'Lakeside dinner, edited');
      else
        assert.equal(
          expense.message,
          'This Expense isn’t saved on this phone. Connect to load it.',
        );
      await controller.back();
      await controller.openGroup(groupId!);
      await controller.selectMonth('2026-08');
      const { expenses } = controller.getSnapshot().financial;
      if (expenses.status === 'error') assert.equal(expenses.message, notSaved);
      else {
        assert.equal(expenses.status, 'ready', 'Expenses after a confirmed edit');
        observe(
          descriptions().includes('Lakeside dinner, edited') &&
            !descriptions().includes('Lakeside dinner'),
          'The saved copy did not show the edited Expense in place of the old one.',
          { descriptions: descriptions() },
        );
      }
    };
    offline = true;
    await readOffline();
    controller.dispose();
    controller = create();
    await controller.restore();
    assert.equal(controller.getSnapshot().auth.status, 'authenticated');
    await readOffline();

    // #638: a Group's Tags join its Saved copy. Alex reads them online and renames one here;
    // after a cold offline start they show from this phone's copy, renamed, with their time.
    offline = false;
    await controller.refresh();
    const before = await readTags(controller, groupId);
    const tag = before.snapshot?.tags.find((item) => !item.isArchived && !item.isDeleted);
    present(tag, 'The Tags screen read no active Tag to rename.');
    const name = `QA638 ${randomUUID().slice(0, 8)}`;
    const sent = writes;
    const renamed = await readTags(controller, groupId, async (manager) => {
      manager.edit(tag, 'rename');
      manager.enter(name);
      await manager.submit();
    });
    observe(renamed.done?.state === 'applied', 'The Tag rename was not confirmed.', {
      message: renamed.message,
      recovery: renamed.recovery,
    });
    // The saved Tags follow the confirmed rename: they are read again after it, never kept from
    // before it.
    const tagsPath = tagActionsPath(groupId);
    for (let wait = 0; ; wait++) {
      const row = z
        .object({ value: z.object({ data: z.object({ tags: z.array(z.unknown()) }) }) })
        .nullable()
        .catch(null)
        .parse(await savedQueries.load(alexId, tagsPath));
      if (JSON.stringify(row?.value.data.tags ?? []).includes(name)) break;
      assert.ok(wait < 2_000, 'The saved Tags never followed the confirmed rename.');
      await setTimeout(10);
    }
    controller.dispose();
    offline = true;
    controller = create();
    await controller.restore();
    assert.equal(controller.getSnapshot().auth.status, 'authenticated');
    const savedTags = await readTags(controller, groupId);
    assert.equal(savedTags.saved, true, 'Saved Tags after offline restart');
    assert.equal(savedTags.unsaved, false);
    present(savedTags.refreshedAt, 'The saved Tags said nothing about when they were read.');
    observe(
      savedTags.snapshot?.tags.some((item) => item.id === tag.id && item.name === name),
      'The saved Tags did not show the confirmed rename.',
      { tags: savedTags.snapshot?.tags },
    );
    assert.equal(writes - sent, 1, 'Only the rename was sent.');
    console.log(
      'PASS: real HTTP cached Home, Group, Month, balances and Activity; disk restart; missing Month; a saved Tag on a new Expense offline; retained draft; reconnect without writes; revocation; sign-out purge; no saved copy older than a confirmed edit; saved Tags after a confirmed rename.',
    );
  } finally {
    options.beforeCleanup?.();
    await Promise.allSettled([...pendingWrites]);
    if (openingActivity) await Promise.allSettled([openingActivity]);
    offline = false;
    await controller.signOut();
    controller.dispose();
    if (groupId) await alex.request(`/api/groups/${groupId}`, 'PATCH', { isArchived: true });
    await Promise.all([alex.close(), sam.close()]);
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  void verifyOffline().catch((error: unknown) => {
    reportVerifierFailure(error);
    // Print only the verifier's source location, keeping the report's credential redaction.
    const location =
      error instanceof Error
        ? error.stack
            ?.split('\n')
            .find((line) => /^\s+at .*[/\\]verify-offline\.ts:\d+:\d+/.test(line))
        : undefined;
    if (location) console.error(`  check: ${location.trim()}`);
  });
