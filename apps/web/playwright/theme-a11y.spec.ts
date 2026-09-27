import { expect, test } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  enterAsPersona,
  expectedTheme,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  reviewScreenshot,
} from './fixtures';

/**
 * Visual + accessibility matrix. Every project (desktop/mobile × light/dark)
 * renders persona entry, login, dashboard, trip workspace, and Settings;
 * axe-core rejects serious/critical findings, with screenshots for review.
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
  await expectNoSeriousA11yViolations(page, testInfo, 'persona-entry');
  await reviewScreenshot(page, testInfo, 'persona-entry');
});

test('login respects the project theme and is accessible', async ({ page }, testInfo) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Continue as a demo persona' })).toBeVisible();
  await expectThemeApplied(page, testInfo);
  await expectNoSeriousA11yViolations(page, testInfo, 'login');
  await reviewScreenshot(page, testInfo, 'login');
});

test('dashboard respects the project theme and is accessible', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);

  await expect(page.getByText('Splitbook', { exact: true })).toBeVisible();
  await expect(page.getByText('Current balance')).toBeVisible();
  await expect(page.getByText('Next best action')).toBeVisible();

  await expectNoSeriousA11yViolations(page, testInfo, 'dashboard');
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

  await page.getByRole('button', { name: `Switch to ${target} mode` }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);
  await expect(page.getByRole('button', { name: `Switch to ${initial} mode` })).toBeVisible();

  // Persists via localStorage across reloads.
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);

  await reviewScreenshot(page, testInfo, `toggled-${target}`);
});
