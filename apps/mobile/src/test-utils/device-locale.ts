import { onTestFinished, vi } from 'vitest';

const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

/**
 * Gives the phone `locale`, such as "en-US", for the rest of the test: the locale Android reads
 * its week and date spelling from (`Intl.DateTimeFormat().resolvedOptions()`).
 */
export function mockDeviceLocale(locale: string) {
  const spy = vi
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), locale };
    });
  onTestFinished(() => spy.mockRestore());
  return spy;
}
