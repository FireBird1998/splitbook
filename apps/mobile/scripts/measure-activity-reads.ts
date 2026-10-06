/**
 * #108: request counts and timings for the Group Activity destination, so a change to how
 * Activity is read can be compared with the controller's own reads on the same journeys.
 * Public controller → real HTTP → isolated fictional ledger, with a fixed injected delay
 * per request (MEASURE_LATENCY_MS, default 300). Creates, then archives, its own fictional
 * Household Group. Never resets a database.
 *
 * A foreground event is what App.tsx does when Android reports the app active again: the
 * controller's foreground refresh. The TanStack Query pilot (PR #173) also sent a focus
 * event through its focusManager; that call left with the pilot.
 *
 * Run inside apps/mobile, as the verify:* scripts run, against a fictional backend:
 *   MOBILE_VERIFY_URL=http://127.0.0.1:<port> node --import tsx scripts/measure-activity-reads.ts
 * Record: docs/qa/2026-10-02-android-activity-query-pilot.md.
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
  const groupId = created.parse(
    await alex.request(
      '/api/groups',
      'POST',
      {
        name: `QA108 ${runId}`,
        description: `Fictional #108 Activity measurement. Run ${runId}.`,
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: [],
      },
      201,
    ),
  ).data._id;
  // Disk-like stores survive a controller restart, as do the cookie and verified identity.
  const cache = memoryStore(),
    // The persister's rows: the Groups list and Home (#217).
    savedRows = memoryStore(),
    drafts = memoryStore(),
    attempts = memoryStore();
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    cleanup = false,
    offline = false,
    skew = 0,
    log: string[] = [];
  // Display freshness runs on TanStack Query's clock, Date.now (#214), so skipping ahead moves
  // Date.now itself, and the controller's clock with it.
  const platformNow = Date.now.bind(Date);
  Date.now = () => platformNow() + skew;
  let controller: MobileController | null = null;
  const create = () =>
    createMobileController(
      { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
      {
        now: () => Date.now(),
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        savedQueries: savedRows,
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
          invalidateLedger: async (account, group) => {
            for (const key of [...cache.records.keys()])
              if (
                key.startsWith(`${account}:/api/groups/${group}/`) ||
                key.startsWith(`${account}:/api/groups/${group}?`) ||
                key === `${account}:/api/user/balances`
              )
                cache.records.delete(key);
          },
          retainGroups: async () => undefined,
        },
        offlineIdentity: {
          load: async () => identity,
          save: async (value) => {
            identity = structuredClone(value);
          },
          clear: async () => {
            identity = null;
          },
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
          stores: [cache, savedRows, drafts, attempts],
        },
        fetch: async (url, init) => {
          const target = new URL(url);
          assert.equal(target.origin, origin, 'A controller request attempted a nonlocal target.');
          const page = target.pathname.endsWith('/activity')
            ? `?page=${target.searchParams.get('page')}`
            : target.searchParams.has('dateFrom')
              ? '?month'
              : '';
          log.push(
            `${init.method ?? 'GET'} ${target.pathname
              .replace(groupId, ':group')
              .replace(/[a-f\d]{24}/g, ':id')}${page}`,
          );
          await new Promise((done) => setTimeout(done, latency));
          if (offline) throw new TypeError('Network request failed');
          return fetch(url, init);
        },
      },
    );

  const foreground = () => controller!.refresh('foreground');
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
    // Reads a destination starts in the background still count towards its journey.
    await new Promise((done) => setTimeout(done, latency * 3));
    const settledMs = performance.now() - start - latency * 3;
    stop();
    const counts = new Map<string, number>();
    for (const route of log) counts.set(route, (counts.get(route) ?? 0) + 1);
    rows.push({
      journey,
      requests: [...counts].map(([route, count]) => `${count}× ${route}`).join(', ') || 'none',
      count: log.length,
      contentMs: contentMs === null ? null : Math.round(contentMs),
      settledMs: Math.round(Math.max(0, settledMs)),
    });
  };
  const activityShown =
    (minimum = 1) =>
    (state: MobileSnapshot) =>
      state.screen === 'group' &&
      state.destination === 'activity' &&
      state.activity.groupId === groupId &&
      state.activity.events.length >= minimum;
  const activityHasDescription = (text: string) => (state: MobileSnapshot) =>
    activityShown()(state) &&
    state.activity.events.some((event) => event.metadata.description?.startsWith(text));

  try {
    const code = z
      .object({ data: z.object({ inviteCode: z.string() }) })
      .parse(await alex.request(`/api/groups/${groupId}/invite-link`, 'POST', {}, 201))
      .data.inviteCode;
    await sam.request(`/api/join/${code}`, 'POST', undefined, 201);
    const tagId = tagged
      .parse(await alex.request(`/api/groups/${groupId}/tags`, 'POST', { name: 'QA108 timing' }))
      .data.tags.find((tag) => tag.name === 'QA108 timing')?._id;
    assert.ok(tagId);
    // More than one Activity page: 24 Expenses plus the Group and membership events.
    const now = new Date();
    for (let index = 1; index <= 24; index += 1)
      await alex.request(
        `/api/groups/${groupId}/expenses`,
        'POST',
        {
          description: `QA108 seeded ${index}`,
          amount: 30,
          currency: 'INR',
          category: 'other',
          tagId,
          date: new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString(),
          paidBy: [{ user: alexId, amount: 30 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alexId }, { user: samId }],
        },
        201,
      );

    controller = create();
    await controller.signIn('sam');
    await measure(
      'Open the Group on Activity (first time)',
      () => controller!.openActivity(groupId),
      activityShown(),
    );
    await measure(
      'Expenses, then Activity again within 30 s',
      async () => {
        await controller!.selectDestination('expenses');
        await controller!.selectDestination('activity');
      },
      activityShown(),
    );
    await measure(
      'Three overlapping foreground events on Activity within 30 s',
      () => Promise.all([foreground(), foreground(), foreground()]),
      activityShown(),
    );
    skew += 31_000;
    await measure(
      'Three overlapping foreground events on Activity after 30 s',
      () => Promise.all([foreground(), foreground(), foreground()]),
      activityShown(),
    );
    await measure(
      'Pull to refresh on Activity',
      () => controller!.refresh('pull'),
      activityShown(),
    );
    await measure('Load older Activity', () => controller!.loadMoreActivity(), activityShown(21));
    await measure(
      'Home, then the Group on Activity within 30 s',
      async () => {
        await controller!.back();
        await controller!.openActivity(groupId);
      },
      activityShown(),
    );
    await controller.selectDestination('expenses');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      amount: '45.50',
      description: `QA108 confirmed write ${runId.slice(0, 8)}`,
      tagId,
    });
    await measure(
      'Confirmed Expense create (returns to Expenses)',
      () => controller!.saveExpense(),
      (state) => state.screen === 'group' && state.destination === 'expenses',
    );
    await measure(
      'Activity after the confirmed create',
      () => controller!.selectDestination('activity'),
      activityHasDescription('QA108 confirmed write'),
    );
    assert.ok(
      activityHasDescription('QA108 confirmed write')(controller.getSnapshot()),
      'The confirmed Expense is missing from Activity after the write.',
    );
    controller.dispose();
    skew += 31_000;
    controller = create();
    await controller.restore();
    await measure(
      'Restart: open the Group on Activity (saved views)',
      () => controller!.openActivity(groupId),
      activityShown(),
    );
    controller.dispose();
    offline = true;
    controller = create();
    await controller.restore();
    await measure(
      'Offline restart: open the Group on Activity',
      () => controller!.openActivity(groupId),
      activityShown(),
    );
    const shown = controller.getSnapshot();
    console.log(
      `Offline restart: Activity ${shown.activity.status}, ${shown.activity.events.length} events, offline label ${shown.offline.active ? 'shown' : 'absent'}, saved time ${shown.offline.refreshedAt ? 'kept' : 'absent'}.`,
    );
    offline = false;

    console.log(`Injected delay: ${latency} ms per request.`);
    console.log('| Journey | Requests | Count | First content (ms) | Settled (ms) |');
    console.log('| --- | --- | ---: | ---: | ---: |');
    for (const row of rows)
      console.log(
        `| ${row.journey} | ${row.requests} | ${row.count} | ${row.contentMs ?? 'not shown'} | ${row.settledMs} |`,
      );
  } finally {
    offline = false;
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
