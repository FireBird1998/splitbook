import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';

// #852: opening an Activity row's card, with Enter or a click, moves keyboard focus into the
// card, and closing the card puts it back on the row that opened it. Before, the list was drawn
// again when the card opened or closed, so focus fell to the page.

/**
 * A Group in rupees and euros where Alex owes Sam in both, then pays him twice: once for a
 * euro Debt in rupees (#727), once for both Debts in one payment (#734). Each payment's row
 * opens its card.
 */
async function twoPayments(ledger: Ledger) {
  const { alex, sam } = DEMO_PERSONA_IDS;
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Activity focus ${randomUUID().slice(0, 8)}`,
          category: 'trip',
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
    [80, 'EUR'],
  ] as const)
    await dataOf(
      await ledger.sam.post(`/api/groups/${group}/expenses`, {
        data: {
          description: `Dinner in ${currency}`,
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
  await dataOf(
    await ledger.alex.post(`/api/groups/${group}/settlements`, {
      data: {
        paidTo: sam,
        amount: 10,
        currency: 'EUR',
        amountPaidMinor: 90000,
        paidCurrency: 'INR',
        appliedRate: '90',
        rateKind: 'entered',
      },
    }),
    201,
  );
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
            amountPaidMinor: 180000,
            appliedRate: '90',
            rateKind: 'entered',
          },
        ],
      },
    }),
    201,
  );
  return group;
}

/** The rows that open a payment's card: the batch payment (newest), then the single one. */
function paymentRows(page: Page) {
  return {
    batch: page.getByRole('button', {
      name: /^You paid Sam Chen ₹3,280\.00 to clear ₹1,480\.00 and €20\.00/,
    }),
    single: page.getByRole('button', { name: /^You paid Sam Chen ₹900\.00 to clear €10\.00/ }),
  };
}

const card = (page: Page) => page.getByRole('region', { name: 'Payment', exact: true });

/** Tabbed to, as a keyboard reaches it: from the control before it. */
async function tabTo(page: Page, row: Locator) {
  await row.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(row).toBeFocused();
}

async function openActivity(page: Page, ledger: Ledger, group: string) {
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}/activity`);
  await expect(paymentRows(page).batch).toBeVisible();
  await expect(paymentRows(page).single).toBeVisible();
}

const phone = { width: 390, height: 844 };
for (const [layout, options] of [
  ['beside the list', { viewport: { width: 1280, height: 900 } }],
  ['above the list, on a phone', { viewport: phone }],
  // Where transitions end at once, the card must already be above the list when focus moves.
  [
    'above the list, on a phone, with reduced motion',
    { viewport: phone, contextOptions: { reducedMotion: 'reduce' } },
  ],
] as const) {
  test.describe(`the card ${layout}`, () => {
    test.use(options);

    for (const kind of ['single', 'batch'] as const) {
      test(`Enter on the ${kind} payment's row focuses its card, and Close focuses the row (#852)`, async ({
        page,
        ledger,
      }) => {
        await openActivity(page, ledger, await twoPayments(ledger));
        const row = paymentRows(page)[kind];
        await tabTo(page, row);
        await page.keyboard.press('Enter');
        await expect(row).toHaveAttribute('aria-expanded', 'true');
        const heading = card(page).getByRole('heading', { name: 'Payment' });
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport();
        // The card's controls come next, from where focus is.
        await page.keyboard.press('Tab');
        const close = card(page).getByRole('button', { name: 'Close Payment' });
        await expect(close).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(card(page)).toHaveCount(0);
        await expect(row).toBeFocused();
        await expect(row).toBeInViewport();
        await expect(row).toHaveAttribute('aria-expanded', 'false');
      });

      test(`a click on the ${kind} payment's row focuses its card, and Close focuses the row (#852)`, async ({
        page,
        ledger,
      }) => {
        await openActivity(page, ledger, await twoPayments(ledger));
        const row = paymentRows(page)[kind];
        await row.click();
        const heading = card(page).getByRole('heading', { name: 'Payment' });
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport();
        await card(page).getByRole('button', { name: 'Close Payment' }).click();
        await expect(card(page)).toHaveCount(0);
        await expect(row).toBeFocused();
        await expect(row).toBeInViewport();
      });
    }

    test('opening another row moves focus to its card, and the open row closes its own (#852)', async ({
      page,
      ledger,
    }) => {
      await openActivity(page, ledger, await twoPayments(ledger));
      const { batch, single } = paymentRows(page);
      await tabTo(page, single);
      await page.keyboard.press('Enter');
      await expect(card(page)).toContainText('Rate used');
      await tabTo(page, batch);
      await page.keyboard.press('Enter');
      await expect(card(page)).toContainText('Each currency’s balances moved only by its own Debt');
      await expect(card(page).getByRole('heading', { name: 'Payment' })).toBeFocused();
      await expect(single).toHaveAttribute('aria-expanded', 'false');
      // Enter on the open row closes its card, and focus stays on the row.
      await tabTo(page, batch);
      await page.keyboard.press('Enter');
      await expect(card(page)).toHaveCount(0);
      await expect(batch).toBeFocused();
    });
  });
}
