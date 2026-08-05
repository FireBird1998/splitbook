import { defineConfig, devices } from '@playwright/test';

/**
 * Google-mode auth smoke suite (Phase 7).
 *
 * Runs the app with AUTH_MODE=google on port 3101 and verifies the real
 * OAuth entry points: marketing landing + Google sign-in (never the demo
 * persona picker), and the redirect to accounts.google.com carrying the
 * configured client_id and the /api/auth/callback/google redirect URI.
 * The Google authorization endpoint is intercepted, so no real Google
 * login is performed and no secrets are required.
 *
 * Kept separate from the demo-mode suite (playwright.config.ts), which owns
 * port 3100 and the seeded splitwise-demo database. This suite needs no
 * seed data because the OAuth flow is never completed.
 */

const PORT = 3101;
const baseURL = `http://localhost:${PORT}`;

export const GOOGLE_MODE_CLIENT_ID = 'playwright-google-client-id.apps.googleusercontent.com';

export default defineConfig({
  testDir: './playwright-google',
  outputDir: './playwright-google/results',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-google/report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-google/report', open: 'never' }]],
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
  ],
  webServer: {
    command: process.env.CI ? 'pnpm exec next start -p 3101' : 'pnpm exec next dev -p 3101',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      AUTH_MODE: 'google',
      // CI serves a production build (`next start`), where Auth.js no longer
      // auto-trusts the host; `next dev` (local) implies it via NODE_ENV.
      AUTH_TRUST_HOST: 'true',
      AUTH_SECRET: 'playwright-google-secret',
      AUTH_GOOGLE_ID: GOOGLE_MODE_CLIENT_ID,
      AUTH_GOOGLE_SECRET: 'playwright-google-client-secret',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/splitwise-demo?directConnection=true',
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
