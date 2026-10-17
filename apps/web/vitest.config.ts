import { availableParallelism } from 'node:os';
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
    // Vitest's default (one fewer than the CPUs), at most four (#470). Each integration file's
    // database is about 35 files mongod keeps open, so the open-file count grows with the
    // worker count, and a big machine's default would pass the default soft limit
    // (nofile 1024), where mongod aborts. --maxWorkers and VITEST_MAX_WORKERS still override it.
    maxWorkers: Math.min(4, Math.max(1, availableParallelism() - 1)),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/lib/test-utils/stubs/server-only.ts'),
    },
  },
});
