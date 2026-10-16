import { expect, test, type APIResponse, type Page } from '@playwright/test';
import {
  GOOGLE_MODE_APPROVED_EMAIL,
  GOOGLE_MODE_CLIENT_ID,
  GOOGLE_MODE_TEST_ID_TOKEN_SECRET,
} from '../playwright.google.config';
import { signTestIdToken } from '../src/lib/auth/test-id-token';
import { expectNoSeriousA11yViolations } from '../playwright/fixtures';

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * Auth smoke tests for AUTH_MODE=google.
 *
 * Google is never contacted. The redirect test intercepts the navigation to
 * accounts.google.com and inspects the authorization request; the approved
 * and denied outcomes go through Better Auth's ID-token sign-in endpoint —
 * the same path the native mobile clients will use — with tokens signed
 * locally under AUTH_TEST_ID_TOKEN_SECRET (see src/lib/auth/test-id-token.ts).
 */

/** POST an ID token as the browser context, so the session cookie lands on `page`. */
async function signInWithIdToken(
  page: Page,
  identity: { sub: string; email: string; name: string },
): Promise<APIResponse> {
  const token = signTestIdToken(
    { ...identity, aud: GOOGLE_MODE_CLIENT_ID },
    GOOGLE_MODE_TEST_ID_TOKEN_SECRET,
  );
  return page.request.post('/api/auth/sign-in/social', {
    data: { provider: 'google', idToken: { token } },
  });
}

test.describe('google auth mode', () => {
  const headline = (page: Page) =>
    page.getByRole('heading', { level: 1, name: 'Every shared cost, worked out to the paisa.' });

  test('home page shows the landing page with Google sign-in, not the demo picker', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    await expect(headline(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Google' }).first()).toBeVisible();
    await expect(page.getByText(/demo persona/i)).toHaveCount(0);
    await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);

    // This server has nothing optional live (#444): no store, assistants or legal links.
    await expect(
      page.getByRole('link', {
        name: /Get the app|Google Play|Connect Splitbook|Privacy|Terms|Support/,
      }),
    ).toHaveCount(0);

    // The brand kit: the logo leads home, and the footer's mark is decorative beside the name.
    const home = page.getByRole('link', { name: 'Splitbook home' });
    await expect(home).toHaveAttribute('href', '/');
    await expect(home.getByRole('img')).toHaveAttribute('src', '/brand/logo-light.svg');
    const footer = page.getByRole('contentinfo');
    await expect(footer).toContainText('Splitbook · shared expenses, settled fairly.');
    await expect(footer.locator('img')).toHaveAttribute('alt', '');
    await expect(footer.locator('img')).toHaveAttribute('src', '/brand/mark-indigo.svg');

    await expectNoSeriousA11yViolations(page, testInfo, 'landing-desktop-light');
  });

  test('the landing page fits a phone without sideways scroll, in dark', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    await expect(headline(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Splitbook home' }).getByRole('img'),
    ).toHaveAttribute('src', '/brand/logo-dark.svg');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await expectNoSeriousA11yViolations(page, testInfo, 'landing-phone-dark');
  });

  test('/login shows the Google sign-in button, not the demo picker', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('img', { name: 'Splitbook', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByText(/demo persona/i)).toHaveCount(0);
  });

  test('the demo persona endpoint does not exist in google mode', async ({ page }) => {
    const response = await page.request.post('/api/auth/demo-persona/sign-in', {
      data: { personaId: 'alex' },
    });
    expect(response.status()).toBe(404);
  });

  test('an approved Google identity reaches the application', async ({ page }) => {
    const signIn = await signInWithIdToken(page, {
      sub: 'approved-playwright-user',
      email: GOOGLE_MODE_APPROVED_EMAIL,
      name: 'Approved Playwright User',
    });
    expect(signIn.status(), await signIn.text()).toBe(200);
    expect((await signIn.json()).user.email).toBe(GOOGLE_MODE_APPROVED_EMAIL);

    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('link', { name: 'Splitbook home' })).toBeVisible();
    // Home, for the approved identity: its heading, and the account at the foot of the sidebar.
    await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('complementary', { name: 'Splitbook' })
        .getByRole('button', { name: 'Approved Playwright User, account menu', exact: true }),
    ).toBeVisible();
    // A signed-in visit to /login goes straight back to the app.
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);
    // CI runs next start: a real authenticated session must not reveal the lab.
    if (process.env.CI) {
      const catalogue = await page.request.get('/dev/design-system');
      expect(catalogue.status()).toBe(404);
      expect(await catalogue.text()).not.toContain('Local examples · synthetic data');
    }
  });

  test('an unapproved Google identity is denied and sees the invite-only access result', async ({
    page,
  }) => {
    const signIn = await signInWithIdToken(page, {
      sub: 'unapproved-playwright-user',
      email: 'unapproved.playwright@splitbook.local',
      name: 'Unapproved Playwright User',
    });
    expect(signIn.status(), await signIn.text()).toBe(403);
    expect((await signIn.json()).code).toBe('email_not_allowed');
    expect(await (await page.request.get('/api/auth/get-session')).json()).toBeNull();

    // The browser redirect flow lands on the same code; the login page maps it.
    await page.goto('/login?error=email_not_allowed');

    await expect(page.getByText('Splitbook is invite-only right now.')).toBeVisible();
    await expect(
      page.getByText('Ask the owner to add your Google email to the beta.'),
    ).toBeVisible();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard/);
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
    baseURL,
  }) => {
    let authorizeUrl: URL | null = null;
    await page.route('https://accounts.google.com/**', async (route) => {
      authorizeUrl = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>captured Google OAuth authorization</body></html>',
      });
    });

    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();

    await expect
      .poll(() => authorizeUrl, { message: 'expected navigation to Google OAuth' })
      .not.toBeNull();

    const url = authorizeUrl as unknown as URL;
    expect(url.origin + url.pathname).toBe(GOOGLE_AUTHORIZE);
    expect(url.searchParams.get('client_id')).toBe(GOOGLE_MODE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(
      new URL('/api/auth/callback/google', baseURL).href,
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });
});
