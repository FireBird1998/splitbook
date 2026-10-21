import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup } from './fixtures';

test('Sam selects two of three Expenses and downloads just those, with each member’s share (#613)', async ({
  page,
  ledger,
}) => {
  const group = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: {
        name: `Selected export ${randomUUID().slice(0, 8)}`,
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: [],
      },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, group._id);
  for (const [description, amount] of [
    ['Milk and bread', 186],
    ['Water cans', 320],
    ['Plumber', 1080],
  ] as const)
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
    );

  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group._id}`);
  const main = page.getByRole('main');
  await main.getByRole('checkbox', { name: /^Select Milk and bread, / }).check();
  await main.getByRole('checkbox', { name: /^Select Plumber, / }).check();
  const panel = page.getByRole('region', { name: / selected · / });

  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export selected' }).click();
  const file = await download;

  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  }).format(new Date());
  expect(file.suggestedFilename()).toMatch(
    new RegExp(`^selected-export-[a-f0-9]{8}-${day}-selected-expenses\\.csv$`),
  );
  const status = panel.getByRole('status');
  await expect(status).toContainText('Downloading 2 Expenses as CSV');
  await expect(status).toContainText(file.suggestedFilename());
  const text = await readFile((await file.path())!, 'utf8');
  const [header, ...rows] = text
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split('\r\n');
  expect(header.split(',').slice(-2)).toEqual(['Priya Shah share', 'Sam Chen share']);
  expect(rows).toHaveLength(2);
  expect(text).toContain('Milk and bread');
  expect(text).toContain('Plumber');
  expect(text).not.toContain('Water cans');
});
