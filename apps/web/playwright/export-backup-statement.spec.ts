import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { backupSchema } from '@splitbook/shared/export-backup';
import { statementPath } from '@splitbook/shared/statement-request';
import { DEMO_WEEK_TRIP_ID, DEMO_WORK_GROUP_ID } from '../src/lib/demo-personas';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  reviewScreenshot,
} from './fixtures';

/** Every section a statement has, in order. */
const SECTIONS = [
  'Summary',
  'Paid, Share and Net',
  'Balances and suggested payments',
  'Expenses with shares',
  'Payments by date',
];

/** The seeded six-day Trip (#316), Kochi to Alleppey: Alex, Sam and Priya. */
const WEEK_TRIP_NAME = 'Kochi to Alleppey';

const viewerTimeZone = (page: Page) =>
  page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

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
  for (const title of SECTIONS) {
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

test('a Trip’s Share wrap-up opens its whole-trip statement, with every section', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_WEEK_TRIP_ID}/insights`);
  await expectThemeApplied(page, testInfo);
  const timeZone = await viewerTimeZone(page);
  const wrapUp = page.getByRole('main').getByRole('region', { name: 'Trip wrap-up' });
  const share = wrapUp.getByRole('link', { name: 'Share wrap-up' });
  await expect(share).toBeVisible({ timeout: 30_000 });
  // The whole trip, in the viewer's own zone; a read any member may open, in the same tab.
  await expect(share).toHaveAttribute(
    'href',
    statementPath(DEMO_WEEK_TRIP_ID, { timeZone, wholeTrip: true }),
  );
  await expect(share).not.toHaveAttribute('target', /.+/);
  await expectNoSeriousA11yViolations(page, testInfo, 'trip-wrap-up');
  await reviewScreenshot(page, testInfo, 'trip-wrap-up');

  // What the wrap-up suggests, from the Trip summary read the tab makes.
  const summary = await page.request.get(
    `/api/groups/${DEMO_WEEK_TRIP_ID}/trip-summary?tz=${encodeURIComponent(timeZone)}`,
  );
  expect(summary.ok(), await summary.text()).toBe(true);
  const { suggestedPayments } = (await summary.json()).data as {
    suggestedPayments: { from: { name: string }; to: { name: string } }[];
  };
  const group = await page.request.get(`/api/groups/${DEMO_WEEK_TRIP_ID}`);
  const { startDate, endDate } = (await group.json()).data as {
    startDate: string;
    endDate: string;
  };

  await share.click();
  await page.waitForURL((url) => url.pathname === `/groups/${DEMO_WEEK_TRIP_ID}/statement`);
  const address = new URL(page.url()).searchParams;
  expect([address.get('scope'), address.get('tz')]).toEqual(['trip', timeZone]);
  await expectThemeApplied(page, testInfo);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${WEEK_TRIP_NAME} · Statement`);
  const statement = page.locator('.statement-paper');
  // The Trip's own dates, as stored calendar days, and what the whole trip covers.
  await expect(statement).toContainText(
    `${startDate.slice(0, 10)} – ${endDate.slice(0, 10)} · INR · ${timeZone}`,
  );
  await expect(statement).toContainText(
    'Whole trip, including Expenses before and after the Trip’s dates.',
  );
  for (const title of SECTIONS)
    await expect(statement.getByRole('heading', { name: title, exact: true })).toBeVisible();
  for (const name of ['Alex Rivera', 'Sam Chen', 'Priya Shah'])
    await expect(statement).toContainText(name);
  await expect(statement).toContainText('Alleppey houseboat (overnight, all meals)');
  const payments = statement.getByRole('region', { name: 'Payments by date' });
  await expect(payments).toContainText(
    'Every recorded payment, including those before and after the trip.',
  );
  const postTripPayment = payments.getByRole('row').filter({ hasText: 'After the trip' });
  await expect(postTripPayment).toHaveCount(1);
  await expect(postTripPayment.getByRole('cell').nth(1)).toHaveText('Alex Rivera');
  await expect(postTripPayment.getByRole('cell').nth(2)).toHaveText('Sam Chen');
  await expect(postTripPayment.getByRole('cell').nth(3)).toHaveText('₹4,000.00');
  await expect(postTripPayment.getByRole('cell').nth(5)).toHaveText('Alex Rivera');
  await payments.screenshot({
    path: `playwright/artifacts/${testInfo.project.name}/trip-statement-payments.png`,
  });
  // The same payments the wrap-up suggests, everyone by name.
  const suggestions = statement
    .getByRole('region', { name: 'Balances and suggested payments' })
    .getByRole('listitem');
  await expect(suggestions).toHaveCount(suggestedPayments.length);
  for (const payment of suggestedPayments)
    await expect(
      suggestions.filter({ hasText: `${payment.from.name} pays ${payment.to.name}` }),
    ).toHaveCount(1);
  expect(await statement.innerText()).not.toMatch(/\bYou\b/);
  await expectNoSeriousA11yViolations(page, testInfo, 'trip-statement');
  await reviewScreenshot(page, testInfo, 'trip-statement-screen');

  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  await expect(page.locator('aside')).toBeHidden();
  await reviewScreenshot(page, testInfo, 'trip-statement-print');
});

test('a Group the member can’t open refuses its statement with the app’s own page', async ({
  page,
}, testInfo) => {
  // Priya was only invited to the Studio Lunch Club; the other Group doesn't exist. Both are
  // refused with the same 403 page, which never says which it is.
  await enterAsPersona(page, 'priya');
  for (const id of [DEMO_WORK_GROUP_ID, 'f00000000000000000000000']) {
    const response = await page.goto(`/groups/${id}/statement?tz=UTC`);
    expect(response?.status()).toBe(403);
    await expectThemeApplied(page, testInfo);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Group not found');
    await expect(main).toContainText("This group may have been deleted or you don't have access.");
    await expect(main.getByRole('link', { name: 'Back to Home' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    await expect(main).not.toContainText('Studio Lunch Club');
    await expect(page.locator('.statement-paper')).toHaveCount(0);
  }
  await expectNoSeriousA11yViolations(page, testInfo, 'group-refusal');
  await reviewScreenshot(page, testInfo, 'group-refusal');

  await page.getByRole('main').getByRole('link', { name: 'Back to Home' }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard');
});
