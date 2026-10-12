import { expect, test } from '@playwright/test';
import { enterAsPersona } from './fixtures';

const enabled = process.env.MCP_GUIDE_TEST_MODE === 'enabled';

test('public visitors can read the guide without granting access', async ({ page }) => {
  await page.goto('/connect/chatgpt');
  await expect(page.getByRole('heading', { name: 'Connect ChatGPT', exact: true })).toBeVisible();
  await expect(
    page.getByText('All current and future Groups', { exact: false }).first(),
  ).toBeVisible();
  if (process.env.MCP_GUIDE_TEST_MODE !== 'invalid')
    await expect(
      page.getByRole('link', { name: 'Sign in to check your connection' }),
    ).toBeVisible();
  await expect(page.getByText('ChatGPT authorized', { exact: true })).toHaveCount(0);
  if (enabled) {
    await expect(page.getByText('Staging · test environment')).toBeVisible();
    await expect(
      page.getByText('https://mcp.staging.example.test/api/mcp', { exact: true }),
    ).toBeVisible();
    return;
  }
  await expect(page.getByText('Not available in this environment', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy server URL' })).toHaveCount(0);
});

test('members can find the public guide in Settings', async ({ page }) => {
  test.skip(
    process.env.MCP_GUIDE_TEST_MODE === 'invalid',
    'Invalid backend config disables auth too',
  );
  await enterAsPersona(page, 'alex');
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Connect ChatGPT', exact: true }).click();
  await expect(page).toHaveURL(/\/connect\/chatgpt$/);
});

test('copy controls, keyboard details and external navigation never claim success', async ({
  page,
  context,
}) => {
  test.skip(!enabled, 'Requires enabled deployment');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/connect/chatgpt');
  await page.getByRole('button', { name: 'Copy server URL' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied.' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'https://mcp.staging.example.test/api/mcp',
  );
  const details = page.locator('summary');
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Request ledger:read and offline_access.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Copy test prompt' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'connection_status only',
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: () => Promise.reject(new Error('blocked')),
      configurable: true,
    });
  });
  await page.getByRole('button', { name: 'Copy server URL' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copy unavailable.' })).toBeVisible();
  await context.route('https://chatgpt.com/plugins', (route) =>
    route.fulfill({ body: '<h1>ChatGPT</h1>', contentType: 'text/html' }),
  );
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open ChatGPT (new tab)' }).click();
  await (await popup).close();
  await expect(page.getByText('ChatGPT authorized', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('authorization checks all pages and shows actual ChatGPT permissions', async ({ page }) => {
  test.skip(!enabled, 'Requires enabled deployment');
  await enterAsPersona(page, 'alex');
  const offsets: string[] = [];
  await page.route('**/api/auth/mcp/connections*', async (route) => {
    expect(route.request().headers()['x-expected-account']).toBeTruthy();
    const offset = new URL(route.request().url()).searchParams.get('offset') ?? '0';
    offsets.push(offset);
    const second = offset === '50';
    await route.fulfill({
      json: {
        connections: second
          ? [
              {
                id: 'chatgpt',
                clientId: 'https://chatgpt.com/oauth/client.json',
                scopes: ['ledger:read', 'drafts:write', 'offline_access'],
              },
            ]
          : [
              {
                id: 'other',
                clientId: 'https://not-chatgpt.example/oauth/client.json',
                scopes: ['ledger:read'],
              },
            ],
        nextOffset: second ? null : 50,
      },
    });
  });
  await page.goto('/connect/chatgpt');
  await expect(page.getByText('ChatGPT authorized', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Private Draft access, including permanent discard', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh status' })).toBeVisible();
  expect(offsets).toContain('0');
  expect(offsets).toContain('50');
  await expect(page.getByText('Test passed', { exact: true })).toHaveCount(0);
});

test('refresh distinguishes absent, failed, unavailable and revoked access', async ({ page }) => {
  test.skip(!enabled, 'Requires enabled deployment');
  await enterAsPersona(page, 'alex');
  let status = 200;
  let connections = [
    { id: 'other', clientId: 'https://example.test/chatgpt', scopes: ['ledger:read'] },
  ];
  await page.route('**/api/auth/mcp/connections*', (route) =>
    route.fulfill({ status, json: { connections, nextOffset: null } }),
  );
  await page.goto('/connect/chatgpt');
  await expect(page.getByText('ChatGPT is not authorized for this account.')).toBeVisible();
  status = 503;
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByText('Could not check authorization.', { exact: false })).toBeVisible();
  await expect(page.getByText('ChatGPT is not authorized for this account.')).toHaveCount(0);
  status = 200;
  connections = [
    { id: 'chatgpt', clientId: 'https://chatgpt.com/oauth/client.json', scopes: ['ledger:read'] },
  ];
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByText('ChatGPT authorized', { exact: true })).toBeVisible();
  connections = [];
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByText('ChatGPT is not authorized for this account.')).toBeVisible();
  status = 404;
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(
    page.getByText('Connection checking is unavailable in this environment.'),
  ).toBeVisible();
  status = 401;
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('link', { name: 'Sign in to check your connection' })).toBeVisible();
});

test('switching accounts clears access and ignores a late response', async ({ page }) => {
  test.skip(!enabled, 'Requires enabled deployment');
  await enterAsPersona(page, 'alex');
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { user: alex } = await (await page.request.get('/api/auth/get-session')).json();
  await page.route('**/api/auth/mcp/connections*', async (route) => {
    if (route.request().headers()['x-expected-account'] === alex.id) {
      await delayed;
      await route
        .fulfill({
          json: {
            connections: [
              {
                id: 'old',
                clientId: 'https://chatgpt.com/oauth/client.json',
                scopes: ['drafts:write'],
              },
            ],
            nextOffset: null,
          },
        })
        .catch(() => {});
    } else {
      await route.fulfill({ json: { connections: [], nextOffset: null } });
    }
  });
  await page.goto('/connect/chatgpt');
  await expect(page.getByText('Checking authorization…')).toBeVisible();
  const switched = await page.request.post('/api/auth/demo-persona/sign-in', {
    data: { personaId: 'sam' },
    headers: { Origin: 'http://localhost:3100' },
  });
  expect(switched.ok()).toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('ChatGPT is not authorized for this account.')).toBeVisible();
  release();
  await expect(
    page.getByText('Private Draft access, including permanent discard', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('ChatGPT authorized', { exact: true })).toHaveCount(0);
  const signout = await page.request.post('/api/auth/sign-out', {
    data: {},
    headers: { Origin: 'http://localhost:3100' },
  });
  expect(signout.ok()).toBe(true);
  // Better Auth throttles focus checks. Repeat focus until it observes the new session.
  await expect(async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('link', { name: 'Sign in to check your connection' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 15000 });
});
