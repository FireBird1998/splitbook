/** #59: public controller + real HTTP, with disk-backed restart and controlled network loss. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createMobileController } from '../src/data';
import { FixtureActor, samId } from './financial-view-fixtures';
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
  const entries = async () => z.record(z.string(), z.unknown()).parse((await cache.load()) ?? {});
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
          stores: [identity, cache, draft],
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
    await controller.selectMonth('2026-07');
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
    console.log(
      'PASS: real HTTP cached Home, Group, Month, balances and Activity; disk restart; missing Month; retained draft; reconnect without writes; revocation; sign-out purge.',
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
