/** Throwaway #715: the scope experiment must preserve the existing browser contract. */
import { expect, test, type Page } from '@playwright/test';
import { DEMO_GROUP_ID, enterAsPersona, isPhone } from './fixtures';

const expenses = `/groups/${DEMO_GROUP_ID}/expenses`;
const addDialog = (page: Page) => page.getByRole('dialog', { name: /^Add expense/ });
const searchDialog = (page: Page) => page.getByRole('dialog', { name: 'Search', exact: true });
const setting = (page: Page) => page.getByRole('switch', { name: 'Single-key shortcuts' });
async function globalN(page: Page) {
  return page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test('nested MUI menu and search restore outer suspension and finally page shortcuts', async ({
  page,
}, info) => {
  await enterAsPersona(page, 'alex');
  await page.goto(expenses);
  if (isPhone(info)) await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const account = page.getByRole('button', { name: /Alex Rivera, account menu/ });
  await account.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  expect(await globalN(page)).toBe(false);
  await expect(addDialog(page)).toBeHidden();
  await page.getByRole('menuitem', { name: 'Settings' }).focus();
  await page.keyboard.press('Control+k');
  await expect(searchDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(searchDialog(page)).toBeHidden();
  await expect(menu).toBeVisible();
  expect(await globalN(page)).toBe(false);
  await expect(addDialog(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  if (isPhone(info)) {
    expect(await globalN(page)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(account).toBeHidden();
  }
  // Wait for MUI's exit lifecycle, not only the disappearing accessible role.
  await expect(page.locator('.MuiModal-root:not(.MuiModal-hidden)')).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('n');
  await expect(addDialog(page)).toBeVisible();
});

test('another tab updates the member preference without disabling global search', async ({
  page,
  context,
}) => {
  await enterAsPersona(page, 'alex');
  await page.goto('/settings');
  await expect(setting(page)).toBeChecked();
  await setting(page).uncheck();
  await setting(page).check();
  const key = await page.evaluate(
    () =>
      Object.keys(localStorage).find((key) => key.startsWith('splitbook:single-key-shortcuts:'))!,
  );
  expect(key).toBeTruthy();
  const other = await context.newPage();
  try {
    await other.goto('/settings');
    await other.evaluate((key) => localStorage.setItem(key, 'off'), key);
    await expect(setting(page)).not.toBeChecked();
    expect(await globalN(page)).toBe(false);
    await page.keyboard.press('Control+k');
    await expect(searchDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(searchDialog(page)).toBeHidden();
    await other.evaluate((key) => localStorage.setItem(key, 'on'), key);
    await expect(setting(page)).toBeChecked();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('n');
    await expect(page.getByRole('dialog', { name: 'Choose a Group' })).toBeVisible();
  } finally {
    await other.close();
  }
});

test('an Expenses read failure keeps slash on the same page and focuses its existing search', async ({
  page,
}) => {
  await enterAsPersona(page, 'alex');
  await page.route(`**/api/groups/${DEMO_GROUP_ID}/expenses*`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporary fictional read failure' }),
    }),
  );
  await page.goto(expenses);
  await expect(page.getByText('Expenses could not be loaded.', { exact: true })).toBeVisible();
  const retry = page.getByRole('button', { name: 'Try again', exact: true }).first();
  await retry.focus();
  const before = page.url();
  await page.keyboard.press('/');
  await expect(page).toHaveURL(before);
  await expect(page.getByRole('searchbox', { name: /^Search Expenses in / })).toBeFocused();
  await expect(searchDialog(page)).toBeHidden();
});
