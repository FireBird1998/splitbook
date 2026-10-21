import { randomUUID } from 'node:crypto';
import type { Page, TestInfo } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';

/*
 * #727: Alex pays Sam's €20.00 Debt in rupees from Balances, in each state the boards "Pay a euro
 * Debt in rupees" and "Record payment · every state" show, then opens the payment's card in
 * Activity ("Activity and a cross-currency Settlement"), light and dark. The Group's rate read is
 * answered here, so each state is the one drawn; the server checks the payment as recorded.
 */

const { alex, sam } = DEMO_PERSONA_IDS;

/** Lisbon & Tokyo, a fictional Trip: rupees, with euros and yen. Sam paid €40.00 for two. */
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
  await dataOf(
    await ledger.sam.post(`/api/groups/${group}/expenses`, {
      data: {
        description: 'Pastéis de nata',
        amount: 40,
        currency: 'EUR',
        category: 'food',
        tag: 'Food',
        date: new Date().toISOString(),
        paidBy: [{ user: sam, amount: 40 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
    }),
    201,
  );
  return group;
}

const today = new Date();
const dayOf = (offset: number) => {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};
const fetchedToday = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate(),
  6,
).toISOString();
const frankfurter = {
  from: 'EUR',
  to: 'INR',
  rate: '92.1',
  source: 'frankfurter',
  asOf: dayOf(1),
  fetchedAt: fetchedToday,
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
  components: [],
};

/** The Group's rate read answers with this suggestion, or none. */
async function answerRate(page: Page, suggestion: object | null) {
  await page.unroute('**/api/groups/*/rates?**');
  await page.route('**/api/groups/*/rates?**', (route) =>
    route.fulfill({
      json: suggestion
        ? { data: { suggestion }, status: 200 }
        : { data: { suggestion: null, reason: 'unavailable' }, status: 200 },
    }),
  );
}

/** Alex's Balances, on the euro tab, with Record payment open for Sam's Debt, paid in rupees. */
async function openSheet(page: Page, ledger: Ledger, group: string) {
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}?tab=balances`);
  const euros = page.getByRole('tabpanel', { name: 'EUR, you owe €20.00' });
  await euros
    .getByRole('region', { name: 'Settle up', exact: true })
    .getByRole('button', { name: 'Record your payment to Sam Chen' })
    .click();
  const sheet = euros.getByRole('region', { name: 'Record payment', exact: true });
  await sheet.getByRole('radio', { name: 'INR' }).click();
  return sheet;
}

const fieldsOf = (sheet: ReturnType<Page['getByRole']>) => [
  sheet.getByRole('textbox', { name: 'Amount cleared, EUR' }),
  sheet.getByRole('textbox', { name: 'Rate, INR for each EUR' }),
  sheet.getByRole('textbox', { name: 'Amount paid, INR' }),
];

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`727-${name}.png`), animations: 'disabled' });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`desktop ${scheme}: pay a euro Debt in rupees, in every state, and its record (#727)`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: scheme });
    const group = await lisbonAndTokyo(ledger);

    // The suggested rate: the whole Debt, and the amount paid follows.
    await answerRate(page, frankfurter);
    let sheet = await openSheet(page, ledger, group);
    const [cleared, rate, paid] = fieldsOf(sheet);
    await expect(cleared).toHaveValue('20.00');
    await expect(rate).toHaveValue('92.10');
    await expect(paid).toHaveValue('1,842.00');
    await expect(sheet).toContainText('· Debt in EUR');
    await expect(sheet).toContainText('EUR is the Debt’s own currency; INR is the main currency.');
    await expect(sheet).toContainText('Clears your €20.00 Debt to Sam. Sam gets ₹1,842.00.');
    await shoot(page, testInfo, `pay-euro-in-rupees-${scheme}`);

    // Another currency's tab and back keeps what was entered (#727 review).
    await cleared.fill('15.00');
    await page.getByRole('tab', { name: /^INR, main currency/ }).click();
    await page.getByRole('tab', { name: /^EUR, you owe/ }).click();
    await expect(cleared).toHaveValue('15.00');
    await expect(paid).toHaveValue('1,381.50');
    await cleared.fill('20.00');

    // Your rate, with the suggestion one click away.
    await rate.fill('92.50');
    await expect(paid).toHaveValue('1,850.00');
    await expect(sheet).toContainText('Your rate. Suggested ₹92.10 from Frankfurter');
    await shoot(page, testInfo, `your-rate-${scheme}`);
    await sheet.getByRole('button', { name: 'Use ₹92.10' }).click();
    await expect(paid).toHaveValue('1,842.00');

    // Part of the Debt.
    await cleared.fill('10.00');
    await expect(paid).toHaveValue('921.00');
    await expect(sheet).toContainText('€10.00 stays to pay.');
    await shoot(page, testInfo, `part-of-the-debt-${scheme}`);

    // More than the Debt: Record waits for the tick.
    await cleared.fill('25.00');
    await expect(paid).toHaveValue('2,302.50');
    await expect(sheet).toContainText(
      'That’s €5.00 more than you owe Sam in EUR, so Sam would owe you €5.00.',
    );
    const record = sheet.getByRole('button', { name: 'Record payment', exact: true });
    await expect(record).toBeDisabled();
    await shoot(page, testInfo, `more-than-the-debt-${scheme}`);

    // No suggestion: the payer types the rate or both amounts.
    await answerRate(page, null);
    sheet = await openSheet(page, ledger, group);
    await expect(sheet).toContainText('No rate suggested right now.');
    await expect(fieldsOf(sheet)[1]).toHaveValue('');
    await expect(sheet).toContainText('Enter the rate or the amount paid to record it');
    await shoot(page, testInfo, `no-suggestion-${scheme}`);

    // The second source, with its attribution and link.
    await answerRate(page, {
      ...frankfurter,
      rate: '92.06',
      source: 'exchange-rate-api',
      asOf: dayOf(0),
      attributionRequired: true,
      attribution: { text: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' },
    });
    sheet = await openSheet(page, ledger, group);
    await expect(fieldsOf(sheet)[2]).toHaveValue('1,841.20');
    await expect(sheet.getByRole('link', { name: 'Rates By Exchange Rate API' })).toHaveAttribute(
      'href',
      'https://www.exchangerate-api.com',
    );
    await shoot(page, testInfo, `second-source-${scheme}`);

    // An older suggestion shows its age.
    await answerRate(page, { ...frankfurter, rate: '91.4', asOf: dayOf(5), ageDays: 5 });
    sheet = await openSheet(page, ledger, group);
    await expect(fieldsOf(sheet)[2]).toHaveValue('1,828.00');
    await expect(sheet).toContainText('5 days old. Today’s rates aren’t in yet.');
    await shoot(page, testInfo, `older-suggestion-${scheme}`);

    // Record it at the payer's own rate.
    await answerRate(page, frankfurter);
    sheet = await openSheet(page, ledger, group);
    await fieldsOf(sheet)[1].fill('92.50');
    await sheet.getByRole('button', { name: 'Record payment', exact: true }).click();
    await expect(page.getByText('Payment recorded.', { exact: false })).toBeVisible();
    const stored = (await dataOf(
      await ledger.sam.get(`/api/groups/${group}/settlements`),
    )) as Array<Record<string, unknown>>;
    expect(stored[0]).toMatchObject({
      amount: 20,
      currency: 'EUR',
      amountPaidMinor: 185000,
      paidCurrency: 'INR',
      appliedRate: '92.5',
      rateKind: 'custom',
      suggestedRate: '92.1',
      rateSource: 'frankfurter',
    });
    // Only the euro Debt moved: settled in euros, and still settled up in rupees.
    await expect(page.getByRole('tab', { name: /^EUR, you’re settled up/ })).toBeVisible();
    await expect(
      page.getByRole('tab', { name: /^INR, main currency, you’re settled up/ }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toContainText('€20.00 paid as ₹1,850.00 at ₹92.50 per €');

    // Activity names both amounts and the rate, and opens the payment's card.
    await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}/activity`);
    const row = page.getByRole('button', {
      name: /You paid Sam Chen ₹1,850\.00 to clear €20\.00 at ₹92\.50 per €, suggested ₹92\.10/,
    });
    await expect(row).toContainText('Settlement · EUR Debt paid in INR');
    await row.click();
    const card = page.getByRole('region', { name: 'Payment', exact: true });
    await expect(card).toContainText(/Paid\s*₹1,850\.00\s*to clear €20\.00, a Debt in EUR/);
    await expect(card).toContainText(/Rate used\s*₹92\.50 per €\s*Your rate/);
    await expect(card).toContainText('You and Sam in EUR: −€20.00 → €0.00');
    await expect(card).toContainText(
      'INR balances didn’t change. Only the Debt’s own currency moves.',
    );
    await shoot(page, testInfo, `activity-payment-${scheme}`);
    await card.getByRole('button', { name: 'Close Payment' }).click();
    await expect(card).toBeHidden();
  });
}
