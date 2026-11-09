import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../playwright/fixtures';

/**
 * The landing page where Connected assistants are live and can prepare items for To review
 * (#450), on playwright.google-assistants.config.ts's server. With them off, the auth suite's
 * landing tests check the section is absent.
 */

const section = (page: Page) => page.locator('#assistants');
const rack = (page: Page) => page.locator('[data-quiet-figure="to-review-rack"]');

test('the hero and the top bar lead to Connected assistants, with Fig 2 and what an assistant can do', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Splitbook' }).getByRole('link', { name: 'Assistants' }),
  ).toHaveAttribute('href', '#assistants');
  await page.getByRole('link', { name: 'Use Claude or ChatGPT? Connect Splitbook' }).click();
  await expect(page).toHaveURL(/#assistants$/);
  await expect(
    section(page).getByRole('heading', {
      level: 2,
      name: 'Talk to your Groups in Claude or ChatGPT.',
    }),
  ).toBeInViewport();
  // Splitbook never moves money; what an assistant prepares waits for the member (owner copy).
  await expect(section(page)).toContainText('Nothing is saved until you say so.');
  await expect(section(page)).not.toContainText('money only moves');

  for (const step of ['Ask, or tell it what you spent', 'Review and save'])
    await expect(section(page).getByRole('listitem').filter({ hasText: step })).toBeVisible();
  for (const name of [
    'Ask about your money',
    'Tell it what you spent',
    'You save, never the assistant',
    'Stay in control',
  ])
    await expect(section(page).getByRole('heading', { level: 3, name })).toBeVisible();
  await expect(section(page).getByRole('link', { name: 'How to connect ChatGPT' })).toHaveAttribute(
    'href',
    '/connect/chatgpt',
  );
  await expect(rack(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(rack(page).locator('[data-stage] svg')).toBeVisible();

  await expectNoSeriousA11yViolations(page, testInfo, 'landing-assistants-desktop-light');
});

test('the assistants section fits a phone without sideways scroll, in dark', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#assistants');
  await expect(section(page).getByRole('heading', { level: 2 })).toBeVisible();
  await rack(page).scrollIntoViewIfNeeded();
  await expect(rack(page).locator('[data-stage] svg')).toBeVisible();
  await expect(rack(page).locator('.iso')).toHaveCSS('--anatomy-paper', '#141720');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await expectNoSeriousA11yViolations(page, testInfo, 'landing-assistants-phone-dark');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the assistants copy and quiet rack still render', async ({ page }) => {
    await page.goto('/#assistants');
    await expect(section(page).getByRole('heading', { level: 2 })).toBeVisible();
    await expect(rack(page).locator('[data-stage] svg')).toBeVisible();
    await expect(rack(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByRole('button', { name: /animation$/ })).toHaveCount(0);
  });
});
