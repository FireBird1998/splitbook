import { randomUUID } from 'node:crypto';
import type { Page, TestInfo } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';

/*
 * #759: the Expenses tab's summary card says what Alex owes and gets back in every currency the
 * Trip's Expenses are in, one line each under its label as Spent stacks them, main currency first
 * (the Designer's option (b)), light and dark. A one-currency Trip's card is as it was.
 */

const { alex, sam } = DEMO_PERSONA_IDS;

async function trip(ledger: Ledger, alternateCurrencies: string[]) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Lisbon & Tokyo ${randomUUID().slice(0, 6)}`,
          category: 'trip',
          defaultCurrency: 'INR',
          alternateCurrencies,
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  return group;
}

async function add(
  ledger: Ledger,
  group: string,
  description: string,
  amount: number,
  currency: string,
  paidBy: 'alex' | 'sam',
) {
  const payer = paidBy === 'alex' ? alex : sam;
  await dataOf(
    await ledger[paidBy].post(`/api/groups/${group}/expenses`, {
      data: {
        description,
        amount,
        currency,
        category: 'food',
        tag: 'Food',
        date: new Date().toISOString(),
        paidBy: [{ user: payer, amount }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
    }),
    201,
  );
}

async function summaryOf(page: Page, ledger: Ledger, group: string) {
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}/expenses`);
  return page.getByRole('region', { name: 'Summary', exact: true });
}

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`759-${name}.png`), animations: 'disabled' });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`desktop ${scheme}: the summary says Alex’s position in every currency (#759)`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    const group = await trip(ledger, ['EUR', 'JPY']);
    // Yen first, so the card's order is the Trip's, not the order the money came in.
    await add(ledger, group, 'Hotel Gracery', 21000, 'JPY', 'sam');
    await add(ledger, group, 'Matcha in Uji', 3000, 'JPY', 'alex');
    await add(ledger, group, 'Pastéis de nata', 26.4, 'EUR', 'sam');
    await add(ledger, group, 'Tram 28 passes', 42000, 'INR', 'sam');

    const summary = await summaryOf(page, ledger, group);
    await expect(summary).toContainText(/Spent\s*₹42,000\.00\s*€26\.40\s*¥24,000/);
    // Heard as one sentence each; seen as one line per currency.
    await expect(summary).toContainText('₹21,000.00, €13.20 and ¥10,500');
    await expect(summary).toContainText(/You owe.*₹21,000\.00\s*€13\.20\s*¥10,500/);
    await expect(summary).toContainText(/You get back.*¥1,500/);
    await shoot(page, testInfo, `summary-${scheme}`);
  });
}

test('a one-currency Trip’s summary is as it was (#759)', async ({ page, ledger }) => {
  const group = await trip(ledger, []);
  await add(ledger, group, 'Beach shack dinner', 2400, 'INR', 'sam');
  await add(ledger, group, 'Scooter hire', 600, 'INR', 'alex');
  const summary = await summaryOf(page, ledger, group);
  await expect(summary).toHaveText(
    /^Spent\s*₹3,000\.00\s*Expenses\s*2\s*You owe\s*₹1,200\.00\s*You get back\s*₹300\.00$/,
  );
});
