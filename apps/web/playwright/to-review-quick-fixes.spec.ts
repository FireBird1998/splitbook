import { expect, test, type Page } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  isPhone,
} from './fixtures';
import { cleanupReviewPage, seedReviewPage } from './to-review-seed';

// #439: one-tap quick fixes, row Save and Delete, the bulk payer action and the keyboard.
const root = `/groups/${DEMO_GROUP_ID}`;
const alex = 'a00000000000000000000001';
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const openRow = (page: Page, description: string) =>
  page.getByRole('button', { name: `Review ${description}`, exact: true });
async function open(page: Page, kinds: Parameters<typeof seedReviewPage>[0]) {
  await seedReviewPage(kinds);
  await enterAsPersona(page, 'alex');
  await page.goto(`${root}/review`);
}
async function rows(page: Page) {
  const response = await page.request.get(`/api/groups/${DEMO_GROUP_ID}/drafts`);
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}
test.afterEach(async () => {
  await cleanupReviewPage();
});

test('a payer chip moves an item to Ready, and its row Save records it', async ({
  page,
}, testInfo) => {
  await open(page, ['missing-payer']);
  const payers = page.getByRole('group', { name: 'Who paid for Review meal 1' });
  await expect(payers.getByRole('button')).toHaveText(['You', 'Sam Chen', 'Priya Shah']);
  await expect(payers.getByRole('button').first()).toHaveAccessibleName('You, suggested');
  await expectThemeApplied(page, testInfo);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%';
  });
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-quick-fixes');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await payers.getByRole('button', { name: 'You, suggested' }).click();
  const ready = region(page, 'Ready');
  await expect(ready).toContainText('Review meal 1');
  await expect(ready).toContainText(/You paid · Split equally/);
  // The chip keeps a lone payer only; saving makes them pay the whole amount (#425).
  expect((await rows(page))[0].values.paidBy).toEqual([{ user: alex }]);

  await ready.getByRole('button', { name: 'Save Review meal 1' }).click();
  const saved = page.getByRole('alert').filter({ hasText: 'Expense saved' });
  await expect(saved).toBeVisible();
  await expect(saved.getByRole('link', { name: 'View' })).toHaveAttribute(
    'href',
    new RegExp(`^${root}/expenses\\?`),
  );
  expect(await rows(page)).toHaveLength(0);
});

test('You for all sets every missing payer at once, and Undo puts them back', async ({ page }) => {
  await open(page, ['missing-payer', 'missing-payer']);
  await region(page, 'Needs details').getByRole('button', { name: 'You for all 2' }).click();
  await expect(region(page, 'Ready')).toContainText('Review meal 2');
  await expect(
    page.getByRole('alert').filter({ hasText: 'You set as payer on 2 items' }),
  ).toBeVisible();
  for (const row of await rows(page)) expect(row.values.paidBy).toEqual([{ user: alex }]);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('group', { name: 'Who paid for Review meal 2' })).toBeVisible();
  await expect
    .poll(async () =>
      (await rows(page)).filter((row: { values: object }) => 'paidBy' in row.values),
    )
    .toHaveLength(0);
});

test('Tag chips lead with the Tag matching the Category, and More shows every Tag', async ({
  page,
}) => {
  await open(page, ['missing-tag']);
  const tags = page.getByRole('group', { name: 'Tag for Review meal 1' });
  await expect(tags.getByRole('button').first()).toHaveAccessibleName('Food, suggested');
  await expect(tags.getByRole('button', { name: 'Activities', exact: true })).toHaveCount(0);
  await tags.getByRole('button', { name: 'More…' }).click();
  await expect(tags.getByRole('button', { name: 'Activities', exact: true })).toBeVisible();

  await tags.getByRole('button', { name: 'Food, suggested' }).click();
  await expect(region(page, 'Ready')).toContainText('Review meal 1');
  const [row] = await rows(page);
  expect(typeof row.values.tagId).toBe('string');
  expect(row.values).not.toHaveProperty('tag');
});

test('Delete under ⋯ asks first and removes only that item', async ({ page }) => {
  await open(page, ['ready', 'ready']);
  await page.getByRole('button', { name: 'More for Review meal 1' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this item?' });
  await expect(dialog).toContainText('It was never saved');
  await dialog.getByRole('button', { name: 'Delete item' }).click();
  await expect(openRow(page, 'Review meal 1')).toHaveCount(0);
  await expect(openRow(page, 'Review meal 2')).toBeVisible();
  expect(await rows(page)).toHaveLength(1);
});

test('keyboard: J moves, a number picks, S saves and Esc closes the panel', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'Keyboard shortcuts are for computers');
  await open(page, ['ready', 'missing-payer']);
  await expect(page.getByText(/^Keyboard shortcuts:/)).toBeVisible();
  await openRow(page, 'Review meal 1').focus();
  await page.keyboard.press('j');
  await expect(openRow(page, 'Review meal 2')).toBeFocused();

  await page.keyboard.press('1');
  await expect(region(page, 'Ready')).toContainText('Review meal 2');
  await expect(openRow(page, 'Review meal 2')).toBeFocused();

  await page.keyboard.press('s');
  await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toBeVisible();
  await expect
    .poll(async () =>
      (await rows(page)).map((row: { values: { description: string } }) => row.values.description),
    )
    .toEqual(['Review meal 1']);

  await openRow(page, 'Review meal 1').click();
  const panel = page.getByRole('region', { name: 'Review expense', exact: true });
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});
