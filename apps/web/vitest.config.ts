import { defineConfig } from 'vitest/config';
import path from 'path';

// Tests run in UTC, the zone CI uses, unless TZ names another zone (#227).
const requestedTimeZone = process.env.TZ || null;

/**
 * How many integration files run at once (#470). Each file has its own database of about
 * 35 files that mongod keeps open, so the open-file count grows with the worker count:
 * the default (one fewer than the CPUs) peaked at 749 on an 11-core machine, close to the
 * default soft limit (nofile 1024), where mongod aborts and the run fails with 30 s hook
 * timeouts. Four at a time peaked at 383 and ran no slower; unit files keep full parallelism.
 * `integration-db.ts` closes each dropped database's files.
 */
const INTEGRATION_MAX_WORKERS = 4;
const INTEGRATION_FILES = 'src/**/*.integration.test.ts';

export default defineConfig({
  test: {
    environment: 'node',
    env: { TZ: requestedTimeZone ?? 'UTC' },
    provide: { requestedTimeZone },
    // Integration tests (*.integration.test.ts) hit a real MongoDB database —
    // allow for connection and query latency on cold starts.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: [INTEGRATION_FILES],
          // Projects with different worker limits run as separate groups: unit files first.
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [INTEGRATION_FILES],
          maxWorkers: INTEGRATION_MAX_WORKERS,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/lib/test-utils/stubs/server-only.ts'),
    },
  },
});
