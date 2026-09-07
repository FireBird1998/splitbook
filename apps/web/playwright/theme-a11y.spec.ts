import { expect, test } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  enterAsPersona,
  expectedTheme,
  expectNoCriticalA11yViolations,
  expectThemeApplied,
  reviewScreenshot,
} from './fixtures';

/**
 * Visual + accessibility matrix. Every project (desktop/mobile × light/dark)
 * renders the persona entry, dashboard, and trip workspace; axe-core checks
 * for critical violations and screenshots are saved for design review.
 */

test('persona entry respects the project theme and is accessible', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect(page.getByText('Splitbook', { exact: true })).toBeVisible();

  // Persona cards are keyboard-focusable buttons with accessible names.
  const alexCard = page.getByRole('button', { name: /Enter as Alex Rivera/ });
  await expect(alexCard).toBeVisible();
  await alexCard.focus();
  await expect(alexCard).toBeFocused();

  await expectThemeApplied(page, testInfo);
  await expectNoCriticalA11yViolations(page, testInfo, 'persona-entry');
  await reviewScreenshot(page, testInfo, 'persona-entry');
});

test('dashboard respects the project theme and is accessible', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);

  await expect(page.getByText('Splitbook', { exact: true })).toBeVisible();
  await expect(page.getByText('Current balance')).toBeVisible();
  await expect(page.getByText('Next best action')).toBeVisible();

  await expectNoCriticalA11yViolations(page, testInfo, 'dashboard');
  await reviewScreenshot(page, testInfo, 'dashboard');
});

test('trip workspace respects the project theme and is accessible', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}`);
  await expectThemeApplied(page, testInfo);

  // Trip strip + tab navigation render; balances tab is reachable.
  await expect(page.getByRole('tab', { name: 'Expenses' })).toBeVisible();
  await page.getByRole('tab', { name: 'Balances' }).click();
  await expect(page.getByText('Who pays whom')).toBeVisible();

  await expectNoCriticalA11yViolations(page, testInfo, 'trip-balances');
  await reviewScreenshot(page, testInfo, 'trip-balances');
});

test('theme toggle flips the document theme and persists', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');

  const initial = expectedTheme(testInfo);
  const target = initial === 'light' ? 'dark' : 'light';

  await page.getByRole('button', { name: `Switch to ${target} mode` }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);
  await expect(page.getByRole('button', { name: `Switch to ${initial} mode` })).toBeVisible();

  // Persists via localStorage across reloads.
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);

  await reviewScreenshot(page, testInfo, `toggled-${target}`);
});
