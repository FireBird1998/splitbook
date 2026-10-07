import { expect, test, type Page } from '@playwright/test';
import { formatCurrency } from '@splitbook/shared/currency';
import { formatSignedCurrency } from '@splitbook/shared/money';
import type { CurrencyBalanceBucket, HomeSuggestedPayment } from '@splitbook/shared/types';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectThemeApplied,
  openAddExpense,
  expenseItem,
  openExpense,
  parseMoneyText,
  reviewScreenshot,
  switchPersona,
} from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

/**
 * Core private-beta journeys for each persona. Serial because they share the
 * seeded demo database: Alex creates a trip, Sam settles with Alex on the
 * seeded trip, Priya verifies her (unaffected) balance.
 *
 * Every project (desktop/mobile × light/dark) runs the same journeys, so
 * assertions on mutable balances are relative to what the journey observed.
 * Home's figures and suggested payments are checked against the balances read (#306),
 * since the Household's recurring bills follow the run date.
 */

test.describe.configure({ mode: 'serial' });

const balancesCard = (page: Page) => page.getByRole('region', { name: 'Your balances' });
const needsYouCard = (page: Page) => page.getByRole('region', { name: 'Needs you' });

/** An amount in the seed's currencies (two decimals), from exact minor units. */
const formatAmount = (amountMinor: number, currency = 'INR') =>
  formatCurrency(amountMinor / 100, currency);

/** The signed-in member's balances read, as Home reads it. */
async function balancesRead(page: Page) {
  const response = await page.request.get('/api/user/balances');
  expect(response.ok()).toBe(true);
  const { data } = await response.json();
  return data as { buckets: CurrencyBalanceBucket[]; suggestedPayments: HomeSuggestedPayment[] };
}

/** Home shows each currency's figures and every suggested payment, as the read has them. */
async function expectHomeMatchesBalancesRead(page: Page) {
  const { buckets, suggestedPayments } = await balancesRead(page);
  for (const { currency, youOwe, youAreOwed, net } of buckets) {
    const figures = balancesCard(page).getByRole('group', { name: currency, exact: true });
    for (const amount of [
      formatSignedCurrency(net, currency),
      formatCurrency(youOwe, currency),
      formatCurrency(youAreOwed, currency),
    ])
      await expect(figures.getByText(amount, { exact: true }).first()).toBeVisible();
  }
  const records = needsYouCard(page).getByRole('link', { name: /^Record payment: / });
  await expect(records).toHaveCount(suggestedPayments.length);
  for (const [index, payment] of suggestedPayments.entries()) {
    const title =
      payment.direction === 'pay'
        ? `You pay ${payment.counterpartyName}`
        : `${payment.counterpartyName} pays you`;
    await expect(records.nth(index)).toHaveAccessibleName(
      `Record payment: ${title}, ${formatAmount(payment.amountMinor, payment.currency)}, in ${payment.groupName}`,
    );
  }
}

// State handed from the create-trip journey to the edit journey.
let qaTripUrl = '';
let qaTripName = '';

test('alex: enters the demo and inspects her balance', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);

  // Money-first Home: the INR balance, with Net, what she owes and what she is owed.
  const balancePanel = balancesCard(page);
  await expect(balancePanel.getByText('INR', { exact: true })).toBeVisible();
  await expect(balancePanel.getByText('Net', { exact: true })).toBeVisible();
  await expect(balancePanel.getByText('Owed to you', { exact: true })).toBeVisible();

  // The seeded trip appears with Alex's positive balance.
  await expect(page.getByText(DEMO_TRIP_NAME).first()).toBeVisible();

  if (testInfo.project.name === 'desktop-light') {
    // Exact seeded amount — asserted once, before any journey mutates it: only Goa owes her.
    await expect(balancePanel.getByText('₹6,160.00', { exact: true })).toBeVisible();
  }

  await expectHomeMatchesBalancesRead(page);
  await reviewScreenshot(page, testInfo, 'alex-dashboard');
});

test('alex: Needs you → Record opens the payment’s Group on its Balances, with Record payment filled in', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const { suggestedPayments } = await balancesRead(page);
  const payment = suggestedPayments.find(({ direction }) => direction === 'pay');
  expect(payment, 'the seed leaves Alex payments to make').toBeDefined();
  const amount = formatAmount(payment!.amountMinor);

  const record = needsYouCard(page).getByRole('link', {
    name: `Record payment: You pay ${payment!.counterpartyName}, ${amount}, in ${payment!.groupName}`,
  });
  // The Balances tab's own address (#305), naming who Alex pays (#312).
  await expect(record).toHaveAttribute(
    'href',
    `/groups/${payment!.groupId}/balances?paidTo=${payment!.counterpartyId}`,
  );
  await record.click();

  await page.waitForURL((url) => url.pathname === `/groups/${payment!.groupId}/balances`);
  const main = page.getByRole('main');
  // The same payment, as the Group's Balances suggests it, is in the form: Alex to the other
  // person, for the suggested amount. Nothing is recorded.
  const form = main.getByRole('region', { name: 'Record payment', exact: true });
  const amountField = form.getByRole('textbox', { name: 'Amount paid' });
  await expect(amountField).toHaveValue((payment!.amountMinor / 100).toFixed(2));
  await expect(amountField).toBeFocused();
  await expect(form.getByRole('combobox', { name: 'From', exact: true })).toHaveValue(
    DEMO_PERSONA_IDS.alex,
  );
  await expect(form.getByRole('combobox', { name: 'To', exact: true })).toHaveValue(
    payment!.counterpartyId,
  );
  await expect(form.getByRole('button', { name: `Record payment ${amount}` })).toBeEnabled();
  const row = main
    .getByRole('region', { name: 'Settle up', exact: true })
    .getByRole('listitem')
    .filter({ hasText: `You pay ${payment!.counterpartyName}` });
  await expect(row).toContainText(amount);
  await expect(row).toContainText('In the form');
  // The address drops the link once the form has it, so a reload starts a blank form.
  await expect.poll(() => new URL(page.url()).search).toBe('');
  await reviewScreenshot(page, testInfo, 'alex-needs-you-record');
});

test('alex: creates a trip that is ready for a first expense', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');

  qaTripName = `Playwright QA Trip ${testInfo.project.name}`;
  await page.goto('/groups/new');
  await page.getByLabel('Trip name').fill(qaTripName);
  await page.getByRole('button', { name: 'Create trip' }).click();

  // A new Group opens on its Expenses tab (#305).
  await page.waitForURL((url) => /^\/groups\/[a-f0-9]{24}\/expenses$/.test(url.pathname));
  qaTripUrl = new URL(page.url()).pathname;

  // The header and the trip strip show the new trip; checklist guides the first expense.
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1, name: qaTripName }),
  ).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('region', { name: new RegExp(`^${qaTripName} trip,`) }),
  ).toBeVisible();
  await expect(page.getByText('Get this trip going')).toBeVisible();

  await reviewScreenshot(page, testInfo, 'alex-new-trip');
});

test('alex: adds an expense to the new trip', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto(qaTripUrl);

  // The top bar's Add expense opens the trip's form (#304).
  const dialog = await openAddExpense(page);
  await expect(dialog.getByText('Add expense')).toBeVisible();

  await dialog.getByLabel('What was it for?').fill('QA Dinner');
  await dialog.getByLabel('Amount').fill('120');
  await dialog.getByRole('button', { name: 'Save expense' }).click();

  await expect(dialog).toBeHidden();
  // The Expense's row (a card on phones) shows it with its amount.
  await expect(expenseItem(page, 'QA Dinner').item).toContainText('₹120.00');
});

test('alex: edits the expense and sees the update', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto(qaTripUrl);

  // Opening the Expense shows its details, with Edit: in the side panel on a computer (#311).
  const details = await openExpense(page, 'QA Dinner');
  await details.getByRole('button', { name: 'Edit', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Edit expense')).toBeVisible();
  await dialog.getByLabel('What was it for?').fill('QA Dinner — updated');
  await dialog.getByLabel('Amount').fill('240');
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(dialog).toBeHidden();
  await expect(expenseItem(page, 'QA Dinner — updated').item).toContainText('₹240.00');
});

test('sam: switches persona and records a payment on Balances; balances update', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await switchPersona(page, 'sam');

  // Sam owes on the seeded trip; Home shows a payable INR balance and every suggested payment.
  await expect(balancesCard(page).getByText('You owe', { exact: true })).toBeVisible();
  await expectHomeMatchesBalancesRead(page);
  await reviewScreenshot(page, testInfo, 'sam-dashboard');

  await page.goto(`/groups/${DEMO_GROUP_ID}`);
  await page
    .getByRole('navigation', { name: `${DEMO_TRIP_NAME} sections` })
    .getByRole('link', { name: 'Balances' })
    .click();

  // Sam is a party to exactly one open debt, so exactly one Record on Settle up.
  const settleUp = page.getByRole('region', { name: 'Settle up', exact: true });
  const recordButton = page.getByRole('button', { name: /^Record .*payment to/ });
  const settleButton = settleUp.getByRole('button', { name: /^Record .*payment to/ });
  await expect(settleButton).toHaveCount(1);
  const debtRow = settleUp.getByRole('listitem').filter({ has: recordButton });
  const debtBefore = parseMoneyText((await debtRow.textContent()) ?? '');

  // Record fills in Record payment, on the page itself (#312).
  await settleButton.click();
  const form = page.getByRole('region', { name: 'Record payment', exact: true });
  const amount = form.getByRole('textbox', { name: 'Amount paid' });
  await expect(amount).toBeFocused();
  await amount.fill('100');
  await form.getByRole('button', { name: /^Record payment/ }).click();
  await expect(form.getByRole('status').filter({ hasText: 'Payment recorded.' })).toBeVisible();

  // The open debt shrinks by exactly the settled amount. The app formats
  // amounts with en-US grouping (see formatCurrency).
  const expected = (debtBefore - 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  await expect(settleUp.getByText(`₹${expected}`, { exact: true })).toBeVisible();

  // Payments gains the new entry at the top, recorded by Sam.
  const newest = page.getByRole('table', { name: 'Payments' }).getByRole('row').nth(1);
  await expect(newest).toContainText('₹100.00');
  await expect(newest).toContainText('You');

  await reviewScreenshot(page, testInfo, 'sam-after-settlement');
});

test('priya: switches persona and verifies her seeded balance', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await switchPersona(page, 'priya');

  // Priya owes ₹4,680.00 to Alex from the seeded trip; untouched by journeys. She owes
  // nothing elsewhere, so it is all she owes.
  const balancePanel = balancesCard(page);
  await expect(balancePanel.getByText('You owe', { exact: true })).toBeVisible();
  await expect(balancePanel.getByText('₹4,680.00', { exact: true })).toBeVisible();

  // Alex has invited her to the Studio Lunch Club: answered from Needs you.
  const invitation = needsYouCard(page)
    .getByRole('listitem')
    .filter({ hasText: 'Studio Lunch Club' });
  await expect(invitation).toContainText('Invitation from Alex Rivera · Work');
  await expect(invitation.getByRole('button', { name: 'Join Studio Lunch Club' })).toBeVisible();
  await expect(invitation.getByRole('button', { name: 'Decline Studio Lunch Club' })).toBeVisible();
  await expectHomeMatchesBalancesRead(page);
  await reviewScreenshot(page, testInfo, 'priya-dashboard');

  await page.goto(`/groups/${DEMO_GROUP_ID}`);
  await page
    .getByRole('navigation', { name: `${DEMO_TRIP_NAME} sections` })
    .getByRole('link', { name: 'Balances' })
    .click();
  await expect(page.getByRole('heading', { name: 'Settle up' })).toBeVisible();
  await expect(page.getByText('₹4,680.00').first()).toBeVisible();

  await reviewScreenshot(page, testInfo, 'priya-balances');
});
