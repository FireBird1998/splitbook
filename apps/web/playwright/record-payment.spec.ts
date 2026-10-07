import { expect, test, type Page } from '@playwright/test';
import { DEMO_HOUSEHOLD_ID, DEMO_PERSONA_IDS, DEMO_WORK_GROUP_ID } from '../src/lib/demo-personas';
import {
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  parseMoneyText,
  reviewScreenshot,
} from './fixtures';

/**
 * Record payment on the Balances tab (#312), on the seeded demo data. Each project runs
 * against the same database, so the journeys record small amounts and read the figures off
 * the page rather than assume them: the Household keeps its suggested payments, and the Goa
 * trip, which other journeys check, is left alone.
 */

const { sam, priya } = DEMO_PERSONA_IDS;

/** "₹2,726.77" for an amount in rupees. */
const rupees = (amount: number) =>
  `₹${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function openBalances(page: Page, groupId: string) {
  await page.goto(`/groups/${groupId}/balances`);
  const settleUp = page.getByRole('region', { name: 'Settle up', exact: true });
  // The local suite runs `next dev`, which may still be compiling the tab's reads.
  await expect(settleUp).toBeVisible({ timeout: 30_000 });
  const form = page.getByRole('region', { name: 'Record payment', exact: true });
  return {
    settleUp,
    form,
    from: form.getByRole('combobox', { name: 'From', exact: true }),
    to: form.getByRole('combobox', { name: 'To', exact: true }),
    amount: form.getByRole('textbox', { name: 'Amount paid' }),
    note: form.getByRole('textbox', { name: 'Note, optional' }),
    record: form.getByRole('button', { name: /^Record payment/ }),
    meantMore: form.getByRole('checkbox', { name: 'I meant to pay more than suggested' }),
    after: form.getByRole('region', { name: 'After this payment' }),
    payments: page.getByRole('table', { name: 'Payments' }),
  };
}

test('a suggested payment’s Record fills the form in, and the payment lands in Payments', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const tab = await openBalances(page, DEMO_HOUSEHOLD_ID);
  await expectThemeApplied(page, testInfo);

  const row = tab.settleUp.getByRole('listitem').filter({ hasText: 'You pay Priya Shah' });
  const owed = parseMoneyText((await row.textContent()) ?? '');
  await row.getByRole('button', { name: 'Record your payment to Priya Shah' }).click();

  // The form takes the pair and the suggested amount, and focus moves to the amount.
  await expect(tab.amount).toBeFocused();
  await expect(tab.from).toHaveValue(DEMO_PERSONA_IDS.alex);
  await expect(tab.to).toHaveValue(priya);
  await expect(tab.amount).toHaveValue(owed.toFixed(2));
  await expect(tab.form.getByRole('button', { name: /^Suggested / })).toHaveText(
    `Suggested ${rupees(owed)}`,
  );
  await expect(row).toContainText('In the form');
  await expect(tab.after).toContainText('You are settled up');
  await expect(tab.form).toContainText(
    'Either of you can record it. Priya will see it in Activity.',
  );
  await expect(tab.record).toHaveText(`Record payment ${rupees(owed)}`);

  // A part of it: the positions after follow the amount.
  await tab.amount.fill('1');
  await expect(tab.after).toContainText(`You owe ${rupees(owed - 1)}`);
  await tab.note.fill(`Part payment (${testInfo.project.name})`);
  await tab.record.click();
  await expect(tab.form.getByRole('status')).toHaveText(
    'Payment recorded. You paid Priya Shah ₹1.00.',
  );

  // The form starts afresh, the debt falls by exactly that, and Payments lists it first.
  await expect(tab.amount).toHaveValue('');
  await expect(row).toContainText(rupees(owed - 1));
  const newest = tab.payments.getByRole('row').nth(1).getByRole('cell');
  await expect(newest.nth(1)).toHaveAccessibleName('You to Priya Shah');
  await expect(newest.nth(2)).toHaveText('₹1.00');
  await expect(newest.nth(3)).toHaveText(`Part payment (${testInfo.project.name})`);
  await expect(newest.nth(4)).toHaveText('You');
  await expect(tab.payments).not.toContainText('@');
});

test('a payment from a blank form that nobody suggested needs the explicit tick', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const tab = await openBalances(page, DEMO_WORK_GROUP_ID);

  await expect(tab.from).toHaveValue(DEMO_PERSONA_IDS.alex);
  await expect(tab.record).toBeDisabled();
  await expect(tab.form).toContainText('Choose who paid whom.');
  await tab.to.selectOption({ label: 'Sam Chen' });
  await expect(tab.amount).toHaveValue('');
  await expect(tab.form).toContainText('Enter the amount paid.');
  await tab.amount.fill('5');

  // Nothing is suggested from Alex to Sam, so any amount pays more than suggested.
  await expect(tab.form.getByText(/^No payment from you to Sam Chen is suggested\./)).toHaveText(
    /^No payment from you to Sam Chen is suggested\. Afterwards you’d be owed ₹[\d,]+\.\d{2} in this Group\.$/,
  );
  await expect(tab.record).toBeDisabled();
  await expect(tab.form).toContainText('Tick “I meant to pay more than suggested” first.');
  await expectNoSeriousA11yViolations(page, testInfo, 'record-payment-overpay');
  await reviewScreenshot(page, testInfo, 'record-payment-overpay');

  await tab.meantMore.check();
  await expect(tab.record).toBeEnabled();
  await expect(tab.record).toHaveText('Record payment ₹5.00');
  await tab.record.click();
  await expect(tab.form.getByRole('status')).toHaveText(
    'Payment recorded. You paid Sam Chen ₹5.00.',
  );
  const newest = tab.payments.getByRole('row').nth(1).getByRole('cell');
  await expect(newest.nth(1)).toHaveAccessibleName('You to Sam Chen');
  await expect(newest.nth(2)).toHaveText('₹5.00');
  await expect(newest.nth(3)).toHaveAccessibleName('No note');
});

test('paying more than suggested warns, and Record waits for the tick', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const tab = await openBalances(page, DEMO_HOUSEHOLD_ID);
  await tab.settleUp.getByRole('button', { name: 'Record your payment to Priya Shah' }).click();
  const owed = Number(await tab.amount.inputValue());

  await tab.amount.fill((owed + 10).toFixed(2));
  const warning = tab.form.getByText(/more than suggested\./);
  await expect(warning).toHaveText(
    'That’s ₹10.00 more than suggested. Afterwards you’d be owed ₹10.00 in this Group.',
  );
  await expect(tab.after).toContainText('You get back ₹10.00');
  await expect(tab.record).toBeDisabled();
  await expect(tab.meantMore).not.toBeChecked();
  await tab.meantMore.check();
  await expect(tab.record).toBeEnabled();

  // A new amount takes a new tick; back at the suggestion, there is nothing to tick.
  await tab.amount.fill((owed + 20).toFixed(2));
  await expect(tab.meantMore).not.toBeChecked();
  await expect(tab.record).toBeDisabled();
  await tab.form.getByRole('button', { name: /^Suggested / }).click();
  await expect(tab.amount).toHaveValue(owed.toFixed(2));
  await expect(warning).toHaveCount(0);
  await expect(tab.record).toBeEnabled();
  await expectNoSeriousA11yViolations(page, testInfo, 'record-payment-filled');
  // Nothing was recorded: the overpayment is only checked here.
});

test('only a pair that includes the member can be recorded', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  const tab = await openBalances(page, DEMO_HOUSEHOLD_ID);

  // Sam's payment to Priya is suggested, but only Sam or Priya can record it.
  const theirs = tab.settleUp.getByRole('listitem').filter({ hasText: 'Sam Chen pays Priya Shah' });
  await expect(theirs).toContainText('Only Sam or Priya can record it');
  await expect(theirs.getByRole('button')).toHaveCount(0);

  await tab.from.selectOption({ label: 'Sam Chen' });
  await tab.to.selectOption({ label: 'Priya Shah' });
  await tab.amount.fill('10');
  await expect(tab.form.getByRole('alert')).toHaveText(
    'Only Sam or Priya can record a payment between them.',
  );
  await expect(tab.record).toBeDisabled();
  await expect(tab.after).toHaveCount(0);

  await tab.to.selectOption({ label: 'Sam Chen' });
  await expect(tab.form.getByRole('alert')).toHaveText('Pick two different people.');
  await expect(tab.record).toBeDisabled();

  // Choosing the member again makes it a pair they are part of.
  await tab.to.selectOption({ label: 'You' });
  await expect(tab.form.getByRole('alert')).toHaveCount(0);
  await expect(tab.form).toContainText('Sam will see it in Activity.');

  // The server holds the same rule, whatever a page sends.
  const refused = await page.request.post(`/api/groups/${DEMO_HOUSEHOLD_ID}/settlements`, {
    data: { paidBy: sam, paidTo: priya, amount: 10, currency: 'INR', note: '' },
    headers: { 'Idempotency-Key': `w312-parties-${testInfo.project.name}-${Date.now()}` },
  });
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error).toBe(
    'Only the payer or recipient can record this settlement',
  );
});

test('the Balances tab with Record payment is accessible', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  const tab = await openBalances(page, DEMO_HOUSEHOLD_ID);
  await expect(tab.payments).toBeVisible();
  await expect(page.getByRole('region', { name: 'All-time balance' })).toContainText('You owe');
  await expectNoSeriousA11yViolations(page, testInfo, 'record-payment');
  await reviewScreenshot(page, testInfo, 'record-payment');

  // Keyboard: From, To, the amount, the note, then Record, in that order.
  await tab.from.focus();
  await page.keyboard.press('Tab');
  await expect(tab.to).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tab.amount).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tab.note).toBeFocused();
  // The table scrolls sideways on its own at phone width, so it takes focus to scroll by key.
  await expect(page.getByRole('region', { name: 'Payments table' })).toHaveAttribute(
    'tabindex',
    '0',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
});
