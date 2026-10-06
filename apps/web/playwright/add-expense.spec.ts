import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { DEMO_WORK_GROUP_ID } from '../src/lib/demo-personas';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  isPhone,
  reviewScreenshot,
} from './fixtures';

/**
 * Add expense from anywhere (#304): the top bar's primary button. Outside a Group it asks which
 * Group first; inside one it opens that Group's Expense form. Either way the member stays on the
 * page, a confirmation names the Group, and the Group's figures refresh. Journeys elsewhere
 * change balances, so figures are compared with what this journey saw before saving.
 *
 * Expenses go to the seeded Work Group, Alex's and Sam's only: the journeys check Priya's
 * seeded balance exactly, so nothing here may touch a Group she is in.
 */

const WORK_GROUP_NAME = 'Studio Lunch Club';

/** The top bar's button: labelled on desktop, an icon button with the same name on phones. */
const addExpenseButton = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: 'Add expense', exact: true });

/** Click Add expense until `dialog` opens: a click that lands before hydration does nothing. */
async function openFromTopBar(page: Page, dialog: Locator) {
  await expect(async () => {
    if (!(await dialog.isVisible())) await addExpenseButton(page).click({ timeout: 1_000 });
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

const chooserDialog = (page: Page) => page.getByRole('dialog', { name: 'Choose a Group' });
const formDialog = (page: Page) => page.getByRole('dialog', { name: /^Add expense/ });

/**
 * Fill and save the form, and wait for the save and for each read in `rereads` to be made again
 * after it: the refetches that refresh the figures on screen.
 */
async function saveExpense(page: Page, { groupId, description, amount, rereads }: SaveExpense) {
  const form = formDialog(page);
  await form.getByLabel('What was it for?').fill(description);
  await form.getByLabel('Amount').fill(amount);
  let saved = false;
  const save = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/groups/${groupId}/expenses`,
    )
    .then((response: Response) => {
      saved = true;
      return response;
    });
  const reads = rereads.map((pathname) =>
    page.waitForResponse(
      (response) =>
        saved &&
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === pathname,
    ),
  );
  await form.getByRole('button', { name: 'Save expense' }).click();
  expect((await save).status()).toBe(201);
  for (const read of reads) expect((await read).ok()).toBe(true);
  await expect(form).toHaveCount(0);
}

interface SaveExpense {
  groupId: string;
  description: string;
  amount: string;
  /** Reads the page shows figures from, which the save must have made again. */
  rereads: string[];
}

test('from Home: choose a Group, add the Expense, and stay on Home with a confirmation', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);

  const button = addExpenseButton(page);
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  if (isPhone(testInfo)) {
    // An icon button that fits the 390 px top bar on one line.
    expect(box).toMatchObject({ width: 44, height: 44 });
    await expect(button.getByText('Add expense')).not.toBeInViewport();
    const header = (await page.getByRole('banner').boundingBox())!;
    expect(header.height).toBe(68);
  } else {
    expect(box.height).toBe(44);
    await expect(button.getByText('Add expense')).toBeVisible();
  }

  // The Group's line in the sidebar, before the Expense: it changes once the save lands.
  const sidebarRow = page
    .getByRole('complementary', { name: 'Splitbook' })
    .getByRole('navigation', { name: 'Your Groups' })
    .getByRole('link', { name: new RegExp(`^${WORK_GROUP_NAME} `) });
  const before = isPhone(testInfo)
    ? null
    : await sidebarRow.evaluate((element) => element.textContent);

  const chooser = chooserDialog(page);
  await openFromTopBar(page, chooser);
  await expect(chooser).toHaveAccessibleDescription('Pick the Group this expense belongs to.');
  const groups = chooser.getByRole('list', { name: 'Your Groups' });
  await expect(
    groups.getByRole('button', { name: new RegExp(`^${WORK_GROUP_NAME} `) }),
  ).toBeVisible();
  await expect(
    groups.getByRole('button', { name: new RegExp(`^${DEMO_TRIP_NAME} `) }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, 'add-expense-chooser');
  await reviewScreenshot(page, testInfo, 'add-expense-chooser');

  await groups.getByRole('button', { name: new RegExp(`^${WORK_GROUP_NAME} `) }).click();
  await expect(chooser).toHaveCount(0);
  const form = formDialog(page);
  await expect(form).toBeVisible();
  // The form names the Group it adds to.
  await expect(form.getByText(WORK_GROUP_NAME, { exact: true })).toBeVisible();

  const description = `Top bar lunch ${testInfo.project.name}`;
  // Home's balances, which the sidebar reads too, and its Groups list.
  await saveExpense(page, {
    groupId: DEMO_WORK_GROUP_ID,
    description,
    amount: '90',
    rereads: ['/api/user/balances', '/api/groups'],
  });

  // Still on Home, told where the Expense went, and back on the button.
  expect(new URL(page.url()).pathname).toBe('/dashboard');
  await expect(page.getByRole('alert').filter({ hasText: 'Expense added to' })).toHaveText(
    `Expense added to ${WORK_GROUP_NAME}`,
  );
  await expect(button).toBeFocused();
  if (before !== null) await expect(sidebarRow).not.toHaveText(before);

  // The Expense is in the Group.
  await page.goto(`/groups/${DEMO_WORK_GROUP_ID}`);
  await expect(
    page.getByRole('main').getByRole('button', { name: new RegExp(`^${description}, ₹90\\.00`) }),
  ).toBeVisible();
});

test('inside a Group: the form opens for that Group, with no chooser', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_WORK_GROUP_ID}`);
  const main = page.getByRole('main');
  await expect(main.getByText(WORK_GROUP_NAME).first()).toBeVisible();

  const form = formDialog(page);
  await openFromTopBar(page, form);
  await expect(chooserDialog(page)).toHaveCount(0);
  await expect(form.getByText(WORK_GROUP_NAME, { exact: true })).toBeVisible();
  await reviewScreenshot(page, testInfo, 'add-expense-in-group');

  const description = `Top bar taxi ${testInfo.project.name}`;
  // The Group page's balances; on desktop also the member's balances, for the sidebar.
  await saveExpense(page, {
    groupId: DEMO_WORK_GROUP_ID,
    description,
    amount: '240',
    rereads: [
      `/api/groups/${DEMO_WORK_GROUP_ID}/balances`,
      ...(isPhone(testInfo) ? [] : ['/api/user/balances']),
    ],
  });

  expect(new URL(page.url()).pathname).toBe(`/groups/${DEMO_WORK_GROUP_ID}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Expense added to' })).toHaveText(
    `Expense added to ${WORK_GROUP_NAME}`,
  );
  // The Group's own list refreshes with the new Expense.
  await expect(
    main.getByRole('button', { name: new RegExp(`^${description}, ₹240\\.00`) }),
  ).toBeVisible();
});

test('the ?action=add-expense link still opens the Group’s form', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}?action=add-expense`);
  const form = formDialog(page);
  await expect(form).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(form.getByLabel('What was it for?')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a member with no Groups is told to create one first', async ({ page }, testInfo) => {
  await page.route('**/api/groups', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { status: 200, data: [] } })
      : route.fallback(),
  );
  await enterAsPersona(page, 'alex');

  const chooser = chooserDialog(page);
  await openFromTopBar(page, chooser);
  await expect(chooser.getByRole('heading', { name: 'No Groups yet' })).toBeVisible();
  await expect(chooser).toContainText('Create a Group first, then add expenses to it.');
  await expectNoSeriousA11yViolations(page, testInfo, 'add-expense-no-groups');
  await chooser.getByRole('link', { name: 'Create a Group' }).click();
  await page.waitForURL((url) => url.pathname === '/groups/new');
  await expect(chooser).toHaveCount(0);
});
