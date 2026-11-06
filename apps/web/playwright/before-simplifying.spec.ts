import { expect, test } from '@playwright/test';
import { formatCurrency } from '@splitbook/shared/currency';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import {
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  reviewScreenshot,
} from './fixtures';

const HOUSEHOLD_ID = 'a00000000000000000000201';
interface Pair {
  from: { _id: string; name: string };
  to: { _id: string; name: string };
  amount: number;
}

test('Household switches between Suggested payments and Debts before simplifying', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${HOUSEHOLD_ID}/balances`);
  await expectThemeApplied(page, testInfo);
  const card = page.getByRole('region', { name: 'Settle up', exact: true });
  await expect(card.getByRole('list', { name: 'Suggested payments', exact: true })).toBeVisible();
  await expect(card.getByText(/Record one once it’s paid/)).toBeVisible();
  await reviewScreenshot(page, testInfo, 'balances-suggested');
  const response = await page.request.get(`/api/groups/${HOUSEHOLD_ID}/balances`);
  expect(response.ok()).toBe(true);
  const read = (await response.json()).data;
  const before: Pair[] = read.debtsBeforeSimplifying;
  expect(before.length).toBeGreaterThan(read.debts.length);
  const note = `${read.debts.length} ${read.debts.length === 1 ? 'payment settles' : 'payments settle'} the same ${before.length} debts. Everyone ends settled up either way.`;
  await expect(card.getByText(note, { exact: true })).toBeVisible();
  const toggle = card.getByRole('group', { name: 'Settle up view', exact: true });
  await expect(toggle.getByRole('button', { name: 'Suggested', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await toggle.getByRole('button', { name: 'Before simplifying', exact: true }).click();
  const list = card.getByRole('list', { name: 'Debts before simplifying', exact: true });
  await expect(list).toBeVisible();
  await expect(card.getByText(/Record one once it’s paid/)).toHaveCount(0);
  await expect(list.getByRole('listitem')).toHaveCount(before.length);
  await expect(
    card.getByText(`${read.currency} · the ${before.length} debts as the Expenses left them`),
  ).toBeVisible();
  // Each Debt as a Suggested row (#646): what it becomes, from the Suggested payment between
  // the same two people the same way round, else settled by the other payments.
  const suggested: Pair[] = read.debts;
  for (const debt of before) {
    const payer = debt.from._id === DEMO_PERSONA_IDS.alex ? 'You owe' : `${debt.from.name} owes`;
    const payee = debt.to._id === DEMO_PERSONA_IDS.alex ? 'you' : debt.to.name;
    const row = list
      .getByRole('listitem')
      .filter({ has: page.getByText(`${payer} ${payee}`, { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(formatCurrency(debt.amount, read.currency));
    const same = suggested.find(
      (payment) => payment.from._id === debt.from._id && payment.to._id === debt.to._id,
    );
    await expect(row).toContainText(
      same
        ? `Becomes ${formatCurrency(same.amount, read.currency)} after simplifying`
        : 'Settled by the other payments',
    );
  }
  await expect(card.getByRole('button', { name: /^Record/ })).toHaveCount(0);
  await expect(card.getByText(note, { exact: true })).toBeVisible();
  await reviewScreenshot(page, testInfo, 'balances-before-simplifying');
  await expectNoSeriousA11yViolations(page, testInfo, 'before-simplifying');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await toggle.getByRole('button', { name: 'Suggested', exact: true }).click();
  await expect(card.getByRole('list', { name: 'Suggested payments', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Record/ }).first()).toBeVisible();
});
