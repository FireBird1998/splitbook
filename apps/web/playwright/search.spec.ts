import { expect, test, type Page } from '@playwright/test';
import { DEMO_PERSONA_IDS, DEMO_WEEK_TRIP_ID } from '../src/lib/demo-personas';
import {
  DEMO_GROUP_ID,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  reviewScreenshot,
} from './fixtures';

/**
 * Search across the member's Groups (#321): the top bar's search and ⌘K (Ctrl+K off Apple
 * devices) open one dialog, whose results jump to a Group, to the first Group shared with a
 * person, or to an Expense's Group with its Expense list searched for it. Search only reads,
 * so these journeys never change the seed.
 */

const SEARCH = 'Search Expenses, Groups and people';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Search', exact: true });
const field = (page: Page) => dialog(page).getByRole('combobox', { name: SEARCH });
const results = (page: Page) => dialog(page).getByRole('listbox', { name: 'Search results' });
const section = (page: Page, name: 'Groups' | 'People' | 'Expenses') =>
  results(page).getByRole('group', { name });
/** The top bar's search: a field on wider screens, an icon button on phones. */
const launcher = (page: Page) => page.getByRole('banner').getByRole('button', { name: SEARCH });

/** Open search by clicking the top bar; a click before the page hydrates does nothing, so retry. */
async function openByClick(page: Page) {
  await expect(async () => {
    if (!(await dialog(page).isVisible())) await launcher(page).click({ timeout: 1_000 });
    await expect(dialog(page)).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(field(page)).toBeFocused();
}

/** Open search with the shortcut, retrying until the page has hydrated. */
async function openByShortcut(page: Page) {
  await expect(async () => {
    if (!(await dialog(page).isVisible())) await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog(page)).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(field(page)).toBeFocused();
}

test('the top bar’s search and the shortcut open the dialog, and Escape closes it', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);

  await expect(launcher(page)).toHaveAttribute('aria-haspopup', 'dialog');
  await openByClick(page);
  await expect(dialog(page)).toContainText('Search your Groups');
  await expect(field(page)).toHaveAttribute('aria-expanded', 'false');
  await expectNoSeriousA11yViolations(page, testInfo, 'search-empty');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();

  await openByShortcut(page);
  // In the search field, the shortcut closes the search again.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog(page)).toHaveCount(0);

  // The Close button closes it too, and each opening starts empty.
  await openByShortcut(page);
  await field(page).fill('goa');
  await dialog(page).getByRole('button', { name: 'Close search' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await openByShortcut(page);
  await expect(field(page)).toHaveValue('');
});

test('the shortcut never fires while typing in another field', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}/expenses`);
  const expenseSearch = page
    .getByRole('main')
    .getByRole('searchbox', { name: /^Search Expenses in / });
  await expect(expenseSearch).toBeVisible();
  // Hydrated: the shortcut works from the page itself.
  await openByShortcut(page);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  await expenseSearch.click();
  await expenseSearch.pressSequentially('sea');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog(page)).toHaveCount(0);
  await expect(expenseSearch).toBeFocused();
});

test('search the seed with the keyboard and jump to a Group', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await openByShortcut(page);
  await field(page).pressSequentially('kochi');

  const groups = section(page, 'Groups').getByRole('option');
  await expect(groups).toHaveCount(1);
  await expect(groups).toHaveAccessibleName('Kochi to Alleppey, Trip · 3 members');
  // Expenses whose descriptions have a word starting "kochi", newest first.
  const expenses = section(page, 'Expenses').getByRole('option');
  await expect(expenses).toHaveCount(2);
  await expect(expenses.nth(0)).toHaveAccessibleName(
    /^Fort Kochi homestay \(2 nights\), Kochi to Alleppey · .+, ₹/,
  );
  await expect(expenses.nth(1)).toHaveAccessibleName(
    /^Train to Kochi \(3 × AC 2-tier\), Kochi to Alleppey · .+, ₹/,
  );
  await expect(dialog(page).getByRole('status')).toHaveText('1 Group and 2 Expenses');
  const options = results(page).getByRole('option');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(field(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(field(page)).toHaveAttribute(
    'aria-activedescendant',
    (await options.first().getAttribute('id'))!,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'search-results');
  await reviewScreenshot(page, testInfo, 'search-results');

  // The arrow keys move through the results and wrap; focus stays in the field.
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(options.last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(field(page)).toBeFocused();

  await page.keyboard.press('Enter');
  // The Group's own address lands on its Expenses tab (#305).
  await page.waitForURL((url) => url.pathname === `/groups/${DEMO_WEEK_TRIP_ID}/expenses`);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Kochi to Alleppey').first()).toBeVisible();
});

test('jump to an Expense’s Group, with its Expense list searched for it', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await openByClick(page);
  await field(page).pressSequentially('anjuna sea');
  const expense = section(page, 'Expenses').getByRole('option', {
    name: /^Seafood dinner at Anjuna, Goa Friends Trip · .+, ₹[\d,]+\.\d{2}$/,
  });
  await expect(expense).toBeVisible();
  await expect(results(page).getByRole('group')).toHaveCount(1);

  await expense.click();
  await page.waitForURL(
    (url) =>
      url.pathname === `/groups/${DEMO_GROUP_ID}/expenses` &&
      url.searchParams.get('search') === 'Seafood dinner at Anjuna',
  );
  await expect(dialog(page)).toHaveCount(0);
  const main = page.getByRole('main');
  await expect(main.getByRole('searchbox', { name: /^Search Expenses in / })).toHaveValue(
    'Seafood dinner at Anjuna',
  );
  await expect(main.getByText('Seafood dinner at Anjuna')).toBeVisible();
  await expect(main.getByText('Scooter rental')).toHaveCount(0);

  // Another Expense of the same Group, chosen from its Expenses tab, searches the list again.
  await openByShortcut(page);
  await field(page).pressSequentially('scooter');
  await section(page, 'Expenses')
    .getByRole('option', { name: /^Scooter rental, / })
    .click();
  await page.waitForURL((url) => url.searchParams.get('search') === 'Scooter rental');
  await expect(main.getByRole('searchbox', { name: /^Search Expenses in / })).toHaveValue(
    'Scooter rental',
  );
  await expect(main.getByText('Scooter rental')).toBeVisible();
  await expect(main.getByText('Seafood dinner at Anjuna')).toHaveCount(0);
});

test('people by name only, and only in the member’s own Groups', async ({ page }) => {
  // Priya isn't in the Studio Lunch Club (Alex has only invited her), so it is never searched.
  await enterAsPersona(page, 'priya');
  await openByShortcut(page);
  await field(page).pressSequentially('studio');
  await expect(dialog(page)).toContainText('No results for “studio”');
  await expect(dialog(page).getByRole('status')).toHaveText('No results');

  await field(page).fill('');
  const read = page.waitForResponse((response) =>
    response.url().endsWith('/api/search?q=sam%20chen'),
  );
  await field(page).pressSequentially('sam chen');
  const body = await (await read).text();
  expect(body).not.toContain('@');
  expect(body).not.toMatch(/email/i);

  const sam = section(page, 'People').getByRole('option');
  await expect(sam).toHaveAccessibleName(/^Sam Chen, In .+ and 2 other Groups$/);
  await expect(dialog(page)).not.toContainText('@');
  const href = await sam.getAttribute('href');
  const { data } = JSON.parse(body);
  expect(data.people).toEqual([
    expect.objectContaining({ id: DEMO_PERSONA_IDS.sam, name: 'Sam Chen', groupCount: 3 }),
  ]);
  expect(href).toBe(`/groups/${data.people[0].groupId}`);
  await sam.click();
  await page.waitForURL((url) => url.pathname === `${href}/expenses`);
});

test('a failed search says so, and Try again searches again', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  let failing = true;
  await page.route('**/api/search?*', async (route) => {
    if (failing) await route.fulfill({ status: 500, json: { error: 'Internal diagnostic' } });
    else await route.fallback();
  });
  await openByShortcut(page);
  await field(page).pressSequentially('goa');
  await expect(dialog(page)).toContainText('Search didn’t load');
  await expect(dialog(page)).not.toContainText('Internal diagnostic');
  failing = false;
  await dialog(page).getByRole('button', { name: 'Try again' }).click();
  await expect(section(page, 'Groups').getByRole('option')).toHaveAccessibleName(
    /^Goa Friends Trip, Trip · /,
  );
});
