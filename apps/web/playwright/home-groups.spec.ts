import { expect, test, type Page } from '@playwright/test';
import { getCategory } from '@splitbook/shared/categories';
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
 * Home's "Where it went" and Groups table (#308) on the seeded demo. Journeys elsewhere add
 * Expenses and Groups, so what the cards show is compared with the reads they come from, for
 * the browser's own time zone, rather than assumed.
 */

interface GroupsRead {
  _id: string;
  name: string;
  category: string;
}

interface SpendingRead {
  thisMonth: {
    month: string;
    byCategory: {
      currency: string;
      totalMinor: number;
      categories: { category: string; shareMinor: number; expenseCount: number }[];
    }[];
    groups: { groupId: string; spent: { currency: string; totalMinor: number }[] }[];
  };
  lastChanges: { groupId: string; at: string | null }[];
}

async function groupsRead(page: Page): Promise<GroupsRead[]> {
  const response = await page.request.get('/api/groups');
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}

/** The spending read as Home makes it: six Months in the browser's time zone. */
async function spendingRead(page: Page): Promise<SpendingRead> {
  const timeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const response = await page.request.get(
    `/api/user/spending?months=6&tz=${encodeURIComponent(timeZone)}`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}

/** Minor units as the cards write them, such as ₹9,420.00. */
function money(minor: number, currency: string) {
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  return format.format(minor / 10 ** format.resolvedOptions().maximumFractionDigits!);
}

const monthName = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(year, number - 1, 15),
  );
};

/** `#rrggbb` as getComputedStyle reports it. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;

const THEME_LABELS: Record<string, string> = {
  home: 'Household',
  trip: 'Trip',
  work: 'Work',
  couple: 'Couple',
  other: 'General',
};

const groupsCard = (page: Page) => page.getByRole('region', { name: 'Groups' });
const whereCard = (page: Page) => page.getByRole('region', { name: 'Where it went' });

test('Home lists every Group: Theme, members, spent this month, the balance and Last change', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);
  const [groups, spending] = await Promise.all([groupsRead(page), spendingRead(page)]);
  expect(groups.length, 'the seed gives Alex several Groups').toBeGreaterThan(1);

  const card = groupsCard(page);
  await expect(card.getByRole('heading', { name: 'Groups' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'New Group' })).toHaveAttribute(
    'href',
    '/groups/new',
  );
  // The Group cards are gone from Home.
  await expect(page.getByRole('heading', { name: 'Your groups' })).toHaveCount(0);

  const lastChange = (groupId: string) =>
    spending.lastChanges.find((entry) => entry.groupId === groupId)!.at;
  if (isPhone(testInfo)) {
    // Rows with the name, the balance and the last change; no table to scroll.
    await expect(card.getByRole('table')).toHaveCount(0);
    const rows = card.getByRole('listitem');
    await expect(rows).toHaveCount(groups.length);
    for (const [index, group] of groups.entries()) {
      const row = rows.nth(index);
      await expect(row.getByRole('link')).toHaveAttribute('href', `/groups/${group._id}`);
      await expect(row).toContainText(group.name);
      await expect(row).toContainText(THEME_LABELS[group.category]);
      await expect(row.locator('time')).toHaveAttribute('datetime', lastChange(group._id)!);
    }
  } else {
    const table = card.getByRole('table', { name: 'Groups' });
    // A narrow card may scroll the table sideways: the keyboard can reach it to scroll.
    const frame = card.getByRole('region', { name: 'Groups table' });
    await frame.focus();
    await expect(frame).toBeFocused();
    await expect(table.getByRole('columnheader')).toHaveText([
      'Group',
      'Members',
      `Spent in ${monthName(spending.thisMonth.month)}`,
      'Your balance',
      'Last change',
    ]);
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(groups.length);
    for (const [index, group] of groups.entries()) {
      const row = rows.nth(index);
      await expect(row.getByRole('rowheader')).toContainText(group.name);
      await expect(row.getByRole('rowheader')).toContainText(THEME_LABELS[group.category]);
      await expect(row.getByRole('img', { name: /^Members: you/ })).toBeVisible();
      const spent = spending.thisMonth.groups.find((entry) => entry.groupId === group._id)!;
      for (const line of spent.spent)
        await expect(row.getByRole('cell').nth(1)).toContainText(
          money(line.totalMinor, line.currency),
        );
      await expect(row.locator('time')).toHaveAttribute('datetime', lastChange(group._id)!);
    }
    // The seeded Trip says when it is.
    await expect(
      table.locator(`tbody tr:has(a[href="/groups/${DEMO_GROUP_ID}"])`).getByRole('rowheader'),
    ).toContainText(new RegExp(`^${DEMO_TRIP_NAME}Trip · \\w{3} \\d`));
    // The page never scrolls sideways; a narrow card scrolls its table instead.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  await expectNoSeriousA11yViolations(page, testInfo, 'home-groups-table');
  await reviewScreenshot(page, testInfo, 'home-groups-table');
});

test('a row opens its Group', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  const [group] = await groupsRead(page);
  const card = groupsCard(page);
  if (isPhone(testInfo)) {
    await card.getByRole('listitem').filter({ hasText: group.name }).first().click();
  } else {
    // Anywhere in the row, not only its link: here the Last change cell.
    const row = card.locator('tbody tr').filter({ hasText: group.name }).first();
    await expect(row.locator('time')).toBeVisible();
    await row.locator('time').click();
  }
  await page.waitForURL((url) => url.pathname === `/groups/${group._id}/expenses`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(group.name);
});

test('Where it went shows this month’s share by Category, with the same numbers as a table', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);
  const { thisMonth } = await spendingRead(page);
  const card = whereCard(page);
  const month = monthName(thisMonth.month);
  const [series] = thisMonth.byCategory;

  if (!series) {
    await expect(card.getByText('Nothing spent yet this month')).toBeVisible();
    return;
  }
  await expect(
    card.getByText(`Your share by Category · ${month} · ${series.currency}`),
  ).toBeVisible();
  await expect(card.getByRole('group', { name: 'Currency' })).toHaveCount(
    thisMonth.byCategory.length > 1 ? 1 : 0,
  );
  const label = (category: string) => getCategory(category)?.label ?? 'Other';

  // One bar per Category in the series colour, hidden from assistive technology.
  const bars = card.getByTestId('category-bars');
  await expect(bars).toHaveAttribute('aria-hidden', 'true');
  await expect(bars.getByTestId('category-bar')).toHaveCount(series.categories.length);
  const tokens = expectedTheme(testInfo) === 'dark' ? darkTokens : lightTokens;
  const fills = await bars
    .getByTestId('category-bar')
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
  const seriesColor = rgb(tokens.chart.series);
  expect(new Set(fills)).toEqual(new Set([seriesColor]));
  // The largest Category's bar is the full track.
  const widths = await bars
    .getByTestId('category-bar')
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          element.getBoundingClientRect().width /
          element.parentElement!.getBoundingClientRect().width,
      ),
    );
  expect(widths[0]).toBeCloseTo(1, 2);

  await expectNoSeriousA11yViolations(page, testInfo, 'home-where-it-went');

  await card.getByRole('button', { name: 'Table' }).click();
  await expect(card.getByTestId('category-bars')).toHaveCount(0);
  // A narrow card may scroll the table sideways: the keyboard can reach it to scroll.
  const frame = card.getByRole('region', { name: 'Your share by Category table' });
  await frame.focus();
  await expect(frame).toBeFocused();
  const table = card.getByRole('table', {
    name: `Your share by Category in ${month}, in ${series.currency}`,
  });
  await expect(table.getByRole('rowheader')).toHaveText([
    ...series.categories.map((part) => label(part.category)),
    'Total',
  ]);
  const shares = await table
    .locator('tbody tr, tfoot tr')
    .evaluateAll((rows) => rows.map((row) => row.lastElementChild?.textContent?.trim() ?? ''));
  expect(shares).toEqual([
    ...series.categories.map((part) => money(part.shareMinor, series.currency)),
    money(series.totalMinor, series.currency),
  ]);
  await expectNoSeriousA11yViolations(page, testInfo, 'home-where-it-went-table');
  await reviewScreenshot(page, testInfo, 'home-where-it-went');
});

test('the cards fail on their own and recover with Try again', async ({ page }) => {
  let failing = true;
  await page.route('**/api/user/spending?**', async (route) => {
    if (failing) await route.fulfill({ status: 500, json: { error: 'Internal diagnostic' } });
    else await route.fallback();
  });
  await enterAsPersona(page, 'alex');

  const where = whereCard(page);
  await expect(where.getByRole('alert')).toHaveText(/Spending by Category could not be loaded\./);
  // The Groups table keeps its Groups and balances; only its spending figures wait.
  const groups = groupsCard(page);
  await expect(groups.getByText('Some figures could not be loaded.')).toBeVisible();
  await expect(page.getByText(/Internal diagnostic/)).toHaveCount(0);

  failing = false;
  await where.getByRole('button', { name: 'Try again' }).click();
  await expect(where.getByRole('alert')).toHaveCount(0);
  await expect(groups.getByText('Some figures could not be loaded.')).toHaveCount(0);
});
