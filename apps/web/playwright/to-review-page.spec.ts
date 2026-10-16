import { expect, test, type Page } from '@playwright/test';
import {
  enterAsPersona,
  DEMO_GROUP_ID,
  expectNoSeriousA11yViolations,
  reviewScreenshot,
  expectThemeApplied,
} from './fixtures';
import { cleanupReviewPage, seedReviewPage } from './to-review-seed';
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
test.afterEach(async () => {
  await cleanupReviewPage();
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
  await review.getByLabel('Paid by', { exact: true }).click();
  await page.getByRole('option', { name: 'Alex Rivera', exact: true }).click();
  await review.getByLabel('Date', { exact: true }).fill('2026-10-15');
  await expect(review.getByRole('button', { name: 'Save expense', exact: true })).toBeEnabled();
  expect((await rows(page))[0].values.date).toBe('2026-10-15');
  await expect(page.getByRole('region', { name: 'Ready', exact: true })).toContainText(
    'Review meal 1',
  );
  await expect(page.locator('body')).not.toContainText(
    /\(e.g. INR\)|\(YYYY-MM-DD\)|\bequal\b|\bother\b|paidBy\.|splitBetween\./,
  );
  expect((await rows(page))[0].values.paidBy).toEqual([
    { user: 'a00000000000000000000001', amount: 12.34 },
  ]);
  await review.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toBeVisible();
  expect(await rows(page)).toHaveLength(0);
});

test("Claude's one-payer item without a Category is Ready, shows who paid and Other, and saves", async ({
  page,
}, testInfo) => {
  await open(page, ['one-payer-no-category']);
  await expect(page.getByRole('region', { name: 'Ready', exact: true })).toContainText(
    'Review meal 1',
  );
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  const review = panel(page);
  await expect(review.getByLabel('Paid by', { exact: true })).toHaveText('Alex Rivera');
  await expect(review.getByLabel('Paid by Alex Rivera', { exact: true })).toHaveCount(0);
  await expect(review.getByLabel('Category', { exact: true })).toHaveText('Other');
  await expect(review.getByRole('button', { name: 'Save expense', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%';
  });
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-one-payer');
  await review.getByRole('spinbutton', { name: 'Amount', exact: true }).fill('15');
  await expect
    .poll(async () => (await rows(page))[0].values.paidBy)
    .toEqual([{ user: 'a00000000000000000000001', amount: 15 }]);
  expect((await rows(page))[0].values).not.toHaveProperty('category');
  await page.getByRole('button', { name: 'Save 1 ready', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Save 1 ready?' });
  await expect(confirm).toContainText('Paid by Alex Rivera');
  await expect(confirm).toContainText('Total · ₹15.00');
  await confirm.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toBeVisible();
  expect(await rows(page)).toHaveLength(0);
});

test("a lone payer's mismatched amount stays editable while it is cleared and retyped", async ({
  page,
}) => {
  await open(page, ['ready']);
  const [draft] = await rows(page);
  expect(
    (
      await page.request.put(`/api/groups/${DEMO_GROUP_ID}/drafts/${draft.id}`, {
        headers: { 'X-Splitbook-Revision': String(draft.revision) },
        data: {
          values: { ...draft.values, paidBy: [{ user: draft.values.paidBy[0].user, amount: 10 }] },
        },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  const paid = panel(page).getByLabel('Paid by Alex Rivera', { exact: true });
  await expect(paid).toHaveValue('10');
  await paid.fill('');
  await expect(paid).toBeVisible();
  await paid.fill('12.34');
  await expect(page.getByRole('region', { name: 'Ready', exact: true })).toContainText(
    'Review meal 1',
  );
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
  await expect(page.getByRole('button', { name: 'Save 0 ready' })).toHaveCount(0);
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
  await expect(confirm).toContainText('Paid by Alex Rivera · Split equally between Alex Rivera');
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
  await expect(review.getByRole('spinbutton', { name: /^Amount/ })).toHaveValue('15', {
    timeout: 40_000,
  });
  await expect(review.getByRole('status').first()).toContainText(
    'You on another device changed the amount a moment ago: ₹12.34 → ₹15.00',
  );
  const next = (await rows(page))[0];
  await page.request.put(`/api/groups/${DEMO_GROUP_ID}/drafts/${next.id}`, {
    headers: { 'X-Splitbook-Revision': String(next.revision) },
    data: { values: { ...next.values, description: 'Review corrected meal' } },
  });
  await review.getByLabel('What was it for?').fill('Unsent older edit');
  await expect(
    review.getByRole('status').filter({ hasText: 'Changes kept in To review' }),
  ).toBeVisible();
  await expect(review.getByLabel('What was it for?')).toHaveValue('Review corrected meal');
  await expect(review).toContainText('You on another device changed the description a moment ago:');
  expect((await rows(page))[0].values.description).toBe('Review corrected meal');
});

test('one-at-a-time uses ready first, then missing details and summarizes saved/deleted/skipped', async ({
  page,
}) => {
  await open(page, ['missing-payer', 'ready', 'ready']);
  await page.getByRole('button', { name: 'Review one at a time' }).click();
  const review = panel(page);
  await expect(review.getByRole('heading', { name: '1 of 3' })).toBeVisible();
  await expect(review.getByLabel('What was it for?')).toHaveValue('Review meal 2');
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
  await expect(
    page.getByRole('button', { name: 'Review Review meal 1', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Trip · 3 members · INR', { exact: true })).toBeVisible();
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

test('the last member is told To review items are deleted with the Group', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  const created = await page.request.post('/api/groups', {
    data: { name: 'Review deletion example', category: 'home', defaultCurrency: 'INR' },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()).data;
  const kept = await page.request.post(`/api/groups/${group._id}/drafts`, {
    headers: { 'Idempotency-Key': 'to-review-last-member-fixture' },
    data: { drafts: [{ description: 'Waiting example' }] },
  });
  expect(kept.status()).toBe(201);
  await page.goto(`/groups/${group._id}/settings`);
  await page.getByRole('button', { name: 'Leave Group', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText(
    'Your 1 item in To review will be permanently deleted with Review deletion example.',
  );
  await expect(confirm).not.toContainText('kept but hidden');
  await confirm.getByRole('button', { name: 'Leave and delete Group', exact: true }).click();
  await page.waitForURL('**/dashboard');
  expect((await page.request.get(`/api/groups/${group._id}`)).status()).toBe(404);
});

test('polling an in-flight autosave keeps typing entered after that submission', async ({
  page,
}) => {
  await open(page, ['ready']);
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  const draft = (await rows(page))[0];
  let release: () => void = () => {};
  let committed: () => void = () => {};
  const applied = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let updates = 0;
  await page.route(`**/api/groups/${DEMO_GROUP_ID}/drafts/${draft.id}`, async (route) => {
    if (route.request().method() !== 'PUT' || ++updates !== 1) return route.continue();
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    committed();
    await held;
    await route.fulfill({ response: result });
  });
  const review = panel(page);
  await review.getByLabel('What was it for?').fill('Review first edit');
  await applied;
  try {
    await review.getByLabel('What was it for?').fill('Review newer typing');
    const polled = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/user/to-review' && response.ok(),
      { timeout: 40_000 },
    );
    await polled;
    await expect(review.getByLabel('What was it for?')).toHaveValue('Review newer typing');
    await expect(review).not.toContainText('You on another device');
  } finally {
    release();
  }
  await expect(
    review.getByRole('status').filter({ hasText: 'Changes kept in To review' }),
  ).toBeVisible();
  expect((await rows(page))[0].values.description).toBe('Review newer typing');
});

test('a run advances past an item removed on another device and still reaches its summary', async ({
  page,
}) => {
  await open(page, ['ready', 'ready', 'ready']);
  await page.getByRole('button', { name: 'Review one at a time' }).click();
  const upcoming = (await rows(page)).find(
    (row: { values: { description: string } }) => row.values.description === 'Review meal 2',
  );
  const removed = await page.request.delete(`/api/groups/${DEMO_GROUP_ID}/drafts/${upcoming.id}`, {
    headers: { 'X-Splitbook-Revision': String(upcoming.revision) },
  });
  expect(removed.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Review Review meal 2', exact: true })).toHaveCount(
    0,
    { timeout: 40_000 },
  );
  await panel(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(panel(page).getByLabel('What was it for?')).toHaveValue('Review meal 3');
  await panel(page).getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Done for now' })).toContainText(
    '2 left for later',
  );
  await expect(page.getByRole('button', { name: 'Review one at a time' })).toBeEnabled();
});

test('an external version delivered by the post-edit refresh appears immediately', async ({
  page,
}) => {
  await open(page, ['ready']);
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  const draft = (await rows(page))[0];
  let intercepted = false;
  await page.route(`**/api/groups/${DEMO_GROUP_ID}/drafts/${draft.id}`, async (route) => {
    if (route.request().method() !== 'PUT' || intercepted) return route.continue();
    intercepted = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const kept = (await response.json()).data;
    const external = await page.request.put(`/api/groups/${DEMO_GROUP_ID}/drafts/${draft.id}`, {
      headers: { 'X-Splitbook-Revision': String(kept.revision) },
      data: { values: { ...kept.values, description: 'Review another device edit' } },
    });
    expect(external.status()).toBe(200);
    await route.fulfill({ response });
  });
  const review = panel(page);
  await review.getByLabel('What was it for?').fill('Review this device edit');
  await expect(review.getByLabel('What was it for?')).toHaveValue('Review another device edit', {
    timeout: 10_000,
  });
  await expect(review).toContainText('You on another device changed the description a moment ago:');
});

test('opening and closing an item carries keyboard focus between its row and panel', async ({
  page,
}) => {
  await open(page, ['ready']);
  const row = page.getByRole('button', { name: 'Review Review meal 1', exact: true });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeFocused();
  await panel(page).getByRole('button', { name: 'Close review', exact: true }).click();
  await expect(row).toBeFocused();
});

test('a new possible match invalidates the earlier duplicate tick before saving', async ({
  page,
}) => {
  await open(page, ['duplicate']);
  const draft = (await rows(page))[0];
  const body = { ...draft.values, date: `${draft.values.date}T12:00:00.000Z` };
  expect(
    (await page.request.post(`/api/groups/${DEMO_GROUP_ID}/expenses`, { data: body })).status(),
  ).toBe(201);
  await page.reload();
  await page.getByRole('button', { name: 'Review Review matching meal', exact: true }).click();
  const review = panel(page);
  await review.getByLabel("It's a different expense, save it anyway").check();
  expect(
    (await page.request.post(`/api/groups/${DEMO_GROUP_ID}/expenses`, { data: body })).status(),
  ).toBe(201);
  await review.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'The possible matches changed' }),
  ).toBeVisible();
  await expect(review.getByLabel("It's a different expense, save it anyway")).not.toBeChecked();
  expect(await rows(page)).toHaveLength(1);
  await expect(review.getByRole('button', { name: 'Save expense', exact: true })).toBeDisabled();
  await review.getByLabel("It's a different expense, save it anyway").check();
  await review.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toBeVisible();
});

test('payer problems use names; split, Tag and optional detail pickers keep their changes', async ({
  page,
}) => {
  await open(page, ['ready']);
  const current = (await rows(page))[0];
  // A lone payer without an amount paid it all (#425); with two payers, a missing amount is named.
  const values = {
    ...current.values,
    paidBy: [
      { user: 'a00000000000000000000001', amount: 6.17 },
      { user: 'a00000000000000000000002' },
    ],
  };
  const changed = await page.request.put(`/api/groups/${DEMO_GROUP_ID}/drafts/${current.id}`, {
    headers: { 'X-Splitbook-Revision': String(current.revision) },
    data: { values },
  });
  expect(changed.ok(), await changed.text()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  const review = panel(page);
  await expect(review).toContainText('The amount paid by Sam Chen?');
  await expect(page.locator('body')).not.toContainText(
    /paidBy\.|splitBetween\.|\(YYYY-MM-DD\)|\(e.g. INR\)/,
  );
  await review.getByLabel('Paid by Sam Chen', { exact: true }).fill('6.17');
  await expect(review.getByRole('button', { name: 'Save expense', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: '%', exact: true }).click();
  await review.getByLabel('Percentage for Alex Rivera', { exact: true }).fill('100');
  await review.getByLabel('Notes (optional)').fill('A fictional shared lunch');
  const group = (await (await page.request.get(`/api/groups/${DEMO_GROUP_ID}`)).json()).data;
  const tag = group.tags.find(
    (option: { _id: string; isArchived: boolean; isDeleted: boolean }) =>
      option._id !== current.values.tagId && !option.isArchived && !option.isDeleted,
  );
  await review.getByRole('button', { name: tag.name, exact: true }).click();
  await expect(review.getByRole('button', { name: 'Save expense', exact: true })).toBeEnabled();
  const kept = (await rows(page))[0];
  expect(kept.values.splitMethod).toBe('percentage');
  expect(kept.values.splitBetween).toEqual([{ user: 'a00000000000000000000001', percentage: 100 }]);
  expect(kept.values.notes).toBe('A fictional shared lunch');
  expect(kept.values.tagId).toBe(tag._id);
  await review.getByRole('button', { name: 'Close review' }).click();
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  await expect(panel(page).getByLabel('Notes (optional)')).toHaveValue('A fictional shared lunch');
});

test('Save ready waits for the open edit and confirms exactly the kept version', async ({
  page,
}, testInfo) => {
  await open(page, ['ready', 'ready']);
  await expectThemeApplied(page, testInfo);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%';
  });
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${root}/drafts/*`, async (route) => {
    if (route.request().method() === 'PUT') await held;
    await route.continue();
  });
  await panel(page).getByLabel('What was it for?').fill('Review corrected meal just typed');
  const saveReady = page.getByRole('button', { name: 'Save 2 ready', exact: true });
  await expect(saveReady).toBeEnabled();
  await saveReady.click();
  await expect(saveReady).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();
  const confirm = page.getByRole('dialog', { name: 'Save 2 ready?' });
  await expect(confirm).toContainText('Review corrected meal just typed');
  await expect(confirm).not.toContainText('Review meal 1');
  const kept = (await rows(page)).find(
    (row: { values: { description: string } }) =>
      row.values.description === 'Review corrected meal just typed',
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-kept-confirmation');
  await confirm.getByRole('button', { name: 'Keep reviewing' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(saveReady).toBeFocused();
  await saveReady.click();
  await expect(confirm).toBeVisible();
  const sent = page.waitForRequest(
    (request) => request.url().endsWith(`${root}/drafts/save`) && request.method() === 'POST',
  );
  await confirm.getByRole('button', { name: 'Confirm save' }).click();
  expect((await sent).postDataJSON().drafts).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: kept.id, revision: kept.revision })]),
  );
  await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toHaveCount(2);
  await expect(panel(page)).toHaveCount(0);
  expect(await rows(page)).toHaveLength(0);
});

test('Save ready stops at the open editor error when keeping changes fails', async ({
  page,
}, testInfo) => {
  await open(page, ['ready']);
  await expectThemeApplied(page, testInfo);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%';
  });
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  let reviews = 0;
  await page.route(`**${root}/drafts/*`, async (route) => {
    if (route.request().method() === 'PUT')
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unavailable' }),
      });
    if (route.request().url().endsWith('/review')) reviews++;
    await route.continue();
  });
  await panel(page).getByLabel('What was it for?').fill('Keep this wording');
  await page.getByRole('button', { name: 'Save 1 ready', exact: true }).click();
  await expect(panel(page)).toContainText('This change is not kept yet.');
  await expect(panel(page).getByLabel('What was it for?')).toHaveValue('Keep this wording');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(reviews).toBe(0);
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-keep-failed');
  await page.unroute(`**${root}/drafts/*`);
  await page.getByRole('button', { name: 'Save 1 ready', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Keep this wording');
});

test('nothing ready hides bulk save, counts appear once, and one-at-a-time still works', async ({
  page,
}, testInfo) => {
  await open(page, ['missing-payer']);
  await expectThemeApplied(page, testInfo);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%';
  });
  await expect(page.getByRole('button', { name: /^Save \d+ ready$/ })).toHaveCount(0);
  await expect(page.getByText(/1 needs details/)).toHaveCount(1);
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-none-ready');
  await page.getByRole('button', { name: 'Review one at a time' }).click();
  await expect(panel(page)).toContainText('1 of 1');
  await expect(page.getByRole('button', { name: /^Save \d+ ready$/ })).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Done for now' })).toBeVisible();
});

test('bulk confirmation excludes an open item made incomplete by its pending edit', async ({
  page,
}) => {
  await open(page, ['ready', 'ready']);
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  await panel(page).getByLabel('What was it for?').fill('');
  await page.getByRole('button', { name: /^Save \d+ ready$/ }).click();
  const confirm = page.getByRole('dialog', { name: 'Save 1 ready?' });
  await expect(confirm).toContainText('Review meal 2');
  await expect(confirm).not.toContainText('Review meal 1');
  await confirm.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toHaveCount(1);
  await expect(panel(page).getByLabel('What was it for?')).toHaveValue('');
  await expect(page.getByRole('button', { name: /^Save \d+ ready$/ })).toHaveCount(0);
  expect(await rows(page)).toHaveLength(1);
});

for (const reply of ['confirmed', 'lost reply']) {
  test(`bulk saving during one-at-a-time counts every saved item once (${reply})`, async ({
    page,
  }) => {
    await open(page, ['ready', 'ready', 'missing-payer']);
    if (reply === 'lost reply') {
      let first = true;
      await page.route(`**${root}/drafts/save`, async (route) => {
        if (!first) return route.continue();
        first = false;
        const applied = await route.fetch();
        expect(applied.ok()).toBe(true);
        await route.abort('failed');
      });
    }
    await page.getByRole('button', { name: 'Review one at a time' }).click();
    await panel(page).getByLabel('What was it for?').fill('Review corrected meal in this run');
    await page.getByRole('button', { name: 'Save 2 ready', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Save 2 ready?' });
    await expect(confirm).toContainText('Review corrected meal in this run');
    await confirm.getByRole('button', { name: 'Confirm save' }).click();
    if (reply === 'lost reply')
      await page.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(panel(page)).toContainText('3 of 3');
    await panel(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Done for now' })).toContainText(
      'Saved 2',
    );
  });
}

test('when keeping the last ready item makes it incomplete, focus returns to its panel', async ({
  page,
}) => {
  await open(page, ['ready']);
  await page.getByRole('button', { name: 'Review Review meal 1', exact: true }).click();
  await panel(page).getByLabel('What was it for?').fill('');
  await page.getByRole('button', { name: 'Save 1 ready', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Save \d+ ready$/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel(page)).toBeFocused();
  await expect(panel(page).getByLabel('What was it for?')).toHaveValue('');
});
