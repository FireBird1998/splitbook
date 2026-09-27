import { test, expect, dataOf } from './fixtures';

test('a lost create response preserves the draft and retries the same submission exactly once', async ({
  page,
  ledger,
}) => {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}`);
  await page.getByRole('button', { name: 'Add expense' }).last().click();
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
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('What was it for?')).toHaveValue('Lost response retry');
  await expect(dialog.getByLabel('Amount')).toHaveValue('101.01');
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
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
