import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  isPhone,
  openNavigation,
  reviewScreenshot,
} from './fixtures';

/**
 * The shell from the design canvas (#303): a full-height sidebar on desktop and, on phones, a
 * drawer opened from the top bar, each with the logo, Home, the member's Groups with their
 * balances, Settings and the account. Journeys elsewhere change balances, so figures are
 * compared with the balances read rather than assumed.
 */

const tripRow = (navigation: Locator) =>
  navigation
    .getByRole('navigation', { name: 'Your Groups' })
    .getByRole('link', { name: new RegExp(`^${DEMO_TRIP_NAME} `) });

/** The trip's balance line as the sidebar should word it, from the member's balances read. */
async function expectedTripLine(page: Page): Promise<string> {
  const response = await page.request.get('/api/user/balances');
  expect(response.ok()).toBe(true);
  const { data } = await response.json();
  const trip = data.groups.find((group: { groupId: string }) => group.groupId === DEMO_GROUP_ID);
  const open = trip.balances.filter((item: { balance: number }) => item.balance !== 0);
  if (open.length === 0) return 'Settled up';
  const { balance } = open.find((item: { currency: string }) => item.currency === 'INR') ?? open[0];
  const amount = `₹${Math.abs(balance).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return balance < 0 ? `you owe ${amount}` : `owed ${amount}`;
}

test('desktop: a full-height sidebar holds the logo, Home, the live Group list and the account', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'Phones get the drawer instead.');
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);

  const sidebar = page.getByRole('complementary', { name: 'Splitbook' });
  const bounds = await sidebar.boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, width: 248 });
  expect(bounds!.height).toBeGreaterThanOrEqual(page.viewportSize()!.height);
  // Full height: the logo, the account and the top bar stay in view down the page.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(sidebar.getByRole('link', { name: 'Splitbook home' })).toBeInViewport();
  await expect(sidebar.getByRole('button', { name: 'Alex Rivera, account menu' })).toBeInViewport();
  await expect(page.getByRole('banner')).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(sidebar.getByRole('link', { name: 'Splitbook home' })).toHaveAttribute(
    'href',
    '/dashboard',
  );
  const main = sidebar.getByRole('navigation', { name: 'Main' });
  await expect(main.getByRole('link')).toHaveText(['Home']);
  await expect(main.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.getByText(/Dashboard|Receipts|Export/)).toHaveCount(0);

  // The seeded trip, with its Theme's line icon and Alex's balance, exactly as the read has it.
  const trip = tripRow(sidebar);
  await expect(trip).toHaveAccessibleName(`${DEMO_TRIP_NAME} ${await expectedTripLine(page)}`);
  await expect(trip.locator('[data-group-theme="trip"]')).toHaveCount(1);
  await expect(sidebar.getByRole('link', { name: 'New Group' })).toHaveAttribute(
    'href',
    '/groups/new',
  );
  await expect(sidebar.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Alex Rivera, account menu' })).toBeVisible();

  // The top bar sits in the main column, beside the sidebar, with the theme switch.
  const header = page.getByRole('banner');
  expect((await header.boundingBox())!.x).toBe(248);
  await expect(header.getByRole('button', { name: /^Switch to (dark|light) mode$/ })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Splitbook home' })).toBeHidden();
  await expectNoSeriousA11yViolations(page, testInfo, 'shell-home');

  // The open Group is highlighted, and Home no longer is.
  await trip.click();
  await page.waitForURL((url) => url.pathname === `/groups/${DEMO_GROUP_ID}`);
  await expect(trip).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  // Axe runs on the Balances tab, as the trip workspace check in theme-a11y does: the
  // Expenses tab's cards carry their own findings, which the Group page rewrite (#305) owns.
  await page.getByRole('main').getByRole('tab', { name: 'Balances' }).click();
  await expect(page.getByRole('main').getByText('Who pays whom')).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, 'shell-group');
  await reviewScreenshot(page, testInfo, 'shell-group');
});

test('desktop: the Groups list page leaves the main navigation but stays a link away', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'Phones get the drawer instead.');
  await enterAsPersona(page, 'alex');
  const sidebar = page.getByRole('complementary', { name: 'Splitbook' });
  await sidebar.getByRole('link', { name: 'Groups', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/groups');
  await expect(sidebar.getByRole('link', { name: 'Groups', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page.getByRole('main').getByRole('link', { name: 'New Group' }).first(),
  ).toBeVisible();
  await sidebar.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/settings');
  await expect(sidebar.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('phone: the drawer opens from the top bar with the same items, traps focus and closes on navigation', async ({
  page,
}, testInfo) => {
  test.skip(!isPhone(testInfo), 'Desktop keeps the sidebar open.');
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);

  await expect(page.getByRole('complementary', { name: 'Splitbook' })).toHaveCount(0);
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Splitbook home' })).toBeVisible();
  const menu = header.getByRole('button', { name: 'Open navigation menu' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await reviewScreenshot(page, testInfo, 'shell-drawer-closed');

  const drawer = await openNavigation(page);
  // The open drawer hides the page behind it from assistive technology, its button included.
  await expect(page.locator('header button[aria-label="Open navigation menu"]')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(
    drawer.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }),
  ).toHaveAttribute('aria-current', 'page');
  const trip = tripRow(drawer);
  await expect(trip).toHaveAccessibleName(`${DEMO_TRIP_NAME} ${await expectedTripLine(page)}`);
  await expect(drawer.getByRole('link', { name: 'New Group' })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Alex Rivera, account menu' })).toBeVisible();
  // Every target in the drawer is at least 44 px high.
  for (const target of await drawer.locator('a, button').all()) {
    const box = await target.boundingBox();
    expect(
      box!.height,
      await target.evaluate((element) => element.outerHTML.slice(0, 80)),
    ).toBeGreaterThanOrEqual(44);
  }
  // Focus moves into the drawer and stays there.
  const focusInside = () => drawer.evaluate((element) => element.contains(document.activeElement));
  await expect.poll(focusInside).toBe(true);
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press('Tab');
    expect(await focusInside()).toBe(true);
  }
  await expectNoSeriousA11yViolations(page, testInfo, 'shell-drawer');
  await reviewScreenshot(page, testInfo, 'shell-drawer-open');

  // Escape closes it and hands focus back to the menu button.
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(menu).toBeFocused();

  // Following a link closes it; the open Group is then the highlighted one.
  await openNavigation(page);
  await tripRow(drawer).click();
  await page.waitForURL((url) => url.pathname === `/groups/${DEMO_GROUP_ID}`);
  await expect(drawer).toHaveCount(0);
  // Axe below runs over the Balances tab, as in the desktop journey.
  await page.getByRole('main').getByRole('tab', { name: 'Balances' }).click();
  await expect(page.getByRole('main').getByText('Who pays whom')).toBeVisible();
  await openNavigation(page);
  await expect(tripRow(drawer)).toHaveAttribute('aria-current', 'page');
  await expect(
    drawer.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }),
  ).not.toHaveAttribute('aria-current');
  await expectNoSeriousA11yViolations(page, testInfo, 'shell-drawer-group');
  await drawer.getByRole('button', { name: 'Close navigation menu' }).click();
  await expect(drawer).toHaveCount(0);
});

test('sign out from the account at the foot of the sidebar', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  const navigation = await openNavigation(page);
  await navigation.getByRole('button', { name: 'Alex Rivera, account menu' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('Alex Rivera');
  await expect(menu.getByRole('menuitem')).toHaveText(['Settings', 'Sign Out']);
  await menu.getByRole('menuitem', { name: 'Sign Out' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('button', { name: 'Enter as Alex Rivera' })).toBeVisible();
  // Signed out for real: the app sends the visitor back to sign in.
  await page.goto('/dashboard');
  await page.waitForURL((url) => url.pathname === '/login');
});
