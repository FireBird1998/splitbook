import { defineConfig } from '@playwright/test';
import appConfig from './playwright.config';

const webServer = appConfig.webServer;
if (!webServer || Array.isArray(webServer))
  throw new Error('Pilot expects the single demo app server.');

export default defineConfig({
  ...appConfig,
  testDir: './playwright-pilot',
  outputDir: './playwright-pilot/results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-pilot/report', open: 'never' }]],
  snapshotPathTemplate: '{testDir}/snapshots/{projectName}/{arg}{ext}',
  use: {
    ...appConfig.use,
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
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
  webServer: { ...webServer, reuseExistingServer: false },
});
