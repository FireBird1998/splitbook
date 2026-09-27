import { MongoClient, ObjectId } from 'mongodb';
import { test, expect, dataOf } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

test('recurring legacy float tails display exact fields and allow a metadata-only save', async ({
  page,
  ledger,
}) => {
  const now = new Date();
  const startsOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const template = await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/recurring`, {
      data: {
        description: 'Compatible legacy utilities',
        amount: 0.3,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 0.3 }],
        splitMethod: 'exact',
        splitBetween: [
          { user: DEMO_PERSONA_IDS.priya, amount: 0.15 },
          { user: DEMO_PERSONA_IDS.sam, amount: 0.15 },
        ],
        dayOfMonth: 1,
        startsOn,
      },
    }),
    201,
  );
  const dbName = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!dbName || !/^splitbook-test-access-[a-f0-9-]+$/.test(dbName))
    throw new Error('Unique isolated test database required');
  const client = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    // Old binary tails are readable storage; the public API correctly rejects new ones.
    await client
      .db(dbName)
      .collection('recurringexpenses')
      .updateOne(
        { _id: new ObjectId(template._id) },
        {
          $set: {
            amount: 0.1 + 0.2,
            'paidBy.0.amount': 0.1 + 0.2,
            'splitBetween.0.amount': 0.1 + 0.05,
            'splitBetween.1.amount': 0.1 + 0.05,
          },
          $unset: {
            moneyVersion: '',
            amountMinor: '',
            'paidBy.0.amountMinor': '',
            'splitBetween.0.amountMinor': '',
            'splitBetween.1.amountMinor': '',
          },
        },
      );
  } finally {
    await client.close();
  }
  await page.context().addCookies((await ledger.priya.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}/settings`);
  await page
    .getByRole('button', { name: 'Actions for recurring expense Compatible legacy utilities' })
    .click();
  await expect(page.getByText('Amounts need review — not generating', { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit recurring expense' });
  const amounts = dialog.getByLabel('Amount', { exact: true });
  await expect(amounts).toHaveCount(3);
  await expect(amounts.nth(0)).toHaveValue('0.3');
  await expect(amounts.nth(1)).toHaveValue('0.15');
  await expect(amounts.nth(2)).toHaveValue('0.15');
  await dialog.getByLabel('Description').fill('Reviewed legacy utilities');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  const templates = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/recurring`));
  const updated = templates.find((row: { _id: string }) => row._id === template._id);
  expect(updated).toMatchObject({
    description: 'Reviewed legacy utilities',
    amount: 0.3,
    amountMinor: 30,
    moneyVersion: 1,
  });
  expect(updated.paidBy[0].amountMinor).toBe(30);
  expect(updated.splitBetween.map((row: { amountMinor: number }) => row.amountMinor)).toEqual([
    15, 15,
  ]);
});
