import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Exercise real server configuration without changing deployed feature flags.
const mode = process.env.MCP_GUIDE_TEST_MODE ?? 'disabled';
export default defineConfig({
  ...base,
  testMatch: 'connect-chatgpt.spec.ts',
  webServer: {
    ...base.webServer,
    command: 'pnpm exec next dev -p 3100',
    url: 'http://localhost:3100/connect/chatgpt',
    reuseExistingServer: false,
    env: {
      ...(!Array.isArray(base.webServer) ? base.webServer?.env : {}),
      MCP_ENABLED: mode === 'disabled' ? 'false' : 'true',
      MCP_RESOURCE_URL:
        mode === 'invalid'
          ? 'https://invalid.example/wrong'
          : 'https://mcp.staging.example.test/api/mcp',
    },
  },
});
