import { expect, test, type Locator, type Page } from '@playwright/test';
import { darkTokens, lightTokens } from '../src/lib/theme/tokens';
import {
  enterAsPersona,
  expectedTheme,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  isPhone,
  reviewScreenshot,
} from './fixtures';

/**
 * Home's "Your share of spending" (#307) on the seeded demo: six Months of columns with the
 * current Month in the series colour, a tooltip with each Group's part, and a Table view with
 * the same numbers. Journeys elsewhere add Expenses, so figures are compared with the spending
 * read for the browser's own time zone rather than assumed.
 */

interface SpendingRead {
  months: string[];
  groups: { groupId: string; name: string }[];
  currencies: {
    currency: string;
    months: {
      month: string;
      shareMinor: number;
      byGroup: { groupId: string; shareMinor: number }[];
    }[];
  }[];
}

/** The spending read as the card makes it: six Months in the browser's time zone. */
async function spendingRead(page: Page): Promise<SpendingRead> {
  const timeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const response = await page.request.get(
    `/api/user/spending?months=6&tz=${encodeURIComponent(timeZone)}`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}

/** Minor units as the card writes them, such as ₹9,420.00. */
function money(minor: number, currency: string) {
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  return format.format(minor / 10 ** format.resolvedOptions().maximumFractionDigits!);
}

const longMonth = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, number - 1, 15));
};

const spendingCard = (page: Page) => page.getByRole('region', { name: 'Your share of spending' });

/** The table's "Your share" column, top to bottom. */
async function shareColumn(card: Locator): Promise<string[]> {
  const rows = card.getByRole('table').locator('tbody tr');
  return rows.evaluateAll((elements) =>
    elements.map((row) => row.lastElementChild?.textContent?.trim() ?? ''),
  );
}

test('Home shows six Months of the member’s share as columns, the current Month highlighted', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);
  const read = await spendingRead(page);
  const [series] = read.currencies;
  expect(series, 'the seed gives Alex spending in the last six months').toBeTruthy();

  const card = spendingCard(page);
  await expect(card.getByRole('heading', { name: 'Your share of spending' })).toBeVisible();
  await expect(card.getByText(`${series.currency} · last 6 months · every Group`)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Chart' })).toHaveAttribute('aria-pressed', 'true');
  // A currency switch only when the member has spending in several.
  await expect(card.getByRole('group', { name: 'Currency' })).toHaveCount(
    read.currencies.length > 1 ? 1 : 0,
  );

  // Six columns, hidden from assistive technology, which gets the table instead.
  const chart = card.getByTestId('spending-columns');
  await expect(chart).toHaveAttribute('aria-hidden', 'true');
  const bars = chart.locator('.MuiBarElement-root');
  await expect(bars).toHaveCount(6);
  const tokens = expectedTheme(testInfo) === 'dark' ? darkTokens : lightTokens;
  const fills = await bars.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('fill')),
  );
  expect(fills).toEqual([...Array(5).fill(tokens.chart.seriesSoft), tokens.chart.series]);
  await expect(card.getByRole('table')).toHaveCount(1);
  expect(await shareColumn(card)).toEqual(
    series.months.map((month) => money(month.shareMinor, series.currency)),
  );

  // The current Month's figure sits above its column, whole: exact on a desktop, shortened
  // (₹20K) on a phone when the exact figure is wider than its column's band.
  const current = series.months[5];
  const label = chart.locator('.MuiBarLabel-root');
  await expect(label).toHaveCount(1);
  if (!isPhone(testInfo))
    await expect(label).toHaveText(money(current.shareMinor, series.currency));
  const [labelBox, chartBox] = [await label.boundingBox(), await chart.boundingBox()];
  expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(chartBox!.x + chartBox!.width);
  // Inside the plot, under its top grid line, where nothing clips it.
  const gridTops = await chart
    .locator('.MuiChartsGrid-line')
    .evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().top));
  expect(labelBox!.y).toBeGreaterThanOrEqual(Math.min(...gridTops) - 1);
  await expect(
    card.getByText(
      / is up because of | is below your average | matches your average |^Nothing in /,
    ),
  ).toBeVisible();

  await expectNoSeriousA11yViolations(page, testInfo, 'home-spending-chart');
  await reviewScreenshot(page, testInfo, 'home-spending-chart');
});

test('the tooltip breaks a Month down by Group', async ({ page }, testInfo) => {
  test.skip(isPhone(testInfo), 'Hover is a pointer gesture; phones read the table.');
  await enterAsPersona(page, 'alex');
  const read = await spendingRead(page);
  const [series] = read.currencies;
  const names = new Map(read.groups.map((group) => [group.groupId, group.name]));
  // The busiest Month, so the tooltip has Groups to list.
  const index = series.months.reduce(
    (best, month, at) => (month.byGroup.length > series.months[best].byGroup.length ? at : best),
    0,
  );
  const month = series.months[index];

  const card = spendingCard(page);
  await card.getByTestId('spending-columns').locator('.MuiBarElement-root').nth(index).hover();
  const tooltip = page.locator('.MuiChartsTooltip-root');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(longMonth(month.month));
  await expect(tooltip).toContainText(money(month.shareMinor, series.currency));
  for (const part of month.byGroup)
    await expect(tooltip).toContainText(
      `${names.get(part.groupId)}${money(part.shareMinor, series.currency)}`,
    );
});

test('the Table view shows the same numbers, with a column per Group', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);
  const read = await spendingRead(page);
  const [series] = read.currencies;

  const card = spendingCard(page);
  await card.getByRole('button', { name: 'Table' }).click();
  await expect(card.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByTestId('spending-columns')).toHaveCount(0);

  const table = card.getByRole('table', { name: /Your share of spending in / });
  await expect(table).toBeVisible();
  await expect(table.getByRole('rowheader')).toHaveText(
    read.months.map((month, at) =>
      at === 5 ? `${longMonth(month)} · this month` : longMonth(month),
    ),
  );
  expect(await shareColumn(card)).toEqual(
    series.months.map((month) => money(month.shareMinor, series.currency)),
  );
  const groupsWithSpending = new Set(
    series.months.flatMap((month) => month.byGroup.map((part) => part.groupId)),
  );
  // A column per Group with spending, between Month and Your share. Names can repeat (two
  // Groups may share one), so they are compared as a sorted list.
  const headers = await table.getByRole('columnheader').allTextContents();
  expect(headers[0]).toBe('Month');
  expect(headers.at(-1)).toBe('Your share');
  expect(headers.slice(1, -1).sort()).toEqual(
    [...groupsWithSpending]
      .map((groupId) => read.groups.find((group) => group.groupId === groupId)!.name)
      .sort(),
  );

  // The page never scrolls sideways; a wide table scrolls inside the card.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await expectNoSeriousA11yViolations(page, testInfo, 'home-spending-table');
  await reviewScreenshot(page, testInfo, 'home-spending-table');

  await card.getByRole('button', { name: 'Chart' }).click();
  await expect(card.getByTestId('spending-columns')).toBeVisible();
});

test('a table with many Groups scrolls inside the card, never the page', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const { months } = await spendingRead(page);
  // Eight fictional Groups with long names. The first has a part every Month; the others
  // only in the current Month, so the columns past the card's edge are mostly empty cells.
  const groups = Array.from({ length: 8 }, (_, index) => ({
    groupId: `f0000000000000000000000${index}`,
    name: `Synthetic weekend away number ${index + 1}`,
  }));
  const parts = (index: number) =>
    groups
      .filter((_, at) => at === 0 || index === 5)
      .map(({ groupId }) => ({ groupId, shareMinor: 123456 }));
  const wide = {
    timeZone: 'UTC',
    months,
    window: { from: `${months[0]}-01`, to: `${months[5]}-28` },
    groups,
    currencies: [
      {
        currency: 'INR',
        totalMinor: 13 * 123456,
        expenseCount: 13,
        months: months.map((month, index) => ({
          month,
          shareMinor: parts(index).length * 123456,
          byGroup: parts(index),
        })),
      },
    ],
  };
  await page.route('**/api/user/spending?**', (route) =>
    route.fulfill({ json: { status: 200, data: wide } }),
  );
  await page.reload();
  await expectThemeApplied(page, testInfo);

  const card = spendingCard(page);
  await card.getByRole('button', { name: 'Table' }).click();
  await expect(card.getByRole('table').getByRole('columnheader')).toHaveCount(10);
  const frame = card.getByRole('group', { name: /Your share of spending in INR/ });
  expect(await frame.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // The frame takes focus, so the keyboard can scroll it.
  await frame.focus();
  await expect(frame).toBeFocused();
});
