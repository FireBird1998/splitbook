import { enterAsPersona } from './fixtures';
import { test, expect } from '@playwright/test';

test('Join keeps one h1 through loading, invite, persona entry and error states', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/join/heading-invite', async (route) => {
    await held;
    await route.fulfill({
      json: { data: { name: 'Heading Trip', category: 'trip', memberCount: 2 } },
    });
  });
  await page.goto('/join/heading-invite');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Join Group' })).toBeAttached();
  release();
  await expect(page.getByRole('heading', { level: 1, name: /Heading Trip/ })).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  await page.getByRole('button', { name: 'Sign in to Join', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to join', exact: true }),
  ).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  await page.route('**/api/join/bad-heading-invite', (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.goto('/join/bad-heading-invite');
  await expect(page.getByRole('heading', { level: 1, name: 'Oops!' })).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText('...');
});

test('Join keeps the invite h1 while joining and after a refused join', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/join/heading-invite', async (route) => {
    if (route.request().method() === 'POST') {
      await held;
      await route.fulfill({ status: 403, json: { error: 'This invite has expired.' } });
    } else {
      await route.fulfill({
        json: { data: { name: 'Heading Trip', category: 'trip', memberCount: 2 } },
      });
    }
  });
  await page.goto('/join/heading-invite');
  await page.getByRole('button', { name: 'Join Group', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Heading Trip/ })).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  release();
  await expect(page.getByText('This invite has expired.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /Heading Trip/ })).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
});
