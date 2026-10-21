import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Opt-in only: exercise the unchanged seed assertions with delayed database responses.
// Use a dedicated local replica set with enableTestCommands=1, never a shared server.
const uri = new URL(process.env.TEST_MONGODB_URI ?? '');
if (
  uri.protocol !== 'mongodb:' ||
  !['127.0.0.1', 'localhost'].includes(uri.hostname) ||
  !uri.port ||
  ['27017', '27018'].includes(uri.port) ||
  uri.username ||
  uri.password
)
  throw new Error('Seed load checks require TEST_MONGODB_URI on an isolated local test port');
uri.searchParams.set('appName', 'splitbook-seed-load');
process.env.TEST_MONGODB_URI = uri.href;

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      'src/lib/demo/seed.integration.test.ts',
      'src/lib/demo/seed-groups.integration.test.ts',
    ],
    maxWorkers: 1,
    globalSetup: ['./src/lib/test-utils/seed-load-setup.ts'],
  },
});
