import { randomUUID } from 'node:crypto';
import type { Page, TestInfo } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';

/*
 * #734: Alex owes Sam ₹1,480.00 and €20.00 in Lisbon & Tokyo, and settles both from Balances in
 * one payment in rupees, the euro Debt at Frankfurter's ₹92.10 (board "Web · Settle both
 * currencies at once"), light and dark. The server records two Settlements, each currency's
 * ledger moving by its own Debt; Activity shows them as one payment. A lost reply is sent again
 * unchanged from Check payment and recorded once. The Group's rate read is answered here.
 */

const { alex, sam } = DEMO_PERSONA_IDS;

async function lisbonAndTokyo(ledger: Ledger) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Lisbon & Tokyo ${randomUUID().slice(0, 6)}`,
          category: 'trip',
          defaultCurrency: 'INR',
          alternateCurrencies: ['EUR', 'JPY'],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  for (const [description, amount, currency] of [
    ['Tram 28 passes', 2960, 'INR'],
    ['Pastéis de nata', 40, 'EUR'],
  ] as const)
    await dataOf(
      await ledger.sam.post(`/api/groups/${group}/expenses`, {
        data: {
          description,
          amount,
          currency,
          category: 'food',
          tag: 'Food',
          date: new Date().toISOString(),
          paidBy: [{ user: sam, amount }],
          splitMethod: 'equal',
          splitBetween: [{ user: alex }, { user: sam }],
        },
      }),
      201,
    );
  return group;
}

const today = new Date();
const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
const frankfurter = {
  from: 'EUR',
  to: 'INR',
  rate: '92.1',
  source: 'frankfurter',
  asOf: `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`,
  fetchedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 6).toISOString(),
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
  components: [],
};

async function openBalances(page: Page, ledger: Ledger, group: string) {
  await page.route('**/api/groups/*/rates?**', (route) =>
    route.fulfill({ json: { data: { suggestion: frankfurter }, status: 200 } }),
  );
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}?tab=balances`);
}

async function settlementsOf(ledger: Ledger, group: string) {
  const rows = (await dataOf(await ledger.alex.get(`/api/groups/${group}/settlements`))) as Array<{
    currency: string;
    amount: number;
    amountPaidMinor?: number;
    paidCurrency?: string;
  }>;
  return rows.map(({ currency, amount, amountPaidMinor, paidCurrency }) => ({
    currency,
    amount,
    ...(amountPaidMinor === undefined ? {} : { amountPaidMinor, paidCurrency }),
  }));
}

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`734-${name}.png`), animations: 'disabled' });
}

const RECORDED = 'Recorded. You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00.';

for (const scheme of ['light', 'dark'] as const) {
  test(`desktop ${scheme}: settle both of Alex’s Debts to Sam in one payment, and its Activity (#734)`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    const group = await lisbonAndTokyo(ledger);
    await openBalances(page, ledger, group);

    const offers = page.getByRole('list', { name: 'Settle up' });
    await expect(offers).toContainText('You owe Sam Chen in 2 currencies');
    await expect(offers).toContainText('₹1,480.00 and €20.00');
    await shoot(page, testInfo, `balances-offer-${scheme}`);

    await offers.getByRole('button', { name: 'Settle both with Sam Chen' }).click();
    const sheet = page.getByRole('dialog', { name: 'Settle up with Sam Chen' });
    await expect(sheet.getByRole('row')).toHaveText([
      /Debt\s*Rate\s*You pay/,
      /INR\s*₹1,480\.00\s*Same currency\s*₹1,480\.00/,
      /EUR\s*€20\.00\s*₹92\.10 per €.*Suggested.*₹1,842\.00/,
      /Total\s*₹3,322\.00/,
    ]);
    await expect(sheet).toContainText('Activity shows them as one payment.');
    await shoot(page, testInfo, `sheet-${scheme}`);

    await sheet.getByRole('button', { name: 'Record ₹3,322.00' }).click();
    await expect(page.getByRole('status').filter({ hasText: RECORDED })).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await expect(offers).toHaveCount(0);

    // Two Settlements, each clearing its own Debt; nothing converted on either ledger.
    expect(await settlementsOf(ledger, group)).toEqual(
      expect.arrayContaining([
        { currency: 'INR', amount: 1480 },
        { currency: 'EUR', amount: 20, amountPaidMinor: 184200, paidCurrency: 'INR' },
      ]),
    );
    expect(await settlementsOf(ledger, group)).toHaveLength(2);
    const balances = await dataOf(await ledger.alex.get(`/api/groups/${group}/balances`));
    for (const code of ['INR', 'EUR']) {
      const bucket = balances.byCurrency.find((row: { currency: string }) => row.currency === code);
      expect(
        bucket?.balances.find((row: { user: { _id: string } }) => row.user._id === alex)?.balance ??
          0,
      ).toBe(0);
    }
    await shoot(page, testInfo, `settled-${scheme}`);

    await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}/activity`);
    const row = page.getByRole('button', {
      name: /You paid Sam Chen ₹3,322\.00 to clear ₹1,480\.00 and €20\.00/,
    });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('€20.00 at ₹92.10 per €, suggested ₹92.10');
    await row.click();
    await expect(page.getByRole('region', { name: 'Payment' })).toContainText(/Paid\s*₹3,322\.00/);
    await shoot(page, testInfo, `activity-${scheme}`);
  });
}

test('a settle-up whose reply was lost is sent again unchanged from Check payment, and recorded once (#734)', async ({
  page,
  ledger,
}) => {
  const group = await lisbonAndTokyo(ledger);
  await openBalances(page, ledger, group);
  // The first send is recorded, then its reply is lost.
  const keys: string[] = [];
  const bodies: string[] = [];
  await page.route('**/api/groups/*/settlements/batch', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    bodies.push(route.request().postData() ?? '');
    if (keys.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      return route.abort('failed');
    }
    return route.continue();
  });

  await page.getByRole('button', { name: 'Settle both with Sam Chen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Settle up with Sam Chen' });
  await sheet.getByRole('button', { name: 'Record ₹3,322.00' }).click();
  await expect(sheet).toContainText('The connection failed before this payment was confirmed.');
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  const unconfirmed = page.getByRole('status').filter({ hasText: 'Payment not confirmed' });
  await expect(unconfirmed).toContainText('Your payment of ₹3,322.00 to Sam Chen');
  await unconfirmed.getByRole('button', { name: 'Check payment' }).click();
  const check = page.getByRole('dialog', { name: 'Settle up with Sam Chen' });
  await expect(check).toContainText('This payment may already be recorded.');
  await check.getByRole('button', { name: 'Record ₹3,322.00 again' }).click();
  await expect(page.getByRole('status').filter({ hasText: RECORDED })).toBeVisible();

  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(bodies[1]).toBe(bodies[0]);
  expect(await settlementsOf(ledger, group)).toHaveLength(2);
  await expect(unconfirmed).toHaveCount(0);
});
