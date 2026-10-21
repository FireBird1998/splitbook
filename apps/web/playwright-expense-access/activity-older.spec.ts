import { randomUUID } from 'node:crypto';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup } from './fixtures';

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: Load older activity opens a Group's history beyond 50 events (#800)`, async ({
    page,
    ledger,
  }) => {
    // Write through HTTP so pagination, membership and the shared page decoder all participate.
    for (let i = 1; i <= 51; i++) {
      await dataOf(
        await ledger.alex.post(`/api/groups/${ledger.groupA}/expenses`, {
          data: {
            description: `History item ${i}`,
            amount: 10,
            currency: 'INR',
            category: 'food',
            tag: 'Groceries',
            date: '2026-10-21',
            paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 10 }],
            splitMethod: 'equal',
            splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
          },
        }),
        201,
      );
    }
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.context().addCookies((await ledger.alex.storageState()).cookies);
    await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupA}/activity`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const events = page.getByText(/^You added “History item \d+”$/);
    await expect(events).toHaveCount(50);
    await expect(events.first()).toHaveText('You added “History item 51”');
    await expect(events.last()).toHaveText('You added “History item 2”');
    await expect(page.getByText('You added “History item 1”', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Load older activity', exact: true }).click();
    await expect(events).toHaveCount(51);
    await expect(events.last()).toHaveText('You added “History item 1”');
    await expect(page.getByText('You created the group', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Load older activity', exact: true }),
    ).toHaveCount(0);
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: Load older activity joins a split payment despite a newer event shifting the pages (#800)`, async ({
    page,
    ledger,
  }) => {
    const { alex, sam } = DEMO_PERSONA_IDS;
    const group = (
      await dataOf(
        await ledger.alex.post('/api/groups', {
          data: {
            name: 'Fictional two-currency history',
            category: 'home',
            defaultCurrency: 'INR',
            alternateCurrencies: ['EUR'],
          },
        }),
        201,
      )
    )._id as string;
    await joinGroup(ledger.alex, ledger.sam, group);
    for (const [amount, currency] of [
      [2960, 'INR'],
      [40, 'EUR'],
    ] as const) {
      await dataOf(
        await ledger.sam.post(`/api/groups/${group}/expenses`, {
          data: {
            description: `Shared ${currency} dinner`,
            amount,
            currency,
            category: 'food',
            tag: 'Groceries',
            date: '2026-10-21',
            paidBy: [{ user: sam, amount }],
            splitMethod: 'equal',
            splitBetween: [{ user: alex }, { user: sam }],
          },
        }),
        201,
      );
    }
    await dataOf(
      await ledger.alex.post(`/api/groups/${group}/settlements/batch`, {
        headers: { 'Idempotency-Key': randomUUID() },
        data: {
          paidBy: alex,
          paidTo: sam,
          paidCurrency: 'INR',
          settlements: [
            { amount: 1480, currency: 'INR' },
            {
              amount: 20,
              currency: 'EUR',
              amountPaidMinor: 184200,
              appliedRate: '92.1',
              rateKind: 'entered',
            },
          ],
        },
      }),
      201,
    );
    const addHistory = async (description: string) =>
      dataOf(
        await ledger.alex.post(`/api/groups/${group}/expenses`, {
          data: {
            description,
            amount: 10,
            currency: 'INR',
            category: 'food',
            tag: 'Groceries',
            date: '2026-10-21',
            paidBy: [{ user: alex, amount: 10 }],
            splitMethod: 'equal',
            splitBetween: [{ user: alex }],
          },
        }),
        201,
      );
    // Exactly 49 newer events leave one of this payment's two events at position 50.
    for (let i = 1; i <= 49; i++) await addHistory(`Recent history ${i}`);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.context().addCookies((await ledger.alex.storageState()).cookies);
    await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}/activity`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const payment = page.getByRole('button', { name: /^You paid Sam Chen/ });
    await expect(payment).toHaveCount(1);
    await expect(payment).toContainText('to clear €20.00 and 1 more Debt');
    await expect(payment).toContainText('The rest of this payment is in older Activity.');
    await expect(page.getByText(/^You added “Recent history \d+”$/)).toHaveCount(49);

    // The server really shifts page 2, after page 1 was read: its first event now repeats.
    await page.route(
      `**/api/groups/${group}/activity?page=2&limit=50`,
      async (route) => {
        await addHistory('Arrived between Activity pages');
        await route.continue();
      },
      { times: 1 },
    );
    await payment.click();
    await page.getByRole('button', { name: 'Load older activity', exact: true }).click();
    await expect(payment).toHaveCount(1);
    await expect(payment).toContainText(
      'You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00',
    );
    await expect(payment).toContainText('₹1,480.00, same currency, no rate');
    await expect(payment).toContainText('€20.00 at ₹92.10 per €; no rate suggested');
    await expect(
      page.getByText('The rest of this payment is in older Activity.', { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/1 more Debt/)).toHaveCount(0);
    const card = page.getByRole('region', { name: 'Payment' });
    await expect(card).toContainText(/Paid\s*₹3,322.00/);
    await expect(card).toContainText('to clear ₹1,480.00 and €20.00');
    await expect(
      page.getByRole('button', { name: 'Load older activity', exact: true }),
    ).toHaveCount(0);
  });
}
