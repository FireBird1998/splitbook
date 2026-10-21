import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { expectThemeApplied } from '../playwright/fixtures';

test('feedback visual baseline protects error and recovered states', async ({ page }, testInfo) => {
  expect(
    process.platform === 'linux' || Boolean(process.env.DESIGN_BROWSER_WS),
    'Visual baselines require the documented Linux browser.',
  ).toBe(true);
  await page.goto('/dev/design-system');
  await expectThemeApplied(page, testInfo);
  await page.evaluate(() => document.fonts.ready);
  const feedback = page.getByRole('region', { name: 'Feedback states' });
  await expect(feedback).toHaveScreenshot('feedback-error.png', { animations: 'disabled' });
  await feedback.getByRole('button', { name: 'Retry sample' }).click();
  await expect(feedback.getByRole('status')).toContainText('Sample balances loaded.');
  await expect(feedback).toHaveScreenshot('feedback-recovered.png', { animations: 'disabled' });
});

// #772: each standard banner takes its status tint, also in dark mode, where MUI's own was near
// black.
test('banners visual baseline shows each severity on its status tint', async ({
  page,
}, testInfo) => {
  expect(
    process.platform === 'linux' || Boolean(process.env.DESIGN_BROWSER_WS),
    'Visual baselines require the documented Linux browser.',
  ).toBe(true);
  await page.goto('/dev/design-system');
  await expectThemeApplied(page, testInfo);
  await page.evaluate(() => document.fonts.ready);
  const banners = page.getByRole('region', { name: 'Banners' });
  await expect(banners.getByRole('alert')).toHaveCount(4);
  await expect(banners).toHaveScreenshot('banners.png', { animations: 'disabled' });
});

test('catalogue renders with no auth, database, or application API requests', async ({
  page,
}, testInfo) => {
  const apiRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', async (route) => {
    apiRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto('/dev/design-system');
  await expect(
    page.getByRole('heading', { name: 'Splitbook design system', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('You owe', { exact: true })).toBeVisible();
  await expectThemeApplied(page, testInfo);
  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('catalogue has no serious accessibility findings or narrow-screen overflow', async ({
  page,
}, testInfo) => {
  await page.goto('/dev/design-system');
  await expectThemeApplied(page, testInfo);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => ({ id: v.id, nodes: v.nodes.map((node) => node.failureSummary) })),
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('catalogue.png'), fullPage: true });
});

test('shared feedback recovers locally and resets on reload', async ({ page }) => {
  await page.goto('/dev/design-system');
  const example = page.getByRole('region', { name: 'Feedback states' });
  await expect(example.getByRole('alert')).toContainText('Sample balances could not be loaded.');
  await example.getByRole('button', { name: 'Retry sample' }).click();
  await expect(example.getByRole('status')).toContainText('Sample balances loaded.');
  await expect(example.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(example.getByRole('alert')).toBeVisible();
});

test('catalogue demonstrates money, controls, empty and loading states in either theme', async ({
  page,
}) => {
  await page.goto('/dev/design-system');
  const money = page.getByRole('region', { name: 'Money and typography' });
  await expect(money.getByText('₹1,480.00', { exact: true })).toBeVisible();
  await expect(money.getByText('₹0.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No sample expenses yet' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading sample expenses' })).toBeVisible();
  await page.getByLabel('Sample expense name').fill('Train tickets');
  await expect(page.getByRole('button', { name: 'Unavailable action' })).toBeDisabled();
  const initial = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: /^Switch to (light|dark) mode$/ }).click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    initial === 'dark' ? 'light' : 'dark',
  );
});

test('a text field focused by click or Tab draws only its own border, an errored one a ring around it; an icon button keeps the ring (#823)', async ({
  page,
}) => {
  await page.goto('/dev/design-system');
  const field = page.getByLabel('Sample expense name');
  await field.click();
  await expect(field).toBeFocused();
  // In Chromium a clicked text field matches :focus-visible too, so the ring showed on a click.
  expect(await field.evaluate((input) => input.matches(':focus-visible'))).toBe(true);
  await expect(field).toHaveCSS('box-shadow', 'none');
  // From the keyboard: back out to the field before it, and Tab in again.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS('box-shadow', 'none');
  // The field itself draws no ring either: its focused border shows focus.
  const fieldRoot = field.locator(
    'xpath=ancestor::div[contains(@class,"MuiOutlinedInput-root")][1]',
  );
  await expect(fieldRoot).toHaveCSS('box-shadow', 'none');
  // An errored field's border is red already, so the ring goes around the whole field.
  const errored = page.getByLabel('Amount with an error');
  await page.keyboard.press('Tab');
  await expect(errored).toBeFocused();
  await expect(errored).toHaveCSS('box-shadow', 'none');
  await expect(
    errored.locator('xpath=ancestor::div[contains(@class,"MuiOutlinedInput-root")][1]'),
  ).toHaveCSS('box-shadow', /4px/);
  // On to the icon button, which keeps the theme's ring.
  const iconButton = page.getByRole('button', { name: /^Switch to (light|dark) mode using icon$/ });
  for (let press = 0; press < 8; press++) {
    if (await iconButton.evaluate((button) => button === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(iconButton).toBeFocused();
  await expect(iconButton).toHaveCSS('box-shadow', /4px/);
});

test('a contained, icon, tonal and text button and a chip focused by Tab show the ring (#830)', async ({
  page,
}) => {
  await page.goto('/dev/design-system');
  await page.getByLabel('Amount with an error').click();
  for (const name of [
    'Reset feedback example',
    /^Switch to (light|dark) mode using icon$/,
    'Sample tonal action',
    'Sample text action',
    'Sample filter',
  ]) {
    const control = page.getByRole('button', { name, exact: true });
    for (let press = 0; press < 10; press++) {
      if (await control.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(control, String(name)).toBeFocused();
    await expect(control, String(name)).toHaveCSS('outline-style', 'solid');
    await expect(control, String(name)).toHaveCSS('outline-width', '2px');
    await expect(control, String(name)).toHaveCSS('box-shadow', /4px/);
  }
});

test('a mouse click on a button, toggle button or chip draws no ring; Tab does (#830)', async ({
  page,
}) => {
  await page.goto('/dev/design-system');
  for (const name of ['Reset feedback example', 'Sample toggle', 'Sample filter']) {
    const control = page.getByRole('button', { name, exact: true });
    await control.click();
    await expect(control, name).toBeFocused();
    await expect(control, name).toHaveCSS('outline-style', 'none');
    // Out and back in from the keyboard, the same control draws the ring.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(control, name).toBeFocused();
    await expect(control, name).toHaveCSS('outline-style', 'solid');
  }
});
