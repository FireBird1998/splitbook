import { expect, test } from '@playwright/test';
import { GOOGLE_MODE_CLIENT_ID } from '../playwright.google.config';

const EXPECTED_REDIRECT_URI = 'http://localhost:3101/api/auth/callback/google';

/**
 * Auth smoke tests for AUTH_MODE=google. The Google authorization endpoint
 * is intercepted, so these tests never perform a real Google login and never
 * see real OAuth secrets.
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

    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByText(/demo persona/i)).toHaveCount(0);
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
    await page.route('https://accounts.google.com/**', async (route) => {
      authorizeUrl = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>intercepted google authorization</body></html>',
      });
    });

    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();

    await expect
      .poll(() => authorizeUrl, { message: 'expected navigation to accounts.google.com' })
      .not.toBeNull();

    const url = authorizeUrl as unknown as URL;
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(GOOGLE_MODE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(EXPECTED_REDIRECT_URI);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
