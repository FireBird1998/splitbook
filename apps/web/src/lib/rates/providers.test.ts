import { describe, expect, it, vi } from 'vitest';
import { createRateProviders } from './providers';

describe('rate-provider HTTP adapters with fictional responses', () => {
  it('reads Frankfurter v2 rows from one USD table and preserves each date', async () => {
    const http = vi.fn(async () =>
      Response.json([
        { base: 'USD', quote: 'EUR', rate: 0.8, date: '2026-10-20' },
        { base: 'USD', quote: 'JPY', rate: 160, date: '2026-10-19' },
        { base: 'EUR', quote: 'INR', rate: 90, date: '2026-10-20' },
        { base: 'USD', quote: 'INR', rate: -1, date: '2026-10-20' },
      ]),
    );
    expect(await createRateProviders(http).primary.fetchTable()).toEqual([
      { currency: 'EUR', rate: '0.8', asOf: '2026-10-20' },
      { currency: 'JPY', rate: '160', asOf: '2026-10-19' },
    ]);
    expect(http).toHaveBeenCalledWith(
      'https://api.frankfurter.dev/v2/rates?base=USD',
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it('reads the open-access fallback date from its update timestamp, not the fetch day', async () => {
    const http = vi.fn(async () =>
      Response.json({
        result: 'success',
        base_code: 'USD',
        time_last_update_unix: 1792454400,
        rates: { USD: 1, EUR: 0.9, INR: 90 },
      }),
    );
    expect(await createRateProviders(http).fallback.fetchTable()).toEqual([
      { currency: 'EUR', rate: '0.9', asOf: '2026-10-20' },
      { currency: 'INR', rate: '90', asOf: '2026-10-20' },
    ]);
    expect(http).toHaveBeenCalledWith('https://open.er-api.com/v6/latest/USD', expect.any(Object));
  });
  it('refuses failed, malformed, wrong-base and oversized provider responses', async () => {
    for (const response of [
      new Response('', { status: 503 }),
      Response.json({ result: 'error' }),
      Response.json({
        result: 'success',
        base_code: 'EUR',
        time_last_update_unix: 1792454400,
        rates: { EUR: 1 },
      }),
      new Response('x'.repeat(131073)),
    ]) {
      await expect(
        createRateProviders(async () => response).fallback.fetchTable(),
      ).rejects.toThrow();
    }
  });
});
