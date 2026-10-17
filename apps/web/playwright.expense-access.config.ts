import { defineConfig } from '@playwright/test';

/**
 * HTTP specs (#476): no browser page, no direct database writes, no account-wide reads and
 * nothing about Sam's profile. Each test works only on the Groups its ledger fixture makes,
 * by id, so they run in parallel beside the browser specs, against the same isolated app and
 * database as the rest of the run. These HTTP specs stay serial: ledger-money reads Sam's
 * balances across all his Groups; ledger-creation-replay and group-read-compatibility write
 * legacy states straight into the database; trip-summary-read checks Sam's name, which
 * profile-settings changes while it runs.
 */
const HTTP_SPECS = ['delete', 'edit-restore', 'export', 'insights-read', 'read', 'statement'].map(
  (name) => `${name}.spec.ts`,
);

export default defineConfig({
  testDir: './playwright-expense-access',
  outputDir: './output/playwright/expense-access',
  globalSetup: './playwright-expense-access/global-setup.ts',
  workers: 4,
  timeout: 90_000,
  reporter: 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    // The browser specs, and the HTTP specs that stay serial (above): one at a time. Listed
    // first, so its one worker starts at once and the HTTP specs fill the others beside it.
    { name: 'browser', testIgnore: HTTP_SPECS, fullyParallel: false, workers: 1 },
    { name: 'http', testMatch: HTTP_SPECS, fullyParallel: true },
  ],
});
