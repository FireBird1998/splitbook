import { defineConfig } from 'vitest/config';
import path from 'path';

// Tests run in UTC, the zone CI uses, unless TZ names another zone (#227).
const requestedTimeZone = process.env.TZ || null;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: requestedTimeZone ?? 'UTC' },
    provide: { requestedTimeZone },
    // Integration tests (*.integration.test.ts) hit a real MongoDB database —
    // allow for connection and query latency on cold starts.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/lib/test-utils/stubs/server-only.ts'),
    },
  },
});
