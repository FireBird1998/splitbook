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

it('does not let a delayed earlier-day invocation replace the newer daily table', async () => {
  await handler(request('Bearer synthetic-cron-fixture'));
  const yesterday = createRefreshHandler(
    { primary, fallback },
    () => new Date('2026-10-20T18:00:00Z'),
  );
  await yesterday(request('Bearer synthetic-cron-fixture'));
  expect(calls).toBe(1);
});

it('keeps the next day’s table when an earlier claimed run finishes last', async () => {
  let release!: () => void;
  let claimed!: () => void;
  const stalled = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    claimed = resolve;
  });
  const slow = createRefreshHandler(
    {
      primary: {
        ...primary,
        fetchTable: async () => {
          claimed(); // The service has already claimed day D before entering the provider.
          await stalled;
          return primary.fetchTable();
        },
      },
      fallback,
    },
    () => now,
  );
  const nextDay = new Date('2026-10-22T18:00:00Z');
  const next = createRefreshHandler(
    {
      primary: {
        ...primary,
        fetchTable: async () =>
          (await primary.fetchTable()).map((row) => ({
            ...row,
            rate: row.currency === 'EUR' ? '0.8' : '96',
            asOf: '2026-10-22',
          })),
      },
      fallback,
    },
    () => nextDay,
  );
  const earlier = slow(request('Bearer synthetic-cron-fixture'));
  try {
    await started;
    expect((await next(request('Bearer synthetic-cron-fixture'))).status).toBe(200);
    expect((await readRateSuggestion('EUR', 'INR', nextDay)).suggestion).toMatchObject({
      rate: '120',
      asOf: '2026-10-22',
      fetchedAt: nextDay.toISOString(),
    });
  } finally {
    release();
    await earlier;
  }
  expect((await readRateSuggestion('EUR', 'INR', nextDay)).suggestion).toMatchObject({
    rate: '120',
    asOf: '2026-10-22',
    fetchedAt: nextDay.toISOString(),
  });
});

it.each(['throws', 'empty', 'stale'])(
  'reports a provider outage when each source is %s, while keeping saved suggestions',
  async (failure) => {
    await handler(request('Bearer synthetic-cron-fixture'));
    const nextDay = new Date('2026-10-22T18:00:00Z');
    const saved = await readRateSuggestion('EUR', 'INR', nextDay);
    const fetchTable: RateProvider['fetchTable'] = async () => {
      if (failure === 'throws') throw new Error('Fictional provider outage');
      if (failure === 'empty') return [];
      return (await primary.fetchTable()).map((row) => ({ ...row, asOf: '2026-10-17' }));
    };
    const unavailable = createRefreshHandler(
      {
        primary: { source: 'frankfurter', fetchTable },
        fallback: { source: 'exchange-rate-api', fetchTable },
      },
      () => nextDay,
    );
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await unavailable(request('Bearer synthetic-cron-fixture'));
      expect(response.status).toBe(502);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({
        data: { refreshed: false, reason: 'providers_unavailable', availableCurrencies: 29 },
        status: 502,
      });
      expect(log).toHaveBeenCalledWith('Rate refresh: providers unavailable', {
        freshCurrencies: 0,
        availableCurrencies: 29,
      });
      expect(await readRateSuggestion('EUR', 'INR', nextDay)).toEqual(saved);
    } finally {
      log.mockRestore();
    }
  },
);

it('reports zero available currencies when an outage starts without a saved table', async () => {
  const fetchTable = async () => [];
  const unavailable = createRefreshHandler(
    {
      primary: { source: 'frankfurter', fetchTable },
      fallback: { source: 'exchange-rate-api', fetchTable },
    },
    () => now,
  );
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const response = await unavailable(request('Bearer synthetic-cron-fixture'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      data: { refreshed: false, reason: 'providers_unavailable', availableCurrencies: 0 },
      status: 502,
    });
    expect(log).toHaveBeenCalledWith('Rate refresh: providers unavailable', {
      freshCurrencies: 0,
      availableCurrencies: 0,
    });
    expect(await readRateSuggestion('EUR', 'INR', now)).toEqual({
      suggestion: null,
      reason: 'unavailable',
    });
  } finally {
    log.mockRestore();
  }
});
