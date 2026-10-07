/** #59: public controller + real HTTP, with disk-backed restart and controlled network loss. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createMobileController } from '../src/data';
import { FixtureActor, alexId, samId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';

async function run() {
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
    cache = record('cache'),
    // The persister's rows (#217): the Groups list and Home, in a file of their own.
    rows = record('rows'),
    draft = record('draft');
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
  const entries = async (file = cache) =>
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
        savedQueries: {
          load: (account, path) =>
            inTurn(async () => (await entries(rows))[account + path] ?? null),
          save: (account, path, value) =>
            inTurn(async () => {
              const saved = await entries(rows);
              saved[account + path] = value;
              await rows.save(saved);
            }),
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
        },
        readCache: {
          load: async (account, path) => (await entries())[account + path] ?? null,
          save: async (account, path, value) => {
            const saved = await entries();
            saved[account + path] = value;
            await cache.save(saved);
          },
          clear: cache.clear,
          invalidateGroup: async (account, group) => {
            const saved = await entries();
            for (const key of Object.keys(saved))
              if (
                key.startsWith(account + '/api/groups/' + group) ||
                key === account + '/api/groups' ||
                key === account + '/api/user/balances'
              )
                delete saved[key];
            await cache.save(saved);
          },
          invalidateLedger: async (account, group) => {
            const saved = await entries();
            for (const key of Object.keys(saved))
              if (
                key.startsWith(account + '/api/groups/' + group + '/') ||
                key.startsWith(account + '/api/groups/' + group + '?') ||
                key === account + '/api/user/balances'
              )
                delete saved[key];
            await cache.save(saved);
          },
          retainGroups: async (account, ids) => {
            const saved = await entries();
            for (const key of Object.keys(saved)) {
              const group = /^\/api\/groups\/([a-f\d]{24})(?:\/|\?|$)/i.exec(
                key.slice(account.length),
              )?.[1];
              if (key.startsWith(account) && group && !ids.includes(group)) {
                delete saved[key];
                delete saved[account + '/api/user/balances'];
              }
            }
            await cache.save(saved);
          },
        },
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
          stores: [identity, cache, rows, draft],
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
    assert.equal(controller.getSnapshot().home.status, 'ready');
    await controller.openGroup(groupId);
    await controller.selectMonth('2026-08');
    await controller.openActivity(groupId);
    const activity = controller.getSnapshot().activity.events.length;
    assert.ok(activity > 0);
    controller.dispose();
    offline = true;
    controller = create();
    await controller.restore();
    assert.equal(controller.getSnapshot().auth.status, 'authenticated');
    assert.equal(controller.getSnapshot().home.status, 'ready');
    assert.ok(controller.getSnapshot().offline.refreshedAt);
    await controller.openGroup(groupId);
    await controller.selectMonth('2026-08');
    assert.equal(controller.getSnapshot().financial.expenses.status, 'ready');
    assert.equal(controller.getSnapshot().financial.balances.status, 'ready');
    const savedBalances = controller.getSnapshot().financial.balances.data;
    await controller.selectMonth('2026-07');
    assert.equal(controller.getSnapshot().financial.balances.status, 'ready');
    assert.deepEqual(controller.getSnapshot().financial.balances.data, savedBalances);
    assert.equal(controller.getSnapshot().financial.expenses.status, 'error');
    assert.equal(controller.getSnapshot().financial.expenses.summary, null);
    await controller.openActivity(groupId);
    assert.equal(controller.getSnapshot().activity.events.length, activity);
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Prepared offline', amount: '12.00' });
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
    assert.equal(await cache.load(), null);

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
    assert.ok(descriptions().includes('Lakeside dinner'));
    await controller.openExpense(groupId, expenseId);
    assert.equal(controller.getSnapshot().expense.draft?.description, 'Lakeside dinner');
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Lakeside dinner, edited' });
    await controller.saveExpense();
    assert.equal(controller.getSnapshot().expense.status, 'saved');
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
        assert.equal(expenses.status, 'ready');
        assert.ok(descriptions().includes('Lakeside dinner, edited'));
        assert.ok(!descriptions().includes('Lakeside dinner'));
      }
    };
    offline = true;
    await readOffline();
    controller.dispose();
    controller = create();
    await controller.restore();
    assert.equal(controller.getSnapshot().auth.status, 'authenticated');
    await readOffline();
    console.log(
      'PASS: real HTTP cached Home, Group, Month, balances and Activity; disk restart; missing Month; retained draft; reconnect without writes; revocation; sign-out purge; no saved copy older than a confirmed edit.',
    );
  } finally {
    offline = false;
    await controller.signOut();
    if (groupId) await alex.request(`/api/groups/${groupId}`, 'PATCH', { isArchived: true });
    await Promise.all([alex.close(), sam.close()]);
    await rm(directory, { recursive: true, force: true });
  }
}
void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Offline verification failed');
  process.exitCode = 1;
});
