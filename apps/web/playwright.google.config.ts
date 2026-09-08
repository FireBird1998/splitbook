import { defineConfig, devices } from '@playwright/test';

/**
 * Google-mode auth smoke suite.
 *
 * Runs the app with AUTH_MODE=google on port 3101 and verifies the OAuth
 * entry points and the approved and denied sign-in outcomes. Google itself is
 * never contacted: the redirect is intercepted before it leaves the browser,
 * and the outcomes run through Better Auth's ID-token sign-in endpoint with
 * tokens the suite signs locally under AUTH_TEST_ID_TOKEN_SECRET (see
 * src/lib/auth/test-id-token.ts). No real Google login or secrets are needed.
 *
 * Kept separate from the demo-mode suite (playwright.config.ts), which owns
 * port 3100 and the seeded splitbook-demo database. This suite uses its own
 * splitbook-google-e2e database, dropped by global setup before each run.
 */

const PORT = 3101;
const baseURL = `http://localhost:${PORT}`;

export const GOOGLE_MODE_CLIENT_ID = 'playwright-google-client-id.apps.googleusercontent.com';
export const GOOGLE_MODE_TEST_ID_TOKEN_SECRET = 'playwright-google-test-id-token-secret';
export const GOOGLE_MODE_APPROVED_EMAIL = 'approved.playwright@splitbook.local';

export default defineConfig({
  testDir: './playwright-google',
  outputDir: './playwright-google/results',
  globalSetup: './playwright-google/global-setup.ts',
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
      AUTH_SECRET: 'playwright-google-secret',
      AUTH_GOOGLE_ID: GOOGLE_MODE_CLIENT_ID,
      AUTH_GOOGLE_SECRET: 'playwright-google-client-secret',
      AUTH_ALLOWED_EMAILS: GOOGLE_MODE_APPROVED_EMAIL,
      // Test-only verifier for locally signed ID tokens. CI serves a
      // production build, where the override additionally needs the explicit
      // ALLOW_TEST_ID_TOKEN opt-in (the same rule as ALLOW_DEMO_AUTH).
      AUTH_TEST_ID_TOKEN_SECRET: GOOGLE_MODE_TEST_ID_TOKEN_SECRET,
      ...(process.env.CI ? { ALLOW_TEST_ID_TOKEN: 'true' } : {}),
      // See playwright.config.ts: no client IP behind `next start` on loopback.
      AUTH_RATE_LIMIT_ENABLED: 'false',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/splitbook-google-e2e?directConnection=true',
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
