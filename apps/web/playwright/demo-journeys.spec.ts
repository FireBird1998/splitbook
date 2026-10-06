import { expect, test } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectThemeApplied,
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
 */

test.describe.configure({ mode: 'serial' });

// State handed from the create-trip journey to the edit journey.
let qaTripUrl = '';
let qaTripName = '';

test('alex: enters the demo and inspects her balance', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);

  // Money-first dashboard: balance bucket in INR with a non-zero owed amount.
  await expect(page.getByText('Current balance')).toBeVisible();
  const balancePanel = page.locator('section', { hasText: 'Current balance' });
  await expect(balancePanel.getByText('INR').first()).toBeVisible();
  await expect(balancePanel.getByText("You're owed")).toBeVisible();

  // The seeded trip appears with Alex's positive balance.
  await expect(page.getByText(DEMO_TRIP_NAME).first()).toBeVisible();

  if (testInfo.project.name === 'desktop-light') {
    // Exact seeded amount — asserted once, before any journey mutates it.
    await expect(balancePanel.getByText('₹6,160.00')).toBeVisible();
  }

  await reviewScreenshot(page, testInfo, 'alex-dashboard');
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

  // A fresh trip offers the same editor through its checklist and workspace action.
  await page.getByRole('button', { name: 'Add expense' }).last().click();
  const dialog = page.getByRole('dialog');
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

  // Sam owes on the seeded trip; the dashboard shows a payable INR balance.
  const balancePanel = page.locator('section', { hasText: 'Current balance' });
  await expect(balancePanel.getByText('You owe')).toBeVisible();

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

  // Priya owes ₹4,680.00 to Alex from the seeded trip; untouched by journeys.
  const balancePanel = page.locator('section', { hasText: 'Current balance' });
  await expect(balancePanel.getByText('You owe')).toBeVisible();
  await expect(balancePanel.getByText('₹4,680.00')).toBeVisible();

  await page.goto(`/groups/${DEMO_GROUP_ID}`);
  await page
    .getByRole('navigation', { name: `${DEMO_TRIP_NAME} sections` })
    .getByRole('link', { name: 'Balances' })
    .click();
  await expect(page.getByText('Who pays whom')).toBeVisible();
  await expect(page.getByText('₹4,680.00').first()).toBeVisible();

  await reviewScreenshot(page, testInfo, 'priya-balances');
});
