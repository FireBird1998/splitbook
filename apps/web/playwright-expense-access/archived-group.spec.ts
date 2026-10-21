import { randomUUID } from 'node:crypto';
import { test, expect, dataOf, joinGroup, openAddExpense } from './fixtures';

test('a Group archived while Sam adds an Expense refuses it, says why and keeps the form (#578)', async ({
  page,
  ledger,
}) => {
  // Priya's Household, which Sam has joined, and which she archives while Sam is typing.
  const group = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: {
        name: `Archived while typing ${randomUUID()}`,
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: [],
      },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, group._id);
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group._id}`);
  await openAddExpense(page);
  const dialog = page.getByRole('dialog');
  const description = dialog.getByLabel('What was it for?');
  const amount = dialog.getByLabel('Amount');
  await description.fill('Lake dinner');
  await amount.fill('1200');
  expect((await ledger.priya.delete(`/api/groups/${group._id}`)).status()).toBe(200);

  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();

  await expect(dialog.getByRole('alert')).toHaveText(
    'This Group was archived, so nothing more can be saved in it.',
  );
  await expect(description).toHaveValue('Lake dinner');
  await expect(amount).toHaveValue('1,200.00');
  await expect(dialog.getByRole('button', { name: 'Reload latest' })).toHaveCount(0);
  const list = await dataOf(await ledger.priya.get(`/api/groups/${group._id}/expenses`));
  expect(list.expenses).toEqual([]);
});
