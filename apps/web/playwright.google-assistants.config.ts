import { defineConfig } from '@playwright/test';
import base from './playwright.google.config';

/**
 * The Google-mode app with Connected assistants live and preparing items for To review (#450),
 * for the landing page's assistants section. Like the Connect ChatGPT suite, it flips real server
 * settings without changing deployed flags; the auth suite (playwright.google.config.ts) runs the
 * same app with assistants off. Next allows one dev server per folder, so stop the auth suite's
 * before running this one.
 */
const PORT = 3102;
const baseURL = `http://localhost:${PORT}`;
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;

export default defineConfig({
  ...base,
  testMatch: 'landing-assistants.spec.ts',
  outputDir: './playwright-google/results/assistants',
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-google/report/assistants', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-google/report/assistants', open: 'never' }]],
  use: { ...base.use, baseURL },
  projects: (base.projects ?? []).map((project) => ({
    ...project,
    name: 'assistants-enabled',
    // The auth suite's project leaves this spec out; here it is the whole run.
    testIgnore: [],
    use: { ...project.use, baseURL },
  })),
  webServer: {
    ...server,
    command: process.env.CI ? `pnpm exec next start -p ${PORT}` : `pnpm exec next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    env: {
      ...server?.env,
      MCP_ENABLED: 'true',
      PERSISTENT_DRAFTS_ENABLED: 'true',
      // `next start` runs as production, where the assistant connection accepts only an HTTPS
      // app origin; the page is still served over HTTP on loopback.
      NEXT_PUBLIC_APP_URL: process.env.CI ? `https://localhost:${PORT}` : baseURL,
    },
  },
});
