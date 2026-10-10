import { test, expect, expenseInList } from './fixtures';

test('a malformed Expense refresh keeps verified rows and Retry clears its safe warning (#235)', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  const path = `/api/groups/${ledger.groupB}/expenses`;
  const isExpenseRead = (url: URL) => url.pathname === path;
  await page.goto(`${origin}/groups/${ledger.groupB}/expenses`);
  await expect(expenseInList(page, 'Private rent')).toBeVisible();
  await page.route(isExpenseRead, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { status: 200, data: { expenses: [{ description: 'PRIVATE malformed body' }] } },
    });
  });
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.status() === 200,
  );
  await page.clock.runFor(11_000);
  await refreshed;
  const warning = page
    .getByRole('alert')
    .filter({ hasText: 'Expenses could not be refreshed. Showing the list loaded before.' });
  await expect(warning).toBeVisible();
  await expect(expenseInList(page, 'Private rent')).toBeVisible();
  await expect(page.getByText('PRIVATE malformed body')).toHaveCount(0);
  await page.unroute(isExpenseRead);
  await warning.getByRole('button', { name: 'Try again', exact: true }).press('Enter');
  await expect(warning).toHaveCount(0);
  await expect(expenseInList(page, 'Private rent')).toBeVisible();
});

test('an Expense in a historical currency remains readable (#235)', async ({ page, ledger }) => {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  await page.route(
    (url) => url.pathname === `/api/groups/${ledger.groupB}/expenses`,
    async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.data.expenses[0].currency = 'XYZ';
      payload.data.expenses[0].description = 'Fictional historical currency';
      await route.fulfill({ response, json: payload });
    },
  );
  await page.goto(`${origin}/groups/${ledger.groupB}/expenses`);
  const row = expenseInList(page, 'Fictional historical currency');
  await expect(row).toBeVisible();
  await expect(row).toContainText('XYZ');
  await expect(page.getByText(/Expenses could not be loaded/)).toHaveCount(0);
});
