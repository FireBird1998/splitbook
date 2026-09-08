import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E suite for the private beta.
 *
 * - Runs against the app on port 3100 with AUTH_MODE=demo and the
 *   `splitbook-demo` database (reset + reseeded in global setup).
 * - Four projects cover desktop/mobile × light/dark. The app derives its
 *   initial theme from `prefers-color-scheme`, so `colorScheme` emulation
 *   drives the theme per project.
 * - Journeys share one demo database, so the suite is fully serial
 *   (workers: 1) — each project's run starts from the same seeded baseline
 *   and must not assume exact mutable balances.
 */

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const DEMO_MONGODB_URI = 'mongodb://127.0.0.1:27017/splitbook-demo?directConnection=true';

export default defineConfig({
  testDir: './playwright',
  outputDir: './playwright/results',
  globalSetup: './playwright/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright/report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright/report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-light',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'light',
      },
    },
    {
      name: 'desktop-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'dark',
      },
    },
    {
      name: 'mobile-light',
      // Chromium with mobile emulation (390×844) — WebKit is not required for
      // responsive verification and keeps local/CI browser installs light.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        colorScheme: 'light',
      },
    },
    {
      name: 'mobile-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        colorScheme: 'dark',
      },
    },
  ],
  webServer: {
    command: process.env.CI ? 'pnpm exec next start -p 3100' : 'pnpm exec next dev -p 3100',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      AUTH_MODE: 'demo',
      // CI serves a production build (`next start`), where demo auth fails
      // closed without ALLOW_DEMO_AUTH; `next dev` (local) implies it via
      // NODE_ENV=development.
      ALLOW_DEMO_AUTH: 'true',
      // Better Auth rate-limits production builds per client IP. Behind
      // `next start` on loopback no IP is resolvable, so every persona entry
      // in the run would share one bucket; the suites are deterministic
      // without it.
      AUTH_RATE_LIMIT_ENABLED: 'false',
      AUTH_SECRET: 'playwright-demo-secret',
      AUTH_GOOGLE_ID: 'unused-in-demo-mode',
      AUTH_GOOGLE_SECRET: 'unused-in-demo-mode',
      MONGODB_URI: DEMO_MONGODB_URI,
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
