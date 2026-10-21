import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
afterAll(() => disconnectSignedIn(db));
// Real timers continue to drive MongoDB and HTTP; only the date moves.
import { afterEach } from 'vitest';
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
});
