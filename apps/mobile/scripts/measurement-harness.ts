/**
 * Controller Requests and Count cover journey start through 3 × the injected delay after
 * its action resolves. Settled records the action's resolution, without subtracting a wait.
 * First content is the first matching public snapshot (0 when already shown). Controller
 * requests outside all journey windows are reported separately, never lost or reassigned.
 * The harness creates and archives only its own fictional Household; no database reset.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { createMobileController, type MobileController } from '../src/data';
import type { MobileSnapshot } from '../src/data/types';
import { FixtureActor } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';

interface Row {
  journey: string;
  requests: string;
  count: number;
  contentMs: number | null;
  settledMs: number;
}
const summarize = (routes: readonly string[]) => {
  const counts = new Map<string, number>();
  for (const route of routes) counts.set(route, (counts.get(route) ?? 0) + 1);
  return [...counts].map(([route, count]) => `${count}× ${route}`).join(', ') || 'none';
};

/** Shared clock/window semantics; only public controller snapshots are observed. */
export function measurementWindows(
  controller: () => Pick<MobileController, 'getSnapshot' | 'subscribe'>,
  latency: number,
) {
  const rows: Row[] = [],
    outside: string[] = [];
  let active: string[] | null = null;
  return {
    rows,
    outside,
    record(route: string) {
      (active ?? outside).push(route);
    },
    async measure(
      journey: string,
      action: () => Promise<unknown>,
      content: (state: MobileSnapshot) => boolean,
    ) {
      assert.equal(active, null, 'Journeys must run sequentially.');
      const routes: string[] = [];
      active = routes;
      const current = controller();
      const start = performance.now();
      let contentMs: number | null = content(current.getSnapshot()) ? 0 : null;
      const stop = current.subscribe(() => {
        if (contentMs === null && content(current.getSnapshot()))
          contentMs = performance.now() - start;
      });
      try {
        let failed = false,
          failure: unknown;
        try {
          await action();
        } catch (error) {
          failed = true;
          failure = error;
        }
        const settledMs = performance.now() - start;
        await new Promise((done) => setTimeout(done, latency * 3));
        rows.push({
          journey: failed ? `${journey} (failed)` : journey,
          requests: summarize(routes),
          count: routes.length,
          contentMs: contentMs === null ? null : Math.round(contentMs),
          settledMs: Math.round(settledMs),
        });
        if (failed) throw failure;
      } finally {
        stop();
        active = null;
      }
    },
    print() {
      console.log(`Injected delay: ${latency} ms per request.`);
      console.log(
        'Controller Requests and Count: journey start through 3 × injected delay after the action resolves.',
      );
      console.log(
        'Settled: action resolution (or rejection for a failed journey). First content: first matching snapshot (0 if already shown).',
      );
      console.log('| Journey | Requests | Count | First content (ms) | Settled (ms) |');
      console.log('| --- | --- | ---: | ---: | ---: |');
      for (const row of rows)
        console.log(
          `| ${row.journey} | ${row.requests} | ${row.count} | ${row.contentMs ?? 'not shown'} | ${row.settledMs} |`,
        );
      console.log(
        `Outside journey windows (${outside.length} controller requests): ${summarize(outside)}.`,
      );
    },
  };
}

function memoryStore() {
  const records = new Map<string, unknown>();
  return {
    load: async (account: string, key: string) =>
      structuredClone(records.get(`${account}:${key}`) ?? null),
    save: async (account: string, key: string, value: unknown) => {
      records.set(`${account}:${key}`, structuredClone(value));
    },
    remove: async (account: string, key: string) => {
      records.delete(`${account}:${key}`);
    },
    clear: async () => {
      records.clear();
    },
    list: async (account: string) =>
      [...records]
        .filter(([key]) => key.startsWith(`${account}:`))
        .map(([key, value]) => ({
          groupId: key.slice(account.length + 1),
          value: structuredClone(value),
        })),
  };
}

interface Options {
  prefix: string;
  persistOfflineIdentity?: boolean;
  extraQueryKey?: (target: URL) => string | undefined;
}

async function setup(options: Options) {
  const origin = localOrigin();
  const latency = Number(process.env.MEASURE_LATENCY_MS ?? 300);
  assert.ok(
    Number.isFinite(latency) && latency >= 0,
    'MEASURE_LATENCY_MS must be a finite nonnegative number.',
  );
  const alex = new FixtureActor(origin),
    sam = new FixtureActor(origin);
  const runId = randomUUID(),
    now = new Date();
  const id = z.string().regex(/^[a-f\d]{24}$/);
  let groupId: string | null = null,
    controller: MobileController | null = null;
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null;
  let cleanup = false,
    offline = false,
    skew = 0;
  const savedRows = memoryStore(),
    drafts = memoryStore(),
    attempts = memoryStore();
  const platformNow = Date.now;
  const windows = measurementWindows(() => {
    assert.ok(controller);
    return controller;
  }, latency);
  const close = async () => {
    offline = false;
    try {
      await controller?.signOut().catch(() => undefined);
      controller?.dispose();
      if (groupId) await alex.request(`/api/groups/${groupId}`, 'DELETE');
    } finally {
      await Promise.allSettled([alex.close(), sam.close()]);
      Date.now = platformNow;
      windows.print();
    }
  };
  try {
    await alex.signIn('alex');
    await sam.signIn('sam');
    groupId = z.object({ data: z.object({ _id: id }) }).parse(
      await alex.request(
        '/api/groups',
        'POST',
        {
          name: `${options.prefix} ${runId}`,
          description: `Fictional ${options.prefix} measurement. Run ${runId}.`,
          category: 'home',
          defaultCurrency: 'INR',
          alternateCurrencies: [],
        },
        201,
      ),
    ).data._id;
    const code = z
      .object({ data: z.object({ inviteCode: z.string() }) })
      .parse(await alex.request(`/api/groups/${groupId}/invite-link`, 'POST', {}, 201))
      .data.inviteCode;
    await sam.request(`/api/join/${code}`, 'POST', undefined, 201);
    const tagName = `${options.prefix} timing`;
    const tagId = z
      .object({ data: z.object({ tags: z.array(z.object({ _id: id, name: z.string() })) }) })
      .parse(await alex.request(`/api/groups/${groupId}/tags`, 'POST', { name: tagName }))
      .data.tags.find((tag) => tag.name === tagName)?._id;
    assert.ok(tagId);
    Date.now = () => platformNow() + skew;
    return {
      alex,
      sam,
      groupId,
      tagId,
      runId,
      now,
      close,
      measure: windows.measure,
      month(offset: number) {
        const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      },
      advance(milliseconds: number) {
        skew += milliseconds;
      },
      setOffline(value: boolean) {
        offline = value;
      },
      restart() {
        controller?.dispose();
        controller = createMobileController(
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
            expenseDrafts: drafts,
            settlementAttempts: attempts,
            newSubmissionKey: randomUUID,
            offlineIdentity: {
              load: async () => (options.persistOfflineIdentity ? structuredClone(identity) : null),
              save: async (value) => {
                if (options.persistOfflineIdentity) identity = structuredClone(value);
              },
              clear: async () => {
                identity = null;
              },
            },
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
              stores: [savedRows, drafts, attempts],
            },
            fetch: async (url, init) => {
              const target = new URL(url);
              assert.equal(
                target.origin,
                origin,
                'A controller request attempted a nonlocal target.',
              );
              const query =
                options.extraQueryKey?.(target) ??
                (target.searchParams.has('dateFrom') ? '?month' : '');
              windows.record(
                `${init.method ?? 'GET'} ${target.pathname.replace(groupId!, ':group').replace(/[a-f\d]{24}/g, ':id')}${query}`,
              );
              await new Promise((done) => setTimeout(done, latency));
              if (offline) throw new TypeError('Network request failed');
              return fetch(url, init);
            },
          },
        );
        return controller;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function withMeasurementHarness(
  options: Options,
  run: (harness: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const harness = await setup(options);
  try {
    await run(harness);
  } finally {
    await harness.close();
  }
}
