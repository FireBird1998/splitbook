import { defineConfig } from 'vitest/config';

// Tests run in UTC, the zone CI uses, unless TZ names another zone (#227).
const requestedTimeZone = process.env.TZ || null;

export default defineConfig({
  test: {
    environment: 'node',
    env: { TZ: requestedTimeZone ?? 'UTC' },
    provide: { requestedTimeZone },
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    setupFiles: ['src/test-utils/setup.ts'],
  },
});
