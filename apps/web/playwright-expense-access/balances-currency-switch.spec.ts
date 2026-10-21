import { randomUUID } from 'node:crypto';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup } from './fixtures';

test('Balances shows one currency at a time, opening on the first Sam isn’t settled in (#724)', async ({
  page,
  ledger,
}) => {
  const group = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: {
        name: `Lisbon and Tokyo ${randomUUID().slice(0, 8)}`,
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: ['EUR', 'JPY'],
      },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, group._id);
  const both = [{ user: DEMO_PERSONA_IDS.priya }, { user: DEMO_PERSONA_IDS.sam }];
  // Nothing in rupees: Sam owes Priya €20.00 and is owed ¥8,400.
  await dataOf(
    await ledger.priya.post(`/api/groups/${group._id}/expenses`, {
      data: {
        description: 'Pastéis in Lisbon',
        amount: 40,
        currency: 'EUR',
        category: 'food',
        tag: 'Groceries',
        date: new Date().toISOString(),
        paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 40 }],
        splitMethod: 'equal',
        splitBetween: both,
      },
    }),
    201,
  );
  await dataOf(
    await ledger.sam.post(`/api/groups/${group._id}/expenses`, {
      data: {
        description: 'Ramen in Tokyo',
        amount: 16800,
        currency: 'JPY',
        category: 'food',
        tag: 'Groceries',
        date: new Date().toISOString(),
        paidBy: [{ user: DEMO_PERSONA_IDS.sam, amount: 16800 }],
        splitMethod: 'equal',
        splitBetween: both,
      },
    }),
    201,
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group._id}?tab=balances`);

  const tabs = page.getByRole('tablist', { name: 'Balances in' }).getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveAccessibleName('INR, main currency, you’re settled up');
  await expect(tabs.nth(1)).toHaveAccessibleName('EUR, you owe €20.00');
  await expect(tabs.nth(2)).toHaveAccessibleName('JPY, you’re owed ¥8,400');
  // Settled up in rupees, so it opens on euros: every amount shown is in euros.
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel', { name: 'EUR, you owe €20.00' });
  const ownBalance = panel.getByRole('region', { name: 'All-time balance', exact: true });
  await expect(ownBalance).toContainText('You owe');
  await expect(ownBalance).toContainText('€20.00');
  const settleUp = panel.getByRole('region', { name: 'Settle up', exact: true });
  await expect(settleUp.getByRole('list', { name: 'Suggested payments' })).toContainText(
    /You pay Priya Shah[\s\S]*€20\.00/,
  );
  const everyone = panel.getByRole('region', { name: 'Everyone', exact: true });
  await expect(everyone.getByText('All-time net · EUR', { exact: true })).toBeVisible();
  for (const figures of [ownBalance, settleUp, everyone]) {
    await expect(figures).not.toContainText('₹');
    await expect(figures).not.toContainText('¥');
  }
  // Payments are recorded in the main currency; its tab has the form.
  const recordInMain = panel.getByRole('region', { name: 'Record payment', exact: true });
  await expect(recordInMain).toContainText('Payments are recorded in INR, the main currency.');
  await expect(page.getByRole('region', { name: 'Record payment', exact: true })).toHaveCount(1);

  await tabs.nth(2).click();
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  const yen = page.getByRole('tabpanel', { name: 'JPY, you’re owed ¥8,400' });
  await expect(yen.getByRole('region', { name: 'All-time balance', exact: true })).toContainText(
    /You’re owed\s*¥8,400/,
  );
  await expect(yen.getByRole('region', { name: 'Settle up', exact: true })).not.toContainText('€');

  await yen
    .getByRole('region', { name: 'Record payment', exact: true })
    .getByRole('button', { name: 'Show INR' })
    .click();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(
    page
      .getByRole('tabpanel', { name: 'INR, main currency, you’re settled up' })
      .getByRole('region', { name: 'All-time balance', exact: true }),
  ).toContainText(/You’re settled up\s*₹0\.00/);
});
