import { expect, test, type Page } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import {
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  isPhone,
  reviewScreenshot,
} from './fixtures';

/**
 * The Insights tab's Month in detail (#315) on the seeded Household, Banyan Court Flat 4B: By
 * Tag against each Tag's average (bars and ticks, and a Chart/Table switch whose table the
 * keyboard can scroll), Who paid this month (Paid against Share, exact, with See Balances),
 * and the Recurring Expenses card only while recurring Expenses are switched on (#289; this
 * suite's app keeps them off, the pilot's has them on). Journeys elsewhere add Expenses, so the
 * figures are compared with the insights read for the browser's own time zone rather than
 * assumed. It only reads, so it runs in any order.
 */

const HOUSEHOLD_ID = 'a00000000000000000000201';
const INSIGHTS = `/groups/${HOUSEHOLD_ID}/insights`;

interface TagRead {
  tagId: string | null;
  name: string | null;
  spentMinor: number;
  averageMinor: number | null;
  changePercent: number | null;
}
interface PaidShareRead {
  id: string;
  name: string;
  paidMinor: number;
  shareMinor: number;
  netMinor: number;
}
interface InsightsRead {
  month: string;
  currency: string;
  recurringExpenses: boolean;
  average: { monthCount: number } | null;
  byTag: { earlierMonths: string[]; tags: TagRead[] };
  whoPaid: { members: PaidShareRead[] };
  recurring?: unknown;
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

/** The insights read as the tab makes it, for a Month in the browser's zone. */
async function insightsRead(page: Page, month: string): Promise<InsightsRead> {
  const { timeZone } = await viewerMonth(page);
  const response = await page.request.get(
    `/api/groups/${HOUSEHOLD_ID}/insights?month=${month}&compare=6&tz=${encodeURIComponent(timeZone)}`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data;
}

/** Minor units as the tab writes them, such as ₹18,420.00. */
function money(minor: number, currency: string) {
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  return format.format(minor / 10 ** format.resolvedOptions().maximumFractionDigits!);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The change as the card writes it: "+8.9%", "−5.4%", "New" or "–". */
function change(tag: TagRead) {
  if (tag.averageMinor === null) return '–';
  if (tag.changePercent === null) return tag.spentMinor > 0 ? 'New' : '–';
  const text = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(tag.changePercent));
  return `${tag.changePercent > 0 ? '+' : tag.changePercent < 0 ? '−' : ''}${text}%`;
}

const monthName = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(year, number - 1, 15),
  );
};

const shiftMonth = (month: string, offset: number) => {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 15));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const card = (page: Page, name: string) =>
  page.getByRole('main').getByRole('region', { name, exact: true });

/** Last month: a whole month of the seeded Household, whatever day the suite runs. */
async function openLastMonth(page: Page) {
  await enterAsPersona(page, 'alex');
  const { month } = await viewerMonth(page);
  const previous = shiftMonth(month, -1);
  await page.goto(`${INSIGHTS}?month=${previous}`);
  const read = await insightsRead(page, previous);
  await expect(card(page, 'By Tag').getByRole('button', { name: 'Chart' })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 30_000 },
  );
  return read;
}

test('By Tag and Who paid show the Month against the read, and recurring Expenses only when on', async ({
  page,
}, testInfo) => {
  const read = await openLastMonth(page);
  await expectThemeApplied(page, testInfo);
  const tags = read.byTag.tags;
  expect(tags.length).toBeGreaterThan(0);
  // The seed's Household has history back to seven months ago: six earlier months.
  expect(read.byTag.earlierMonths).toHaveLength(6);
  expect(read.average?.monthCount).toBe(6);
  expect(read.byTag.earlierMonths).not.toContain(read.month);

  // By Tag: a bar per Tag in the series colour, each with its average tick, hidden from
  // assistive technology, which reads the same Tags in the table.
  const byTag = card(page, 'By Tag');
  await expect(byTag.getByText(/ vs the 6-month average, /)).toBeVisible();
  const bars = byTag.getByTestId('tag-bars');
  await expect(bars).toHaveAttribute('aria-hidden', 'true');
  const rows = bars.getByTestId('tag-bar-row');
  await expect(rows).toHaveCount(tags.length);
  for (const [index, tag] of tags.entries())
    await expect(rows.nth(index)).toHaveText(
      `${tag.name ?? 'Untagged'}${money(tag.spentMinor, read.currency)}${change(tag)}`,
    );
  await expect(bars.getByTestId('tag-average-tick')).toHaveCount(
    tags.filter((tag) => tag.averageMinor !== null).length,
  );

  // Who paid: each member's Paid against their Share, exact, with the Month net.
  const whoPaid = card(page, 'Who paid this month');
  const table = whoPaid.getByRole('region', { name: 'Who paid this month table' });
  await expect(table).toHaveAttribute('tabindex', '0');
  const members = table.getByRole('row');
  await expect(members).toHaveCount(read.whoPaid.members.length + 1);
  for (const [index, member] of read.whoPaid.members.entries()) {
    const row = members.nth(index + 1);
    await expect(row.getByRole('rowheader')).toContainText(
      member.id === DEMO_PERSONA_IDS.alex ? 'You' : member.name,
    );
    // The bar beside the figures is hidden from assistive technology: three cells.
    await expect(row.getByRole('cell')).toHaveText([
      money(member.paidMinor, read.currency),
      money(member.shareMinor, read.currency),
      new RegExp(
        `^${member.netMinor > 0 ? '\\+' : member.netMinor < 0 ? '−' : ''}${escape(
          money(Math.abs(member.netMinor), read.currency),
        )} paid `,
      ),
    ]);
  }
  const spent = read.whoPaid.members.reduce((sum, member) => sum + member.paidMinor, 0);
  expect(read.whoPaid.members.reduce((sum, member) => sum + member.shareMinor, 0)).toBe(spent);
  await expect(whoPaid).not.toContainText(/front/i);
  await expect(whoPaid.getByRole('link', { name: 'See Balances' })).toHaveAttribute(
    'href',
    `/groups/${HOUSEHOLD_ID}/balances`,
  );

  // One product-wide switch (#289): this suite's app keeps recurring Expenses off, so there is
  // no card, heading or empty state, and the read sends no recurring data.
  if (!read.recurringExpenses) {
    expect(read).not.toHaveProperty('recurring');
    await expect(card(page, 'Recurring Expenses')).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText('Recurring Expenses');
  } else {
    await expect(card(page, 'Recurring Expenses')).toBeVisible();
  }

  // The page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'group-insights-detail');
  await reviewScreenshot(page, testInfo, 'group-insights-detail');
});

test('By Tag’s Table view lists each Tag against its average, and the keyboard can scroll it', async ({
  page,
}, testInfo) => {
  const read = await openLastMonth(page);
  await expectThemeApplied(page, testInfo);
  const byTag = card(page, 'By Tag');
  await byTag.getByRole('button', { name: 'Table' }).click();
  await expect(byTag.getByRole('button', { name: 'Table' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(byTag.getByTestId('tag-bars')).toHaveCount(0);

  const region = byTag.getByRole('region', { name: 'Spending by Tag table' });
  await expect(region).toHaveAttribute('tabindex', '0');
  await region.focus();
  await expect(region).toBeFocused();
  const table = region.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText([
    'Tag',
    monthName(read.month),
    '6-month average',
    'Change',
  ]);
  await expect(table.getByRole('rowheader')).toHaveText(
    read.byTag.tags.map((tag) => tag.name ?? 'Untagged'),
  );
  const cells = await table
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim())),
    );
  expect(cells).toEqual(
    read.byTag.tags.map((tag) => [
      money(tag.spentMinor, read.currency),
      tag.averageMinor === null ? '–' : money(tag.averageMinor, read.currency),
      change(tag),
    ]),
  );

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'group-insights-by-tag-table');
  await reviewScreenshot(page, testInfo, 'group-insights-by-tag-table');

  // Back to the chart, and the choice stays as the member moves to another Month.
  await byTag.getByRole('button', { name: 'Chart' }).click();
  await expect(byTag.getByTestId('tag-bars')).toBeVisible();
  await byTag.getByRole('button', { name: 'Table' }).click();
  const before = shiftMonth(read.month, -1);
  await page
    .getByRole('main')
    .getByRole('link', { name: new RegExp(`^Previous month, ${monthName(before)} `) })
    .click();
  await page.waitForURL((url) => url.searchParams.get('month') === before);
  await expect(card(page, 'By Tag').getByRole('button', { name: 'Table' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Who paid’s table scrolls inside its card on a phone', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'A phone’s width is what makes the table scroll.');
  await openLastMonth(page);
  const region = card(page, 'Who paid this month').getByRole('region', {
    name: 'Who paid this month table',
  });
  await expect(region).toBeVisible();
  // The bars beside the figures make way on a phone; the figures stay.
  await expect(region.getByTestId('paid-bar').first()).toBeHidden();
  await region.focus();
  await expect(region).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
