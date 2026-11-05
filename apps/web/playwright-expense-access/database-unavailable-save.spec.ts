import { test, expect, dataOf, openAddExpense } from './fixtures';

/*
 * #858: Save while Splitbook can't reach its database. The duplicate check runs first, and the
 * server answers it, after its one retry, with 503 DATABASE_UNAVAILABLE within about 5 s
 * (`src/app/api/database-unavailable.integration.test.ts` pins that against a database it cuts).
 * The form then says so in the owner's words straight away, keeps everything typed and sends no
 * save, where it used to send one anyway and wait about 5 s more for "Internal server error".
 * Once the database is back, Save records the Expense exactly once.
 *
 * The check's answer is the server's own, stood in for at the network edge: this suite shares
 * one database with the specs running beside it, so it can't take that database away.
 */

const unavailable = {
  error: 'Couldn’t reach Splitbook. Try again.',
  code: 'DATABASE_UNAVAILABLE',
  status: 503,
};

test('a Save that finds the database unreachable says so at once, keeps the form, sends nothing, and saves once after', async ({
  page,
  ledger,
}) => {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}`);
  await openAddExpense(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What was it for?').fill('Database outage dinner');
  await dialog.getByLabel('Amount').fill('640.25');
  const createPath = `/api/groups/${ledger.groupB}/expenses`;
  const saves: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === createPath && request.method() === 'POST')
      saves.push(request.headers()['idempotency-key']);
  });
  await page.route('**/expenses/check-duplicate?*', (route) =>
    route.fulfill({ status: 503, json: unavailable }),
  );

  const save = dialog.getByRole('button', { name: 'Save expense', exact: true });
  await save.click();
  await expect(dialog.getByText('Couldn’t reach Splitbook. Try again.')).toBeVisible();
  await expect(dialog.getByText('Internal server error')).toHaveCount(0);
  await expect(dialog.getByLabel('What was it for?')).toHaveValue('Database outage dinner');
  await expect(dialog.getByLabel('Amount')).toHaveValue('640.25');
  await expect(save).toBeEnabled();
  expect(saves).toEqual([]);
  const before = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/expenses`));
  expect(
    before.expenses.filter(
      (row: { description: string }) => row.description === 'Database outage dinner',
    ),
  ).toHaveLength(0);

  // The database is back: Try again checks and saves, once.
  await page.unroute('**/expenses/check-duplicate?*');
  await save.click();
  await expect(dialog).toBeHidden();
  expect(saves).toHaveLength(1);
  const after = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/expenses`));
  expect(
    after.expenses.filter(
      (row: { description: string }) => row.description === 'Database outage dinner',
    ),
  ).toHaveLength(1);
});
