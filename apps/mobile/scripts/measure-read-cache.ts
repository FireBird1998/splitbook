/**
 * #103: request counts and cold/warm timings for display reads.
 * Public controller → real HTTP → isolated fictional ledger, with a fixed injected
 * delay per request (MEASURE_LATENCY_MS, default 300) so timings resemble a phone.
 * Creates, then archives, its own fictional Household Group. Never resets a database.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { createMobileController, type MobileController } from '../src/data';
import type { MobileSnapshot } from '../src/data/types';
import { alexId, samId, FixtureActor } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';

const latency = Number(process.env.MEASURE_LATENCY_MS ?? 300);
const id = z.string().regex(/^[a-f\d]{24}$/);
const created = z.object({ data: z.object({ _id: id }) });
const tagged = z.object({
  data: z.object({ tags: z.array(z.object({ _id: id, name: z.string() })) }),
});

interface Row {
  journey: string;
  requests: string;
  count: number;
  contentMs: number | null;
  settledMs: number;
}

function memoryStore() {
  const records = new Map<string, unknown>();
  return {
    load: async (account: string, key: string) => records.get(`${account}:${key}`) ?? null,
    save: async (account: string, key: string, value: unknown) => {
      records.set(`${account}:${key}`, structuredClone(value));
    },
    remove: async (account: string, key: string) => {
      records.delete(`${account}:${key}`);
    },
    clear: async () => {
      records.clear();
    },
    records,
  };
}

async function run() {
  const origin = localOrigin();
  const alex = new FixtureActor(),
    sam = new FixtureActor();
  await alex.signIn('alex');
  await sam.signIn('sam');
  const runId = randomUUID();
  const now = new Date();
  const month = (offset: number) => {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  };
  const groupId = created.parse(
    await alex.request(
      '/api/groups',
      'POST',
      {
        name: `QA103 ${runId}`,
        description: `Fictional #103 cache measurement. Run ${runId}.`,
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: [],
      },
      201,
    ),
  ).data._id;
  // Persisted (disk-like) stores survive a controller restart; the session cookie too.
  const cache = memoryStore(),
    drafts = memoryStore(),
    attempts = memoryStore();
  let cookie: string | null = null,
    owner: string | null = null,
    cleanup = false,
    skew = 0,
    log: string[] = [];
  let controller: MobileController | null = null;
  const create = () =>
    createMobileController(
      { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
      {
        now: () => Date.now() + skew,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        readCache: {
          load: (account, path) => cache.load(account, path),
          save: (account, path, value) => cache.save(account, path, value),
          clear: cache.clear,
          invalidateGroup: async (account, group) => {
            for (const key of [...cache.records.keys()])
              if (
                key.startsWith(`${account}:/api/groups/${group}`) ||
                key === `${account}:/api/groups` ||
                key === `${account}:/api/user/balances`
              )
                cache.records.delete(key);
          },
          retainGroups: async () => undefined,
        },
        offlineIdentity: {
          load: async () => null,
          save: async () => undefined,
          clear: async () => undefined,
        },
        expenseDrafts: drafts,
        settlementAttempts: attempts,
        newSubmissionKey: randomUUID,
        accountLocal: {
          owner: {
            load: async () => owner,
            save: async (value) => {
              owner = value;
            },
            clear: async () => {
              owner = null;
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
          stores: [cache, drafts, attempts],
        },
        fetch: async (url, init) => {
          const target = new URL(url);
          assert.equal(target.origin, origin, 'A controller request attempted a nonlocal target.');
          const route = `${init.method ?? 'GET'} ${target.pathname
            .replace(groupId, ':group')
            .replace(/[a-f\d]{24}/g, ':id')}${target.searchParams.has('dateFrom') ? '?month' : ''}`;
          log.push(route);
          await new Promise((done) => setTimeout(done, latency));
          return fetch(url, init);
        },
      },
    );

  const rows: Row[] = [];
  const measure = async (
    journey: string,
    action: () => Promise<unknown>,
    content: (state: MobileSnapshot) => boolean,
  ) => {
    assert.ok(controller);
    log = [];
    const start = performance.now();
    let contentMs: number | null = content(controller.getSnapshot()) ? 0 : null;
    const stop = controller.subscribe(() => {
      if (contentMs === null && content(controller!.getSnapshot()))
        contentMs = performance.now() - start;
    });
    await action();
    const settledMs = performance.now() - start;
    stop();
    const counts = new Map<string, number>();
    for (const route of log) counts.set(route, (counts.get(route) ?? 0) + 1);
    rows.push({
      journey,
      requests: [...counts].map(([route, count]) => `${count}× ${route}`).join(', ') || 'none',
      count: log.length,
      contentMs: contentMs === null ? null : Math.round(contentMs),
      settledMs: Math.round(settledMs),
    });
  };
  const groupsShown = (state: MobileSnapshot) =>
    state.groups.data.some((group) => group.id === groupId) && state.home.data !== null;
  const groupShown = (state: MobileSnapshot) =>
    state.detail.data?.id === groupId &&
    state.financial.expenses.data.length > 0 &&
    state.financial.balances.data !== null;
  const monthShown = (key: string) => (state: MobileSnapshot) =>
    state.financial.month === key &&
    state.financial.expenses.month === key &&
    state.financial.expenses.data.length > 0;

  try {
    const code = z
      .object({ data: z.object({ inviteCode: z.string() }) })
      .parse(await alex.request(`/api/groups/${groupId}/invite-link`, 'POST', {}, 201))
      .data.inviteCode;
    await sam.request(`/api/join/${code}`, 'POST', undefined, 201);
    const tagId = tagged
      .parse(await alex.request(`/api/groups/${groupId}/tags`, 'POST', { name: 'QA103 timing' }))
      .data.tags.find((tag) => tag.name === 'QA103 timing')?._id;
    assert.ok(tagId);
    for (const [offset, description] of [
      [0, 'QA103 this Month groceries'],
      [0, 'QA103 this Month rent share'],
      [-1, 'QA103 last Month groceries'],
    ] as const) {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 2, 12);
      await alex.request(
        `/api/groups/${groupId}/expenses`,
        'POST',
        {
          description,
          amount: 120,
          currency: 'INR',
          category: 'other',
          tagId,
          date: date.toISOString(),
          paidBy: [{ user: alexId, amount: 120 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alexId }, { user: samId }],
        },
        201,
      );
    }

    controller = create();
    await measure(
      'Sign in, Groups and Home (cold, no saved views)',
      () => controller!.signIn('sam'),
      groupsShown,
    );
    await measure('Open the Group (first time)', () => controller!.openGroup(groupId), groupShown);
    await measure(
      'Back to Groups within 30 s',
      () => Promise.resolve(controller!.back()),
      groupsShown,
    );
    await measure('Reopen the Group within 30 s', () => controller!.openGroup(groupId), groupShown);
    await measure(
      'Three overlapping foreground events within 30 s',
      () =>
        Promise.all([
          controller!.refresh('foreground'),
          controller!.refresh('foreground'),
          controller!.refresh('foreground'),
        ]),
      groupShown,
    );
    skew += 31_000;
    await measure(
      'Three overlapping foreground events after 30 s',
      () =>
        Promise.all([
          controller!.refresh('foreground'),
          controller!.refresh('foreground'),
          controller!.refresh('foreground'),
        ]),
      groupShown,
    );
    await measure('Pull to refresh', () => controller!.refresh('pull'), groupShown);
    await measure(
      'Previous Month (first visit)',
      () => controller!.selectMonth(month(-1)),
      monthShown(month(-1)),
    );
    await measure(
      'Back to this Month within 30 s',
      () => controller!.selectMonth(month(0)),
      monthShown(month(0)),
    );
    await measure(
      'Previous, this, previous Month without waiting',
      () =>
        Promise.all([
          controller!.selectMonth(month(-1)),
          controller!.selectMonth(month(0)),
          controller!.selectMonth(month(-1)),
        ]),
      monthShown(month(-1)),
    );
    await controller.selectMonth(month(0));
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      amount: '45.50',
      description: `QA103 confirmed write ${runId.slice(0, 8)}`,
      tagId,
    });
    await measure(
      'Confirmed Expense create, then affected views',
      () => controller!.saveExpense(),
      (state) =>
        state.screen === 'group' &&
        state.financial.expenses.data.some((expense) =>
          expense.description.startsWith('QA103 confirmed write'),
        ),
    );
    assert.ok(
      controller
        .getSnapshot()
        .financial.expenses.data.some((expense) =>
          expense.description.startsWith('QA103 confirmed write'),
        ),
      'The confirmed Expense is missing after the post-write refresh.',
    );
    controller.dispose();
    skew += 31_000;
    controller = create();
    await measure(
      'Restart: restore, Groups and Home (saved views)',
      () => controller!.restore(),
      groupsShown,
    );
    await measure(
      'Restart: open the Group (saved views)',
      () => controller!.openGroup(groupId),
      groupShown,
    );

    console.log(`Injected delay: ${latency} ms per request.`);
    console.log('| Journey | Requests | Count | First content (ms) | Settled (ms) |');
    console.log('| --- | --- | ---: | ---: | ---: |');
    for (const row of rows)
      console.log(
        `| ${row.journey} | ${row.requests} | ${row.count} | ${row.contentMs ?? 'not shown'} | ${row.settledMs} |`,
      );
  } finally {
    await controller?.signOut().catch(() => undefined);
    await alex.request(`/api/groups/${groupId}`, 'DELETE').catch(() => undefined);
    await alex.close();
    await sam.close();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
