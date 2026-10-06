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
  parseMoneyText,
  reviewScreenshot,
  switchPersona,
} from './fixtures';

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

test('alex: Needs you → Record opens the payment’s Group on its Balances', async ({
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
  // The Balances tab's own address (#305).
  await expect(record).toHaveAttribute('href', `/groups/${payment!.groupId}/balances`);
  await record.click();

  await page.waitForURL((url) => url.pathname === `/groups/${payment!.groupId}/balances`);
  const main = page.getByRole('main');
  await expect(main.getByText('Who pays whom')).toBeVisible();
  // The same payment, as the Group's Balances suggests it: recording it there fills in its
  // amount. The dialog is closed again, so nothing is recorded.
  // The innermost block holding the other person, the amount and its Record settlement button.
  const row = main
    .locator('div')
    .filter({ hasText: payment!.counterpartyName })
    .filter({ has: page.getByText(amount, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Record settlement', exact: true }) })
    .last();
  await row.getByRole('button', { name: 'Record settlement', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('spinbutton', { name: 'Amount' })).toHaveValue(
    String(payment!.amountMinor / 100),
  );
  await reviewScreenshot(page, testInfo, 'alex-needs-you-record');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
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
  // The expense row's accessible name carries description + amount.
  await expect(page.getByRole('button', { name: /QA Dinner, ₹120\.00/ })).toBeVisible();
});

test('alex: edits the expense and sees the update', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  await page.goto(qaTripUrl);

  const row = page.getByRole('button', { name: /QA Dinner/ });
  await row.getByLabel('Expense actions').click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Edit expense')).toBeVisible();
  await dialog.getByLabel('What was it for?').fill('QA Dinner — updated');
  await dialog.getByLabel('Amount').fill('240');
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /QA Dinner — updated, ₹240\.00/ })).toBeVisible();
});

test('sam: switches persona and records a settlement; balances update', async ({
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

  // Sam is a party to exactly one open debt, so exactly one settle action.
  const settleButton = page.getByRole('button', { name: 'Record settlement' });
  await expect(settleButton).toHaveCount(1);
  const debtRow = page.locator('div', { has: settleButton }).last();
  const debtBefore = parseMoneyText((await debtRow.textContent()) ?? '');

  await settleButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Record settlement')).toBeVisible();
  await dialog.getByLabel('Amount').fill('100');
  await dialog.getByRole('button', { name: 'Save settlement' }).click();

  await expect(dialog).toBeHidden();

  // The open debt shrinks by exactly the settled amount. The app formats
  // amounts with en-US grouping (see formatCurrency).
  const expected = (debtBefore - 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  await expect(page.getByText(`₹${expected}`, { exact: true })).toBeVisible();

  // Settlement history gains the new entry at the top.
  await expect(page.getByText('Settlement history')).toBeVisible();

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
  await expect(page.getByText('Who pays whom')).toBeVisible();
  await expect(page.getByText('₹4,680.00').first()).toBeVisible();

  await reviewScreenshot(page, testInfo, 'priya-balances');
});
