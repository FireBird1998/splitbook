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
      return Response.json(
        { data: await refreshRates(providers, now()), status: 200 },
        { headers },
      );
    } catch {
      // Do not log credentials, provider replies or rate data.
      return Response.json({ error: 'Rate refresh failed', status: 500 }, { status: 500, headers });
    }
  };
}
