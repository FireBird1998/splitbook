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
