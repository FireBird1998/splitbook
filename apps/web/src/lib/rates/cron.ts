import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { refreshRates } from './service';
import type { RateProviders } from './providers';

/** The sole provider-fetch entry point. The response deliberately contains no rates. */
export function createRefreshHandler(providers: RateProviders, now = () => new Date()) {
  return async (request: Request): Promise<Response> => {
    const secret = process.env.CRON_SECRET;
    const supplied = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const headers = { 'Cache-Control': 'no-store' };
    if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return Response.json({ error: 'Unauthorized', status: 401 }, { status: 401, headers });
    try {
      const data = await refreshRates(providers, now());
      const status = data.reason === 'providers_unavailable' ? 502 : 200;
      if (status === 502) {
        // Counts only: never log credentials, provider replies or rate data.
        console.warn('Rate refresh: providers unavailable', {
          freshCurrencies: 0,
          availableCurrencies: data.availableCurrencies,
        });
      }
      return Response.json({ data, status }, { status, headers });
    } catch {
      // Do not log credentials, provider replies or rate data.
      return Response.json({ error: 'Rate refresh failed', status: 500 }, { status: 500, headers });
    }
  };
}
