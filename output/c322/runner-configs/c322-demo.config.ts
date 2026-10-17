import { defineConfig } from '@playwright/test';
import base from '/Users/ankitdas/AnkitPersonalProjech/SplidBook/apps/web/playwright.config';
export default defineConfig({ ...base, globalSetup: undefined, testDir: '/Users/ankitdas/AnkitPersonalProjech/SplidBook/apps/web/playwright',
outputDir: '/Users/ankitdas/AnkitPersonalProjech/SplidBook/output/c322/demo', reporter: 'list', workers: 1, retries: 0,
use: { ...base.use, baseURL: 'http://localhost:3322' },
webServer: { command: 'node /Users/ankitdas/AnkitPersonalProjech/SplidBook/apps/web/node_modules/next/dist/bin/next start -p 3322', cwd: '/tmp/c322-web',
url: 'http://localhost:3322', reuseExistingServer: false, timeout: 180000,
env: { AUTH_MODE: 'demo', ALLOW_DEMO_AUTH: 'true', AUTH_RATE_LIMIT_ENABLED: 'false', AUTH_SECRET: 'c322-fictional-secret',
MONGODB_URI: 'mongodb://127.0.0.1:27018/splitbook_c322?directConnection=true', NEXT_PUBLIC_APP_URL: 'http://localhost:3322' } } });
