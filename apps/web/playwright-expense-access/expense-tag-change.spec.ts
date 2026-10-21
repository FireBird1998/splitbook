import { randomUUID } from 'node:crypto';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import {
  test,
  expect,
  dataOf,
  expenseButton,
  expensePath,
  expenseRevisionHeaders,
  joinGroup,
} from './fixtures';

test('Sam ticks three Expenses and moves them to one Tag; one Priya changed meanwhile stays, with why and Open (#610)', async ({
  page,
  ledger,
}) => {
  // Priya's Household, which Sam has joined, with three Groceries Expenses.
  const group = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: {
        name: `Tag change ${randomUUID()}`,
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: [],
      },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, group._id);
  const add = async (description: string, amount: number): Promise<string> =>
    (
      await dataOf(
        await ledger.priya.post(`/api/groups/${group._id}/expenses`, {
          data: {
            description,
            amount,
            currency: 'INR',
            category: 'food',
            tag: 'Groceries',
            date: new Date().toISOString(),
            paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount }],
            splitMethod: 'equal',
            splitBetween: [{ user: DEMO_PERSONA_IDS.priya }, { user: DEMO_PERSONA_IDS.sam }],
          },
        }),
        201,
      )
    )._id;
  const milk = await add('Milk and bread', 186);
  const water = await add('Water cans', 320);
  const plumber = await add('Plumber', 1080);

  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group._id}`);
  const main = page.getByRole('main');
  await main.getByRole('checkbox', { name: /^Select Milk and bread, / }).check();
  await main.getByRole('checkbox', { name: /^Select Water cans, / }).check();
  // X ticks the row whose Expense has focus.
  await expenseButton(page, 'Plumber').focus();
  await page.keyboard.press('x');
  const panel = page.getByRole('region', { name: / selected · / });
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('3 selected · ₹1,586.00');

  // The list Sam sees stays as it is from here: its refresh never lands, so the change below
  // goes with the revisions Sam saw.
  await page.route(`**/api/groups/${group._id}/expenses?*`, () => {});
  // Priya renames Water cans meanwhile.
  const path = expensePath(group._id, water);
  const renamed = await ledger.priya.patch(path, {
    headers: await expenseRevisionHeaders(ledger.priya, path),
    data: { description: 'Water cans (20 L)' },
  });
  expect(renamed.status()).toBe(200);

  await panel.getByRole('button', { name: 'Change Tag' }).click();
  await panel.getByRole('button', { name: 'Move to Household' }).click();

  const result = panel.getByRole('status');
  await expect(result).toContainText('Moved 2 Expenses to Household. 1 didn’t change:');
  await expect(result).toContainText('Someone changed it a moment ago. Open it to see the latest.');
  // What didn't change stays selected.
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('1 selected · ₹320.00');
  const list = await dataOf(await ledger.priya.get(`/api/groups/${group._id}/expenses`));
  const tagOf = (id: string) =>
    list.expenses.find((expense: { _id: string }) => expense._id === id).tag;
  expect([tagOf(milk), tagOf(water), tagOf(plumber)]).toEqual([
    'Household',
    'Groceries',
    'Household',
  ]);

  await panel.getByRole('button', { name: 'Open Water cans' }).click();
  await expect(page.getByRole('region', { name: 'Water cans (20 L) details' })).toBeVisible();
  await expect(main.getByRole('checkbox', { name: /^Select Water cans, / })).not.toBeChecked();
});
