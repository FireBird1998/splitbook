import { expect, test, type TestInfo } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectedTheme,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  reviewScreenshot,
  themeSwitch,
} from './fixtures';

/**
 * Visual + accessibility matrix. Every project (desktop/mobile × light/dark)
 * renders persona entry, login, the invite page, dashboard, trip workspace,
 * and Settings; axe-core rejects serious/critical findings, with screenshots
 * for review.
 */

/** The brand kit's logo artwork for the project's theme (docs/design/brand). */
function logoArtwork(testInfo: TestInfo): string {
  return `/brand/logo-${expectedTheme(testInfo)}.svg`;
}

test('persona entry respects the project theme and is accessible', async ({ page }, testInfo) => {
  await page.goto('/');

  const logo = page.getByRole('img', { name: 'Splitbook', exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', logoArtwork(testInfo));
  // Browser tabs show the brand favicon, not the Next.js default.
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/brand/favicon.svg',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/brand/icon-180.png',
  );
  const favicon = await page.request.get('/brand/favicon.svg');
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()['content-type']).toContain('image/svg+xml');

  // Persona cards are keyboard-focusable buttons with accessible names.
  const alexCard = page.getByRole('button', { name: /Enter as Alex Rivera/ });
  await expect(alexCard).toBeVisible();
  await alexCard.focus();
  await expect(alexCard).toBeFocused();

  await expectThemeApplied(page, testInfo);
  await expectNoSeriousA11yViolations(page, testInfo, 'persona-entry');
  await reviewScreenshot(page, testInfo, 'persona-entry');
});

test('login respects the project theme and is accessible', async ({ page }, testInfo) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Continue as a demo persona' })).toBeVisible();
  await expectThemeApplied(page, testInfo);
  await expect(page.getByRole('img', { name: 'Splitbook', exact: true })).toHaveAttribute(
    'src',
    logoArtwork(testInfo),
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'login');
  await reviewScreenshot(page, testInfo, 'login');
});

test('the invite page respects the project theme and is accessible', async ({ page }, testInfo) => {
  // A synthetic invite: the preview read is public, so only its answer is fixed here.
  await page.route('**/api/join/synthetic-invite', (route) =>
    route.fulfill({
      json: {
        data: { name: 'Synthetic Lakeview Flat', category: 'home', memberCount: 3 },
        status: 200,
      },
    }),
  );
  await page.goto('/join/synthetic-invite');
  await expect(page.getByText('Synthetic Lakeview Flat')).toBeVisible();
  await expectThemeApplied(page, testInfo);

  const home = page.getByRole('banner').getByRole('link', { name: 'Splitbook home' });
  await expect(home).toHaveAttribute('href', '/');
  await expect(home.getByRole('img')).toHaveAttribute('src', logoArtwork(testInfo));
  // The card is the Group's own: its icon, name and member count, and no brand artwork.
  const card = page.getByRole('main');
  await expect(card.getByRole('img')).toHaveCount(0);
  await expect(card.getByText('3 members')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Sign in to Join' })).toBeVisible();
  await expect(
    card.getByText('Splitbook keeps a shared record of what the Group spends and who owes whom.'),
  ).toBeVisible();

  await expectNoSeriousA11yViolations(page, testInfo, 'invite');
  await reviewScreenshot(page, testInfo, 'invite');
});

test('dashboard respects the project theme and is accessible', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);

  const home = page.getByRole('link', { name: 'Splitbook home' });
  await expect(home).toHaveAttribute('href', '/dashboard');
  await expect(home.getByRole('img')).toHaveAttribute('src', logoArtwork(testInfo));
  // Home's top section (#306), loaded: the figures and the suggested payments.
  await expect(
    page.getByRole('region', { name: 'Your balances' }).getByText('Net', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Needs you' })
      .getByRole('link', { name: /^Record payment/ })
      .first(),
  ).toBeVisible();

  await expectNoSeriousA11yViolations(page, testInfo, 'dashboard');
  await reviewScreenshot(page, testInfo, 'dashboard');
});

test('trip workspace respects the project theme and is accessible', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}`);
  await expectThemeApplied(page, testInfo);

  // Trip strip + tab navigation render; the Balances tab is a link away.
  const sections = page.getByRole('navigation', { name: `${DEMO_TRIP_NAME} sections` });
  await expect(sections.getByRole('link', { name: 'Expenses' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await sections.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByText('Who pays whom')).toBeVisible();

  await expectNoSeriousA11yViolations(page, testInfo, 'trip-balances');
  await reviewScreenshot(page, testInfo, 'trip-balances');
});

test('Settings loaded and validation error states are accessible', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto('/settings');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Alex Rivera');
  await expect(page.getByText('✓ Active session', { exact: true })).toBeVisible();
  await expectThemeApplied(page, testInfo);
  await expectNoSeriousA11yViolations(page, testInfo, 'settings');
  await reviewScreenshot(page, testInfo, 'settings');

  await page.getByLabel('Name', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Name is required' })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expectNoSeriousA11yViolations(page, testInfo, 'settings-validation');
  await reviewScreenshot(page, testInfo, 'settings-validation');
});

test('theme toggle flips the document theme and persists', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');

  const initial = expectedTheme(testInfo);
  const target = initial === 'light' ? 'dark' : 'light';

  // In the top bar, or in the drawer on a narrow phone.
  const toggle = await themeSwitch(page);
  await expect(toggle).toHaveAccessibleName(`Switch to ${target} mode`);
  await toggle.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);
  await expect(toggle).toHaveAccessibleName(`Switch to ${initial} mode`);

  // Persists via localStorage across reloads.
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);

  await reviewScreenshot(page, testInfo, `toggled-${target}`);
});
