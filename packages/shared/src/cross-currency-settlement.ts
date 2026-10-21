import { getCurrencyPrecision } from './currency';
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

/** Stored snapshots, never refreshed or recomputed from the current rate service. */
export interface CrossCurrencySettlementFields {
  amountPaidMinor: number;
  paidCurrency: string;
  appliedRate: string;
  rateKind: 'suggested' | 'custom' | 'entered';
  suggestedRate?: string;
  rateSource?: 'frankfurter' | 'exchange-rate-api' | 'mixed';
  rateAsOf?: string;
  rateFetchedAt?: string;
}
