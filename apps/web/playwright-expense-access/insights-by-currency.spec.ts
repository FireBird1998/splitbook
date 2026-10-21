import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';

/**
 * #729: Insights, the Trip summary and the Trip strip by currency. A Trip in rupees with euros
 * and yen: 1 rupee, 2 euro and 3 yen Expenses, so everything opens on yen and nothing is
 * converted.
 */

const today = () => new Date().toISOString().slice(0, 10);
const shifted = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function lisbonAndTokyo(ledger: Ledger, category: 'trip' | 'home') {
  const group = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: {
        name: `Lisbon and Tokyo ${randomUUID().slice(0, 8)}`,
        category,
        defaultCurrency: 'INR',
        alternateCurrencies: ['EUR', 'JPY'],
        ...(category === 'trip' ? { startDate: shifted(-2), endDate: shifted(2) } : {}),
      },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, group._id);
  const both = [{ user: DEMO_PERSONA_IDS.priya }, { user: DEMO_PERSONA_IDS.sam }];
  const add = async (description: string, amount: number, currency: string) =>
    dataOf(
      await ledger.priya.post(`/api/groups/${group._id}/expenses`, {
        data: {
          description,
          amount,
          currency,
          category: 'food',
          tag: category === 'trip' ? 'Food' : 'Groceries',
          date: `${today()}T12:00:00.000Z`,
          paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount }],
          splitMethod: 'equal',
          splitBetween: both,
        },
      }),
      201,
    );
  await add('Flights', 2400, 'INR');
  await add('Pastéis', 20, 'EUR');
  await add('Tram', 10, 'EUR');
  await add('Ramen', 2500, 'JPY');
  await add('Taxi', 4200, 'JPY');
  await add('Sushi', 3300, 'JPY');
  return group;
}

/** Sam, signed in. */
async function enter(page: Page, ledger: Ledger) {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
}

test('a Trip in three currencies opens on yen, and its strip and summary follow the switch (#729)', async ({
  page,
  ledger,
}) => {
  const group = await lisbonAndTokyo(ledger, 'trip');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await enter(page, ledger);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group._id}/expenses`);

  // The strip lists the Group's currencies, and its total is in yen, never ₹0.00.
  const strip = page.getByRole('region', { name: /^Lisbon and Tokyo .* trip, / });
  await expect(strip).toContainText('INR · EUR · JPY');
  await expect(strip).toContainText('¥10,000');
  // Every currency spent in is in the Expenses summary, and none that wasn't.
  const summary = page.getByRole('region', { name: 'Summary', exact: true });
  await expect(summary).toContainText('₹2,400.00');
  await expect(summary).toContainText('€30.00');
  await expect(summary).toContainText('¥10,000');

  await page.getByRole('link', { name: 'Insights', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Spending in' }).getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveAccessibleName(
    'INR, main currency, ₹2,400.00 spent in 1 Expense',
  );
  await expect(tabs.nth(1)).toHaveAccessibleName('EUR, €30.00 spent in 2 Expenses');
  await expect(tabs.nth(2)).toHaveAccessibleName('JPY, ¥10,000 spent in 3 Expenses');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByText('Opened on JPY, the currency with the most Expenses (3).'),
  ).toBeVisible();

  await tabs.nth(1).click();
  await expect(page).toHaveURL(/currency=EUR/);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByText('Each currency is shown on its own; nothing is converted.'),
  ).toBeVisible();
  // The strip follows the switch.
  await expect(strip).toContainText('€30.00');
});

test('a Household’s Insights opens on the currency with the most Expenses in the Month (#729)', async ({
  page,
  ledger,
}) => {
  const group = await lisbonAndTokyo(ledger, 'home');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await enter(page, ledger);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group._id}/insights`);
  const tabs = page.getByRole('tablist', { name: 'Spending in' }).getByRole('tab');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByText(
      'Opened on JPY, the currency with the most Expenses (3). Each currency is shown on its own; nothing is converted.',
    ),
  ).toBeVisible();
  await expect(page.getByText(/left out, never converted/)).toHaveCount(0);
});
