import { defineConfig } from 'vitest/config';

// Tests run in UTC, the zone CI uses, unless TZ names another zone (#227).
const requestedTimeZone = process.env.TZ || null;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: requestedTimeZone ?? 'UTC' },
    provide: { requestedTimeZone },
  },
});
