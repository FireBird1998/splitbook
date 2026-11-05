/**
 * Hermes's Intl, in a test run (#863, #869). Android runs the shared code on Hermes, whose Intl
 * differs from Node's V8 in ways that crash the app or change what it shows, so the shared and
 * Android test runs make Node behave as Hermes does (Hermes 260318099.0.4, probed on a device):
 *
 * - `Intl.NumberFormat#format` and `formatToParts` refuse a BigInt with "TypeError: Cannot
 *   convert BigInt to number", where V8 formats it;
 * - they read any other value as a Number, so a long numeric string is rounded to the nearest
 *   double ("12345678901234567890" shows as "12,345,678,901,234,567,000"), where V8 formats
 *   every digit;
 * - `BigInt.prototype.toLocaleString` ignores the locale and the options, and returns the
 *   plain digits ("1234567"), where V8 formats it as `Intl.NumberFormat` would;
 * - `Intl.NumberFormat#formatRange`, `formatRangeToParts` and `Intl.PluralRules` don't exist,
 *   so a call is a crash on Hermes.
 *
 * So code that relies on V8's behaviour fails a test instead of the app.
 */

const installed = Symbol.for('splitbook.hermes-intl');

/** Hermes's ToNumber for Intl.NumberFormat's argument: a BigInt is refused, the rest is a Number. */
function hermesNumber(value: unknown): number {
  if (typeof value === 'bigint') throw new TypeError('Cannot convert BigInt to number');
  // Unary plus is ToNumber itself: it also refuses an object whose value is a BigInt.
  return +(value as number);
}

/** Give this process Hermes's Intl, as described above. Safe to call twice. */
export function installHermesIntl(): void {
  const prototype = Intl.NumberFormat.prototype as unknown as Record<PropertyKey, unknown>;
  if (prototype[installed]) return;
  prototype[installed] = true;
  // `format` is a getter that returns a bound function.
  const format = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, 'format')!;
  Object.defineProperty(Intl.NumberFormat.prototype, 'format', {
    ...format,
    get(this: Intl.NumberFormat) {
      const bound = format.get!.call(this) as (value: unknown) => string;
      return (value: unknown) => bound(hermesNumber(value));
    },
  });
  const formatToParts = Intl.NumberFormat.prototype.formatToParts;
  Object.defineProperty(Intl.NumberFormat.prototype, 'formatToParts', {
    configurable: true,
    writable: true,
    value(this: Intl.NumberFormat, value?: unknown) {
      return formatToParts.call(this, hermesNumber(value));
    },
  });
  delete prototype.formatRange;
  delete prototype.formatRangeToParts;
  delete (Intl as unknown as Record<string, unknown>).PluralRules;
  const bigIntToString = BigInt.prototype.toString;
  Object.defineProperty(BigInt.prototype, 'toLocaleString', {
    configurable: true,
    writable: true,
    value(this: bigint) {
      return bigIntToString.call(this);
    },
  });
}
