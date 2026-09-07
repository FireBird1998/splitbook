import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright-production-ui',
  outputDir: './playwright-production-ui/results',
  workers: 1,
  use: { baseURL: 'http://localhost:4129' },
  webServer: {
    command: 'pnpm exec next start -p 4129',
    port: 4129,
    reuseExistingServer: false,
    env: {
      AUTH_SECRET: 'design-system-production-check',
      AUTH_MODE: 'google',
      AUTH_GOOGLE_ID: '',
      AUTH_GOOGLE_SECRET: '',
      AUTH_ALLOWED_EMAILS: '',
      MONGODB_URI: '',
      AUTH_TRUST_HOST: 'true',
    },
  },
});
