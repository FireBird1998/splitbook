import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright-auth-recovery',
  testMatch: 'auth-recovery.spec.ts',
  outputDir: './output/playwright/auth-recovery',
  globalSetup: './playwright-auth-recovery/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: { trace: 'off' },
});
