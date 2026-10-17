import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '/tmp/w318-access-suite/playwright-expense-access',
outputDir: '/Users/ankitdas/AnkitPersonalProjech/SplidBook/output/w318/access', globalSetup: '/tmp/w318-access-suite/playwright-expense-access/global-setup.ts',
workers: 1, fullyParallel: false, timeout: 90000, reporter: 'list', use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' } });
