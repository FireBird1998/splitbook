import { expect, test } from '@playwright/test';
import { GOOGLE_MODE_CLIENT_ID, GOOGLE_MODE_ISSUER } from '../playwright.google.config';

const EXPECTED_REDIRECT_URI = 'http://localhost:3101/api/auth/callback/google';

/**
 * Auth smoke tests for AUTH_MODE=google. A local OIDC stand-in completes the
 * callback for approved and denied identities without live Google access or
 * real OAuth secrets.
 */
test.describe('google auth mode', () => {
  test('home page shows the marketing landing with Google sign-in, not the demo picker', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByText(/demo persona/i)).toHaveCount(0);
    await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
  });

  test('/login shows the Google sign-in button, not the demo picker', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByText('Splitbook', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByText(/demo persona/i)).toHaveCount(0);
  });

  test('an approved Google identity reaches the application', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();

    await page.getByRole('link', { name: 'Continue as approved tester' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Splitbook', { exact: true })).toBeVisible();
    // CI runs next start: a real authenticated session must not reveal the lab.
    if (process.env.CI) {
      const catalogue = await page.request.get('/dev/design-system');
      expect(catalogue.status()).toBe(404);
      expect(await catalogue.text()).not.toContain('Local examples · synthetic data');
    }
  });

  test('an unapproved Google identity sees the invite-only access result', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();

    await page.getByRole('link', { name: 'Continue as unapproved tester' }).click();

    await expect(page.getByText('Splitbook is invite-only right now.')).toBeVisible();
    await expect(
      page.getByText('Ask the owner to add your Google email to the beta.'),
    ).toBeVisible();
  });

  test('protected pages redirect anonymous users to /login with a callbackUrl', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard/);
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });

  test('Google sign-in redirects to Google OAuth with the configured client and callback', async ({
    page,
  }) => {
    let authorizeUrl: URL | null = null;
    await page.route(`${GOOGLE_MODE_ISSUER}/**`, async (route) => {
      authorizeUrl = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>captured local OAuth authorization</body></html>',
      });
    });

    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();

    await expect
      .poll(() => authorizeUrl, { message: 'expected navigation to the local OAuth stand-in' })
      .not.toBeNull();

    const url = authorizeUrl as unknown as URL;
    expect(url.origin + url.pathname).toBe(`${GOOGLE_MODE_ISSUER}/authorize`);
    expect(url.searchParams.get('client_id')).toBe(GOOGLE_MODE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(EXPECTED_REDIRECT_URI);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
