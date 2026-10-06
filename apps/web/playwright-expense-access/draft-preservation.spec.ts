import { MongoClient, ObjectId } from 'mongodb';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, dataOf, expensePath, openAddExpense, type Ledger } from './fixtures';

async function enterGroup(page: Page, ledger: Ledger) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  await page.context().addCookies((await ledger.priya.storageState()).cookies);
  await page.clock.install();
  await page.goto(`${origin}/groups/${ledger.groupB}`);
}

async function refreshGroupTags(page: Page, ledger: Ledger) {
  const path = `/api/groups/${ledger.groupB}`;
  const group = await dataOf(await ledger.priya.get(path));
  const rent = group.tags.find((tag: { name: string }) => tag.name === 'Rent');
  await dataOf(
    await ledger.priya.patch(`${path}/tags/${rent._id}`, {
      data: { name: 'Updated housing Tag' },
    }),
  );
  // Drive the actual SWR background refresh, then wait for the new Tag to render.
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.status() === 200,
  );
  await page.clock.fastForward(31_000);
  await refreshed;
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Updated housing Tag', exact: true }),
  ).toBeVisible();
}

test('new expense keeps entered fields when Group data refreshes in the background', async ({
  page,
  ledger,
}) => {
  await enterGroup(page, ledger);
  await openAddExpense(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What was it for?').fill('Unsaved household purchase');
  await dialog.getByLabel('Amount').fill('27.19');
  await dialog.getByRole('button', { name: 'Rent', exact: true }).click();
  await refreshGroupTags(page, ledger);
  await expect(dialog.getByLabel('What was it for?')).toHaveValue('Unsaved household purchase');
  await expect(dialog.getByLabel('Amount')).toHaveValue('27.19');
  await expect(
    dialog.getByRole('button', { name: 'Updated housing Tag', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('stale expense edit keeps its draft and conflict until an explicit reload', async ({
  page,
  ledger,
}) => {
  await enterGroup(page, ledger);
  const path = expensePath(ledger.groupB, ledger.expenseB);
  const expense = await dataOf(await ledger.priya.get(path));
  await page
    .getByRole('button', { name: /Private rent, ₹1,200\.00/ })
    .getByLabel('Expense actions')
    .click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const description = dialog.getByLabel('What was it for?');
  await description.fill('Draft awaiting conflict resolution');
  await dataOf(
    await ledger.priya.patch(path, {
      data: { description: 'Saved in another browser' },
      headers: { 'X-Splitbook-Revision': String(expense.revision ?? 0) },
    }),
  );
  // Saving first checks duplicates; assert the conflict only after the stale
  // mutation has reached the server and its response is fully received.
  const rejected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path && response.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  const conflict = await rejected;
  expect(conflict.status()).toBe(409);
  await conflict.finished();
  await expect(dialog.getByRole('alert')).toContainText('changed while you were editing');
  await refreshGroupTags(page, ledger);
  await expect(description).toHaveValue('Draft awaiting conflict resolution');
  await expect(dialog.getByRole('alert')).toContainText('changed while you were editing');
  const contrast = await new AxeBuilder({ page })
    .include('[role="dialog"] [role="alert"]')
    .withRules(['color-contrast'])
    .analyze();
  expect(contrast.violations).toEqual([]);
  // A failed explicit reload must retain both the draft and the conflict action.
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not reload this Expense');
  await expect(description).toHaveValue('Draft awaiting conflict resolution');
  await expect(dialog.getByRole('button', { name: 'Reload latest', exact: true })).toBeVisible();
  await page.unroute(`**${path}`);
  const reloaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path && response.request().method() === 'GET',
  );
  await dialog.getByRole('button', { name: 'Reload latest', exact: true }).click();
  const latest = await reloaded;
  expect(latest.status()).toBe(200);
  await latest.finished();
  await expect(description).toHaveValue('Saved in another browser');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('editing a historical JPY expense preserves its currency and whole-unit precision', async ({
  page,
  ledger,
}) => {
  const dbName = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!dbName || !/^splitbook-test-access-[a-f0-9-]+$/.test(dbName))
    throw new Error('Unique isolated test database required');
  const client = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    // A historical currency can only be introduced below the current write API.
    await client
      .db(dbName)
      .collection('expenses')
      .updateOne(
        { _id: new ObjectId(ledger.expenseB) },
        {
          $set: { currency: 'JPY' },
          $unset: {
            moneyVersion: '',
            amountMinor: '',
            'paidBy.0.amountMinor': '',
            'splitBetween.0.amountMinor': '',
          },
        },
      );
  } finally {
    await client.close();
  }
  await enterGroup(page, ledger);
  await page
    .getByRole('button', { name: /Private rent, ¥1,200/ })
    .getByLabel('Expense actions')
    .click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Currency')).toContainText('JPY');
  await expect(dialog.getByLabel('Amount')).toHaveAttribute('step', '1');
  await dialog.getByLabel('What was it for?').fill('Historical Japanese rent');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  const updated = await dataOf(await ledger.priya.get(expensePath(ledger.groupB, ledger.expenseB)));
  expect(updated).toMatchObject({
    description: 'Historical Japanese rent',
    currency: 'JPY',
    amount: 1200,
    amountMinor: 1200,
  });
  expect(updated.paidBy[0].amountMinor).toBe(1200);
  expect(updated.splitBetween[0].amountMinor).toBe(1200);
});
