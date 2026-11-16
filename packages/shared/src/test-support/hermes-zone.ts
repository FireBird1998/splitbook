/** The process's environment, without Node's types: shared code is typed for any runtime. */
const env = () =>
  (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

/**
 * Hermes after the phone's time zone changes while the app runs (#1283). Probed on an Android
 * emulator on 17 Nov 2026 (the release app, started in Asia/Kolkata, the zone then set to
 * Pacific/Pago_Pago and the app brought back):
 *
 * - `Date` keeps the zone the app started in: a date-time string without an offset is read in it,
 *   and the local getters and `getTimezoneOffset()` (-330) answer in it;
 * - Intl follows the new zone: `Intl.DateTimeFormat().resolvedOptions().timeZone` is
 *   "Pacific/Pago_Pago", and `toLocaleString`, `toLocaleDateString` and `toLocaleTimeString`
 *   without a `timeZone` format in it.
 *
 * So `new Date('2026-11-01T12:00:00')` is 06:30 UTC, its `getDate()` is 1 and its
 * `toLocaleDateString('en', { month: 'long' })` is "October". A cold start in the new zone puts
 * both in it again.
 *
 * `hermesZoneMoved(from, to)` makes this Node process behave so: `Date` in `from`, Intl in `to`.
 * It returns what puts both back.
 */
export function hermesZoneMoved(from: string, to: string): () => void {
  const was = env().TZ;
  env().TZ = from;
  const Original = Intl.DateTimeFormat;
  const Moved = function DateTimeFormat(
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    return Original(locales, { timeZone: to, ...options });
  } as unknown as typeof Intl.DateTimeFormat;
  Object.assign(Moved, {
    supportedLocalesOf: Original.supportedLocalesOf,
    prototype: Original.prototype,
  });
  Intl.DateTimeFormat = Moved;
  const names = ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const;
  const saved = names.map((name) => Date.prototype[name]);
  names.forEach((name, index) => {
    Object.defineProperty(Date.prototype, name, {
      configurable: true,
      writable: true,
      value(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        return saved[index]!.call(this, locales, { timeZone: to, ...options });
      },
    });
  });
  return () => {
    Intl.DateTimeFormat = Original;
    names.forEach((name, index) =>
      Object.defineProperty(Date.prototype, name, {
        configurable: true,
        writable: true,
        value: saved[index],
      }),
    );
    if (was === undefined) delete env().TZ;
    else env().TZ = was;
  };
}
