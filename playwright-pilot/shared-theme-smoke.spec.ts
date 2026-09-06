import { expect, test } from '@playwright/test';
import { DEMO_GROUP_ID, enterAsPersona } from '../playwright/fixtures';
import { group, installPilotFixtures } from './fixtures';

test('shared theme preserves Household header, Settings, and Recurring dialog', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installPilotFixtures(page, {
    [`/api/groups/${DEMO_GROUP_ID}`]: { ...group, category: 'home' },
    [`/api/groups/${DEMO_GROUP_ID}/recurring`]: [],
  });
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}`);
  await expect(page.getByRole('region', { name: /Goa Friends Trip, Household/ })).toBeVisible();
  await page.goto(`/groups/${DEMO_GROUP_ID}/settings`);
  await expect(page.getByRole('heading', { name: 'Group Settings' })).toBeVisible();
  await expect(page.getByText('Recurring', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add recurring expense' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Description', { exact: false }).fill('Synthetic rent example');
  await testInfo.attach('recurring-dialog', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Alex Rivera');
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  await testInfo.attach('settings', { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});
