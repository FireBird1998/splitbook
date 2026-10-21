import { expect, test, type Page } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { enterAsPersona, openAddExpense, expectNoSeriousA11yViolations } from './fixtures';
import { DRAFT_GROUP_LIMIT_MESSAGE } from '@splitbook/shared/validators/expense-draft';

const ownedGroups = new WeakMap<Page, string>();
test.afterEach(async ({ page }) => {
  const id = ownedGroups.get(page);
  if (id) {
    const removed = await page.request.delete(`/api/groups/${id}`);
    expect(removed.ok()).toBe(true);
    // Archiving keeps private items by design; erase only this test’s waiting items too.
    await withDemoDb(async (db) => {
      await db.collection('expensedrafts').deleteMany({ group: new ObjectId(id) });
    });
  }
});

const form = (page: Page) => page.getByRole('dialog', { name: /^Add expense/ });
const closing = (page: Page) => page.getByRole('dialog', { name: 'Finish this expense later?' });
async function ownGroup(page: Page) {
  await enterAsPersona(page, 'alex');
  const response = await page.request.post('/api/groups', {
    data: {
      name: `Playwright Finish later ${Date.now()}`,
      category: 'home',
      defaultCurrency: 'INR',
    },
  });
  expect(response.status()).toBe(201);
  const { data } = await response.json();
  ownedGroups.set(page, data._id);
  await page.goto(`/groups/${data._id}/expenses`);
  return data;
}

/** Test-only storage access, restricted to the fictional database serving this suite. */
async function withDemoDb(run: (db: ReturnType<MongoClient['db']>) => Promise<void>) {
  const uri =
    process.env.PLAYWRIGHT_DEMO_MONGODB_URI ??
    'mongodb://127.0.0.1:27017/splitbook-demo?directConnection=true';
  const name = new URL(uri).pathname.slice(1);
  if (
    ![
      'splitbook-demo',
      'splitbook_w407',
      'splitbook_w406',
      'splitbook_w419',
      'splitbook_w420',
      'splitbook_w421',
      'splitbook_w425',
      'splitbook_w439',
    ].includes(name)
  )
    throw new Error('Expected fictional demo database');
  const client = await MongoClient.connect(uri);
  try {
    await run(client.db());
  } finally {
    await client.close();
  }
}
async function seedWaiting(page: Page, groupId: string, count: number) {
  for (let offset = 0; offset < count; offset += 10) {
    const response = await page.request.post(`/api/groups/${groupId}/drafts`, {
      headers: { 'Idempotency-Key': `fictional-${offset}-${Date.now()}` },
      data: {
        drafts: Array.from({ length: Math.min(10, count - offset) }, () => ({
          description: 'Fictional waiting item',
        })),
      },
    });
    expect(response.status()).toBe(201);
  }
}

test('Finish later keeps a member item and shows View without leaving the Group', async ({
  page,
}) => {
  const group = await ownGroup(page);
  await openAddExpense(page);
  await form(page).getByLabel('What was it for?').fill('Fictional electricity');
  await form(page).getByRole('button', { name: 'Finish later', exact: true }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(page.getByText('Kept in To review', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View', exact: true })).toHaveAttribute(
    'href',
    `/groups/${group._id}/review`,
  );
  const rows = (await (await page.request.get(`/api/groups/${group._id}/drafts`)).json()).data;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    values: { description: 'Fictional electricity' },
    preparedBy: { kind: 'member' },
  });
});

for (const closeBy of ['Close expense form', 'Cancel', 'Escape', 'backdrop']) {
  test(`changed form asks before closing through ${closeBy}`, async ({ page }) => {
    await ownGroup(page);
    await openAddExpense(page);
    await form(page).getByLabel('What was it for?').fill('Fictional lunch');
    if (closeBy === 'Escape') await page.keyboard.press('Escape');
    else if (closeBy === 'backdrop')
      await page.locator('.MuiDialog-container').click({ position: { x: 2, y: 2 } });
    else await form(page).getByRole('button', { name: closeBy, exact: true }).click();
    await expect(closing(page)).toBeVisible();
    await closing(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(form(page).getByLabel('What was it for?')).toHaveValue('Fictional lunch');
    await form(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await closing(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(form(page)).toHaveCount(0);
  });
}

test('close prompt can Finish later; untouched form closes silently', async ({ page }) => {
  await ownGroup(page);
  await openAddExpense(page);
  await form(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(closing(page)).toHaveCount(0);
  await openAddExpense(page);
  await form(page).getByLabel('What was it for?').fill('Fictional lunch');
  await page.keyboard.press('Escape');
  await expectNoSeriousA11yViolations(page, test.info(), 'finish-later');
  await closing(page).getByRole('button', { name: 'Finish later', exact: true }).click();
  await expect(page.getByText('Kept in To review', { exact: true })).toBeVisible();
});

test('100 waiting items disable Finish later with a To review link', async ({ page }) => {
  const group = await ownGroup(page);
  await seedWaiting(page, group._id, 100);
  await openAddExpense(page);
  await expect(
    form(page).getByRole('button', { name: 'Finish later', exact: true }),
  ).toBeDisabled();
  await expect(form(page).getByText(DRAFT_GROUP_LIMIT_MESSAGE, { exact: false })).toBeVisible();
  await expect(form(page).getByRole('link', { name: 'To review' })).toHaveAttribute(
    'href',
    `/groups/${group._id}/review`,
  );
  await expectNoSeriousA11yViolations(page, test.info(), 'finish-later');
});

for (const status of [500, 409]) {
  test(`failed Finish later (${status}) retains all content`, async ({ page }) => {
    const group = await ownGroup(page);
    await openAddExpense(page);
    await form(page).getByLabel('What was it for?').fill('Fictional groceries');
    await form(page).getByLabel('Amount').fill('125');
    await page.route(`**/api/groups/${group._id}/drafts`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status,
        json:
          status === 409
            ? { code: 'DRAFT_GROUP_LIMIT', error: DRAFT_GROUP_LIMIT_MESSAGE }
            : { error: 'Temporary outage' },
      });
    });
    await form(page).getByRole('button', { name: 'Finish later', exact: true }).click();
    await expect(form(page).getByRole('alert')).toContainText(
      status === 409 ? DRAFT_GROUP_LIMIT_MESSAGE : 'Everything you typed is still here',
    );
    await expect(form(page).getByLabel('What was it for?')).toHaveValue('Fictional groceries');
    await expect(form(page).getByLabel('Amount')).toHaveValue('125.00');
    await expectNoSeriousA11yViolations(page, test.info(), 'finish-later');
  });
}

test('saved assistant provenance appears in list, panel and Activity at 130% text', async ({
  page,
}) => {
  const group = await ownGroup(page);
  const member = group.members[0].user._id ?? group.members[0].user;
  const created = await page.request.post(`/api/groups/${group._id}/drafts`, {
    headers: { 'Idempotency-Key': `fictional-claude-${Date.now()}` },
    data: {
      drafts: [
        {
          description: 'Fictional electricity',
          amount: 125,
          currency: 'INR',
          category: 'housing',
          date: '2026-10-12',
          tagId: group.tags[0]._id,
          paidBy: [{ user: member, amount: 125 }],
          splitMethod: 'equal',
          splitBetween: [{ user: member }],
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const [draft] = (await created.json()).data;
  await withDemoDb(async (db) => {
    await db
      .collection('expensedrafts')
      .updateOne(
        { _id: new ObjectId(draft.id), group: new ObjectId(group._id) },
        { $set: { preparedBy: { kind: 'assistant', name: 'Claude' } } },
      );
  });
  const reviews = await page.request.post(`/api/groups/${group._id}/drafts/review`, {
    data: { ids: [draft.id] },
  });
  const [review] = (await reviews.json()).data;
  const saved = await page.request.post(`/api/groups/${group._id}/drafts/save`, {
    data: { drafts: [{ id: draft.id, revision: draft.revision, review: review.review }] },
  });
  expect((await saved.json()).data[0].status).toBe('saved');
  await page.reload();
  await page.addStyleTag({ content: 'html { font-size: 130%; }' });
  await expect(page.getByText('· prepared by Claude', { exact: false }).first()).toBeVisible();
  await page
    .getByRole('button', { name: /Fictional electricity/ })
    .first()
    .click();
  await expect(page.getByText('Prepared by Claude', { exact: true }).first()).toBeVisible();
  await expectNoSeriousA11yViolations(page, test.info(), 'finish-later');
  await page.goto(`/groups/${group._id}/activity`);
  await expect(page.getByText(/added.*Fictional electricity.*prepared by Claude/)).toBeVisible();
  await expectNoSeriousA11yViolations(page, test.info(), 'finish-later');
});
