import { expect, test, type Page } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  expenseItem,
  isPhone,
  openExpense,
  reviewScreenshot,
} from './fixtures';

/**
 * A Group's Expenses (#310): a table on computers and cards on phones, a toolbar whose search,
 * filters and sort live in the address, the Household Month bar, exact positions, and a failed
 * load that says so. Everything here only reads the seeded Groups, so it runs in any order
 * with the other journeys.
 */

const TRIP = `/groups/${DEMO_GROUP_ID}/expenses`;
const HOUSEHOLD_ID = 'a00000000000000000000201';
const HOUSEHOLD = `/groups/${HOUSEHOLD_ID}/expenses`;
const SAM_ID = 'a00000000000000000000002';

/** The Goa trip's seeded Expenses, newest first. */
const GOA = [
  'Trip SIM cards',
  'Groceries & snacks',
  'Parasailing & jet ski',
  'Scooter rental',
  'Seafood dinner at Anjuna',
  'Airport taxi + tolls',
  'Beachside villa (3 nights)',
];

const GOA_AMOUNTS: Record<string, number> = {
  'Trip SIM cards': 900,
  'Groceries & snacks': 2100,
  'Parasailing & jet ski': 4500,
  'Scooter rental': 1500,
  'Seafood dinner at Anjuna': 3600,
  'Airport taxi + tolls': 2400,
  'Beachside villa (3 nights)': 18000,
};

const list = (page: Page) => page.getByRole('main').getByRole('region', { name: /^Expenses/ });
const toolbar = (page: Page) => page.getByRole('search', { name: /^Find Expenses in / });
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /^Search Expenses in / });

/** The Expenses the list shows, by description, in order. */
async function shown(page: Page, known: string[] = GOA): Promise<string[]> {
  const names = await list(page)
    .locator('[aria-expanded]')
    .evaluateAll((buttons) => buttons.map((button) => button.textContent ?? ''));
  return names.map((name) => known.find((description) => name.includes(description)) ?? name);
}

async function expectShown(page: Page, expected: string[], known: string[] = GOA) {
  await expect.poll(() => shown(page, known), { timeout: 15_000 }).toEqual(expected);
}

const params = (page: Page) => new URL(page.url()).searchParams;

/** Choose an option from one of the toolbar's menus. */
async function choose(page: Page, chip: RegExp, option: string) {
  await toolbar(page).getByRole('button', { name: chip }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

test('filters, sort and search work together, live in the address, and survive a reload', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(TRIP);
  await expectThemeApplied(page, testInfo);
  await expectShown(page, GOA);

  await choose(page, /^Paid by/, 'Sam Chen');
  await expect.poll(() => params(page).get('paidBy')).toBe(SAM_ID);
  await expectShown(page, ['Parasailing & jet ski', 'Airport taxi + tolls']);

  await choose(page, /^Tag/, 'Transport');
  await expectShown(page, ['Airport taxi + tolls']);
  await expect(page.getByRole('status').filter({ hasText: 'Expense matches' })).toHaveText(
    '1 Expense matches',
  );

  await toolbar(page).getByRole('button', { name: 'Clear filters' }).click();
  await expectShown(page, GOA);
  await expect.poll(() => page.url()).toMatch(/\/expenses$/);

  await toolbar(page)
    .getByRole('button', { name: /^Amount/ })
    .click();
  const range = page.getByRole('dialog', { name: 'Amount range' });
  await range.getByLabel('From').fill('1000');
  await range.getByLabel('To').fill('3000');
  await range.getByRole('button', { name: 'Apply' }).click();
  await expect(range).toHaveCount(0);
  await expectShown(page, ['Groceries & snacks', 'Scooter rental', 'Airport taxi + tolls']);

  await choose(page, /^Sort:/, 'Largest first');
  await expectShown(page, ['Airport taxi + tolls', 'Groceries & snacks', 'Scooter rental']);

  await searchBox(page).fill('taxi');
  await expectShown(page, ['Airport taxi + tolls']);
  await expect
    .poll(() => Object.fromEntries(params(page)))
    .toEqual({ min: '1000', max: '3000', sort: 'largest', search: 'taxi' });
  await reviewScreenshot(page, testInfo, 'expenses-filtered');

  // Reloading, or opening the link afresh, keeps the whole view.
  for (const open of [() => page.reload(), () => page.goto(page.url())]) {
    await open();
    await expectShown(page, ['Airport taxi + tolls']);
    await expect(searchBox(page)).toHaveValue('taxi');
    await expect(toolbar(page).getByRole('button', { name: /^Amount/ })).toHaveText(
      /₹1,000\.00 – ₹3,000\.00/,
    );
    await expect(toolbar(page).getByRole('button', { name: /^Sort:/ })).toHaveText(/Largest first/);
  }

  // Search alone, after clearing the others.
  await toolbar(page).getByRole('button', { name: 'Clear filters' }).click();
  await expectShown(
    page,
    [...GOA].sort((a, b) => GOA_AMOUNTS[b] - GOA_AMOUNTS[a]),
  );
  await searchBox(page).fill('s');
  await expect.poll(() => params(page).get('search')).toBe('s');
});

test('"Involves me" keeps the Expenses the member paid or has a share of', async ({ page }) => {
  // Priya has no AC in her room, so the AC servicing is Alex's and Sam's alone.
  await enterAsPersona(page, 'priya');
  const ac = ['AC servicing — two rooms'];
  await page.goto(`${HOUSEHOLD}?search=AC%20servicing`);
  await expectShown(page, ac, ac);

  await toolbar(page).getByRole('button', { name: 'Involves me' }).click();
  await expect(toolbar(page).getByRole('button', { name: 'Involves me' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(() => params(page).get('involvesMe')).toBe('1');
  await expect(list(page)).toHaveCount(0);
  await expect(page.getByText('No matching Expenses')).toBeVisible();

  await page.reload();
  await expect(page.getByText('No matching Expenses')).toBeVisible();
  await toolbar(page).getByRole('button', { name: 'Involves me' }).click();
  await expectShown(page, ac, ac);
  expect(params(page).get('involvesMe')).toBeNull();
});

test('a ?search= link, as the top bar’s search makes, opens the list searched', async ({
  page,
}) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}?search=Trip%20SIM%20cards`);
  await page.waitForURL((url) => url.pathname === TRIP);
  expect(params(page).get('search')).toBe('Trip SIM cards');
  await expect(searchBox(page)).toHaveValue('Trip SIM cards');
  await expectShown(page, ['Trip SIM cards']);

  // A second link replaces the search, and no filter from before hides the Expense.
  await page.goto(`/groups/${DEMO_GROUP_ID}?search=villa`);
  await expect(searchBox(page)).toHaveValue('villa');
  await expectShown(page, ['Beachside villa (3 nights)']);
});

test('computers get the table, with exact positions; phones keep the cards', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(TRIP);
  await expectShown(page, GOA);
  const villa = expenseItem(page, 'Beachside villa (3 nights)').item;
  const seafood = expenseItem(page, 'Seafood dinner at Anjuna').item;
  await expect(villa).toContainText(/you\s*lent\s*₹12,000\.00/);
  await expect(seafood).toContainText(/you\s*owe\s*₹1,440\.00/);

  if (isPhone(testInfo)) {
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(villa).toContainText('You paid · Equally · 3');
  } else {
    const table = list(page).getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText([
      'Date',
      'Description',
      'Paid by',
      'Split',
      'Amount',
      'You',
    ]);
    await expect(seafood.getByRole('cell')).toHaveText([
      /^\w{3} \d{1,2} \w{3}/,
      'Seafood dinner at AnjunaFood',
      'PSPriya Shah',
      'By percentage · 3',
      '₹3,600.00',
      /you\s*owe₹1,440\.00/,
    ]);
  }

  // Opening an Expense shows its details, with Edit and Delete, and nothing nested: in the side
  // panel beside the table on a computer (#311), below the card on a phone.
  const phone = isPhone(testInfo);
  const details = await openExpense(page, 'Seafood dinner at Anjuna');
  await expect(details).toContainText(phone ? 'Split (By percentage)' : 'By percentage · 3');
  await expect(details.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(
    details.getByRole('button', { name: phone ? 'Delete' : 'Delete Expense', exact: true }),
  ).toBeVisible();
  await expectThemeApplied(page, testInfo);
  await expectNoSeriousA11yViolations(page, testInfo, 'expenses-opened');
});

test('the Household Month bar shows Spent, Your share, You paid and Expenses, worded with "Paid"', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(HOUSEHOLD);
  await expectThemeApplied(page, testInfo);
  const bar = page.getByRole('region', { name: 'All time summary' });
  await expect(bar.getByRole('heading', { level: 2, name: 'All time' })).toBeVisible();
  await expect(bar.getByRole('term')).toHaveText(['Spent', 'Your share', 'You paid', 'Expenses']);
  await expect(bar.getByRole('definition').last()).toHaveText(/^\d+$/);
  await expect(bar.getByRole('button', { name: 'All time', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await bar.getByRole('button', { name: 'This month', exact: true }).click();
  await expect.poll(() => params(page).get('month')).toMatch(/^\d{4}-\d{2}$/);
  const month = page.getByRole('region', { name: / summary$/ });
  await expect(month.getByRole('button', { name: 'This month', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(month.getByRole('button', { name: /^Next month, unavailable/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await month.getByRole('button', { name: /^Previous month/ }).click();
  await expect(page.getByRole('main')).toContainText(/Per member/i);
  await expect(page.getByRole('main')).not.toContainText(/fronted/i);

  // Recurring Expenses are switched off in this suite, so nothing says an Expense repeats.
  await page.goto(HOUSEHOLD);
  await expect(list(page)).toBeVisible();
  await expect(page.getByRole('img', { name: 'Repeats monthly' })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page, testInfo, 'household-expenses');
});

test('a failed load says so and offers Try again, never the raw error', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  let failing = true;
  // The list's read only: the header's and the Month bar's reads go through.
  const listRead = (url: URL) =>
    url.pathname === `/api/groups/${DEMO_GROUP_ID}/expenses` &&
    url.searchParams.get('limit') === '50';
  await page.route(listRead, async (route) => {
    if (failing)
      await route.fulfill({ status: 500, json: { error: 'Internal diagnostic: pool closed' } });
    else await route.continue();
  });
  await page.goto(TRIP);
  const alert = page.getByRole('alert').filter({ hasText: 'Expenses could not be loaded.' });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Internal diagnostic/)).toHaveCount(0);
  failing = false;
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expectShown(page, GOA);
});

for (const [name, path] of [
  ['household', HOUSEHOLD],
  ['trip', TRIP],
] as const) {
  test(`review: the ${name} Expenses tab`, async ({ page }, testInfo) => {
    if (!isPhone(testInfo)) await page.setViewportSize({ width: 1440, height: 1000 });
    await enterAsPersona(page, 'alex');
    await page.goto(path);
    await expectThemeApplied(page, testInfo);
    await expect(list(page)).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(page, testInfo, `${name}-expenses`);
    await reviewScreenshot(page, testInfo, `${name}-expenses`);
  });
}
