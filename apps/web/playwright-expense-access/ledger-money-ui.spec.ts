import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, dataOf, expensePath, joinGroup, type Ledger } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

const { sam, priya } = DEMO_PERSONA_IDS;

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  return `${origin}${path}`;
}

async function enter(page: Page, actor: APIRequestContext, path: string) {
  await page.context().addCookies((await actor.storageState()).cookies);
  await page.goto(appURL(path));
}

async function yenGroup(ledger: Ledger) {
  const group = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: {
        name: `Whole-yen browser ${randomUUID()}`,
        category: 'home',
        defaultCurrency: 'JPY',
        alternateCurrencies: [],
      },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, group._id);
  await joinGroup(ledger.priya, ledger.alex, group._id);
  return group._id as string;
}

for (const layout of [
  { name: 'desktop-light', viewport: { width: 1440, height: 1000 }, colorScheme: 'light' as const },
  { name: 'mobile-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' as const },
]) {
  test(`${layout.name}: JPY precision and shares preview match the saved allocation`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize(layout.viewport);
    await page.emulateMedia({ colorScheme: layout.colorScheme });
    const group = await yenGroup(ledger);
    await enter(page, ledger.priya, `/groups/${group}`);
    await page.getByRole('button', { name: 'Add expense' }).last().click();
    const dialog = page.getByRole('dialog');
    const description = `Whole-yen shares ${layout.name}`;
    await dialog.getByLabel('What was it for?').fill(description);
    const amount = dialog.getByLabel('Amount');
    await expect(amount).toHaveAttribute('step', '1');
    await amount.fill('100.5');
    await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
    await expect(dialog.getByText(/at most 0 decimal places/)).toBeVisible();
    await expect(amount).toHaveValue('100.5');
    await amount.fill('100');
    await dialog.getByRole('button', { name: 'Advanced split options' }).click();
    await dialog.getByRole('button', { name: 'Shares', exact: true }).click();
    const weights = dialog.getByPlaceholder('1', { exact: true });
    await expect(weights).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) await weights.nth(index).fill('1');
    await expect(dialog.getByText(/=\s*¥33$/)).toHaveCount(2);
    await expect(dialog.getByText(/=\s*¥34$/)).toHaveCount(1);
    await weights.last().scrollIntoViewIfNeeded();
    await expect(dialog.getByText(/=\s*¥34$/)).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath(`${layout.name}-weighted-preview.png`) });
    await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: new RegExp(`${description}, ¥100`) }),
    ).toBeVisible();
    const list = await dataOf(await ledger.priya.get(`/api/groups/${group}/expenses`));
    const stored = list.expenses.find(
      (expense: { description: string }) => expense.description === description,
    );
    expect(stored.splitBetween.map((person: { amount: number }) => person.amount)).toEqual([
      33, 33, 34,
    ]);
    expect(
      stored.splitBetween.map((person: { amountMinor: number }) => person.amountMinor),
    ).toEqual([33, 33, 34]);
  });
}

test('desktop: conflict feedback retains the draft until Reload latest is selected', async ({
  page,
  ledger,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const path = expensePath(ledger.groupB, ledger.expenseB);
  const original = await dataOf(await ledger.sam.get(path));
  await enter(page, ledger.sam, `/groups/${ledger.groupB}`);
  const row = page.getByRole('button', { name: /Private rent, ₹1,200\.00/ });
  await row.getByLabel('Expense actions').click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const description = dialog.getByLabel('What was it for?');
  await description.fill('My unsaved correction');
  await dataOf(
    await ledger.priya.patch(path, {
      data: { description: 'Someone else saved first' },
      headers: { 'X-Splitbook-Revision': String(original.revision ?? 0) },
    }),
  );
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByText(/changed while you were editing/)).toBeVisible();
  await expect(description).toHaveValue('My unsaved correction');
  await dialog.screenshot({ path: testInfo.outputPath('retained-edit-conflict.png') });
  await dialog.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(description).toHaveValue('Someone else saved first');
  await description.fill('Correction after reload');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await dataOf(await ledger.sam.get(path))).toMatchObject({
    description: 'Correction after reload',
    revision: (original.revision ?? 0) + 2,
  });
});

test('mobile: a one-cent amount remains visible in the expense summary', async ({
  page,
  ledger,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/expenses`, {
      data: {
        description: 'A single paise',
        amount: 0.01,
        currency: 'INR',
        category: 'other',
        tag: 'Rent',
        date: new Date().toISOString(),
        paidBy: [{ user: priya, amount: 0.01 }],
        splitMethod: 'equal',
        splitBetween: [{ user: sam }],
      },
    }),
    201,
  );
  await enter(page, ledger.sam, `/groups/${ledger.groupB}`);
  const summary = page.getByText('Total expenses', { exact: true }).locator('..').locator('..');
  await expect(summary.getByText('You owe', { exact: true })).toBeVisible();
  await expect(summary.getByText('₹0.01', { exact: true })).toBeVisible();
  await summary.screenshot({ path: testInfo.outputPath('single-minor-unit-summary.png') });
});

test('legacy currencies are individually visible and never combined into one balance', async ({
  page,
  ledger,
}, testInfo) => {
  const dbName = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!dbName || !/^splitbook-test-access-[a-f0-9-]+$/.test(dbName))
    throw new Error('Unique isolated test database required');
  await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/expenses`, {
      data: {
        description: 'Current currency allocation',
        amount: 100,
        currency: 'INR',
        category: 'other',
        tag: 'Rent',
        date: new Date().toISOString(),
        paidBy: [{ user: priya, amount: 100 }],
        splitMethod: 'equal',
        splitBetween: [{ user: sam }],
      },
    }),
    201,
  );
  const database = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await database.connect();
    // This state predates the currency lock and cannot be constructed through the current API.
    await database
      .db(dbName)
      .collection('expenses')
      .insertOne({
        group: new ObjectId(ledger.groupB),
        description: 'Historical euro allocation',
        amount: 60,
        currency: 'EUR',
        category: 'other',
        tag: 'Rent',
        date: new Date(),
        paidBy: [{ user: new ObjectId(sam), amount: 60 }],
        splitMethod: 'equal',
        splitBetween: [{ user: new ObjectId(priya), amount: 60 }],
        createdBy: new ObjectId(sam),
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
        editHistory: [],
      });
  } finally {
    await database.close();
  }
  const balances = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/balances`));
  expect(
    balances.byCurrency
      .find((bucket: { currency: string }) => bucket.currency === 'INR')
      .balances.find((row: { user: { _id: string } }) => row.user._id === sam).balance,
  ).toBe(-100);
  expect(
    balances.byCurrency
      .find((bucket: { currency: string }) => bucket.currency === 'EUR')
      .balances.find((row: { user: { _id: string } }) => row.user._id === sam).balance,
  ).toBe(60);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const historyLoaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/groups/${ledger.groupB}/settlements` &&
      response.request().method() === 'GET',
  );
  await enter(page, ledger.sam, `/groups/${ledger.groupB}?tab=balances`);
  const ownBalance = page.getByText('Your balance', { exact: true }).last().locator('..');
  await expect(ownBalance.getByText(/₹100\.00/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Balance currency' }).click();
  await page.getByRole('option', { name: 'EUR', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(ownBalance.getByText(/€60\.00/)).toBeVisible();
  await expect(page.getByText(/Historical balances in EUR/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record settlement' })).toHaveCount(0);
  const history = await historyLoaded;
  expect(history.status()).toBe(200);
  await history.finished();
  await expect(page.getByRole('status', { name: 'Loading settlement history' })).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath('legacy-euro-balance.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByRole('tab', { name: 'Expenses', exact: true }).click();
  const historical = page.getByRole('button', { name: /Historical euro allocation, €60\.00/ });
  await historical.getByLabel('Expense actions').click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByRole('combobox', { name: /Currency/ })).toContainText('EUR');
  await edit.getByLabel('What was it for?').fill('Historical euro corrected');
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(edit).toBeHidden();
  const stored = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/expenses`));
  expect(
    stored.expenses.find(
      (expense: { description: string }) => expense.description === 'Historical euro corrected',
    ),
  ).toMatchObject({ currency: 'EUR', amount: 60, amountMinor: 6000 });
  expect(await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/balances`))).toEqual(
    balances,
  );
});

test('legacy binary-tail amounts remain editable without changing their exact allocations', async ({
  page,
  ledger,
}) => {
  const dbName = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!dbName || !/^splitbook-test-access-[a-f0-9-]+$/.test(dbName))
    throw new Error('Unique isolated test database required');
  const database = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`, {
    serverSelectionTimeoutMS: 5000,
  });
  const id = new ObjectId();
  try {
    await database.connect();
    await database
      .db(dbName)
      .collection('expenses')
      .insertOne({
        _id: id,
        group: new ObjectId(ledger.groupB),
        description: 'Historical fractional calculation',
        amount: 0.6000000000000001,
        currency: 'INR',
        category: 'other',
        tag: 'Rent',
        date: new Date(),
        paidBy: [
          { user: new ObjectId(sam), amount: 0.30000000000000004 },
          { user: new ObjectId(priya), amount: 0.3 },
        ],
        splitMethod: 'unequal',
        splitBetween: [
          { user: new ObjectId(sam), amount: 0.1 },
          { user: new ObjectId(priya), amount: 0.5000000000000001 },
        ],
        createdBy: new ObjectId(sam),
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
        editHistory: [],
      });
  } finally {
    await database.close();
  }

  const path = expensePath(ledger.groupB, id.toHexString());
  expect(await dataOf(await ledger.sam.get(path))).toMatchObject({
    amount: 0.6000000000000001,
  });
  const before = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/balances`));
  await enter(page, ledger.sam, `/groups/${ledger.groupB}`);
  const row = page.getByRole('button', { name: /Historical fractional calculation, ₹0\.60/ });
  await row.getByLabel('Expense actions').click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Amount')).toHaveValue('0.6');
  await expect(dialog.getByRole('spinbutton')).toHaveCount(5);
  expect(
    await dialog
      .getByRole('spinbutton')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
  ).toEqual(['0.6', '0.3', '0.3', '0.5', '0.1']);
  await dialog.getByLabel('What was it for?').fill('Historical fractional description corrected');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await dataOf(await ledger.sam.get(path))).toMatchObject({
    description: 'Historical fractional description corrected',
    amount: 0.6,
    amountMinor: 60,
    moneyVersion: 1,
    paidBy: [
      { amount: 0.3, amountMinor: 30 },
      { amount: 0.3, amountMinor: 30 },
    ],
    splitBetween: [
      { amount: 0.1, amountMinor: 10 },
      { amount: 0.5, amountMinor: 50 },
    ],
  });
  expect(await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/balances`))).toEqual(
    before,
  );
});

test('manual historical equal preview survives participant reorder and agrees with save and Balances', async ({
  page,
  ledger,
}) => {
  const dbName = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!dbName || !/^splitbook-test-access-[a-f0-9-]+$/.test(dbName))
    throw new Error('Isolated database required');
  const client = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`);
  const id = new ObjectId();
  try {
    await client.connect();
    await client
      .db(dbName)
      .collection('expenses')
      .insertOne({
        _id: id,
        group: new ObjectId(ledger.groupB),
        description: 'Historical remainder',
        amount: 0.03,
        currency: 'INR',
        category: 'other',
        tag: 'Rent',
        date: new Date(),
        paidBy: [{ user: new ObjectId(sam), amount: 0.03 }],
        splitMethod: 'equal',
        splitBetween: [
          { user: new ObjectId(sam), amount: 0.01 },
          { user: new ObjectId(priya), amount: 0.02 },
        ],
        createdBy: new ObjectId(sam),
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
        editHistory: [],
      });
  } finally {
    await client.close();
  }
  const balancePath = `/api/groups/${ledger.groupB}/balances`;
  const before = await dataOf(await ledger.sam.get(balancePath));
  await enter(page, ledger.sam, `/groups/${ledger.groupB}`);
  await page
    .getByRole('button', { name: /Historical remainder, ₹0\.03/ })
    .getByLabel('Expense actions')
    .click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const samRow = dialog.getByText('You', { exact: true }).last().locator('..');
  const priyaRow = dialog.getByText('Priya Shah', { exact: true }).last().locator('..');
  await expect(samRow).toContainText('₹0.01');
  await expect(priyaRow).toContainText('₹0.02');
  // Toggling one participant off/on changes presentation order, not the definition.
  await samRow.getByRole('checkbox').uncheck();
  await samRow.getByRole('checkbox').check();
  await expect(samRow).toContainText('₹0.01');
  await expect(priyaRow).toContainText('₹0.02');
  await dialog.getByLabel('What was it for?').fill('Historical remainder corrected');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  const stored = await dataOf(await ledger.sam.get(expensePath(ledger.groupB, id.toHexString())));
  expect(stored.splitBetween.map((row: { amountMinor: number }) => row.amountMinor)).toEqual([
    1, 2,
  ]);
  expect(await dataOf(await ledger.sam.get(balancePath))).toEqual(before);
});
