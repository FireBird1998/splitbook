import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import {
  DEMO_GROUP_ID,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  expenseItem,
  isPhone,
  reviewScreenshot,
} from './fixtures';

/**
 * The Expense side panel (#311). On a computer, opening an Expense shows it in a panel beside
 * the table, and the open Expense lives in the address (`?expense=`), so reload, Back and a
 * shared link reopen it. Edit, Duplicate and Delete (with Undo) work from the panel. Phones keep
 * #310's card that opens below. Journeys that change data use a Group of Alex's own, so no
 * seeded figure moves; the rest only read the seed.
 */

const TRIP = `/groups/${DEMO_GROUP_ID}/expenses`;
const HOUSEHOLD = '/groups/a00000000000000000000201/expenses';
const ID = /^[a-f\d]{24}$/;

const panelOf = (page: Page, description: string) =>
  page.getByRole('main').getByRole('region', { name: `${description} details` });
const emptyPanel = (page: Page) =>
  page.getByRole('main').getByRole('region', { name: 'Expense details', exact: true });
const openParam = (page: Page) => new URL(page.url()).searchParams.get('expense');

/**
 * Open an Expense from its row (the first, when several share the description), and return its
 * panel once its own read, with history, is in.
 */
async function openFromRow(page: Page, description: string) {
  const toggle = expenseItem(page, description).toggle.first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = panelOf(page, description);
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Loading its history…')).toHaveCount(0);
  return panel;
}

test('an open Expense lives in the address: reload, Back and a shared link reopen it', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'Phones open an Expense below its card (see below).');
  await enterAsPersona(page, 'alex');
  await page.goto(TRIP);
  await expectThemeApplied(page, testInfo);
  await expect(emptyPanel(page)).toContainText('No Expense open');

  const seafood = await openFromRow(page, 'Seafood dinner at Anjuna');
  const seafoodId = openParam(page);
  expect(seafoodId).toMatch(ID);
  await expect(seafood.getByRole('heading', { level: 2 })).toHaveText('Seafood dinner at Anjuna');
  await expect(seafood).toContainText('You owe Priya Shah₹1,440.00');
  await expect(seafood).toContainText('By percentage · 3');
  await expect(seafood.getByRole('table', { name: 'Who owes what' }).getByRole('row')).toHaveText([
    /Paid\s*Share/,
    /^PSPriya Shah₹3,600\.00₹1,080\.00$/,
    /^AR\s*You–nothing₹1,440\.00$/,
    /^SCSam Chen–nothing₹1,080\.00$/,
  ]);
  await expect(seafood).toContainText('Category' + 'Food & Drink');
  await expect(seafood).toContainText('Priya Shah added this Expense');
  await expectNoSeriousA11yViolations(page, testInfo, 'expense-panel');

  // Reloading keeps it open.
  await page.reload();
  await expect(panelOf(page, 'Seafood dinner at Anjuna')).toBeVisible();
  await expect(expenseItem(page, 'Seafood dinner at Anjuna').toggle).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  // Each Expense opened is a step back.
  await openFromRow(page, 'Scooter rental');
  const scooterId = openParam(page);
  expect(scooterId).not.toBe(seafoodId);
  await page.goBack();
  await expect(panelOf(page, 'Seafood dinner at Anjuna')).toBeVisible();
  expect(openParam(page)).toBe(seafoodId);
  await page.goForward();
  await expect(panelOf(page, 'Scooter rental')).toBeVisible();

  // Leaving the tab and coming Back opens it again.
  await page
    .getByRole('navigation', { name: /sections$/ })
    .getByRole('link', { name: 'Balances' })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith('/balances'));
  await page.goBack();
  await expect(panelOf(page, 'Scooter rental')).toBeVisible();

  // A shared link, with a filter beside it, opens the same view.
  await page.goto(`${TRIP}?paidBy=${DEMO_PERSONA_IDS.alex}&expense=${seafoodId}`);
  await expect(panelOf(page, 'Seafood dinner at Anjuna')).toBeVisible();
  await expect(expenseItem(page, 'Scooter rental').item).toBeVisible();
  await expect(expenseItem(page, 'Seafood dinner at Anjuna').item).toHaveCount(0);

  // Closing it leaves the address, and gives focus back to the row it was opened from.
  await page.goto(`${TRIP}?expense=${scooterId}`);
  await panelOf(page, 'Scooter rental')
    .getByRole('button', { name: 'Close Expense details' })
    .click();
  await expect(emptyPanel(page)).toContainText('No Expense open');
  await expect.poll(() => openParam(page)).toBeNull();
  await expect(expenseItem(page, 'Scooter rental').toggle).toBeFocused();
});

test('a leftover paisa is explained by the rule, never as the payer’s', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'The panel is for computers.');
  await enterAsPersona(page, 'alex');
  // Sam paid ₹1,090.00, which doesn't split into three equal paise.
  await page.goto(`${HOUSEHOLD}?search=floor%20cleaner`);
  const panel = await openFromRow(page, 'Weekly groceries and floor cleaner');
  await expect(panel).toContainText('You owe Sam Chen₹363.34');
  const note = panel.getByText(/^The leftover/);
  await expect(note).toHaveText(
    'The leftover ₹0.01 went to you, so the total is exact. It goes to the shares rounded ' +
      'down the most, and a fixed member order settles a tie.',
  );
  await expect(note).not.toContainText(/pa(id|yer)/i);
  await expect(panel).toContainText('NotesAdded the floor cleaner from the same shop');
  await expect(panel).toContainText('Sam Chen changed the description and notes');
  await expect(panel).toContainText(/“[^”]+” → “Weekly groceries and floor cleaner”/);
  // Recurring Expenses are switched off in this suite, so nothing says an Expense repeats.
  await page.goto(`${HOUSEHOLD}?search=Flat%20rent`);
  const rent = await openFromRow(page, 'Flat rent');
  await expect(rent).toContainText('You paid your share');
  await expect(rent).not.toContainText(/Repeats|Monthly/);
});

/** A Group of Alex's own, named for this test, project and run, with one Expense in it. */
async function ownGroupWithExpense(page: Page, testInfo: TestInfo) {
  const run = `${testInfo.project.name} ${Date.now().toString(36)}${testInfo.retry}`;
  const group = await page.request.post('/api/groups', {
    data: { name: `Playwright QA Panel ${run}`, category: 'other', defaultCurrency: 'INR' },
  });
  expect(group.status()).toBe(201);
  const groupId = (await group.json()).data._id as string;
  const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const expense = await page.request.post(`/api/groups/${groupId}/expenses`, {
    data: {
      description: 'Panel QA picnic',
      amount: 100,
      currency: 'INR',
      category: 'food',
      tag: 'Food',
      date: lastWeek,
      notes: 'Bring the blue basket',
      paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 100 }],
      splitMethod: 'equal',
      splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
    },
  });
  expect(expense.status()).toBe(201);
  return { groupId, expenseId: (await expense.json()).data._id as string };
}

/** The browser's own today, as the Expense form writes a date. */
const browserToday = (page: Page) =>
  page.evaluate(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });

/** The browser's own today as the panel writes an Expense's day: "Wed 7 Oct 2026". */
const browserDay = (page: Page) =>
  page.evaluate(() => {
    const now = new Date();
    const part = (options: Intl.DateTimeFormatOptions) => now.toLocaleDateString('en-US', options);
    return `${part({ weekday: 'short' })} ${now.getDate()} ${part({ month: 'short' })} ${now.getFullYear()}`;
  });

test('Edit, Duplicate and Delete with Undo, from the panel', async ({ page }, testInfo) => {
  test.skip(isPhone(testInfo), 'The panel is for computers.');
  await enterAsPersona(page, 'alex');
  const { groupId, expenseId } = await ownGroupWithExpense(page, testInfo);
  await page.goto(`/groups/${groupId}/expenses?expense=${expenseId}`);
  let panel = panelOf(page, 'Panel QA picnic');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Loading its history…')).toHaveCount(0);

  // Edit opens the existing form and sends the Expense's revision.
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit expense' });
  await edit.getByLabel('What was it for?').fill('Panel QA picnic lunch');
  await edit.getByLabel('Amount').fill('150');
  const patch = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith(`/expenses/${expenseId}`),
  );
  await edit.getByRole('button', { name: 'Save changes' }).click();
  expect((await patch).headers()['x-splitbook-revision']).toBe('0');
  await expect(edit).toHaveCount(0);
  panel = panelOf(page, 'Panel QA picnic lunch');
  await expect(panel).toContainText('₹150.00');
  await expect(panel).toContainText('You changed the amount and description');
  await expect(panel).toContainText('₹100.00 → ₹150.00');

  // Duplicate opens the Add expense form with its entries, dated today, and saves a new Expense.
  await panel.getByRole('button', { name: 'Duplicate', exact: true }).click();
  const copy = page.getByRole('dialog', { name: /^Add expense/ });
  await expect(copy.getByLabel('What was it for?')).toHaveValue('Panel QA picnic lunch');
  await expect(copy.getByLabel('Amount')).toHaveValue('150');
  await expect(copy.getByLabel('Date')).toHaveValue(await browserToday(page));
  const post = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith(`/api/groups/${groupId}/expenses`),
  );
  await copy.getByRole('button', { name: 'Save expense' }).click();
  expect((await post).headers()['idempotency-key']).toMatch(/^[\w-]{8,}$/);
  await expect(copy).toHaveCount(0);
  await expect(page.getByText('Expense duplicated')).toBeVisible();
  // The copy joins the list, dated today and so first; the Expense it came from stays open.
  await expect(page.locator('[data-expense-id]')).toHaveCount(2);
  expect(openParam(page)).toBe(expenseId);
  const copied = await openFromRow(page, 'Panel QA picnic lunch');
  const copyId = openParam(page)!;
  expect(copyId).toMatch(ID);
  expect(copyId).not.toBe(expenseId);
  await expect(copied).toContainText(`${await browserDay(page)} · Food`);
  await expect(copied).toContainText('NotesBring the blue basket');
  await expect(copied).toContainText('You added this Expense');

  // Delete keeps its revision and Undo; the panel and the address let it go.
  await panelOf(page, 'Panel QA picnic lunch')
    .getByRole('button', { name: 'Delete Expense' })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Delete Expense' });
  const removal = page.waitForRequest(
    (request) => request.method() === 'DELETE' && request.url().endsWith(`/expenses/${copyId}`),
  );
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await removal).headers()['x-splitbook-revision']).toBe('0');
  await expect(emptyPanel(page)).toContainText('No Expense open');
  await expect(emptyPanel(page)).toBeFocused();
  await expect.poll(() => openParam(page)).toBeNull();
  await expect(page.locator('[data-expense-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-expense-id]')).toHaveCount(2);
  await expect.poll(() => openParam(page)).toBe(copyId);
  await expect(panelOf(page, 'Panel QA picnic lunch')).toBeVisible();
});

test('an Expense that has gone says so, and leaves the address', async ({ page }, testInfo) => {
  test.skip(isPhone(testInfo), 'The panel is for computers.');
  await enterAsPersona(page, 'alex');
  const { groupId, expenseId } = await ownGroupWithExpense(page, testInfo);
  const deleted = await page.request.delete(`/api/groups/${groupId}/expenses/${expenseId}`, {
    headers: { 'X-Splitbook-Revision': '0' },
  });
  expect(deleted.status()).toBe(200);

  await page.goto(`/groups/${groupId}/expenses?expense=${expenseId}`);
  await expect(emptyPanel(page)).toContainText('This Expense isn’t here any more');
  await expect.poll(() => openParam(page)).toBeNull();
  // The Group itself is still there.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Playwright QA Panel/);
  // Closed, it leaves the empty list on its own: there is nothing to pick.
  await emptyPanel(page).getByRole('button', { name: 'Close Expense details' }).click();
  await expect(emptyPanel(page)).toHaveCount(0);
  await expect(page.getByText('No expenses yet')).toBeVisible();

  // An id from no Expense at all reads the same way.
  await page.goto(`/groups/${groupId}/expenses?expense=${'f'.repeat(24)}`);
  await expect(emptyPanel(page)).toContainText('This Expense isn’t here any more');
});

test('phones keep the card, opening the Expense below it', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'Computers get the side panel.');
  await enterAsPersona(page, 'alex');
  await page.goto(TRIP);
  const { toggle, item } = expenseItem(page, 'Seafood dinner at Anjuna');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const details = item.getByRole('region', { name: 'Seafood dinner at Anjuna details' });
  await expect(details).toBeVisible();
  await expect(details).toContainText('Split (By percentage)');
  await expect(details.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.locator('#expense-panel')).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
  // The card stays open on reload.
  expect(openParam(page)).toMatch(ID);
  await page.reload();
  await expect(
    expenseItem(page, 'Seafood dinner at Anjuna').item.getByRole('region', {
      name: 'Seafood dinner at Anjuna details',
    }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, 'expense-card-opened');
});

for (const [name, path, description] of [
  ['household', `${HOUSEHOLD}?search=floor%20cleaner`, 'Weekly groceries and floor cleaner'],
  ['trip', TRIP, 'Beachside villa (3 nights)'],
] as const) {
  test(`review: the panel on a ${name}`, async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'The panel is for computers.');
    await page.setViewportSize({ width: 1440, height: 1100 });
    await enterAsPersona(page, 'alex');
    await page.goto(path);
    await expectThemeApplied(page, testInfo);
    if (name === 'trip') await reviewScreenshot(page, testInfo, 'expense-panel-empty');
    await openFromRow(page, description);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoSeriousA11yViolations(page, testInfo, `expense-panel-${name}`);
    await reviewScreenshot(page, testInfo, `expense-panel-${name}`);
  });
}
