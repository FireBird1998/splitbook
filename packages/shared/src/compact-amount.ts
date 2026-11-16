/**
 * How amounts are written where room is short (#1272), as the "Number rules" table on the
 * Spending by day board `SpendAndSettings` sets out:
 *
 * - **Fit first:** an amount is written in full whenever it fits in its place, and shortened only
 *   when it does not.
 * - **In full:** as everywhere else in the app (`formatCurrency`): symbol, commas every three
 *   digits, the currency's own decimals. Rupees are not grouped in lakhs here (#1270).
 * - **Shortened:** three figures at most, a half rounded up, zeros at the end dropped, then K, L
 *   and Cr for rupees, K and M for other currencies: `₹14.2L`, `€1.25M`, `¥186K`.
 * - **A day cell:** whole units without symbol or decimals, in full up to what the cell holds,
 *   then shortened; `<1` under one unit; nothing for an empty day.
 *
 * "Fits" is counted in characters: the caller says how many its place holds. Amounts are exact
 * minor units of their own currency; every figure is worked out on whole numbers, never on a
 * floating-point amount.
 */
import { formatCurrency, getCurrency, getCurrencyPrecision } from './currency';
import { assertSafeMinorAmount, displayMajorAmount } from './exact-money';
import { numberFormat } from './number-format';

/** Each unit and the power of ten it stands for, largest first. */
type Units = readonly (readonly [unit: string, power: number])[];
const RUPEE_UNITS: Units = [
  ['Cr', 7],
  ['L', 5],
  ['K', 3],
];
const UNITS: Units = [
  ['M', 6],
  ['K', 3],
];

/** The most figures a shortened amount keeps. */
const FIGURES = 3;

/** An amount in full, as the app writes money everywhere: `₹1,421,780.00`, `PLN 60.00`. */
export function fullAmount(amountMinor: number, currency: string): string {
  return formatCurrency(displayMajorAmount(amountMinor, currency), currency);
}

/** An amount shortened, with its symbol: `₹14.2L`, `€1.25M`, `¥186K`, `€86`. */
export function shortAmount(amountMinor: number, currency: string): string {
  return shortened(amountMinor, currency, FIGURES, true);
}

/**
 * An amount for the Home card or a total: in full when it fits in `maxLength` characters, else
 * shortened with its symbol, in fewer figures if three don't fit. When nothing fits, its
 * shortest form.
 */
export function amountToFit(amountMinor: number, currency: string, maxLength: number): string {
  return firstThatFits(
    [fullAmount(amountMinor, currency), ...shortForms(amountMinor, currency, true)],
    maxLength,
  );
}

/**
 * A day's share in a calendar cell that holds `maxLength` characters: whole units without symbol
 * or decimals (`420`, `45,000`) when they fit, else shortened (`1.25L`, `12K`); `<1` for a share
 * under one unit, so a day with spending never looks empty; nothing for an empty day. The cell's
 * currency is said by the screen around it. A day's share is never negative.
 */
export function dayCellAmount(amountMinor: number, currency: string, maxLength: number): string {
  const minor = assertSafeMinorAmount(amountMinor);
  if (minor < 0) throw new RangeError("A day's share can't be negative");
  if (minor === 0) return '';
  const unit = 10 ** precision(currency);
  if (minor < unit) return '<1';
  // n.5 is exact in binary, so Math.round takes a half up.
  const whole = Math.round(minor / unit);
  return firstThatFits(
    [
      numberFormat('en-US', { maximumFractionDigits: 0 }).format(whole),
      ...shortForms(minor, currency, false),
    ],
    maxLength,
  );
}

/** The currency's decimal places; 2 for one Splitbook no longer supports, as stored (#810). */
function precision(currency: string): number {
  return getCurrency(currency) ? getCurrencyPrecision(currency) : 2;
}

function firstThatFits(forms: string[], maxLength: number): string {
  return forms.find((form) => form.length <= maxLength) ?? forms[forms.length - 1];
}

/** The shortened forms, from three figures down to one. */
function shortForms(amountMinor: number, currency: string, withSymbol: boolean): string[] {
  return [FIGURES, 2, 1].map((figures) => shortened(amountMinor, currency, figures, withSymbol));
}

/** An amount in at most `figures` significant figures, a half rounded up, then its unit. */
function shortened(
  amountMinor: number,
  currency: string,
  figures: number,
  withSymbol: boolean,
): string {
  const minor = assertSafeMinorAmount(amountMinor);
  const digits = String(Math.abs(minor));
  // The amount is `kept` × 10^`exponent` in whole units.
  let kept = digits.slice(0, figures);
  const exponent = digits.length - kept.length - precision(currency);
  if (digits.length > figures && digits[figures] >= '5') kept = String(Number(kept) + 1);
  // The power of ten of the leading figure picks the unit, after rounding: ₹99,999 rounds to
  // 1000 × 10^2, so it is ₹1L, its zeros dropped.
  const leading = kept.length - 1 + exponent;
  const [unit, power] = (currency === 'INR' ? RUPEE_UNITS : UNITS).find(
    ([, unitPower]) => leading >= unitPower,
  ) ?? ['', 0];
  const number = `${decimal(kept, exponent - power)}${unit}`;
  if (!withSymbol) return number;
  return withCurrency(number, currency, minor < 0);
}

/** `kept` × 10^`exponent` written out: integer part in threes, zeros at the end dropped. */
function decimal(kept: string, exponent: number): string {
  if (exponent >= 0) return group(`${kept}${'0'.repeat(exponent)}`);
  const padded = kept.padStart(1 - exponent, '0');
  const integer = padded.slice(0, exponent);
  const fraction = padded.slice(exponent).replace(/0+$/, '');
  return fraction ? `${group(integer)}.${fraction}` : group(integer);
}

const group = (integer: string) => integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A number in the place formatCurrency gives a currency's amounts: `₹14.2L`, `PLN 60K`. */
function withCurrency(number: string, currency: string, negative: boolean): string {
  try {
    return numberFormat('en-US', { style: 'currency', currency })
      .formatToParts(negative ? -1 : 1)
      .filter((part) => part.type !== 'decimal' && part.type !== 'fraction')
      .map((part) => (part.type === 'integer' ? number : part.value))
      .join('');
  } catch {
    // As formatCurrency writes a currency Intl can't format.
    return `${currency} ${negative ? '-' : ''}${number}`;
  }
}
