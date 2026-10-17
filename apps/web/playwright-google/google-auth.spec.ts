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
  /** Fig 1's plate, and its drawing named by its full description (#448). */
  const fig1 = (page: Page) => page.getByRole('figure', { name: 'The splitting line' });
  const fig1Drawing = (page: Page) =>
    fig1(page).getByRole('img', {
      name: /^A small production line on a bench that splits Expenses\./,
    });
  /** The four bins' counters, left to right: You, Priya, Sam and Alex. */
  const counters = (page: Page) => fig1(page).locator('[data-count]');

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

    // Fig 1 sits under the hero at full width, named by its full description.
    await expect(fig1Drawing(page)).toBeVisible();
    await expect(fig1(page)).toContainText('Fig 1');
    await expect(fig1(page)).toContainText('Bins, left to right: You, Priya, Sam and Alex');

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
    await expect(page.getByRole('button', { name: 'Sign in with Google' }).first()).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Splitbook home' }).getByRole('img'),
    ).toHaveAttribute('src', '/brand/logo-dark.svg');
    await fig1(page).scrollIntoViewIfNeeded();
    await expect(fig1Drawing(page)).toBeVisible();
    // The drawing follows the page into dark: its paper is the kit's dark card.
    await expect(fig1(page)).toHaveAttribute('data-theme', 'dark');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await expectNoSeriousA11yViolations(page, testInfo, 'landing-phone-dark');
  });

  test('under reduced motion Fig 1 holds its still, and steps with clicks and keys', async ({
    page,
  }) => {
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    // The documented still: Groceries partway through its sort, Sam's ₹1,000 on Sam's counter.
    await expect(counters(page)).toHaveText(['+900', '+100', '+500', '−500']);
    await expect(fig1(page)).toContainText('Groceries: each chip to the bin it belongs to');
    // Nothing moves by itself, so there is nothing to pause.
    await expect(fig1(page).getByRole('button', { name: /^(Pause|Play)$/ })).toHaveCount(0);

    const tour = fig1(page).getByRole('group', { name: /^Live tour\./ });
    await tour.press('ArrowRight');
    await expect(counters(page)).toHaveText(['+500', '−100', '+300', '−700']);
    await expect(fig1(page).getByRole('status')).toContainText('All 3 Expenses split.');

    await tour.press('Home');
    await expect(counters(page)).toHaveText(['0', '0', '0', '0']);
    await expect(fig1(page)).toContainText('Line idle · 3 Expenses waiting');

    await tour.click();
    await expect(counters(page)).toHaveText(['+900', '−300', '−300', '−300']);
    await tour.press(' ');
    await expect(counters(page)).toHaveText(['+900', '+100', '−500', '−500']);
    // Nothing moves on its own: five seconds on, the Cab is still settled.
    await page.clock.runFor(5_000);
    await expect(counters(page)).toHaveText(['+900', '+100', '−500', '−500']);
    await expect(fig1(page)).toContainText('Cab ₹600 · Priya paid');
  });

  test('Fig 1 runs its tour on screen and stops when it leaves', async ({ page }) => {
    await page.clock.install();
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto('/');
    await fig1(page).scrollIntoViewIfNeeded();
    // On screen, the line starts the story by itself.
    await expect(fig1(page)).toContainText('Dinner ₹1,200 · You paid', { timeout: 10_000 });

    const drawing = () => fig1Drawing(page).evaluate((svg) => svg.innerHTML);
    await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
    await expect(fig1(page)).not.toBeInViewport();
    const left = await drawing();
    await page.clock.runFor(3_000);
    expect(await drawing()).toBe(left);

    await fig1(page).scrollIntoViewIfNeeded();
    await expect.poll(drawing).not.toBe(left);
  });

  test('Fig 1 pauses from its Pause button and plays on from where it held', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await expect(fig1(page)).toContainText('Dinner ₹1,200 · You paid', { timeout: 10_000 });

    const drawing = () => fig1Drawing(page).evaluate((svg) => svg.innerHTML);
    await fig1(page).getByRole('button', { name: 'Pause' }).click();
    const play = fig1(page).getByRole('button', { name: 'Play' });
    await expect(play).toBeVisible();
    const held = await drawing();
    await page.clock.runFor(3_000);
    expect(await drawing()).toBe(held);

    await play.click();
    await expect(fig1(page).getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect.poll(drawing).not.toBe(held);
  });

  test('Fig 1’s tour ships with the Anatomy kit’s licence', async ({ page }) => {
    await page.goto('/');
    await expect(fig1(page).getByRole('button', { name: 'Pause' })).toBeVisible();
    // The script that brought the tour, as the browser loaded it (minified in a production build).
    const notice = await page.evaluate(async () => {
      for (const entry of performance.getEntriesByType('resource')) {
        if (!entry.name.split('?')[0].endsWith('.js')) continue;
        const source = await (await fetch(entry.name)).text();
        if (source.includes('Live tour.')) return source;
      }
      return '';
    });
    expect(notice).toContain('Anatomy kit (https://github.com/wheresryan22/anatomy)');
    expect(notice).toContain('Copyright (c) 2026 Ryan');
    expect(notice).toContain('Permission is hereby granted, free of charge');
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

test.describe('google auth mode without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the landing page still shows the headline, the actions and Fig 1', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Every shared cost, worked out to the paisa.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Google' }).first()).toBeVisible();
    await expect(
      page
        .getByRole('figure', { name: 'The splitting line' })
        .getByRole('img', { name: /^A small production line on a bench that splits Expenses\./ }),
    ).toBeVisible();
    // The drawing at rest, with no live tour to step through.
    await expect(page.getByRole('figure', { name: 'The splitting line' })).toContainText(
      'Line idle · 3 Expenses waiting',
    );
    await expect(page.getByRole('group', { name: /^Live tour/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Pause|Play)$/ })).toHaveCount(0);
  });
});
