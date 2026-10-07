import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { backupSchema } from '@splitbook/shared/export-backup';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  reviewScreenshot,
} from './fixtures';

test('JSON backup downloads all time, round-trips and has no emails', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/export?group=${DEMO_GROUP_ID}`);
  await page.getByRole('checkbox', { name: 'Shares' }).uncheck();
  await page.getByLabel('Format', { exact: true }).selectOption('json');
  await expect(page.getByRole('checkbox', { name: 'Shares' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Shares' })).toBeDisabled();
  await expect(page.getByLabel('Period', { exact: true })).toHaveValue('all');
  await expect(page.getByLabel('Period', { exact: true })).toBeDisabled();
  await expectNoSeriousA11yViolations(page, testInfo, 'backup');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON backup' }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe('splitbook-1-groups-backup.json');
  const text = await readFile((await file.path())!, 'utf8');
  const backup = backupSchema.parse(JSON.parse(text));
  expect(backup.format).toBe('splitbook-backup/1');
  expect(backup.groups).toHaveLength(1);
  expect(backup.groups[0].id).toBe(DEMO_GROUP_ID);
  expect(backup.groups[0].expenses.length).toBeGreaterThan(0);
  expect(text).not.toMatch(/email|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  await reviewScreenshot(page, testInfo, 'json-backup');
});

test('Export opens one Group’s printable statement with named sections in both themes', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/export?group=${DEMO_GROUP_ID}`);
  await page.getByLabel('Format', { exact: true }).selectOption('statement');
  await page.getByLabel('Period', { exact: true }).selectOption('all');
  await page.getByRole('link', { name: 'Open statement' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${DEMO_TRIP_NAME} · Statement`);
  for (const title of [
    'Summary',
    'Paid, Share and Net',
    'Balances and suggested payments',
    'Expenses with shares',
    'Payments by date',
  ]) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  const statement = page.locator('.statement-paper');
  await expect(statement).toContainText('Alex Rivera');
  await expect(statement).toContainText('Beachside villa');
  expect(await statement.innerText()).not.toMatch(/\bYou\b/);
  await expectNoSeriousA11yViolations(page, testInfo, 'statement');
  await reviewScreenshot(page, testInfo, 'statement-screen');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  await expect(page.locator('aside')).toBeHidden();
  expect(await statement.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );
  await reviewScreenshot(page, testInfo, 'statement-print');
});
