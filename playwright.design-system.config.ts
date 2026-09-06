import { defineConfig } from '@playwright/test';

// The catalogue is deliberately tested on a dev server with no app credentials
// and no database setup. Production exclusion lives in the production suite.
const baseURL = 'http://localhost:4128';

export default defineConfig({
  testDir: './playwright-design-system',
  outputDir: './playwright-design-system/results',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
    ...(process.env.DESIGN_BROWSER_WS
      ? {
          connectOptions: {
            wsEndpoint: process.env.DESIGN_BROWSER_WS,
            exposeNetwork: '<loopback>',
          },
        }
      : {}),
  },
  reporter: [['list'], ['json', { outputFile: 'playwright-design-system/results/report.json' }]],
  snapshotPathTemplate: '{testDir}/snapshots/{projectName}/{arg}{ext}',
  projects: [
    {
      name: 'desktop-light',
      use: { viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
    },
    { name: 'desktop-dark', use: { viewport: { width: 1280, height: 800 }, colorScheme: 'dark' } },
    {
      name: 'mobile-light',
      use: {
        viewport: { width: 390, height: 844 },
        colorScheme: 'light',
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-dark',
      use: {
        viewport: { width: 390, height: 844 },
        colorScheme: 'dark',
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'pnpm exec next dev -p 4128',
    port: 4128,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_SECRET: '',
      AUTH_GOOGLE_ID: '',
      AUTH_GOOGLE_SECRET: '',
      AUTH_MODE: 'google',
      AUTH_ALLOWED_EMAILS: '',
      MONGODB_URI: '',
    },
  },
});
