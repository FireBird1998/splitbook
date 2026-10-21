import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright-auth-recovery',
  testMatch: ['auth-recovery.spec.ts', 'theme-load.spec.ts'],
  outputDir: './output/playwright/auth-recovery',
  globalSetup: './playwright-auth-recovery/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // Compilation belongs to setup; retries must not hide a first-paint regression.
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: { trace: 'off' },
});
