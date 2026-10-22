import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup, openAddExpense, type Ledger } from './fixtures';

// #834: controls built on a bare ButtonBase draw the theme's keyboard focus ring, and a mouse
// click draws none. Where a parent clips, the ring is drawn inside the control instead.

/** A Group in euros and rupees where Alex owes Sam in one and Sam owes Alex in the other. */
async function twoCurrencyGroup(ledger: Ledger) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Focus ${randomUUID().slice(0, 8)}`,
          category: 'trip',
          defaultCurrency: 'EUR',
          alternateCurrencies: ['INR'],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  const dinner = (payer: 'alex' | 'sam', owes: 'alex' | 'sam', amount: number, currency: string) =>
    ledger[payer].post(`/api/groups/${group}/expenses`, {
      data: {
        description: `Dinner in ${currency}`,
        amount,
        currency,
        category: 'food',
        tag: 'Food',
        date: new Date().toISOString(),
        paidBy: [{ user: DEMO_PERSONA_IDS[payer], amount }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS[owes] }],
      },
    });
  await dataOf(await dinner('sam', 'alex', 40, 'EUR'), 201);
  await dataOf(await dinner('alex', 'sam', 900, 'INR'), 201);
  // A payment in another currency, so Activity has a row that opens its card (#727).
  await dataOf(
    await ledger.alex.post(`/api/groups/${group}/settlements`, {
      data: {
        paidTo: DEMO_PERSONA_IDS.sam,
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
  return group;
}

async function signIn(page: Page, ledger: Ledger, path: string) {
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}${path}`);
}

/** The first ancestor that cuts off the control's box grown by `reach` px, if any. */
function clippedBy(control: Locator, reach: number) {
  return control.evaluate((element, reach) => {
    const box = element.getBoundingClientRect();
    for (
      let node = element.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const clip = node.getBoundingClientRect();
      if (
        box.top - reach < clip.top ||
        box.left - reach < clip.left ||
        box.right + reach > clip.right ||
        box.bottom + reach > clip.bottom
      )
        return `${node.tagName.toLowerCase()}.${node.className}`;
    }
    return null;
  }, reach);
}

/**
 * Pressed with the mouse and let go elsewhere, so it takes focus without acting, the control
 * draws no ring; Tabbed back to, it draws the theme's ring, inside itself where a parent clips.
 */
async function expectKeyboardRingOnly(page: Page, control: Locator, { inset = false } = {}) {
  await control.scrollIntoViewIfNeeded();
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS('outline-style', 'none');
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS('outline-style', 'solid');
  await expect(control).toHaveCSS('outline-width', '2px');
  await expect(control).toHaveCSS('outline-offset', inset ? '-2px' : '2px');
  // The outline reaches 4px past an outer ring; an inset one stays inside the control.
  expect(await clippedBy(control, inset ? 0 : 4)).toBeNull();
}

test('the Expenses toolbar filter pills (#834)', async ({ page, ledger }) => {
  await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}`);
  const pills = page.getByRole('search', { name: /^Find Expenses in / }).getByRole('button');
  await expect(pills.first()).toBeVisible();
  for (const pill of await pills.all()) await expectKeyboardRingOnly(page, pill);
});

test('the search launcher (#834)', async ({ page, ledger }) => {
  await signIn(page, ledger, '/dashboard');
  const launcher = page
    .getByRole('button', { name: /^Search Expenses, Groups and people/ })
    .filter({ visible: true })
    .first();
  await expectKeyboardRingOnly(page, launcher);
});

test('an Activity payment row (#834)', async ({ page, ledger }) => {
  await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}?tab=activity`);
  const row = page.locator('button[aria-expanded]').filter({ hasText: 'Sam Chen' }).first();
  await expect(row).toBeVisible();
  await expectKeyboardRingOnly(page, row);
});

test('the Group chooser’s choices (#834)', async ({ page, ledger }) => {
  await twoCurrencyGroup(ledger);
  await signIn(page, ledger, '/dashboard');
  await page
    .getByRole('button', { name: /^Add expense/ })
    .first()
    .click();
  const chooser = page.getByRole('dialog');
  const choices = chooser.getByRole('listitem').getByRole('button');
  await expect(choices.first()).toBeVisible();
  await expectKeyboardRingOnly(page, choices.first());
  await expectKeyboardRingOnly(page, choices.last());
});

test('Quick add’s payer menu chip and split chip (#834)', async ({ page, ledger }) => {
  await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}`);
  await page.getByRole('textbox', { name: 'Quick add', exact: true }).fill('Lunch 24');
  const read = page.getByRole('list', { name: 'How Splitbook reads it' });
  await expectKeyboardRingOnly(page, read.locator('[aria-haspopup="menu"]').first());
  await expectKeyboardRingOnly(page, read.locator('[aria-haspopup="dialog"]').first());
});

test('the selected currency tab on Balances (#834)', async ({ page, ledger }) => {
  await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}?tab=balances`);
  const selected = page.getByRole('tab', { selected: true }).first();
  await expect(selected).toBeVisible();
  // The tabs' scroller clips, so the ring is drawn inside the tab, over its selected border.
  await expectKeyboardRingOnly(page, selected, { inset: true });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('an Expense card’s row, inside a Paper that clips (#834)', async ({ page, ledger }) => {
    await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}`);
    const row = page.locator('[data-expense-id] > button').first();
    await expect(row).toBeVisible();
    await expectKeyboardRingOnly(page, row, { inset: true });
  });
});

test('Quick pick, fixed by #830, keeps its ring whole (#834)', async ({ page, ledger }) => {
  await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}`);
  const dialog = await openAddExpense(page);
  await expectKeyboardRingOnly(page, dialog.getByRole('button', { name: /Groceries/ }));
});
