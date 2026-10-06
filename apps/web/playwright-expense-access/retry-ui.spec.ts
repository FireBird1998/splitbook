import { test, expect, dataOf, openAddExpense } from './fixtures';

test('a lost create response preserves the draft and retries the same submission exactly once', async ({
  page,
  ledger,
}) => {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}`);
  await openAddExpense(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What was it for?').fill('Lost response retry');
  await dialog.getByLabel('Amount').fill('101.01');
  const keys: string[] = [];
  await page.route(`**/api/groups/${ledger.groupB}/expenses`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      return route.abort('failed');
    }
    return route.continue();
  });
  // The real write must finish and the intercepted response must be lost before
  // the UI can show its retryable error; the click alone does not await either.
  const createPath = `/api/groups/${ledger.groupB}/expenses`;
  const responseLost = page.waitForEvent(
    'requestfailed',
    (request) => new URL(request.url()).pathname === createPath && request.method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await responseLost;
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('What was it for?')).toHaveValue('Lost response retry');
  await expect(dialog.getByLabel('Amount')).toHaveValue('101.01');
  const retried = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === createPath && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  const created = await retried;
  expect(created.status()).toBe(201);
  await created.finished();
  await expect(dialog).toBeHidden();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  const result = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/expenses`));
  expect(
    result.expenses.filter(
      (expense: { description: string }) => expense.description === 'Lost response retry',
    ),
  ).toHaveLength(1);
  const activity = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/activity`));
  expect(
    activity.activities.filter(
      (event: { type: string; metadata: { description?: string } }) =>
        event.type === 'expense_added' && event.metadata.description === 'Lost response retry',
    ),
  ).toHaveLength(1);
});

test('changing a draft after a lost committed response creates a distinct explicit action', async ({
  page,
  ledger,
}) => {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}`);
  await openAddExpense(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What was it for?').fill('First explicit action');
  await dialog.getByLabel('Amount').fill('7.13');
  const keys: string[] = [];
  await page.route(`**/api/groups/${ledger.groupB}/expenses`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) {
      expect((await route.fetch()).status()).toBe(201);
      return route.abort('failed');
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByLabel('What was it for?').fill('Second explicit action');
  // Editing alone must not issue another financial request.
  expect(keys).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
  const result = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/expenses`));
  expect(
    result.expenses.filter((row: { description: string }) =>
      /^(First|Second) explicit action$/.test(row.description),
    ),
  ).toHaveLength(2);
  const activity = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/activity`));
  expect(
    activity.activities.filter(
      (row: { type: string; metadata: { description?: string } }) =>
        row.type === 'expense_added' &&
        /^(First|Second) explicit action$/.test(row.metadata.description ?? ''),
    ),
  ).toHaveLength(2);
});

test('validation and cancelled duplicate confirmation retain the draft; advisory failure still permits a real save', async ({
  page,
  ledger,
}) => {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}`);
  await openAddExpense(page);
  const dialog = page.getByRole('dialog');
  const description = dialog.getByLabel('What was it for?');
  const amount = dialog.getByLabel('Amount');
  await description.fill('Private rent');
  await amount.fill('1200.001');
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('decimal places');
  await expect(amount).toHaveValue('1200.001');
  await amount.fill('1200');
  const warning = page.waitForEvent('dialog');
  const confirmSave = dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await (await warning).dismiss();
  await confirmSave;
  await expect(description).toHaveValue('Private rent');
  await expect(amount).toHaveValue('1200');
  await expect(dialog.getByRole('button', { name: 'Save expense', exact: true })).toBeEnabled();
  await description.fill('After duplicate cancellation');
  await page.route('**/expenses/check-duplicate?*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Advisory unavailable' } }),
  );
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(dialog).toBeHidden();
  const result = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/expenses`));
  expect(
    result.expenses.filter(
      (row: { description: string }) => row.description === 'After duplicate cancellation',
    ),
  ).toHaveLength(1);
});
