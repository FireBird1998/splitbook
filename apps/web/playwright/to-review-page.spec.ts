import { expect, test, type Page } from '@playwright/test';
import {
  enterAsPersona,
  DEMO_GROUP_ID,
  expectNoSeriousA11yViolations,
  reviewScreenshot,
  expectThemeApplied,
} from './fixtures';
import { seedToReview, seedReviewPage } from './to-review-seed';
const root = `/groups/${DEMO_GROUP_ID}`;
const panel = (page: Page) => page.getByRole('region', { name: 'Review expense', exact: true });
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
async function removeTestExpenses(page: Page) {
  const response = await page.request.get(`/api/groups/${DEMO_GROUP_ID}/expenses?limit=100`);
  if (!response.ok()) return;
  const data = (await response.json()).data;
  for (const item of data.expenses ?? []) {
    if (/^Review (meal|matching meal|corrected meal)/.test(item.description)) {
      await page.request.delete(`/api/groups/${DEMO_GROUP_ID}/expenses/${item._id}`, {
        headers: { 'X-Splitbook-Revision': String(item.revision) },
      });
    }
  }
}
test.afterEach(async ({ page }) => {
  await seedToReview(0);
  await removeTestExpenses(page);
});

test('fix a missing payer; edits are kept; Save records exactly the version shown', async ({
  page,
}) => {
  await open(page, ['missing-payer']);
  await expect(page.getByRole('region', { name: 'Needs details', exact: true })).toContainText(
    'Who paid?',
  );
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  const review = panel(page);
  await expect(review).toContainText("Claude didn't know who paid, so it left that to you");
  await expect(review.getByRole('button', { name: 'Save expense', exact: true })).toBeDisabled();
  await review.getByLabel('Paid by Alex Rivera', { exact: true }).click();
  await page.getByRole('option', { name: 'Included', exact: true }).click();
  await review.getByLabel('Alex Rivera — amount', { exact: true }).fill('12.34');
  await expect(review.getByRole('button', { name: 'Save expense', exact: true })).toBeEnabled();
  expect((await rows(page))[0].values.paidBy).toEqual([
    { user: 'a00000000000000000000001', amount: 12.34 },
  ]);
  await review.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toBeVisible();
  expect(await rows(page)).toHaveLength(0);
});

test('possible duplicate shows the matching Expense and requires the explicit tick', async ({
  page,
}) => {
  await open(page, ['duplicate']);
  const draft = (await rows(page))[0];
  const created = await page.request.post(`/api/groups/${DEMO_GROUP_ID}/expenses`, {
    data: { ...draft.values, date: `${draft.values.date}T12:00:00.000Z` },
  });
  expect(created.status(), await created.text()).toBe(201);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Check before saving', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save 0 ready' })).toBeDisabled();
  await page.getByRole('button', { name: 'Review Review matching meal', exact: true }).click();
  const review = panel(page);
  await expect(review.getByRole('region', { name: 'Possible duplicates' })).toContainText(
    'Added by Alex Rivera',
  );
  await expect(review.getByRole('button', { name: 'Save expense', exact: true })).toBeDisabled();
  await review.getByLabel("It's a different expense, save it anyway").check();
  await expect(review.getByRole('button', { name: 'Save expense', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toBeVisible();
});

test('Save N ready confirms only ready versions and gives mixed per-item outcomes', async ({
  page,
}) => {
  await open(page, ['ready', 'ready', 'missing-payer']);
  await page.getByRole('button', { name: 'Save 2 ready', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Save 2 ready?' });
  await expect(confirm).toContainText('Review meal 1');
  await expect(confirm).toContainText('Review meal 2');
  await expect(confirm).not.toContainText('Review meal 3');
  await expect(confirm).toContainText('Total · ₹24.68');
  await expect(confirm).toContainText('Paid by Alex Rivera · equal between Alex Rivera');
  await expect(confirm).toContainText(
    "They'll be added to Goa Friends Trip, and Balances there will change for everyone",
  );
  const draft = (await rows(page)).find(
    (row: { values: { description: string } }) => row.values.description === 'Review meal 2',
  );
  expect(
    (
      await page.request.put(`/api/groups/${DEMO_GROUP_ID}/drafts/${draft.id}`, {
        headers: { 'X-Splitbook-Revision': String(draft.revision) },
        data: { values: { ...draft.values, notes: 'Changed after confirmation' } },
      })
    ).status(),
  ).toBe(200);
  await confirm.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't save:" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fix this item' })).toBeVisible();
  expect(await rows(page)).toHaveLength(2);
});

test('delete asks first, removes only the unsaved item and leaves the ledger unchanged', async ({
  page,
}) => {
  await open(page, ['ready']);
  const balances = await (await page.request.get(`/api/groups/${DEMO_GROUP_ID}/balances`)).json();
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this item?' });
  await expect(confirm).toContainText(
    "It was never saved, so nothing in Goa Friends Trip changes. You can't undo this.",
  );
  expect(await rows(page)).toHaveLength(1);
  await confirm.getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
  expect(await rows(page)).toHaveLength(0);
  expect(await (await page.request.get(`/api/groups/${DEMO_GROUP_ID}/balances`)).json()).toEqual(
    balances,
  );
});

test('a newer read and a stale edit both show the changed facts and author', async ({ page }) => {
  await page.clock.install();
  await open(page, ['ready']);
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  const review = panel(page);
  const draft = (await rows(page))[0];
  await page.request.put(`/api/groups/${DEMO_GROUP_ID}/drafts/${draft.id}`, {
    headers: { 'X-Splitbook-Revision': String(draft.revision) },
    data: {
      values: {
        ...draft.values,
        amount: 15,
        paidBy: [{ user: 'a00000000000000000000001', amount: 15 }],
      },
    },
  });
  await expect
    .poll(async () => {
      await page.clock.fastForward(31_000);
      return review.getByLabel('Amount', { exact: true }).inputValue();
    })
    .toBe('15');
  await expect(review.getByRole('status').first()).toContainText(
    'You on another device changed the amount: ₹12.34 → ₹15.00',
  );
  const next = (await rows(page))[0];
  await page.request.put(`/api/groups/${DEMO_GROUP_ID}/drafts/${next.id}`, {
    headers: { 'X-Splitbook-Revision': String(next.revision) },
    data: { values: { ...next.values, description: 'Review corrected meal' } },
  });
  await review.getByLabel('Description', { exact: true }).fill('Unsent older edit');
  await page.clock.fastForward(600);
  await expect(review.getByLabel('Description', { exact: true })).toHaveValue(
    'Review corrected meal',
  );
  await expect(review).toContainText('You on another device changed the description:');
  expect((await rows(page))[0].values.description).toBe('Review corrected meal');
});

test('one-at-a-time uses ready first, then missing details and summarizes saved/deleted/skipped', async ({
  page,
}) => {
  await open(page, ['missing-payer', 'ready', 'ready']);
  await page.getByRole('button', { name: 'Review one at a time' }).click();
  const review = panel(page);
  await expect(review.getByRole('heading', { name: '1 of 3' })).toBeVisible();
  await expect(review.getByLabel('Description', { exact: true })).toHaveValue('Review meal 2');
  await review.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(review.getByRole('heading', { name: '2 of 3' })).toBeVisible();
  await review.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(review.getByRole('heading', { name: '3 of 3' })).toBeVisible();
  await review.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Done for now' })).toContainText(
    'Done for now · Saved 1 · Deleted 1 · 1 left for later',
  );
});

test('empty, old-address redirect and Leave Group count', async ({ page }) => {
  await open(page, []);
  await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Expenses' })).toHaveAttribute(
    'href',
    `${root}/expenses`,
  );
  await page.goto(`${root}/drafts`);
  await page.waitForURL(`**${root}/review`);
  await seedReviewPage(['ready', 'ready', 'missing-payer']);
  await page.goto(`${root}/settings`);
  await page.getByRole('button', { name: 'Leave Group', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    "You have 3 items in To review for Goa Friends Trip. They're kept but hidden while you're not a member.",
  );
});

test('list and side panel are accessible in light/dark at 130% text', async ({
  page,
}, testInfo) => {
  await open(page, ['ready', 'missing-payer']);
  await expectThemeApplied(page, testInfo);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%';
  });
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-list');
  await reviewScreenshot(page, testInfo, 'to-review-list');
  await page.getByRole('button', { name: 'Review Review meal 2', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-panel');
  await reviewScreenshot(page, testInfo, 'to-review-panel');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
