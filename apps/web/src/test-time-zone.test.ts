import { expect, inject, it } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The TZ this run started with, or null when TZ was unset. */
    requestedTimeZone: string | null;
  }
}

// vitest.config.ts runs tests in the zone TZ names, or in UTC when TZ is unset (#227).
const requested = inject('requestedTimeZone');
const expected = requested ?? 'UTC';

it(`runs in ${expected}${requested ? ', the zone TZ names' : ' when TZ is unset'}`, () => {
  // Compared as the runtime names zones, so an alias such as Etc/UTC resolves to UTC.
  const { timeZone: expectedZone } = new Intl.DateTimeFormat('en', {
    timeZone: expected,
  }).resolvedOptions();
  expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(expectedZone);
});
