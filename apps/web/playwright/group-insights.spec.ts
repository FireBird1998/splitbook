import { expect, test, type Page } from '@playwright/test';
import { darkTokens, lightTokens } from '../src/lib/theme/tokens';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectedTheme,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  isPhone,
  reviewScreenshot,
} from './fixtures';

/**
 * A Group's Insights tab (#314) on the seeded Household, Banyan Court Flat 4B, which has seven
 * months of history: Month navigation and the range in the address (through reload), the stat
 * cards, and monthly spending with the average of the earlier months as a line and a table
 * row. Journeys elsewhere add Expenses, so the figures are compared with the insights read for
 * the browser's own time zone rather than assumed. It only reads, so it runs in any order.
 */

const HOUSEHOLD_ID = 'a00000000000000000000201';
const HOUSEHOLD = 'Banyan Court Flat 4B';
const INSIGHTS = `/groups/${HOUSEHOLD_ID}/insights`;

interface MonthRead {
  month: string;
  spentMinor: number;
  expenseCount: number;
  yourShareMinor: number;
  youPaidMinor: number;
  recurringCount?: number;
}
interface InsightsRead {
  month: string;
  compare: number;
  firstMonth: string | null;
  currency: string;
  months: MonthRead[];
  average: { monthCount: number; spentMinor: number; yourShareMinor: number } | null;
  change: { direction: string; differenceMinor: number; changePercent: number | null } | null;
  biggestExpense: { description: string; amountMinor: number } | null;
  recurringExpenses: boolean;
  hasExpenses: boolean;
}

/** The browser's own time zone and current Month: they decide what the tab shows. */
async function viewerMonth(page: Page) {
  return page.evaluate(() => {
    const now = new Date();
    return {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    };
  });
}

/** The insights read as the tab makes it. */
async function insightsRead(
  page: Page,
  {
    groupId = HOUSEHOLD_ID,
    month,
    compare = 6,
  }: { groupId?: string; month: string; compare?: number },
): Promise<InsightsRead> {
  const { timeZone } = await viewerMonth(page);
  const response = await page.request.get(
    `/api/groups/${groupId}/insights?month=${month}&compare=${compare}&tz=${encodeURIComponent(timeZone)}`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data;
}

/** Minor units as the tab writes them, such as ₹18,420.00. */
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

const shiftMonth = (month: string, offset: number) => {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 15));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const figures = (page: Page, month: string) =>
  page.getByRole('main').getByRole('region', { name: `${longMonth(month)} in figures` });
const monthlyCard = (page: Page) =>
  page.getByRole('main').getByRole('region', { name: 'Monthly spending' });
const monthHeading = (page: Page) =>
  page.getByRole('main').getByRole('heading', { level: 2 }).first();

/** The figures the stat cards must show for a read. */
async function expectStats(page: Page, read: InsightsRead) {
  const month = read.months.at(-1)!;
  const cards = figures(page, read.month);
  await expect(cards).toContainText(`Spent${money(month.spentMinor, read.currency)}`);
  await expect(cards).toContainText(
    `Your share${money(month.yourShareMinor, read.currency)}You paid ${money(month.youPaidMinor, read.currency)}`,
  );
  await expect(cards).toContainText(`Expenses${month.expenseCount}`);
  // Against the earlier months' average, or over one month, that month by name.
  if (read.average)
    await expect(cards).toContainText(
      read.average.monthCount === 1
        ? `vs ${longMonth(read.months[0].month).split(' ')[0]} ${money(read.average.spentMinor, read.currency)}`
        : `vs ${read.average.monthCount}-month average ${money(read.average.spentMinor, read.currency)}`,
    );
  // One product-wide switch (#289): no recurring count unless recurring Expenses are on.
  if (!read.recurringExpenses) await expect(cards).not.toContainText(/recurring/i);
  else if (month.recurringCount)
    await expect(cards).toContainText(`${month.recurringCount} added by recurring Expenses`);
  if (read.biggestExpense)
    await expect(cards).toContainText(
      `Biggest expense${money(read.biggestExpense.amountMinor, read.currency)}${read.biggestExpense.description}`,
    );
}

test('Insights opens from the tab bar on the current Month, with seven months of the Household', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${HOUSEHOLD_ID}`);
  const main = page.getByRole('main');
  await main
    .getByRole('navigation', { name: `${HOUSEHOLD} sections` })
    .getByRole('link', { name: 'Insights', exact: true })
    .click();
  // The bare address: the current Month against the six before it.
  await page.waitForURL((url) => url.pathname === INSIGHTS && url.search === '');
  await expectThemeApplied(page, testInfo);
  const { month } = await viewerMonth(page);
  const read = await insightsRead(page, { month });

  // The seed's Household has history back to seven months ago: six earlier months to compare.
  expect(read.hasExpenses).toBe(true);
  expect(read.months.map((entry) => entry.month)).toEqual(
    Array.from({ length: 7 }, (_, index) => shiftMonth(month, index - 6)),
  );
  expect(read.average?.monthCount).toBe(6);

  await expect(monthHeading(page)).toHaveText(longMonth(month), { timeout: 30_000 });
  await expectStats(page, read);
  await expect(
    main.getByRole('button', {
      name: `Next month, unavailable: ${longMonth(month).split(' ')[0]} is the current month`,
    }),
  ).toHaveAttribute('aria-disabled', 'true');
  await expect(main.getByRole('button', { name: '6 months' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Seven columns, hidden from assistive technology, the Month in the series colour and the
  // earlier months soft, with the average drawn as a line.
  const card = monthlyCard(page);
  await expect(
    card.getByText(`${read.currency} · ${longMonth(read.months[0].month).split(' ')[0]}`),
  ).toBeVisible();
  const chart = card.getByTestId('monthly-columns');
  await expect(chart).toHaveAttribute('aria-hidden', 'true');
  const bars = chart.locator('.MuiBarElement-root');
  await expect(bars).toHaveCount(7);
  const tokens = expectedTheme(testInfo) === 'dark' ? darkTokens : lightTokens;
  expect(
    await bars.evaluateAll((elements) => elements.map((element) => element.getAttribute('fill'))),
  ).toEqual([...Array(6).fill(tokens.chart.seriesSoft), tokens.chart.series]);
  await expect(chart.getByTestId('monthly-average-line')).toHaveCount(1);
  await expect(
    card.getByText(/ (above|below) the 6-month average\.| matches the 6-month average\./),
  ).toBeVisible();

  // The page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'group-insights');
  await reviewScreenshot(page, testInfo, 'group-insights');
});

test('Month navigation and the range live in the address, through reload', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto(INSIGHTS);
  const main = page.getByRole('main');
  const { month } = await viewerMonth(page);
  await expect(monthHeading(page)).toHaveText(longMonth(month), { timeout: 30_000 });

  // Back a Month.
  const previous = shiftMonth(month, -1);
  await main.getByRole('link', { name: `Previous month, ${longMonth(previous)}` }).click();
  await page.waitForURL((url) => url.searchParams.get('month') === previous);
  await expect(monthHeading(page)).toHaveText(longMonth(previous));
  await expectStats(page, await insightsRead(page, { month: previous }));

  // The range: compare with 12 months, then 1.
  await main.getByRole('button', { name: '12 months' }).click();
  await page.waitForURL((url) => url.searchParams.get('compare') === '12');
  expect(new URL(page.url()).searchParams.get('month')).toBe(previous);
  await expect(main.getByRole('button', { name: '12 months' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const twelve = await insightsRead(page, { month: previous, compare: 12 });
  await expectStats(page, twelve);

  // A reload, or the address opened afresh, keeps the Month and the range.
  await page.reload();
  await expect(monthHeading(page)).toHaveText(longMonth(previous), { timeout: 30_000 });
  await expect(main.getByRole('button', { name: '12 months' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectStats(page, twelve);

  await main.getByRole('button', { name: '1 month' }).click();
  await page.waitForURL((url) => url.searchParams.get('compare') === '1');
  const one = await insightsRead(page, { month: previous, compare: 1 });
  expect(one.months.map((entry) => entry.month)).toEqual([shiftMonth(month, -2), previous]);
  await expectStats(page, one);
  // Over one month, the average is that month.
  await expect(figures(page, previous)).toContainText(
    `vs ${longMonth(shiftMonth(month, -2)).split(' ')[0]}`,
  );

  // Forward to the current Month: the address drops it, and next stops there.
  await main.getByRole('link', { name: `Next month, ${longMonth(month)}` }).click();
  await page.waitForURL((url) => url.pathname === INSIGHTS && url.search === '?compare=1');
  await expect(monthHeading(page)).toHaveText(longMonth(month));
  await expect(main.getByRole('button', { name: /^Next month, unavailable/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // A Month after the current one, or a malformed one, shows the current Month.
  await page.goto(`${INSIGHTS}?month=${shiftMonth(month, 3)}`);
  await expect(monthHeading(page)).toHaveText(longMonth(month), { timeout: 30_000 });
});

test('the Table view shows each month, the average row, and passes axe', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const { month } = await viewerMonth(page);
  const previous = shiftMonth(month, -1);
  await page.goto(`${INSIGHTS}?month=${previous}`);
  await expectThemeApplied(page, testInfo);
  const read = await insightsRead(page, { month: previous });
  const card = monthlyCard(page);
  await expect(card.getByRole('button', { name: 'Chart' })).toHaveAttribute(
    'aria-pressed',
    'true',
    {
      timeout: 30_000,
    },
  );

  await card.getByRole('button', { name: 'Table' }).click();
  await expect(card.getByTestId('monthly-columns')).toHaveCount(0);
  const table = card.getByRole('table', { name: /The whole Group’s spending in / });
  await expect(table.getByRole('rowheader')).toHaveText([
    ...read.months.map((entry) => longMonth(entry.month)),
    '6-month average',
  ]);
  const spent = await table
    .locator('tbody tr, tfoot tr')
    .evaluateAll((rows) => rows.map((row) => row.children[1]?.textContent?.trim() ?? ''));
  expect(spent).toEqual([
    ...read.months.map((entry) => money(entry.spentMinor, read.currency)),
    money(read.average!.spentMinor, read.currency),
  ]);
  // The average leaves the Month out: it is the earlier months' average, rounded half up.
  const earlier = read.months.slice(0, -1).map((entry) => entry.spentMinor);
  expect(read.average!.spentMinor).toBe(
    Math.floor(
      (2 * earlier.reduce((sum, value) => sum + value, 0) + earlier.length) / (2 * earlier.length),
    ),
  );

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'group-insights-table');
  await reviewScreenshot(page, testInfo, 'group-insights-table');
});

test('the tooltip gives a month’s Spent, count and the member’s share', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'Hover is a pointer gesture; phones read the table.');
  await enterAsPersona(page, 'alex');
  const { month } = await viewerMonth(page);
  const previous = shiftMonth(month, -1);
  await page.goto(`${INSIGHTS}?month=${previous}`);
  const read = await insightsRead(page, { month: previous });
  const last = read.months.at(-1)!;

  const chart = monthlyCard(page).getByTestId('monthly-columns');
  await chart.locator('.MuiBarElement-root').last().hover({ timeout: 30_000 });
  const tooltip = page.locator('.MuiChartsTooltip-root');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(longMonth(previous));
  await expect(tooltip).toContainText(money(last.spentMinor, read.currency));
  await expect(tooltip).toContainText(`your share ${money(last.yourShareMinor, read.currency)}`);
});

test('a Trip shows its Trip summary in place of Months (#316)', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}/insights`);
  const main = page.getByRole('main');
  await expect(main.getByRole('region', { name: /^Whole trip · / })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    main.getByRole('navigation', { name: `${DEMO_TRIP_NAME} sections` }).getByRole('link', {
      name: 'Insights',
    }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('link', { name: /^Previous month/ })).toHaveCount(0);
  await expect(main.getByRole('region', { name: 'Monthly spending' })).toHaveCount(0);
});
