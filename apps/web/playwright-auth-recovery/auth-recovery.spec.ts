import { expect, test } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { signTestIdToken } from '../src/lib/auth/test-id-token';

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('This test requires its own isolated app');
  return `${origin}${path}`;
}

test('an invalid session cookie can reach login without a redirect loop', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: 'stale-invalid-session-token',
      url: appURL('/'),
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const response = await page.goto(appURL('/login'));
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(appURL('/login'));
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  // An invalid cookie still cannot authenticate protected pages.
  await page.goto(appURL('/dashboard'));
  await expect(page).toHaveURL(appURL('/login'));
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
});

for (const failure of ['http', 'network'] as const) {
  test(`Google sign-in shows a retryable error when the initial request fails (${failure})`, async ({
    page,
  }) => {
    await page.goto(appURL('/login'));
    let attempts = 0;
    await page.route('**/api/auth/sign-in/social', async (route) => {
      attempts += 1;
      if (failure === 'network') return route.abort('failed');
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PROVIDER_UNAVAILABLE', message: 'Provider unavailable' }),
      });
    });
    const signIn = page.getByRole('button', { name: 'Sign in with Google' });
    const error = page.getByRole('alert').filter({ hasText: 'Google sign-in could not start' });
    await signIn.click();
    await expect(error).toBeVisible();
    await page.waitForLoadState('load');
    await expect(signIn).toBeEnabled();
    expect(attempts).toBe(1);
    await signIn.click();
    await expect.poll(() => attempts).toBe(2);
    await expect(error).toBeVisible();
    await expect(signIn).toBeEnabled();
  });
}

test('a valid database session redirects login to the dashboard', async ({ page }) => {
  const secret = process.env.AUTH_RECOVERY_TEST_ID_TOKEN_SECRET;
  const dbName = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!secret || !dbName?.startsWith('splitbook-test-access-'))
    throw new Error('This test requires its own isolated auth fixtures');
  // The test verifier replaces Google's external identity proof only. User,
  // account, session creation and browser cookies use the real Mongo adapter.
  const email = 'auth-recovery@splitbook.test';
  const token = signTestIdToken(
    { sub: 'auth-recovery-user', email, name: 'Auth Recovery User' },
    secret,
  );
  const signIn = await page.request.post(appURL('/api/auth/sign-in/social'), {
    data: { provider: 'google', idToken: { token } },
  });
  expect(signIn.status()).toBe(200);
  await page.goto(appURL('/login'));
  await expect(page).toHaveURL(appURL('/dashboard'));
  const session = await (await page.request.get(appURL('/api/auth/get-session'))).json();
  expect(session.user.email).toBe(email);

  const client = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`);
  try {
    const db = client.db(dbName);
    const user = await db.collection('users').findOne({ email });
    expect(user).not.toBeNull();
    expect(
      await db.collection('accounts').countDocuments({ userId: user!._id, providerId: 'google' }),
    ).toBe(1);
    expect(await db.collection('sessions').countDocuments({ userId: user!._id })).toBe(1);
  } finally {
    await client.close();
  }
});
