import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// A running production build, seeded demo database and local HTTPS endpoint are required.
// Enable MCP_ENABLED, MCP_ALLOW_DCR, ALLOW_DEMO_AUTH and both persistent-Drafts flags.
// Production MCP also requires AUTH_ALLOWED_EMAILS=alex.demo@splitbook.local.
const baseURL = process.env.MCP_CONSENT_BASE_URL;
if (!baseURL || new URL(baseURL).protocol !== 'https:')
  throw new Error('Set MCP_CONSENT_BASE_URL to the isolated HTTPS demo server.');
process.env.MCP_CONSENT_TEST = 'true';

export default defineConfig({
  ...base,
  testMatch: 'mcp-consent.spec.ts',
  outputDir: './playwright/results/mcp-consent',
  reporter: [['list'], ['html', { outputFolder: 'playwright/report/mcp-consent', open: 'never' }]],
  globalSetup: undefined,
  webServer: undefined,
  use: { ...base.use, baseURL, ignoreHTTPSErrors: true },
});
