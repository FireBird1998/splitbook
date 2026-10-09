import { expect, test, type Page } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  addExpenseButton,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  isPhone,
  reviewScreenshot,
  switchPersona,
} from './fixtures';

/**
 * Keyboard shortcuts (#322): N adds an Expense and / searches the Group from any page; while
 * the Expense table has focus J and K move, Enter opens the Expense in the side panel and E
 * edits it; hints show beside their controls and a footer on the Expenses tab lists them; and
 * a Settings switch turns single keys off for the member on this device, leaving ⌘K. Forms are
 * opened and closed without saving, so nothing here changes the seed.
 */

const EXPENSES = `/groups/${DEMO_GROUP_ID}/expenses`;
const BALANCES = `/groups/${DEMO_GROUP_ID}/balances`;

const main = (page: Page) => page.getByRole('main');
const footer = (page: Page) =>
  main(page)
    .locator('footer')
    .filter({ has: page.getByRole('heading', { name: 'Keyboard shortcuts' }) });
/** The table's rows' buttons, in order: each opens its Expense in the side panel. */
const rowButtons = (page: Page) =>
  main(page)
    .getByRole('region', { name: /^Expenses/ })
    .locator('tr[data-expense-id] button[aria-expanded]');
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /^Search Expenses in / });
const addHint = (page: Page) => addExpenseButton(page).locator('kbd');
const formDialog = (page: Page) => page.getByRole('dialog', { name: /^Add expense/ });
const editDialog = (page: Page) => page.getByRole('dialog', { name: 'Edit expense' });
const chooserDialog = (page: Page) => page.getByRole('dialog', { name: 'Choose a Group' });
const searchDialog = (page: Page) => page.getByRole('dialog', { name: 'Search', exact: true });
const shortcutsSwitch = (page: Page) => page.getByRole('switch', { name: 'Single-key shortcuts' });

/** The description each row's button starts with, in order. */
const descriptions = (page: Page) =>
  rowButtons(page).evaluateAll((buttons) =>
    buttons.map((button) => button.firstElementChild?.textContent?.trim() ?? ''),
  );

/**
 * The page has read this device's setting and its handlers are listening: the top bar's Add
 * expense shows N only then.
 */
async function shortcutsReady(page: Page) {
  await expect(addHint(page)).toBeVisible();
}

/** Open search with ⌘K (Ctrl+K), retrying until the page has hydrated. */
async function openSearchByShortcut(page: Page) {
  await expect(async () => {
    if (!(await searchDialog(page).isVisible())) await page.keyboard.press('ControlOrMeta+k');
    await expect(searchDialog(page)).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

test('the keyboard path through the Expense table: J and K move, Enter opens, E edits', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'The table and its keys are for computers; phones list cards.');
  await enterAsPersona(page, 'alex');
  await page.goto(EXPENSES);
  await expectThemeApplied(page, testInfo);
  await shortcutsReady(page);
  const buttons = rowButtons(page);
  await expect(buttons.nth(3)).toBeVisible();
  const names = await descriptions(page);

  // The footer lists the keys; there is no X, since nothing selects rows.
  await expect(footer(page)).toBeVisible();
  await expect(footer(page).locator('dt, dd')).toHaveText([
    'JK',
    'Move',
    'Enter',
    'Open',
    'E',
    'Edit',
    'N',
    'New expense',
    '/',
    'Search',
  ]);
  await expect(footer(page)).toContainText('Shortcuts pause while you type in a field.');
  await expectNoSeriousA11yViolations(page, testInfo, 'shortcuts-expenses');
  await reviewScreenshot(page, testInfo, 'shortcuts-expenses');

  // Focus the table, on its first row, then move down and back up; K stops at the top.
  await buttons.first().focus();
  await page.keyboard.press('j');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('j');
  await expect(buttons.nth(2)).toBeFocused();
  await page.keyboard.press('k');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('j');
  await expect(buttons.nth(1)).toBeFocused();

  // Enter opens the row's Expense in the side panel, kept in the address.
  await page.keyboard.press('Enter');
  await expect(buttons.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(main(page).getByRole('region', { name: `${names[1]} details` })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('expense')).toMatch(/^[a-f\d]{24}$/);
  await expect(buttons.nth(1)).toBeFocused();
  await expectNoSeriousA11yViolations(page, testInfo, 'shortcuts-expense-open');

  // E edits it, and closing the form puts focus back on its row.
  await page.keyboard.press('e');
  await expect(editDialog(page)).toBeVisible();
  await expect(editDialog(page).getByLabel('What was it for?')).toHaveValue(names[1]);
  // In the form's fields the keys type: nothing else opens.
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(editDialog(page)).toHaveCount(0);
  await expect(buttons.nth(1)).toBeFocused();

  // E edits the row the keyboard is on, even while another Expense is open.
  await page.keyboard.press('j');
  await expect(buttons.nth(2)).toBeFocused();
  await page.keyboard.press('e');
  await expect(editDialog(page).getByLabel('What was it for?')).toHaveValue(names[2]);
  await page.keyboard.press('Escape');
  await expect(editDialog(page)).toHaveCount(0);
  await expect(main(page).getByRole('region', { name: `${names[1]} details` })).toBeVisible();

  // X selects nothing: the table has no row selection.
  await page.keyboard.press('x');
  await expect(buttons.nth(2)).toBeFocused();
  await expect(
    main(page)
      .getByRole('region', { name: /^Expenses/ })
      .getByRole('checkbox'),
  ).toHaveCount(0);
});

test('J and K skip Trip day headings while every Expense keeps its Tab stop', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'Trip table navigation is for computers; phones list cards.');
  await enterAsPersona(page, 'alex');
  await page.goto('/groups/a00000000000000000000202/expenses');
  await shortcutsReady(page);
  const table = main(page)
    .getByRole('region', { name: /^Expenses/ })
    .getByRole('table');
  const buttons = rowButtons(page);
  await expect(table.locator('tr[data-trip-day]').nth(1)).toBeVisible();
  await expect(buttons.nth(2)).toBeVisible();
  // At least one heading sits between two Expense rows: crossing it is observable here.
  expect(
    await table
      .locator('tr[data-trip-day]')
      .evaluateAll((headings) =>
        headings.some(
          (heading) =>
            heading.previousElementSibling?.hasAttribute('data-expense-id') &&
            heading.nextElementSibling?.hasAttribute('data-expense-id'),
        ),
      ),
  ).toBe(true);
  const count = await buttons.count();
  await buttons.first().focus();
  for (let index = 1; index < count; index++) {
    await page.keyboard.press('j');
    await expect(buttons.nth(index)).toBeFocused();
  }
  await page.keyboard.press('j');
  await expect(buttons.last()).toBeFocused();
  for (let index = count - 2; index >= 0; index--) {
    await page.keyboard.press('k');
    await expect(buttons.nth(index)).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(buttons.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(buttons.nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(buttons.nth(1)).toBeFocused();
  await expect(table.locator('tr[data-trip-day]').nth(1)).toBeVisible();
});

test('N adds an Expense and / searches the Group, from any page, never while typing', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'Hints are for computers (see the phone test below).');
  await enterAsPersona(page, 'alex');
  await page.goto(EXPENSES);
  await shortcutsReady(page);

  // The hints sit beside their controls, which name the keys to screen readers.
  await expect(addHint(page)).toHaveText('N');
  await expect(addExpenseButton(page)).toHaveAttribute('aria-keyshortcuts', 'N');
  await expect(searchBox(page)).toHaveAttribute('aria-keyshortcuts', '/');
  await expect(main(page).getByRole('search').locator('kbd')).toHaveText('/');

  // N opens this Group's form, as the top bar's button does.
  await page.keyboard.press('n');
  await expect(formDialog(page)).toBeVisible();
  await expect(chooserDialog(page)).toHaveCount(0);
  await expect(formDialog(page).getByText(DEMO_TRIP_NAME, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(formDialog(page)).toHaveCount(0);

  // / puts the cursor in the Group's search, where keys type.
  await page.keyboard.press('/');
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.type('n/');
  await expect(searchBox(page)).toHaveValue('n/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await searchBox(page).fill('');

  // On another tab, / opens the Expenses tab with its search ready.
  await page.goto(BALANCES);
  await shortcutsReady(page);
  await page.keyboard.press('/');
  await page.waitForURL((url) => url.pathname === EXPENSES);
  await expect(searchBox(page)).toBeFocused();

  // Outside a Group, N asks which Group first, and / opens search across Groups.
  await page.goto('/dashboard');
  await shortcutsReady(page);
  await page.keyboard.press('n');
  await expect(chooserDialog(page)).toBeVisible();
  // While a dialog is open, single keys do nothing: / opens no search over it, so one Escape
  // closes the chooser itself.
  await page.keyboard.press('/');
  await page.keyboard.press('Escape');
  await expect(chooserDialog(page)).toHaveCount(0);
  await expect(searchDialog(page)).toHaveCount(0);
  await page.keyboard.press('/');
  await expect(searchDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(searchDialog(page)).toHaveCount(0);
});

test('the Settings switch turns single keys off for this member on this device; ⌘K stays', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'The keys and hints are for computers.');
  await enterAsPersona(page, 'alex');
  await page.goto('/settings');
  await expectThemeApplied(page, testInfo);
  // The profile has loaded, so Save is settled before axe looks at it.
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Alex Rivera');
  const toggle = shortcutsSwitch(page);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAccessibleDescription(
    /^N adds an Expense, \/ searches the Group.*⌘K \(Ctrl\+K\) search keeps working/,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'settings-shortcuts');
  await reviewScreenshot(page, testInfo, 'settings-shortcuts');

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  // Kept on this device.
  await page.reload();
  await expect(shortcutsSwitch(page)).toBeEnabled();
  await expect(shortcutsSwitch(page)).not.toBeChecked();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Alex Rivera');
  await expectNoSeriousA11yViolations(page, testInfo, 'settings-shortcuts-off');

  await page.goto(EXPENSES);
  const buttons = rowButtons(page);
  await expect(buttons.nth(1)).toBeVisible();
  // ⌘K still opens search.
  await openSearchByShortcut(page);
  await page.keyboard.press('Escape');
  await expect(searchDialog(page)).toHaveCount(0);

  // The hints are gone, but for ⌘K's.
  await expect(footer(page)).toHaveCount(0);
  await expect(addHint(page)).toHaveCount(0);
  await expect(addExpenseButton(page)).not.toHaveAttribute('aria-keyshortcuts');
  await expect(searchBox(page)).not.toHaveAttribute('aria-keyshortcuts');
  await expect(main(page).getByRole('search').locator('kbd')).toHaveCount(0);
  await expect(page.getByRole('banner').locator('kbd')).toHaveText(/^(⌘K|Ctrl K)$/);

  // N, / and the table's keys do nothing; ⌘K, pressed after them, shows the keys were heard.
  await page.keyboard.press('n');
  await page.keyboard.press('/');
  await expect(searchBox(page)).not.toBeFocused();
  await buttons.first().focus();
  await page.keyboard.press('j');
  await page.keyboard.press('e');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(searchDialog(page)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(searchDialog(page)).toHaveCount(0);

  // Every row is still reachable with Tab, and Enter still opens one: nothing needs a shortcut.
  await buttons.first().focus();
  await page.keyboard.press('Tab');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(buttons.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expectNoSeriousA11yViolations(page, testInfo, 'shortcuts-off-expenses');

  // Another member on this device keeps their own setting.
  await switchPersona(page, 'sam');
  await page.goto(EXPENSES);
  await shortcutsReady(page);
  await expect(footer(page)).toBeVisible();
  await page.keyboard.press('n');
  await expect(formDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(formDialog(page)).toHaveCount(0);
});

test('phones show no hints and no footer', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'Phone layouts only.');
  await enterAsPersona(page, 'alex');
  await page.goto(EXPENSES);
  await expect(searchBox(page)).toBeVisible();
  // The setting is read (Settings' switch can be used) and still nothing shows.
  await expect(footer(page)).toBeHidden();
  await expect(page.locator('[data-shortcut-hint]').first()).toBeHidden();
  await page.goto('/settings');
  await expect(shortcutsSwitch(page)).toBeEnabled();
  await expect(shortcutsSwitch(page)).toBeChecked();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Alex Rivera');
  await expectNoSeriousA11yViolations(page, testInfo, 'settings-shortcuts-phone');
});
