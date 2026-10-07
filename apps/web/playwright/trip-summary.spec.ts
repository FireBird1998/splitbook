import { expect, test, type Page } from '@playwright/test';
import { darkTokens, lightTokens } from '../src/lib/theme/tokens';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { tripDayName } from '../src/components/trip-summary/trip-days';
import {
  enterAsPersona,
  expectedTheme,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  isPhone,
  reviewScreenshot,
} from './fixtures';

/**
 * A Trip's Insights tab (#316) and its Expenses by trip day, on the seeded six-day Trip, Kochi
 * to Alleppey: the whole trip in figures, day by day with the daily average and its table, the
 * wrap-up's Record landing on Balances with the pair filled in, a Tag opening the filtered
 * Expenses, and the Expenses table under its trip days. Figures come from the Trip summary read
 * for the browser's own time zone, and day labels from the app's own formatter, so nothing
 * depends on the zone or the date the suite runs on. It only reads, so it runs in any order.
 */

const TRIP_ID = 'a00000000000000000000202';
const TRIP_NAME = 'Kochi to Alleppey';
const INSIGHTS = `/groups/${TRIP_ID}/insights`;
const EXPENSES = `/groups/${TRIP_ID}/expenses`;

interface Named {
  id: string;
  name: string;
}
interface TripRead {
  currency: string;
  tripDates: { start: string | null; end: string | null };
  dayCount: number;
  spentMinor: number;
  expenseCount: number;
  yourShareMinor: number;
  youPaidMinor: number;
  peopleCount: number;
  perPersonPerDayMinor: number | null;
  dailyAverageMinor: number | null;
  days: {
    day: string;
    spentMinor: number;
    expenseCount: number;
    yourShareMinor: number;
    biggest: { description: string; amountMinor: number }[];
  }[];
  byTag: {
    tagId: string | null;
    name: string;
    spentMinor: number;
    expenseCount: number;
    percent: number;
  }[];
  suggestedPayments: { from: Named; to: Named; amountMinor: number }[];
}

/** The browser's own time zone and today in it: they decide the Trip's days. */
async function viewer(page: Page) {
  return page.evaluate(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return { timeZone, today, thisYear: Number(today.slice(0, 4)) };
  });
}

/** The Trip summary read, as the tab makes it. */
async function tripRead(page: Page): Promise<TripRead> {
  const { timeZone } = await viewer(page);
  const response = await page.request.get(
    `/api/groups/${TRIP_ID}/trip-summary?tz=${encodeURIComponent(timeZone)}`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data;
}

/** Minor units as the tab writes them, such as ₹50,190.00. */
function money(minor: number, currency: string) {
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  return format.format(minor / 10 ** format.resolvedOptions().maximumFractionDigits!);
}

const main = (page: Page) => page.getByRole('main');
const card = (page: Page, name: string | RegExp) => main(page).getByRole('region', { name });
const dayNames = async (page: Page, read: TripRead) => {
  const { thisYear } = await viewer(page);
  const dates = { start: read.tripDates.start, end: read.tripDates.end, thisYear };
  return (day: string) => tripDayName(day, dates);
};

test('a Trip’s Insights shows the whole trip, not Months', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${TRIP_ID}`);
  await main(page)
    .getByRole('navigation', { name: `${TRIP_NAME} sections` })
    .getByRole('link', { name: 'Insights', exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === INSIGHTS);
  await expectThemeApplied(page, testInfo);
  const read = await tripRead(page);
  const { currency } = read;
  // The seed's Trip: six days, three people, every Expense in INR.
  expect(read).toMatchObject({ dayCount: 6, peopleCount: 3, currency: 'INR' });

  const whole = card(page, `Whole trip · ${currency}`);
  await expect(whole).toContainText(`Spent${money(read.spentMinor, currency)}`, {
    timeout: 30_000,
  });
  await expect(whole).toContainText(`Your share${money(read.yourShareMinor, currency)}`);
  await expect(whole).toContainText(`You paid${money(read.youPaidMinor, currency)}`);
  await expect(whole).toContainText(
    `Per person per day${money(read.perPersonPerDayMinor!, currency)}3 people · 6 days`,
  );
  // No Month navigation and no second-currency row.
  await expect(main(page).getByRole('link', { name: /^Previous month/ })).toHaveCount(0);
  await expect(main(page).getByText(/Kept apart|converted/)).toHaveCount(0);

  // One column per day, hidden from assistive technology: the biggest day in the series
  // colour and the others soft, with the daily average as a line.
  const days = card(page, 'Day by day');
  const chart = days.getByTestId('trip-day-columns');
  await expect(chart).toHaveAttribute('aria-hidden', 'true');
  const bars = chart.locator('.MuiBarElement-root');
  await expect(bars).toHaveCount(read.days.length);
  const tokens = expectedTheme(testInfo) === 'dark' ? darkTokens : lightTokens;
  const biggest = read.days.reduce((top, day) => (day.spentMinor > top.spentMinor ? day : top));
  expect(
    await bars.evaluateAll((elements) => elements.map((element) => element.getAttribute('fill'))),
  ).toEqual(
    read.days.map((day) => (day === biggest ? tokens.chart.series : tokens.chart.seriesSoft)),
  );
  await expect(chart.getByTestId('trip-daily-average-line')).toHaveCount(1);
  await expect(days).toContainText(
    `was the biggest day: ${biggest.biggest[0].description} was ${money(biggest.biggest[0].amountMinor, currency)} of its ${money(biggest.spentMinor, currency)}.`,
  );

  // The wrap-up and By Tag.
  const wrapUp = card(page, 'Trip wrap-up');
  await expect(wrapUp.getByRole('listitem')).toHaveCount(read.suggestedPayments.length);
  const tags = card(page, 'By Tag');
  await expect(tags.getByRole('link')).toHaveCount(read.byTag.filter((tag) => tag.tagId).length);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'trip-insights');
  await reviewScreenshot(page, testInfo, 'trip-insights');
});

test('the tooltip names a day’s two biggest Expenses and the member’s share', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'Hover is a pointer gesture; phones read the table.');
  await enterAsPersona(page, 'alex');
  await page.goto(INSIGHTS);
  const read = await tripRead(page);
  const name = await dayNames(page, read);
  const index = read.days.findIndex((day) => day.biggest.length === 2);
  const day = read.days[index];

  const chart = card(page, 'Day by day').getByTestId('trip-day-columns');
  await chart.locator('.MuiBarElement-root').nth(index).hover({ timeout: 30_000 });
  const tooltip = page.getByTestId('trip-day-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(name(day.day));
  await expect(tooltip).toContainText(`${money(day.spentMinor, read.currency)} spent`);
  for (const expense of day.biggest)
    await expect(tooltip).toContainText(
      `${expense.description} ${money(expense.amountMinor, read.currency)}`,
    );
  await expect(tooltip).toContainText(`Your share ${money(day.yourShareMinor, read.currency)}`);
});

test('the Table view lists each day, the daily average and the whole trip, and passes axe', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(INSIGHTS);
  await expectThemeApplied(page, testInfo);
  const read = await tripRead(page);
  const name = await dayNames(page, read);
  const days = card(page, 'Day by day');
  await expect(days.getByRole('button', { name: 'Chart' })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 30_000 },
  );

  await days.getByRole('button', { name: 'Table' }).click();
  await expect(days.getByTestId('trip-day-columns')).toHaveCount(0);
  const table = days.getByRole('table', { name: /^The trip’s spending in / });
  await expect(table.getByRole('rowheader')).toHaveText([
    ...read.days.map((day) => name(day.day)),
    'Daily average',
    'Whole trip',
  ]);
  const spent = await table
    .locator('tbody tr, tfoot tr')
    .evaluateAll((rows) => rows.map((row) => row.children[2]?.textContent?.trim() ?? ''));
  expect(spent).toEqual([
    ...read.days.map((day) => money(day.spentMinor, read.currency)),
    money(read.dailyAverageMinor!, read.currency),
    money(read.spentMinor, read.currency),
  ]);
  // The days add up to the whole trip, to the paisa.
  expect(read.days.reduce((sum, day) => sum + day.spentMinor, 0)).toBe(read.spentMinor);

  // A table wider than the card scrolls inside it, and the keyboard can reach it to scroll.
  const region = days.getByRole('region', { name: 'Day by day, as a table' });
  await region.focus();
  await expect(region).toBeFocused();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'trip-insights-table');
  await reviewScreenshot(page, testInfo, 'trip-insights-table');
});

test('a Tag opens the Expenses tab filtered by it', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto(INSIGHTS);
  const read = await tripRead(page);
  const tag = read.byTag.find((entry) => entry.tagId && entry.expenseCount > 1)!;
  expect(tag, 'the seed has a Tag with several Expenses').toBeDefined();

  const link = card(page, 'By Tag').getByRole('link', { name: new RegExp(`^${tag.name}: `) });
  await expect(link).toHaveAttribute('href', `${EXPENSES}?tag=${tag.tagId}`, { timeout: 30_000 });
  await expect(link).toContainText(`${tag.percent}% of spend`);
  await link.click();

  await page.waitForURL((url) => url.pathname === EXPENSES);
  expect(new URL(page.url()).searchParams.get('tag')).toBe(tag.tagId);
  await expect(
    page.getByRole('search', { name: /^Find Expenses in / }).getByRole('button', { name: /^Tag/ }),
  ).toContainText(tag.name);
  await expect(main(page).locator('[data-expense-id]')).toHaveCount(tag.expenseCount);
});

test('a wrap-up Record opens Balances with Record payment filled in for the pair', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(INSIGHTS);
  const read = await tripRead(page);
  const alex = DEMO_PERSONA_IDS.alex;
  const payment = read.suggestedPayments.find(
    ({ from, to }) => from.id === alex || to.id === alex,
  )!;
  expect(payment, 'the seed leaves Alex a payment in the Trip').toBeDefined();
  const pays = payment.from.id === alex;
  const other = pays ? payment.to : payment.from;
  const amount = money(payment.amountMinor, read.currency);
  const title = pays ? `You pay ${other.name}` : `${other.name} pays you`;

  const wrapUp = card(page, 'Trip wrap-up');
  // Record only on Alex's own payments: the parties-only rule. Share wrap-up, a read, is the
  // card's one other link (#319).
  const own = read.suggestedPayments.filter(({ from, to }) => from.id === alex || to.id === alex);
  await expect(wrapUp.getByRole('link', { name: /^Record payment: / })).toHaveCount(own.length, {
    timeout: 30_000,
  });
  await expect(wrapUp.getByRole('link')).toHaveCount(own.length + 1);
  const record = wrapUp.getByRole('link', { name: `Record payment: ${title}, ${amount}` });
  await expect(record).toHaveAttribute(
    'href',
    `/groups/${TRIP_ID}/balances?${pays ? 'paidTo' : 'paidBy'}=${other.id}`,
  );
  await record.click();

  await page.waitForURL((url) => url.pathname === `/groups/${TRIP_ID}/balances`);
  const form = main(page).getByRole('region', { name: 'Record payment', exact: true });
  await expect(form.getByRole('combobox', { name: 'From', exact: true })).toHaveValue(
    pays ? alex : other.id,
  );
  await expect(form.getByRole('combobox', { name: 'To', exact: true })).toHaveValue(
    pays ? other.id : alex,
  );
  await expect(form.getByRole('textbox', { name: 'Amount paid' })).toHaveValue(
    (payment.amountMinor / 100).toFixed(2),
  );
  // Nothing is recorded, and the address drops the link once the form has it.
  await expect.poll(() => new URL(page.url()).search).toBe('');
  await reviewScreenshot(page, testInfo, 'trip-wrap-up-record');
});

test('a Trip’s Expenses sit under their trip days, each with its total', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(EXPENSES);
  await expectThemeApplied(page, testInfo);
  const read = await tripRead(page);
  const name = await dayNames(page, read);
  // Newest first, as the list opens: only days with Expenses.
  const expected = read.days
    .filter((day) => day.expenseCount > 0)
    .reverse()
    .map((day) => ({ label: name(day.day), total: money(day.spentMinor, read.currency) }));
  expect(expected[0].label).toMatch(/^Day \d · \w{3} \d{1,2} \w{3}/);
  const list = main(page).getByRole('region', { name: /^Expenses/ });

  if (isPhone(testInfo)) {
    const headings = list.getByRole('heading', { level: 3 });
    await expect(headings).toHaveText(
      expected.map(({ label, total }) => `${label}Day total ${total}`),
      { timeout: 30_000 },
    );
  } else {
    const table = list.getByRole('table');
    await expect(table.getByRole('rowheader')).toHaveText(
      expected.map(({ label }) => label),
      { timeout: 30_000 },
    );
    const totals = await table
      .locator('tr[data-trip-day] td:first-of-type')
      .evaluateAll((cells) => cells.map((cell) => cell.textContent?.trim() ?? ''));
    expect(totals).toEqual(expected.map(({ total }) => `Day total ${total}`));
    await expect(table.locator('[data-expense-id]')).toHaveCount(read.expenseCount);

    // A row under a day's heading opens in the side panel (#311), and the headings stay.
    const first = table.locator('tr[data-trip-day] + tr[data-expense-id]').first();
    const expenseId = await first.getAttribute('data-expense-id');
    await first.locator('td').first().click();
    await expect.poll(() => new URL(page.url()).searchParams.get('expense')).toBe(expenseId);
    await expect(first.getByRole('button', { expanded: true })).toHaveAttribute(
      'aria-controls',
      /.+/,
    );
    await expect(main(page).getByRole('region', { name: / details$/ })).toBeVisible();
    await expect(table.getByRole('rowheader')).toHaveCount(expected.length);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'trip-expenses-by-day');
  await reviewScreenshot(page, testInfo, 'trip-expenses-by-day');

  // Sorted by amount, the days would split up: the list has no day headings then.
  await page.goto(`${EXPENSES}?sort=largest`);
  await expect(list.locator('[data-expense-id]')).toHaveCount(read.expenseCount, {
    timeout: 30_000,
  });
  await expect(list.locator('[data-trip-day]')).toHaveCount(0);
  await expect(list.getByText(/^Day \d · /)).toHaveCount(0);
});
