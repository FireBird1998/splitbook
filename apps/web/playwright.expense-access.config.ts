import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright-expense-access',
  outputDir: './output/playwright/expense-access',
  globalSetup: './playwright-expense-access/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  reporter: 'list',
  use: { trace: 'off' },
});
