/**
 * Hermes's Intl, in a test run (#863). Hermes's `Intl.NumberFormat` refuses a BigInt with
 * "TypeError: Cannot convert BigInt to number", where Node's V8 formats it. Android runs the
 * shared code on Hermes, so the shared and Android test runs make Node refuse it too, and a
 * BigInt passed to Intl fails a test instead of crashing the app.
 */

const installed = Symbol.for('splitbook.hermes-intl');

function refuseBigInt(values: readonly unknown[]): void {
  if (values.some((value) => typeof value === 'bigint'))
    throw new TypeError('Cannot convert BigInt to number');
}

/** Make this process's `Intl.NumberFormat` refuse a BigInt, as Hermes does. Safe to call twice. */
export function rejectBigIntInIntl(): void {
  const prototype = Intl.NumberFormat.prototype as unknown as Record<PropertyKey, unknown>;
  if (prototype[installed]) return;
  prototype[installed] = true;
  // `format` is a getter that returns a bound function.
  const format = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, 'format')!;
  Object.defineProperty(Intl.NumberFormat.prototype, 'format', {
    ...format,
    get(this: Intl.NumberFormat) {
      const bound = format.get!.call(this) as (value: unknown) => string;
      return (value: unknown) => {
        refuseBigInt([value]);
        return bound(value);
      };
    },
  });
  for (const name of ['formatToParts', 'formatRange', 'formatRangeToParts']) {
    const original = prototype[name];
    if (typeof original !== 'function') continue;
    Object.defineProperty(Intl.NumberFormat.prototype, name, {
      configurable: true,
      writable: true,
      value(this: Intl.NumberFormat, ...values: unknown[]) {
        refuseBigInt(values);
        return original.apply(this, values);
      },
    });
  }
}
