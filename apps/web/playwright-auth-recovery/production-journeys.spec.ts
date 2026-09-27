import { expect, test } from '@playwright/test';
import { signTestIdToken } from '../src/lib/auth/test-id-token';

function appURL(mode: 'google' | 'demo', path: string) {
  const origin =
    mode === 'google' ? process.env.EXPENSE_ACCESS_BASE_URL : process.env.AUTH_PRODUCTION_DEMO_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('This test requires an isolated production app');
  return `${origin}${path}`;
}

test('production demo login survives a stale cookie, signs in and signs out', async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: 'better-auth.session_token', value: 'invalid-session', url: appURL('demo', '/') },
    ]);
  await page.goto(appURL('demo', '/login'));
  await expect(page.getByRole('heading', { name: 'Continue as a demo persona' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Enter as Alex Rivera/ }).click();
  await expect(page).toHaveURL(appURL('demo', '/dashboard'));
  const session = await (await page.request.get(appURL('demo', '/api/auth/get-session'))).json();
  expect(session.user.email).toBe('alex.demo@splitbook.local');
  await page.goto(appURL('demo', '/login'));
  await expect(page).toHaveURL(appURL('demo', '/dashboard'));
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(appURL('demo', '/'));
  expect(await (await page.request.get(appURL('demo', '/api/auth/get-session'))).json()).toBeNull();
  await page.goto(appURL('demo', '/dashboard'));
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard$/);
  await expect(page.getByRole('heading', { name: 'Continue as a demo persona' })).toBeVisible();
});

test('production Google mode keeps the allowlist and demo endpoint guards', async ({ page }) => {
  const secret = process.env.AUTH_RECOVERY_TEST_ID_TOKEN_SECRET;
  if (!secret) throw new Error('Missing isolated test identity secret');
  const demo = await page.request.post(appURL('google', '/api/auth/demo-persona/sign-in'), {
    data: { personaId: 'alex' },
  });
  expect(demo.status()).toBe(404);
  const token = signTestIdToken(
    { sub: 'denied-auth-recovery', email: 'denied@splitbook.test', name: 'Denied Identity' },
    secret,
  );
  const denied = await page.request.post(appURL('google', '/api/auth/sign-in/social'), {
    data: { provider: 'google', idToken: { token } },
  });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).code).toBe('email_not_allowed');
  expect(
    await (await page.request.get(appURL('google', '/api/auth/get-session'))).json(),
  ).toBeNull();
  await page.goto(appURL('google', '/login?error=email_not_allowed'));
  await expect(page.getByRole('alert').filter({ hasText: 'invite-only' })).toBeVisible();
  await page.goto(appURL('google', '/dashboard'));
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard$/);
});

test('production Google sign-in builds the OAuth redirect with its configured callback', async ({
  page,
}) => {
  let authorizeURL: URL | undefined;
  await page.route('https://accounts.google.com/**', async (route) => {
    authorizeURL = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: 'Captured OAuth redirect' });
  });
  await page.goto(appURL('google', '/login'));
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect.poll(() => authorizeURL?.hostname).toBe('accounts.google.com');
  expect(authorizeURL!.searchParams.get('client_id')).toBe('unused-synthetic-client');
  expect(authorizeURL!.searchParams.get('redirect_uri')).toBe(
    appURL('google', '/api/auth/callback/google'),
  );
  expect(authorizeURL!.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorizeURL!.searchParams.get('response_type')).toBe('code');
  expect(authorizeURL!.searchParams.get('prompt')).toBe('select_account');
});
