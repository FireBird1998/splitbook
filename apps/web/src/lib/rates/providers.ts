import 'server-only';
import { z } from 'zod';

const positiveRate = z.number().finite().positive();
const primaryRow = z.object({
  base: z.string(),
  quote: z.string(),
  date: z.string(),
  rate: positiveRate,
});
const fallbackTable = z.object({
  result: z.literal('success'),
  base_code: z.literal('USD'),
  time_last_update_unix: z.number().int().positive().max(8_640_000_000_000),
  rates: z.record(z.string(), z.unknown()),
});

export type RateSource = 'frankfurter' | 'exchange-rate-api';
/** Every entry is units of currency per USD, with the provider's calendar day. */
export interface ProviderRate {
  currency: string;
  rate: string;
  asOf: string;
}
export interface RateProvider {
  readonly source: RateSource;
  fetchTable(): Promise<ProviderRate[]>;
}
export interface RateProviders {
  primary: RateProvider;
  fallback: RateProvider;
}

const MAX_BYTES = 128 * 1024;
async function json(url: string, http: typeof fetch): Promise<unknown> {
  const response = await http(url, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || !response.body) throw new Error('Rate provider unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Rate provider response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Only these fixed, keyless origins are requested; no member data leaves the server. */
export function createRateProviders(
  http: typeof fetch = (...args) => fetch(...args),
): RateProviders {
  return {
    primary: {
      source: 'frankfurter',
      async fetchTable() {
        const body = await json('https://api.frankfurter.dev/v2/rates?base=USD', http);
        if (!Array.isArray(body)) throw new Error('Invalid primary table');
        return body.flatMap((value) => {
          const row = primaryRow.safeParse(value);
          if (
            !row.success ||
            row.data.base.toUpperCase() !== 'USD' ||
            row.data.quote.toUpperCase() === 'USD'
          )
            return [];
          return [
            {
              currency: row.data.quote.toUpperCase(),
              rate: String(row.data.rate),
              asOf: row.data.date,
            },
          ];
        });
      },
    },
    fallback: {
      source: 'exchange-rate-api',
      async fetchTable() {
        const body = fallbackTable.parse(await json('https://open.er-api.com/v6/latest/USD', http));
        const asOf = new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10);
        return Object.entries(body.rates).flatMap(([currency, value]) => {
          const rate = positiveRate.safeParse(value);
          return currency === 'USD' || !rate.success
            ? []
            : [{ currency, rate: String(rate.data), asOf }];
        });
      },
    },
  };
}
