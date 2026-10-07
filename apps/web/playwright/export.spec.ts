import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { EXPENSE_COLUMNS, PAYMENT_COLUMNS } from '@splitbook/shared/export-csv';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  openNavigation,
  reviewScreenshot,
} from './fixtures';

/**
 * The Export page (#317) on the seeded demo data: open it from the sidebar and from a Group's
 * header, pick Groups and a period, and download a CSV and a zip, then read what they hold.
 */

const BOM = '﻿';
/** How many Groups the persona is in now: the seeded ones, and any a journey before added. */
async function groupCount(page: Page) {
  const response = await page.request.get('/api/groups');
  expect(response.status()).toBe(200);
  return ((await response.json()).data as unknown[]).length;
}

/** A CSV's header row, read as a spreadsheet would. */
const headerOf = (text: string) => text.slice(BOM.length, text.indexOf('\r\n')).split(',');

async function download(page: Page) {
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  return started;
}

/** The month the page calls "this month", on the browser's calendar, as a file name has it. */
const thisMonth = (page: Page) =>
  page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

test('from the sidebar: pick one Group and all time, and download its Expenses as a CSV', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const navigation = await openNavigation(page);
  await navigation.getByRole('link', { name: 'Export', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/export');
  await expect(page.getByRole('heading', { level: 1, name: 'Export' })).toBeVisible();

  // Opened from the sidebar, every Group is picked.
  const groups = page.getByRole('group', { name: 'Groups' });
  await expect(groups.getByRole('checkbox')).toHaveCount(await groupCount(page));
  for (const box of await groups.getByRole('checkbox').all()) await expect(box).toBeChecked();

  // Nothing picked: the page says so and won't download.
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.locator('#export-file')).toHaveText('Pick at least one Group.');
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  await expect(page.getByText('Nothing to export yet')).toBeVisible();

  await groups.getByRole('checkbox', { name: new RegExp(DEMO_TRIP_NAME) }).check();
  await page.getByLabel('Period').selectOption('all');
  const include = page.getByRole('group', { name: 'Include' });
  await include.getByRole('checkbox', { name: 'Payments' }).uncheck();
  await expect(page.locator('#export-file')).toHaveText(
    'goa-friends-trip-all-time-expenses.csv · 1 CSV file',
  );

  await expectThemeApplied(page, testInfo);
  await expectNoSeriousA11yViolations(page, testInfo, 'export');
  await reviewScreenshot(page, testInfo, 'export');

  const file = await download(page);
  expect(file.suggestedFilename()).toBe('goa-friends-trip-all-time-expenses.csv');
  const text = await readFile((await file.path())!, 'utf8');
  expect(text.startsWith(BOM)).toBe(true);
  expect(headerOf(text)).toEqual([
    ...EXPENSE_COLUMNS,
    'Alex Rivera share',
    'Sam Chen share',
    'Priya Shah share',
  ]);
  expect(text).toContain('Beachside villa (3 nights),');
  expect(text).toMatch(/,INR,/);
  // People by name, never by email.
  expect(text).toContain('Alex Rivera');
  expect(text).not.toMatch(/@|splitbook\.local/);

  await expect(page.getByRole('status').filter({ hasText: 'is downloading' })).toHaveText(
    /goa-friends-trip-all-time-expenses\.csv\s*is downloading\./,
  );
});

test('several files download as one zip, named for the Groups and the period', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto('/export');
  const count = await groupCount(page);
  const groups = page.getByRole('group', { name: 'Groups' });
  await expect(groups.getByRole('checkbox')).toHaveCount(count);
  await page.getByLabel('Period').selectOption('this');
  const month = await thisMonth(page);
  const include = page.getByRole('group', { name: 'Include' });
  await include.getByRole('checkbox', { name: 'Edit history' }).check();
  await include.getByRole('checkbox', { name: 'Deleted Expenses' }).check();
  await expect(page.locator('#export-file')).toHaveText(
    `splitbook-${count}-groups-${month}.zip · ${count * 2} CSV files in a .zip`,
  );

  const file = await download(page);
  expect(file.suggestedFilename()).toBe(`splitbook-${count}-groups-${month}.zip`);
  const entries = unzipSync(await readFile((await file.path())!));
  const names = Object.keys(entries);
  expect(names).toHaveLength(count * 2);
  expect(names).toContain(`goa-friends-trip-${month}-expenses.csv`);
  expect(names).toContain(`goa-friends-trip-${month}-payments.csv`);
  for (const name of names) {
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(entries[name]);
    expect(text.startsWith(BOM), name).toBe(true);
    expect(text, name).not.toMatch(/@|splitbook\.local/);
    if (name.endsWith('-payments.csv')) expect(headerOf(text)).toEqual([...PAYMENT_COLUMNS]);
    else
      expect(headerOf(text).slice(-5)).toEqual([
        'Deleted at',
        'Deleted by',
        'Edited at',
        'Edited by',
        'Change',
      ]);
  }
  await expect(page.getByRole('status').filter({ hasText: 'is downloading' })).toBeVisible();
});

test('a Group header’s Export opens the page with that Group picked', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: DEMO_TRIP_NAME })).toBeVisible();
  await main.getByRole('link', { name: 'Export', exact: true }).click();
  await page.waitForURL(
    (url) => url.pathname === '/export' && url.searchParams.get('group') === DEMO_GROUP_ID,
  );

  const groups = page.getByRole('group', { name: 'Groups' });
  await expect(groups.getByRole('checkbox')).toHaveCount(await groupCount(page));
  await expect(groups.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await expect(groups.getByRole('checkbox', { name: new RegExp(DEMO_TRIP_NAME) })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Select all' })).toBeVisible();
});
