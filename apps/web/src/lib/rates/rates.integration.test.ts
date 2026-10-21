import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { registerSplitbookTools } from '@/lib/mcp/tools';
import { refreshRates } from './service';
import type { RateProvider } from './providers';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
const db = integrationTestDb('rate-service');
let route: typeof import('@/app/api/groups/[id]/rates/route');
let groupId: string;
const now = new Date('2026-10-21T18:00:00Z');
const primary: RateProvider = {
  source: 'frankfurter',
  fetchTable: async () => [
    { currency: 'EUR', rate: '0.8', asOf: '2026-10-20' },
    { currency: 'INR', rate: '80', asOf: '2026-10-20' },
    { currency: 'JPY', rate: '160', asOf: '2026-10-20' },
  ],
};
const fallback: RateProvider = { source: 'exchange-rate-api', fetchTable: async () => [] };

beforeAll(async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('External network is forbidden in rate tests');
  });
  await connectSignedIn(db);
  route = await import('@/app/api/groups/[id]/rates/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  const group = await groupService.create(
    {
      name: 'Fictional trip',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: ['EUR'],
    },
    DEMO_PERSONA_IDS.alex,
  );
  groupId = String(group._id);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await disconnectSignedIn(db);
});
// Real timers continue to drive MongoDB and HTTP; only the date moves.
afterEach(() => vi.useRealTimers());

async function read(cookie: string, from = 'EUR', to = 'INR') {
  return callRoute(route.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/rates?from=${from}&to=${to}`,
    params: { id: groupId },
    cookie,
  });
}

describe('Group suggested rate read', () => {
  it('serves a member the primary cross rate and provenance from the daily cache', async () => {
    await refreshRates({ primary, fallback }, now);
    const result = await read(await signIn('alex'));
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      suggestion: {
        from: 'EUR',
        to: 'INR',
        rate: '100',
        source: 'frankfurter',
        asOf: '2026-10-20',
        fetchedAt: now.toISOString(),
        ageDays: 1,
        attributionRequired: false,
        attribution: null,
      },
    });
    expect((await read(await signIn('alex'), 'EUR', 'JPY')).body.data.suggestion.rate).toBe('200');
  });
  it('refuses anonymous callers and signed-in non-members', async () => {
    await refreshRates({ primary, fallback }, now);
    expect((await read('')).status).toBe(401);
    expect((await read(await signIn('sam'))).status).toBe(403);
  });
  const fallbackRates: RateProvider = {
    source: 'exchange-rate-api',
    fetchTable: async () => [
      { currency: 'EUR', rate: '0.9', asOf: '2026-10-21' },
      { currency: 'INR', rate: '90', asOf: '2026-10-21' },
      { currency: 'JPY', rate: '180', asOf: '2026-10-21' },
    ],
  };
  const down: RateProvider = {
    source: 'frankfurter',
    fetchTable: async () => {
      throw new Error('Fictional outage');
    },
  };
  it('uses the fallback during a primary outage and carries its required attribution', async () => {
    await refreshRates({ primary: down, fallback: fallbackRates }, now);
    expect((await read(await signIn('alex'))).body.data.suggestion).toMatchObject({
      rate: '100',
      source: 'exchange-rate-api',
      asOf: '2026-10-21',
      ageDays: 0,
      attributionRequired: true,
      attribution: { text: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' },
    });
  });
  it.each(['missing', 'stale'])(
    'falls back only for a %s currency and marks a mixed cross rate',
    async (problem) => {
      const partial: RateProvider = {
        source: 'frankfurter',
        fetchTable: async () =>
          (await primary.fetchTable()).flatMap((row) =>
            row.currency !== 'INR'
              ? [row]
              : problem === 'missing'
                ? []
                : [{ ...row, asOf: '2026-10-17' }],
          ),
      };
      await refreshRates({ primary: partial, fallback: fallbackRates }, now);
      const cookie = await signIn('alex');
      expect((await read(cookie)).body.data.suggestion).toMatchObject({
        rate: '112.5',
        source: 'mixed',
        asOf: '2026-10-20',
        attributionRequired: true,
      });
      expect((await read(cookie, 'EUR', 'JPY')).body.data.suggestion).toMatchObject({
        rate: '200',
        source: 'frankfurter',
        attributionRequired: false,
      });
      expect((await read(cookie, 'USD', 'INR')).body.data.suggestion.source).toBe(
        'exchange-rate-api',
      );
      expect((await read(cookie, 'INR', 'USD')).body.data.suggestion.rate).toBe('0.011111111111');
    },
  );
  it('returns no suggestion when both providers fail, without failing the member read', async () => {
    await refreshRates({ primary: down, fallback: { ...down, source: 'exchange-rate-api' } }, now);
    expect((await read(await signIn('alex'))).body.data).toEqual({
      suggestion: null,
      reason: 'unavailable',
    });
  });
  it('keeps three-day primary rates but refuses stale cached suggestions after the fourth day', async () => {
    const dated = {
      ...primary,
      fetchTable: async () =>
        (await primary.fetchTable()).map((row) => ({ ...row, asOf: '2026-10-18' })),
    };
    await refreshRates({ primary: dated, fallback: fallbackRates }, now);
    const cookie = await signIn('alex');
    expect((await read(cookie)).body.data.suggestion).toMatchObject({
      source: 'frankfurter',
      ageDays: 3,
    });
    vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
    expect((await read(cookie)).body.data).toEqual({ suggestion: null, reason: 'stale' });
  });
  it('keeps an unexpired saved table through a total outage without inventing a new fetch date', async () => {
    await refreshRates({ primary, fallback }, now);
    const tomorrow = new Date('2026-10-22T18:00:00Z');
    vi.setSystemTime(tomorrow);
    await refreshRates(
      { primary: down, fallback: { ...down, source: 'exchange-rate-api' } },
      tomorrow,
    );
    expect((await read(await signIn('alex'))).body.data.suggestion).toMatchObject({
      rate: '100',
      fetchedAt: now.toISOString(),
      ageDays: 2,
    });
  });
  it('uses the fallback for invalid or future-dated primary entries', async () => {
    const invalid = {
      ...primary,
      fetchTable: async () => [
        { currency: 'EUR', rate: '-1', asOf: '2026-10-21' },
        { currency: 'INR', rate: '80', asOf: '2026-10-22' },
      ],
    };
    await refreshRates({ primary: invalid, fallback: fallbackRates }, now);
    expect((await read(await signIn('alex'))).body.data.suggestion).toMatchObject({
      rate: '100',
      source: 'exchange-rate-api',
    });
  });
  it('reports missing currencies and rejects unsupported codes', async () => {
    await refreshRates({ primary, fallback }, now);
    const cookie = await signIn('alex');
    expect((await read(cookie, 'EUR', 'KRW')).body.data).toEqual({
      suggestion: null,
      reason: 'currency_unavailable',
    });
    expect((await read(cookie, 'EUR', 'ZZZ')).status).toBe(422);
    expect((await read(cookie, 'EUR', 'EUR')).body.data).toEqual({
      suggestion: null,
      reason: 'same_currency',
    });
  });
  it('never exposes fallback rates through the assistant tools', async () => {
    await refreshRates({ primary: down, fallback: fallbackRates }, now);
    expect((await read(await signIn('alex'))).body.data.suggestion.attributionRequired).toBe(true);
    const handler = createMcpHandler(
      async () => {
        const server = new McpServer({ name: 'fictional-rate-boundary', version: '1' });
        registerSplitbookTools(
          server,
          { id: DEMO_PERSONA_IDS.alex },
          ['ledger:read'],
          'http://localhost:3000',
        );
        return server;
      },
      { legacy: 'stateless' },
    );
    const client = new Client({ name: 'fictional-rate-client', version: '1' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
          fetch: async (input, init) => handler.fetch(new Request(input, init)),
        }),
      );
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual(['list_groups', 'group_context', 'group_balances', 'group_spending']);
      for (const name of names) {
        const result = await client.callTool({
          name,
          arguments:
            name === 'list_groups'
              ? {}
              : name === 'group_spending'
                ? { groupId, from: '2026-10-01', to: '2026-10-21' }
                : { groupId },
        });
        expect(result.isError).not.toBe(true);
        expect(JSON.stringify(result)).not.toMatch(
          /exchange-rate-api|Rates By Exchange Rate API|"rate"|"suggestion"/,
        );
      }
      await expect(
        client.callTool({ name: 'exchange_rates', arguments: { groupId, from: 'EUR', to: 'INR' } }),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  });
});
