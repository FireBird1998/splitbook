import 'server-only';
import connectDB from '@/lib/db';
import { CURRENCY_CODES } from '@splitbook/shared/currency';
import type { RateProviders } from './providers';
import { RateTable, type CachedRate } from './table';

const DAY = 86_400_000;
function age(asOf: string, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return Infinity;
  const time = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== asOf) return Infinity;
  return Math.floor(now.getTime() / DAY) - Math.floor(time / DAY);
}
function fraction(value: string): [bigint, bigint] | null {
  if (!/^\d{1,12}(?:\.\d{1,18})?$/.test(value)) return null;
  const [whole, decimal = ''] = value.split('.');
  const numerator = BigInt(whole + decimal);
  return numerator > 0n ? [numerator, 10n ** BigInt(decimal.length)] : null;
}
function usable(row: CachedRate, now: Date) {
  return fraction(row.rate) !== null && age(row.asOf, now) >= 0 && age(row.asOf, now) <= 3;
}
/** Decimal-string ratio rounded half up to 12 places; never converts a ledger amount. */
function crossRate(from: string, to: string): string {
  const [a, b] = fraction(from)!;
  const [c, d] = fraction(to)!;
  const scale = 1_000_000_000_000n;
  const numerator = c * b * scale;
  const denominator = d * a;
  const units = (2n * numerator + denominator) / (2n * denominator);
  const decimals = (units % scale).toString().padStart(12, '0').replace(/0+$/, '');
  return `${units / scale}${decimals ? `.${decimals}` : ''}`;
}

export async function refreshRates(providers: RateProviders, now = new Date()) {
  await connectDB();
  const previous = await RateTable.findById('daily').lean();
  const fetch = async (provider: RateProviders['primary']) => {
    try {
      return (await provider.fetchTable()).map((row) => ({
        ...row,
        source: provider.source,
        fetchedAt: now.toISOString(),
      }));
    } catch {
      return [];
    }
  };
  const primary = await fetch(providers.primary);
  const codes = CURRENCY_CODES.filter((code) => code !== 'USD');
  const find = (rows: CachedRate[], code: string) =>
    rows
      .filter((row) => row.currency === code && usable(row, now))
      .sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
  const fallback = codes.some((code) => !find(primary, code))
    ? await fetch(providers.fallback)
    : [];
  const entries = codes.flatMap((code) => {
    const row =
      find(primary, code) ??
      find(fallback, code) ??
      previous?.entries.find((row) => row.currency === code);
    return row ? [row] : [];
  });
  await RateTable.updateOne({ _id: 'daily' }, { $set: { entries } }, { upsert: true });
  return { refreshed: true };
}

/** App-only read. No assistant operation imports the rate cache. Never calls a provider. */
export async function readRateSuggestion(from: string, to: string, now = new Date()) {
  if (from === to) return { suggestion: null, reason: 'same_currency' };
  await connectDB();
  const table = await RateTable.findById('daily').lean();
  if (!table || table.entries.length === 0) return { suggestion: null, reason: 'unavailable' };
  const a = table.entries.find((row) => row.currency === from);
  const b = table.entries.find((row) => row.currency === to);
  if ((from !== 'USD' && !a) || (to !== 'USD' && !b))
    return { suggestion: null, reason: 'currency_unavailable' };
  const rows = [a, b].filter((row): row is CachedRate => Boolean(row));
  if (rows.some((row) => !usable(row, now))) return { suggestion: null, reason: 'stale' };
  const rate = crossRate(a?.rate ?? '1', b?.rate ?? '1');
  if (rate === '0') return { suggestion: null, reason: 'unavailable' };
  const asOf = rows.map((row) => row.asOf).sort()[0];
  return {
    suggestion: {
      from,
      to,
      rate,
      source: rows.every((row) => row.source === rows[0].source) ? rows[0].source : 'mixed',
      asOf,
      fetchedAt: rows.map((row) => row.fetchedAt).sort()[0],
      ageDays: age(asOf, now),
      attributionRequired: rows.some((row) => row.source === 'exchange-rate-api'),
      attribution: rows.some((row) => row.source === 'exchange-rate-api')
        ? { text: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' }
        : null,
      components: rows.map(({ currency, source, asOf, fetchedAt }) => ({
        currency,
        source,
        asOf,
        fetchedAt,
      })),
    },
  };
}
