import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { CURRENCY_CODES } from '@splitbook/shared/currency';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createRefreshHandler } from './cron';
import type { RateProvider } from './providers';
import { readRateSuggestion } from './service';
const db = integrationTestDb('rate-cron');
const now = new Date('2026-10-21T18:00:00Z');
let calls = 0;
const primary: RateProvider = {
  source: 'frankfurter',
  fetchTable: async () => {
    calls++;
    return CURRENCY_CODES.filter((code) => code !== 'USD').map((currency) => ({
      currency,
      rate: currency === 'EUR' ? '0.8' : '80',
      asOf: '2026-10-21',
    }));
  },
};
const fallback: RateProvider = {
  source: 'exchange-rate-api',
  fetchTable: async () => {
    throw new Error('Fresh primary must not need the fallback');
  },
};
const handler = createRefreshHandler({ primary, fallback }, () => now);
const request = (authorization?: string) =>
  new Request('http://localhost/api/cron/exchange-rates', {
    headers: authorization ? { authorization } : {},
  });
beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  calls = 0;
  vi.stubEnv('CRON_SECRET', 'synthetic-cron-fixture');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.teardown();
});

it('requires the cron secret and fails closed when it is unset', async () => {
  for (const value of [undefined, 'Bearer wrong', 'Bearer undefined'])
    expect((await handler(request(value))).status).toBe(401);
  vi.stubEnv('CRON_SECRET', '');
  expect((await handler(request('Bearer synthetic-cron-fixture'))).status).toBe(401);
  expect(calls).toBe(0);
});
it('fetches once for concurrent daily cron calls and never returns the rate table', async () => {
  const results = await Promise.all(
    Array.from({ length: 3 }, () => handler(request('Bearer synthetic-cron-fixture'))),
  );
  expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
  expect(calls).toBe(1);
  for (const response of results) {
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(JSON.stringify(await response.json())).not.toMatch(/"rate"|"entries"|"EUR"/);
  }
  expect((await readRateSuggestion('EUR', 'INR', now)).suggestion?.rate).toBe('100');
  const tomorrow = createRefreshHandler(
    { primary, fallback },
    () => new Date('2026-10-22T18:00:00Z'),
  );
  expect((await tomorrow(request('Bearer synthetic-cron-fixture'))).status).toBe(200);
  expect(calls).toBe(2);
});
