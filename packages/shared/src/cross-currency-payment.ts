/**
 * The Record payment sheet for a Debt paid in another currency (#727, spec #710), without a UI:
 * its three linked fields (the amount cleared, the rate and the amount paid), which of them
 * follows the other two, the rate kind a payment records, and the words about the rate. The
 * maths is `calculateCrossCurrencySettlement`; nothing here is ever converted on a ledger.
 */
import { format } from 'date-fns';
import { z } from 'zod';
import { readAmountEntry } from './amount-entry';
import { formatCurrency, getCurrency, getCurrencyPrecision } from './currency';
import { toMajorAmount } from './exact-money';
import {
  calculateCrossCurrencySettlement,
  rateFraction,
  type CrossCurrencyAmounts,
  type CrossCurrencySettlementFields,
} from './cross-currency-settlement';

export type CrossCurrencyField = 'cleared' | 'rate' | 'paid';

/** The two currencies: the Debt's, which is cleared, and the one it is paid in. */
export interface PaymentCurrencies {
  currency: string;
  paidCurrency: string;
}

/** A suggested rate, as the Group's rate read answers it (#726). */
export interface RateSuggestion {
  /** Units of the paid currency for one unit of the Debt's, as a decimal string. */
  rate: string;
  source: 'frankfurter' | 'exchange-rate-api' | 'mixed';
  asOf: string;
  fetchedAt: string;
  ageDays: number;
  attributionRequired: boolean;
  attribution: { text: string; url: string } | null;
}

/** What the three fields hold, as typed or worked out. */
export interface CrossCurrencyEntry {
  cleared: string;
  rate: string;
  paid: string;
  /** The fields the member set, the latest first: the third follows these two. */
  drivers: CrossCurrencyField[];
}

export type CrossCurrencyReading =
  | { status: 'incomplete' }
  | { status: 'invalid'; field: CrossCurrencyField; message: string }
  | { status: 'valid'; amounts: CrossCurrencyAmounts };

/** A suggestion older than this many days shows its age. */
const OLD_AFTER_DAYS = 1;
/** A worked-out rate shows at most this many places; the exact one is what is recorded. */
const RATE_PLACES = 6;

const FIELDS: CrossCurrencyField[] = ['cleared', 'rate', 'paid'];
const TEN = BigInt(10);

/** An amount in minor units as its field shows it: "1842.00", or "3253" in yen. */
function amountText(minor: number, currency: string): string {
  return toMajorAmount(minor, currency).toFixed(getCurrencyPrecision(currency));
}

/** A rate as its field shows it: at least two places, at most six, rounded half up. */
export function rateText(rate: string): string {
  const { numerator, denominator } = rateFraction(rate);
  const scale = TEN ** BigInt(RATE_PLACES);
  const units = (BigInt(2) * numerator * scale + denominator) / (BigInt(2) * denominator);
  const fraction = (units % scale).toString().padStart(RATE_PLACES, '0').replace(/0+$/, '');
  return `${units / scale}.${fraction.padEnd(2, '0')}`;
}

type RateReading =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'valid'; rate: string };

/** The rate typed, as a plain decimal: commas only as thousands separators. */
function readRate(text: string): RateReading {
  const typed = text.trim();
  if (!typed) return { status: 'empty' };
  const like = { status: 'invalid' as const, message: 'Enter a rate like 92.10.' };
  if (typed.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(typed)) return like;
  const plain = typed.replaceAll(',', '').replace(/\.$/, '');
  if (!/^\d+(?:\.\d+)?$/.test(plain)) return like;
  if (!/[1-9]/.test(plain)) return { status: 'invalid', message: 'Enter a rate above 0.' };
  try {
    rateFraction(plain);
  } catch {
    return { status: 'invalid', message: 'Use at most 18 decimal places in the rate.' };
  }
  return { status: 'valid', rate: plain };
}

/** The two set fields' values, read; or why one can't be read. */
function readDrivers(entry: CrossCurrencyEntry, currencies: PaymentCurrencies) {
  const values: { amountClearedMinor?: number; amountPaidMinor?: number; rate?: string } = {};
  for (const field of entry.drivers) {
    if (field === 'rate') {
      const rate = readRate(entry.rate);
      if (rate.status === 'empty') return { status: 'incomplete' as const };
      if (rate.status === 'invalid')
        return { status: 'invalid' as const, field, message: rate.message };
      values.rate = rate.rate;
    } else {
      const currency = field === 'cleared' ? currencies.currency : currencies.paidCurrency;
      const amount = readAmountEntry(entry[field], currency);
      if (amount.status === 'empty') return { status: 'incomplete' as const };
      if (amount.status === 'invalid')
        return { status: 'invalid' as const, field, message: amount.message };
      values[field === 'cleared' ? 'amountClearedMinor' : 'amountPaidMinor'] = amount.amountMinor;
    }
  }
  return entry.drivers.length < 2
    ? { status: 'incomplete' as const }
    : { status: 'set' as const, values };
}

/** The field that follows the two set ones. */
const followerOf = (entry: CrossCurrencyEntry) =>
  entry.drivers.length === 2 ? FIELDS.find((field) => !entry.drivers.includes(field))! : null;

/** The entry read: both amounts and the applied rate, or why it isn't ready. */
export function readCrossCurrencyEntry(
  entry: CrossCurrencyEntry,
  currencies: PaymentCurrencies,
): CrossCurrencyReading {
  const read = readDrivers(entry, currencies);
  if (read.status !== 'set') return read;
  try {
    return {
      status: 'valid',
      amounts: calculateCrossCurrencySettlement({
        ...currencies,
        ...read.values,
      } as Parameters<typeof calculateCrossCurrencySettlement>[0]),
    };
  } catch {
    // Too small to pay or clear anything: the field the member set last says so.
    const follower = followerOf(entry)!;
    const field = entry.drivers[0];
    const smallest = (currency: string) => formatCurrency(toMajorAmount(1, currency), currency);
    return {
      status: 'invalid',
      field,
      message:
        follower === 'paid'
          ? `That rate pays less than ${smallest(currencies.paidCurrency)}. Check the rate.`
          : follower === 'cleared'
            ? `That clears less than ${smallest(currencies.currency)}. Check the rate.`
            : 'Those amounts give a rate too small to record. Check the amounts.',
    };
  }
}

/** The follower's text, worked out again from the two set fields, or empty when it can't be. */
function follow(entry: CrossCurrencyEntry, currencies: PaymentCurrencies): CrossCurrencyEntry {
  const follower = followerOf(entry);
  if (!follower) return entry;
  const read = readCrossCurrencyEntry(entry, currencies);
  if (read.status !== 'valid') return { ...entry, [follower]: '' };
  const { amounts } = read;
  const text =
    follower === 'rate'
      ? rateText(amounts.appliedRate)
      : follower === 'cleared'
        ? amountText(amounts.amountClearedMinor, currencies.currency)
        : amountText(amounts.amountPaidMinor, currencies.paidCurrency);
  return { ...entry, [follower]: text };
}

/**
 * The sheet as it opens: the amount cleared (the whole Debt, as the form fills it) and the
 * suggested rate, if there is one, so the amount paid follows them.
 */
export function startCrossCurrencyEntry(
  currencies: PaymentCurrencies,
  clearedText: string,
  suggestion: RateSuggestion | null,
): CrossCurrencyEntry {
  return follow(
    {
      cleared: clearedText,
      rate: suggestion ? rateText(suggestion.rate) : '',
      paid: '',
      drivers: suggestion ? ['cleared', 'rate'] : ['cleared'],
    },
    currencies,
  );
}

/** One field changed: it and the field set before it stay, and the third follows them. */
export function editCrossCurrencyEntry(
  entry: CrossCurrencyEntry,
  currencies: PaymentCurrencies,
  field: CrossCurrencyField,
  text: string,
): CrossCurrencyEntry {
  return follow(
    {
      ...entry,
      [field]: text,
      drivers: [field, ...entry.drivers.filter((driver) => driver !== field)].slice(0, 2),
    },
    currencies,
  );
}

/**
 * The rate kind the payment records: suggested while the suggestion gives the amount paid (the
 * server's rule), custom once it doesn't, and entered when there was no suggestion.
 */
export function crossCurrencyRateKind(
  currencies: PaymentCurrencies,
  amounts: CrossCurrencyAmounts,
  suggestion: RateSuggestion | null,
): CrossCurrencySettlementFields['rateKind'] {
  if (!suggestion) return 'entered';
  const fromSuggestion = calculateCrossCurrencySettlement({
    ...currencies,
    amountClearedMinor: amounts.amountClearedMinor,
    rate: suggestion.rate,
  });
  return fromSuggestion.amountPaidMinor === amounts.amountPaidMinor ? 'suggested' : 'custom';
}

/** The fields a cross-currency payment sends beside its amount cleared. */
export function crossCurrencyPaymentFields(
  currencies: PaymentCurrencies,
  amounts: CrossCurrencyAmounts,
  suggestion: RateSuggestion | null,
): CrossCurrencySettlementFields {
  const rateKind = crossCurrencyRateKind(currencies, amounts, suggestion);
  return {
    amountPaidMinor: amounts.amountPaidMinor,
    paidCurrency: currencies.paidCurrency,
    appliedRate: amounts.appliedRate,
    rateKind,
    ...(suggestion
      ? {
          suggestedRate: suggestion.rate,
          rateSource: suggestion.source,
          rateAsOf: suggestion.asOf,
          rateFetchedAt: suggestion.fetchedAt,
        }
      : {}),
  };
}

/** The tag beside the rate. */
export function rateBadge(
  kind: CrossCurrencySettlementFields['rateKind'],
  suggestion: RateSuggestion | null,
): string {
  if (!suggestion || kind === 'entered') return 'No suggestion';
  if (kind === 'custom') return 'Your rate';
  return suggestion.ageDays > OLD_AFTER_DAYS ? `${suggestion.ageDays} days old` : 'Suggested';
}

/** "₹92.10": a rate in the paid currency, never rounded to the currency's minor unit. */
export function rateMoney(rate: string, currency: string): string {
  const [whole, fraction = ''] = rateText(rate).split('.');
  const symbol = getCurrency(currency)?.symbol ?? `${currency} `;
  return `${symbol}${Number(whole).toLocaleString('en-US')}.${fraction}`;
}

/** "20 Oct", from a provider's calendar date, read as that date wherever the viewer is. */
function calendarDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return format(new Date(year, month - 1, day), 'd MMM');
}

/** "today 06:00", "yesterday 18:00" or "18 Oct 18:00", in the viewer's own time. */
function fetchedWhen(fetchedAt: string, now: Date): string {
  const fetched = new Date(fetchedAt);
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAgo = Math.round((day(now) - day(fetched)) / 86_400_000);
  const when = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : format(fetched, 'd MMM');
  return `${when} ${format(fetched, 'HH:mm')}`;
}

const SOURCE_NAMES: Partial<Record<RateSuggestion['source'], string>> = {
  frankfurter: 'Frankfurter',
};

/** The rate's note: where a suggestion is from and when, or how to go on without one. */
export interface RateNote {
  text: string;
  /** The second source's attribution, shown and linked wherever its rate appears. */
  attribution: { text: string; url: string } | null;
  /** The suggested rate to put back, beside the member's own. */
  useSuggestion: string | null;
}

export function rateNote(
  kind: CrossCurrencySettlementFields['rateKind'],
  suggestion: RateSuggestion | null,
  paidCurrency: string,
  now: Date,
): RateNote {
  if (!suggestion || kind === 'entered')
    return {
      text: 'Type the rate you agreed, or both amounts. The rate is kept as yours.',
      attribution: null,
      useSuggestion: null,
    };
  const name = SOURCE_NAMES[suggestion.source];
  const attribution = suggestion.attributionRequired ? suggestion.attribution : null;
  const ratesOf = `rates of ${calendarDay(suggestion.asOf)}`;
  if (kind === 'custom')
    return {
      text: `Your rate. Suggested ${rateMoney(suggestion.rate, paidCurrency)}${name ? ` from ${name}` : ''}, ${ratesOf}.`,
      attribution,
      useSuggestion: suggestion.rate,
    };
  const lead = name ? `${name} · ${ratesOf}` : `R${ratesOf.slice(1)}`;
  return {
    text:
      suggestion.ageDays > OLD_AFTER_DAYS
        ? `${lead}, ${suggestion.ageDays} days old. Today’s rates aren’t in yet.`
        : `${lead} · fetched ${fetchedWhen(suggestion.fetchedAt, now)}`,
    attribution,
    useSuggestion: null,
  };
}

const suggestionSchema = z
  .object({
    rate: z.string().refine((rate) => {
      try {
        rateFraction(rate);
        return true;
      } catch {
        return false;
      }
    }),
    source: z.enum(['frankfurter', 'exchange-rate-api', 'mixed']),
    asOf: z.iso.date(),
    fetchedAt: z.iso.datetime({ offset: true }),
    ageDays: z.number().int().min(0),
    attributionRequired: z.boolean(),
    attribution: z.object({ text: z.string().min(1), url: z.url() }).nullable(),
  })
  .refine((suggestion) => !suggestion.attributionRequired || suggestion.attribution !== null);

const rateReadSchema = z.object({
  data: z.object({
    suggestion: suggestionSchema.nullable(),
    reason: z.string().optional(),
  }),
});

/** The Group's rate read (#726): its suggestion, or none and why. */
export function parseRateSuggestionResponse(payload: unknown): {
  suggestion: RateSuggestion | null;
  reason: string | null;
} {
  const { data } = rateReadSchema.parse(payload);
  return { suggestion: data.suggestion, reason: data.suggestion ? null : (data.reason ?? null) };
}
