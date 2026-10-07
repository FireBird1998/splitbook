import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  expenseItem,
  reviewScreenshot,
} from './fixtures';

/**
 * Quick add (#320): one line above a Group's Expenses, read into chips on the page and added
 * with Enter through the full form's own request. A lost reply is covered by the
 * expense-access suite (`quick-add-retry.spec.ts`), which can intercept a committed write.
 *
 * Other specs check the seeded Groups exactly, so every Expense here goes to a Household the
 * test creates for Alex alone (its Tags are the Household defaults: General, Rent, Utilities,
 * Groceries, Internet and Household). Reading a line in a seeded Group sends nothing.
 */

async function createOwnGroup(page: Page, testInfo: TestInfo, label: string) {
  const name = `Playwright QA Quick add ${label} ${testInfo.project.name} ${Date.now().toString(36)}${testInfo.repeatEachIndex}${testInfo.retry}`;
  const response = await page.request.post('/api/groups', {
    data: { name, category: 'home', defaultCurrency: 'INR' },
  });
  expect(response.status()).toBe(201);
  const { data } = await response.json();
  const tags = Object.fromEntries(
    (data.tags as Array<{ _id: string; name: string }>).map((tag) => [tag.name, tag._id]),
  );
  return { id: data._id as string, name, tags };
}

const quickAdd = (page: Page) => page.getByRole('region', { name: 'Quick add' });
const field = (page: Page) => page.getByRole('textbox', { name: 'Quick add' });
const chipList = (page: Page) =>
  quickAdd(page).getByRole('list', { name: 'How Splitbook reads it' });
const addButton = (page: Page) =>
  quickAdd(page).getByRole('button', { name: 'Add expense', exact: true });

/** Type a line once the page has hydrated: a fill before then is lost, so retry until it reads. */
async function type(page: Page, line: string) {
  await expect(async () => {
    await field(page).fill(line);
    await expect(chipList(page)).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** The browser's own today, as Quick add dates an Expense: `yyyy-MM-dd` in its zone. */
function browserDay(page: Page, daysBack = 0) {
  return page.evaluate((back) => {
    const date = new Date();
    date.setDate(date.getDate() - back);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }, daysBack);
}

const isCreate = (groupId: string) => (request: Request) =>
  request.method() === 'POST' &&
  new URL(request.url()).pathname === `/api/groups/${groupId}/expenses`;

test('Enter adds the line as read; the field clears and the table shows it', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const group = await createOwnGroup(page, testInfo, 'Enter');
  await page.goto(`/groups/${group.id}/expenses`);
  await expectThemeApplied(page, testInfo);

  const description = `Groceries run ${testInfo.project.name}`;
  await type(page, `${description.toLowerCase()} 450.50 paid by me`);
  const chips = chipList(page);
  await expect(chips.getByRole('listitem')).toHaveCount(6);
  await expect(chips).toContainText(`Description${description}`);
  await expect(chips).toContainText('Amount₹450.50');
  await expect(chips.getByRole('button', { name: 'Paid by: you. Change who paid' })).toBeVisible();
  await expect(chips).toContainText('Equally · 1');
  await expect(chips).toContainText(/Today, \d{1,2} [A-Z][a-z]{2}/);
  // The description names one of the Group's own Tags, so it's suggested.
  await expect(
    chips.getByRole('button', { name: 'Tag: Groceries, suggested, not chosen yet. Change Tag' }),
  ).toBeVisible();
  await expect(quickAdd(page)).toContainText(
    'Only you share it, so nobody owes you anything. Groceries is a suggestion',
  );
  await expect(field(page)).toHaveAccessibleDescription(
    /Only you share it.*Read on this page as you type\. Nothing is sent until you add it\./,
  );

  const created = page.waitForRequest(isCreate(group.id));
  const saved = page.waitForResponse((response) => isCreate(group.id)(response.request()));
  await field(page).press('Enter');
  const request = await created;
  expect((await saved).status()).toBe(201);
  // The full form's request: its idempotency key, the Tag by id, exact money, today here.
  expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(request.postDataJSON()).toMatchObject({
    description,
    amount: 450.5,
    amountMinor: 45050,
    currency: 'INR',
    category: 'other',
    date: await browserDay(page),
    splitMethod: 'equal',
    tagId: group.tags.Groceries,
    notes: '',
  });

  await expect(field(page)).toHaveValue('');
  await expect(field(page)).toBeFocused();
  await expect(chipList(page)).toHaveCount(0);
  await expect(quickAdd(page)).toContainText(`Added ${description}, ₹450.50.`);
  await expect(expenseItem(page, description).item).toContainText('₹450.50');
});

test('a Tag must be chosen before Enter works when none of the Group’s fits', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const group = await createOwnGroup(page, testInfo, 'Tag needed');
  await page.goto(`/groups/${group.id}/expenses`);
  await expectThemeApplied(page, testInfo);

  const description = `Dinner ${testInfo.project.name}`;
  await type(page, `${description} 2400`);
  const tagChip = chipList(page).getByRole('button', { name: 'Tag needed. Choose a Tag' });
  await expect(tagChip).toBeVisible();
  await expect(quickAdd(page)).toContainText(
    'Choose a Tag before adding. Every Expense needs one.',
  );
  await expect(addButton(page)).toBeDisabled();
  await expect(field(page)).not.toHaveAttribute('aria-invalid', 'true');
  await expectNoSeriousA11yViolations(page, testInfo, 'quick-add-tag-needed');
  await reviewScreenshot(page, testInfo, 'quick-add-tag-needed');

  // Enter sends nothing, and says why.
  let sent = 0;
  page.on('request', (request) => {
    if (isCreate(group.id)(request)) sent += 1;
  });
  await field(page).press('Enter');
  await expect(
    quickAdd(page).getByRole('status').filter({ hasText: 'Choose a Tag before adding' }),
  ).toBeAttached();
  expect(sent).toBe(0);

  await tagChip.click();
  await page.getByRole('menuitemradio', { name: 'Household' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(
    chipList(page).getByRole('button', { name: 'Tag: Household. Change Tag' }),
  ).toBeVisible();
  await expect(addButton(page)).toBeEnabled();

  const saved = page.waitForResponse((response) => isCreate(group.id)(response.request()));
  await field(page).press('Enter');
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ tagId: group.tags.Household });
  expect(sent).toBe(1);
  await expect(field(page)).toHaveValue('');
  await expect(expenseItem(page, description).item).toContainText('₹2,400.00');
});

test('too many decimal places are refused, linked to the field, and nothing is sent', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  // Only reads: the seeded trip's Tags suggest Food for coffee, and nothing is added.
  await page.goto(`/groups/${DEMO_GROUP_ID}/expenses`);
  await expectThemeApplied(page, testInfo);
  let sent = 0;
  page.on('request', (request) => {
    if (isCreate(DEMO_GROUP_ID)(request)) sent += 1;
  });

  await type(page, 'Coffee 120.505');
  await expect(chipList(page)).toContainText('AmountCheck decimals');
  await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(field(page)).toHaveAccessibleDescription(
    /^INR amounts have at most 2 decimal places\. Nothing is rounded for you\./,
  );
  await expect(addButton(page)).toBeDisabled();
  await expectNoSeriousA11yViolations(page, testInfo, 'quick-add-decimals');
  await reviewScreenshot(page, testInfo, 'quick-add-decimals');
  await field(page).press('Enter');

  // Fixed, it reads again; Escape clears the line without sending anything.
  await field(page).fill('Coffee 120.50');
  await expect(chipList(page)).toContainText('Amount₹120.50');
  await expect(field(page)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(
    chipList(page).getByRole('button', {
      name: 'Tag: Food, suggested, not chosen yet. Change Tag',
    }),
  ).toBeVisible();
  await field(page).press('Escape');
  await expect(field(page)).toHaveValue('');
  await expect(chipList(page)).toHaveCount(0);
  expect(sent).toBe(0);
});

test('More options opens the full form with what was read, and saving it clears the field', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const group = await createOwnGroup(page, testInfo, 'More options');
  await page.goto(`/groups/${group.id}/expenses`);
  await expectThemeApplied(page, testInfo);

  const description = `Taxi home ${testInfo.project.name}`;
  await type(page, `${description} 300 yesterday`);
  await expect(chipList(page)).toContainText(/Yesterday, \d{1,2} [A-Z][a-z]{2}/);
  await quickAdd(page).getByRole('button', { name: 'More options', exact: true }).click();

  const form = page.getByRole('dialog', { name: /^Add expense/ });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('What was it for?')).toHaveValue(description);
  await expect(form.getByLabel('Amount')).toHaveValue('300');
  await expect(form.getByLabel('Date')).toHaveValue(await browserDay(page, 1));
  await expect(form).toContainText('You paid · Split equally · All 1 members');
  // No Tag fitted, so none is picked for the member: the form waits for one.
  await expect(form.getByRole('button', { name: 'Save expense' })).toBeDisabled();
  await expectNoSeriousA11yViolations(page, testInfo, 'quick-add-more-options');
  await form.getByRole('button', { name: 'Utilities' }).click();

  const saved = page.waitForResponse((response) => isCreate(group.id)(response.request()));
  await form.getByRole('button', { name: 'Save expense' }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({
    description,
    amountMinor: 30000,
    date: await browserDay(page, 1),
    tagId: group.tags.Utilities,
  });
  await expect(form).toHaveCount(0);
  await expect(field(page)).toHaveValue('');
  await expect(expenseItem(page, description).item).toContainText('₹300.00');
});

test('reads a line in a seeded Group without sending it, with no serious axe findings', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}/expenses`);
  await expectThemeApplied(page, testInfo);
  // The empty field: labelled, described, and nothing read.
  await expect(field(page)).toHaveAttribute('placeholder', 'Dinner 2400 paid by me');
  await expect(field(page)).toHaveAccessibleDescription(
    'Read on this page as you type. Nothing is sent until you add it.',
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'quick-add-empty');

  await type(page, 'Dinner 2400 paid by me');
  const chips = chipList(page);
  await expect(chips).toContainText('DescriptionDinner');
  await expect(chips).toContainText('Amount₹2,400.00');
  await expect(chips).toContainText('Equally · 3');
  await expect(quickAdd(page)).toContainText('Sam and Priya each owe you ₹800.00.');
  await expect(addButton(page)).toBeEnabled();
  await expectNoSeriousA11yViolations(page, testInfo, 'quick-add-read');
  await reviewScreenshot(page, testInfo, 'quick-add-read');

  // Who paid can be picked when the line doesn't say.
  await chips.getByRole('button', { name: 'Paid by: you. Change who paid' }).click();
  await page.getByRole('menuitemradio', { name: 'Sam Chen' }).click();
  await expect(
    chips.getByRole('button', { name: 'Paid by: Sam Chen. Change who paid' }),
  ).toBeVisible();
  await expect(quickAdd(page)).toContainText('You owe Sam ₹800.00.');
  await field(page).press('Escape');
  await expect(field(page)).toHaveValue('');
});
