import { defineConfig } from '@playwright/test';
import base from '/Users/ankitdas/AnkitPersonalProjech/SplidBook/apps/web/playwright.pilot.config';
export default defineConfig({ ...base, globalSetup: undefined, testDir: '/Users/ankitdas/AnkitPersonalProjech/SplidBook/apps/web/playwright-pilot',
outputDir: '/Users/ankitdas/AnkitPersonalProjech/SplidBook/output/w318/pilot', snapshotPathTemplate: '/Users/ankitdas/AnkitPersonalProjech/SplidBook/apps/web/playwright-pilot/snapshots/{projectName}/{arg}{ext}', reporter: 'list', workers: 1, retries: 0,
use: { ...base.use, connectOptions: { wsEndpoint: 'ws://127.0.0.1:9338/', exposeNetwork: '<loopback>' }, baseURL: 'http://localhost:9318' },
webServer: { command: 'node /Users/ankitdas/AnkitPersonalProjech/SplidBook/apps/web/node_modules/next/dist/bin/next start -p 9318', cwd: '/tmp/w318-web',
url: 'http://localhost:9318', reuseExistingServer: false, timeout: 180000,
env: { AUTH_MODE: 'demo', ALLOW_DEMO_AUTH: 'true', AUTH_RATE_LIMIT_ENABLED: 'false', AUTH_SECRET: 'w318-fictional-test-secret',
MONGODB_URI: 'mongodb://127.0.0.1:27018/splitbook_w318?directConnection=true', NEXT_PUBLIC_APP_URL: 'http://localhost:9318' } } });
