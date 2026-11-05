import { memberLabel } from './member-label';
import { currencyPrefix, getCurrency, getCurrencyPrecision } from './currency';
import { assertSafeMinorAmount, MoneyValidationError } from './exact-money';

/** Exactly two entered values. Amounts are integer minor units of their named currency. */
export type CrossCurrencyCalculation = { currency: string; paidCurrency: string } & (
  | { amountClearedMinor: number; rate: string; amountPaidMinor?: never }
  | { amountPaidMinor: number; rate: string; amountClearedMinor?: never }
  | { amountClearedMinor: number; amountPaidMinor: number; rate?: never }
);
export interface CrossCurrencyAmounts {
  amountClearedMinor: number;
  amountPaidMinor: number;
  /** 1 major unit cleared = X major units paid, derived from the two rounded amounts. */
  appliedRate: string;
}

/**
 * Whether this rate, applied to the amount cleared and rounded half up in the paid currency, pays
 * exactly the amount paid: a rate a Settlement may keep as the member applied it (#870).
 */
export function rateGivesPaid(
  record: { currency: string; paidCurrency: string; amountMinor: number; amountPaidMinor: number },
  rate: string,
): boolean {
  try {
    return (
      calculateCrossCurrencySettlement({
        currency: record.currency,
        paidCurrency: record.paidCurrency,
        amountClearedMinor: record.amountMinor,
        rate,
      }).amountPaidMinor === record.amountPaidMinor
    );
  } catch {
    return false;
  }
}

/** A rate shows at most this many places, or more for a rate under 1 (`roundedRate`). */
const RATE_PLACES = 6;
/** A rate under 1 keeps this many significant digits, where six places would keep fewer. */
const RATE_DIGITS = 6;
/** The most places a rate can be recorded with. */
const MAX_RATE_PLACES = 18;
const TEN = BigInt(10);

function invalid(message: string): never {
  throw new MoneyValidationError('INVALID_CROSS_CURRENCY_SETTLEMENT', message);
}

/** Positive plain decimals only, bounded before BigInt parsing. No exponent or float math. */
export function rateFraction(rate: string): { numerator: bigint; denominator: bigint } {
  if (typeof rate !== 'string' || !/^\d{1,18}(?:\.\d{1,18})?$/.test(rate))
    invalid('Enter a positive rate with at most 18 decimal places');
  const [whole, fraction = ''] = rate.split('.');
  const numerator = BigInt(whole + fraction);
  if (numerator <= BigInt(0)) invalid('The rate must be positive');
  return { numerator, denominator: BigInt(10) ** BigInt(fraction.length) };
}
function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (BigInt(2) * numerator + denominator) / (BigInt(2) * denominator);
}
function positiveMinor(value: number): number {
  assertSafeMinorAmount(value);
  if (value <= 0) invalid('Both amounts must be at least one minor unit');
  return value;
}
function decimalRatio(numerator: bigint, denominator: bigint): string {
  const scale = BigInt(10) ** BigInt(18);
  const units = halfUp(numerator * scale, denominator);
  if (units === BigInt(0)) invalid('The rate is too small to represent');
  const decimals = (units % scale).toString().padStart(18, '0').replace(/0+$/, '');
  return `${units / scale}${decimals ? `.${decimals}` : ''}`;
}

/**
 * Complete either amount or the rate with exact integer arithmetic. An inferred amount rounds
 * half up in that amount's currency. The applied rate always comes from the resulting amounts,
 * rounded half up to 18 decimal places; it is never the unrounded input rate. Zero results and
 * amounts outside the safe minor-unit range are refused. This function never changes a ledger.
 */
export function calculateCrossCurrencySettlement(
  input: CrossCurrencyCalculation,
): CrossCurrencyAmounts {
  const clearedScale = BigInt(10) ** BigInt(getCurrencyPrecision(input.currency));
  const paidScale = BigInt(10) ** BigInt(getCurrencyPrecision(input.paidCurrency));
  if (input.currency === input.paidCurrency) invalid('Choose two different currencies');
  if (
    [input.amountClearedMinor, input.amountPaidMinor, input.rate].filter(
      (value) => value !== undefined,
    ).length !== 2
  )
    invalid('Enter exactly two of the cleared amount, paid amount and rate');
  let cleared = input.amountClearedMinor;
  let paid = input.amountPaidMinor;
  if (cleared !== undefined) positiveMinor(cleared);
  if (paid !== undefined) positiveMinor(paid);
  if (input.rate !== undefined) {
    const { numerator, denominator } = rateFraction(input.rate);
    if (cleared !== undefined)
      paid = positiveMinor(
        Number(halfUp(BigInt(cleared) * numerator * paidScale, denominator * clearedScale)),
      );
    else
      cleared = positiveMinor(
        Number(halfUp(BigInt(paid!) * denominator * clearedScale, numerator * paidScale)),
      );
  }
  return {
    amountClearedMinor: cleared!,
    amountPaidMinor: paid!,
    appliedRate: decimalRatio(BigInt(paid!) * clearedScale, BigInt(cleared!) * paidScale),
  };
}

/**
 * A rate as rates show (#873), as a plain decimal: rounded half up to six places, or to six
 * significant digits for a rate under 1 that six places would cut (0.005980066445 is 0.00598007,
 * never 0.00598), with no trailing zeros. A suggestion is read this way, so it pays as it shows.
 */
export function roundedRate(rate: string): string {
  const { numerator, denominator } = rateFraction(rate);
  // The zeros after the point before its first digit: 2 in 0.00598.
  let zeros = 0;
  while (zeros < MAX_RATE_PLACES && numerator * TEN ** BigInt(zeros + 1) < denominator) zeros++;
  const places = Math.min(MAX_RATE_PLACES, Math.max(RATE_PLACES, zeros + RATE_DIGITS));
  const scale = TEN ** BigInt(places);
  const units = (BigInt(2) * numerator * scale + denominator) / (BigInt(2) * denominator);
  const fraction = (units % scale).toString().padStart(places, '0').replace(/0+$/, '');
  return fraction ? `${units / scale}.${fraction}` : (units / scale).toString();
}

/** A rate as its field and every record show it: `roundedRate`, with at least two places. */
export function rateText(rate: string): string {
  const [whole, fraction = ''] = roundedRate(rate).split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

/** Stored snapshots, never refreshed or recomputed from the current rate service. */
export interface CrossCurrencySettlementFields {
  /** Read-only signed Debt before simplifying, from the payer's side. */
  pairDebtBeforeMinor?: number;
  pairDebtAfterMinor?: number;
  amountPaidMinor: number;
  paidCurrency: string;
  /**
   * The rate applied, as the member chose it (#870): the suggestion, or theirs as typed, when it
   * gives the amount paid; otherwise worked out from the two amounts, as older records all are.
   */
  appliedRate: string;
  rateKind: 'suggested' | 'custom' | 'entered';
  suggestedRate?: string;
  rateSource?: 'frankfurter' | 'exchange-rate-api' | 'mixed';
  rateAsOf?: string;
  rateFetchedAt?: string;
}

export const EXCHANGE_RATE_API_ATTRIBUTION = {
  text: 'Rates By Exchange Rate API',
  url: 'https://www.exchangerate-api.com',
} as const;

/** Historical display follows formatCurrency's fallback; calculations still check the registry. */
const displayPrecision = (currency: string) =>
  getCurrency(currency) ? getCurrencyPrecision(currency) : 2;

/**
 * Nonnegative plain decimals: Intl supplies grouping and the currency’s symbol placement. Hermes’s
 * Intl refuses a BigInt (#863), so a whole part that is a safe integer is formatted as a number,
 * exactly, and a longer one, such as an 18-digit rate’s, has its digits grouped by hand in place of
 * a formatted zero’s. The fraction’s digits always replace Intl’s, as given.
 */
export function decimalMoney(decimal: string, currency: string): string {
  const [whole, fraction = ''] = decimal.split('.');
  const digits = fraction.padEnd(displayPrecision(currency), '0');
  const format = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits.length,
    maximumFractionDigits: digits.length,
  });
  const value = Number(whole);
  const parts = Number.isSafeInteger(value)
    ? format.formatToParts(value)
    : format
        .formatToParts(0)
        .flatMap((part) =>
          part.type === 'integer' ? groupedInteger(BigInt(whole).toString(), format) : [part],
        );
  return parts.map((part) => (part.type === 'fraction' ? digits : part.value)).join('');
}

/** A nonnegative integer's digits in groups of three, with the format's own group separator. */
function groupedInteger(integer: string, format: Intl.NumberFormat): Intl.NumberFormatPart[] {
  const separator = format.formatToParts(1000).find((part) => part.type === 'group')?.value ?? ',';
  const groups = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').split(' ');
  return groups.flatMap((value, index) => [
    ...(index ? [{ type: 'group' as const, value: separator }] : []),
    { type: 'integer' as const, value },
  ]);
}
/** Format a positive safe integer minor amount without passing through floating point. */
export function minorMoney(minor: number, currency: string): string {
  positiveMinor(minor);
  const places = displayPrecision(currency);
  const scale = BigInt(10) ** BigInt(places);
  const units = BigInt(minor);
  return decimalMoney(
    `${units / scale}${places ? `.${(units % scale).toString().padStart(places, '0')}` : ''}`,
    currency,
  );
}

/**
 * The rate a payment's record and Activity show as used (#870): the suggestion whenever it gives
 * the amount paid, which every payment at it does, though an older record keeps a rate worked
 * back from the rounded amount paid (₹92.099945 for a payment at ₹92.10); else the rate kept.
 */
export function rateUsed(
  record: Pick<
    CrossCurrencySettlementFields,
    'amountPaidMinor' | 'paidCurrency' | 'appliedRate' | 'suggestedRate'
  > & { amountMinor: number; currency: string },
): { rate: string; suggested: boolean } {
  return record.suggestedRate && rateGivesPaid(record, record.suggestedRate)
    ? { rate: record.suggestedRate, suggested: true }
    : { rate: record.appliedRate, suggested: false };
}

/**
 * Shared Activity/record wording from the immutable stored fields, with no rate lookup or
 * conversion, rates as they show (`rateText`). The suggestion is said once when it's the rate
 * used (#870): "at the suggested ₹92.10 per € (22 Oct)"; beside another rate, "at ₹92.50 per €,
 * suggested ₹92.10 (21 Oct)". A caller showing fallback provenance must link the attribution
 * text using EXCHANGE_RATE_API_ATTRIBUTION.url (both exchange-rate-api and mixed sources
 * require it).
 */
export function formatCrossCurrencySettlement(
  record: CrossCurrencySettlementFields & {
    paidBy?: string;
    paidByName?: string;
    paidTo?: string;
    paidToName?: string;
    amountMinor: number;
    currency: string;
  },
  viewerId?: string,
): string {
  rateFraction(record.appliedRate);
  const paidBy = memberLabel(record.paidBy, record.paidByName, viewerId);
  const paidTo = memberLabel(record.paidTo, record.paidToName, viewerId);
  const recipient = viewerId && record.paidTo === viewerId ? 'you' : paidTo;
  // As in Activity detail, a missing payer leaves a recipient-only description.
  const people = paidBy
    ? `${paidBy} paid${paidTo ? ` ${recipient}` : ''}`
    : paidTo
      ? `Paid to ${recipient}`
      : 'Paid';
  // As formatCurrency names it before an amount: "per €", or "per PLN" for the zloty (#884).
  const clearedSymbol = currencyPrefix(record.currency);
  const money = (rate: string) => decimalMoney(rateText(rate), record.paidCurrency);
  const used = rateUsed(record);
  const lead = `${people} ${minorMoney(record.amountPaidMinor, record.paidCurrency)} to clear ${minorMoney(record.amountMinor, record.currency)} at`;
  let text: string;
  if (record.suggestedRate && record.rateAsOf) {
    rateFraction(record.suggestedRate);
    const [, month, day] = record.rateAsOf.split('-');
    const monthName = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ][Number(month) - 1];
    const dated = `(${Number(day)} ${monthName})`;
    text = used.suggested
      ? `${lead} the suggested ${money(used.rate)} per ${clearedSymbol} ${dated}`
      : `${lead} ${money(used.rate)} per ${clearedSymbol}, suggested ${money(record.suggestedRate)} ${dated}`;
  } else text = `${lead} ${money(used.rate)} per ${clearedSymbol}; no rate suggested`;
  if (record.rateSource === 'exchange-rate-api' || record.rateSource === 'mixed')
    text += ` · ${EXCHANGE_RATE_API_ATTRIBUTION.text}`;
  return text;
}
