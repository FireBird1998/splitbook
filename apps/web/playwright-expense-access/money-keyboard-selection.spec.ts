import { randomUUID } from 'node:crypto';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { Locator, Page } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup, openAddExpense, type Ledger } from './fixtures';

async function euroGroup(ledger: Ledger) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Keyboard amounts ${randomUUID()}`,
          category: 'trip',
          defaultCurrency: 'EUR',
          alternateCurrencies: ['INR'],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  return group;
}

/**
 * Real Tab selection, never fill() or selectText() for the replacement, which shows grouped as
 * it is typed: 2000 as "2,000".
 */
async function tabAndReplace(
  page: Page,
  field: Locator,
  initial: string,
  replacement: string,
  shown = replacement,
) {
  await field.fill(initial);
  await field.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(field).toBeFocused();
  await page.keyboard.type(replacement);
  await expect(field).toHaveValue(shown);
}

for (const [initial, replacement, shown, minor] of [
  ['500', '300', '300', 30000],
  ['1842.50', '2000', '2,000', 200000],
] as const) {
  test(`Tab replaces Expense and payer ${initial} with ${replacement}, including the POST (#773)`, async ({
    page,
    ledger,
  }) => {
    const group = await euroGroup(ledger);
    await page.context().addCookies((await ledger.alex.storageState()).cookies);
    await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}`);
    const dialog = await openAddExpense(page);
    await dialog.getByLabel('What was it for?').fill('Keyboard dinner');
    await tabAndReplace(
      page,
      dialog.getByRole('textbox', { name: /^Amount,/ }),
      initial,
      replacement,
      shown,
    );
    await dialog.getByRole('button', { name: 'Advanced split options' }).click();
    await dialog.getByText('Split payment between multiple people', { exact: true }).click();
    await tabAndReplace(
      page,
      dialog.getByRole('textbox', { name: 'Paid by You', exact: true }),
      initial,
      replacement,
      shown,
    );
    const request = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`/api/groups/${group}/expenses`),
    );
    await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
    expect((await request).postDataJSON()).toMatchObject({
      amountMinor: minor,
      paidBy: [{ user: DEMO_PERSONA_IDS.alex, amountMinor: minor }],
    });
    await expect(dialog).toBeHidden();
  });
}

for (const crossCurrency of [false, true]) {
  test(`Tab replaces ${crossCurrency ? 'cross-currency amount paid' : 'Record payment amount'}, including the POST (#773)`, async ({
    page,
    ledger,
  }) => {
    const group = await euroGroup(ledger);
    await dataOf(
      await ledger.sam.post(`/api/groups/${group}/expenses`, {
        data: {
          description: 'Train tickets',
          amount: 1000,
          currency: 'EUR',
          category: 'food',
          tag: 'Food',
          date: new Date().toISOString(),
          paidBy: [{ user: DEMO_PERSONA_IDS.sam, amount: 1000 }],
          splitMethod: 'equal',
          splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
        },
      }),
      201,
    );
    await page.route('**/api/groups/*/rates?**', (route) =>
      route.fulfill({ json: { data: { suggestion: null, reason: 'unavailable' }, status: 200 } }),
    );
    await page.context().addCookies((await ledger.alex.storageState()).cookies);
    await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}?tab=balances`);
    await page.getByRole('button', { name: 'Record your payment to Sam Chen' }).click();
    const sheet = page.getByRole('region', { name: 'Record payment', exact: true });
    if (crossCurrency) {
      await sheet.getByRole('radio', { name: 'INR' }).click();
      await sheet.getByRole('textbox', { name: 'Amount cleared, EUR' }).fill('20');
      await tabAndReplace(
        page,
        sheet.getByRole('textbox', { name: 'Amount paid, INR' }),
        '1842.50',
        '2000',
        '2,000',
      );
    } else {
      await tabAndReplace(page, sheet.getByRole('textbox').first(), '500', '300');
    }
    const request = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`/api/groups/${group}/settlements`),
    );
    await sheet.getByRole('button', { name: /^Record payment(?: |$)/ }).click();
    const sent = await request;
    const body = sent.postDataJSON();
    // Single Settlements send amount in major units; check that exact POST value in minor
    // units too, then the server's stored amountMinor. No display text stands in for a save.
    expect(body).toMatchObject(
      crossCurrency
        ? { amount: 20, currency: 'EUR', amountPaidMinor: 200000, paidCurrency: 'INR' }
        : { amount: 300, currency: 'EUR' },
    );
    expect(parseAmountMinor(String(body.amount), body.currency)).toBe(crossCurrency ? 2000 : 30000);
    const response = await sent.response();
    expect(response?.status()).toBe(201);
    expect((await response!.json()).data).toMatchObject({
      amountMinor: crossCurrency ? 2000 : 30000,
    });
    await expect(page.getByText('Payment recorded.', { exact: false })).toBeVisible();
  });
}

// #773, the Designer's gap: an edit inside a grouped amount regroups it as the member types,
// the caret where it was, and the Expense saves what is shown.
test('Backspace after the 8 in 1,842.50 leaves 142.50, the caret after the 1, and saves it (#773)', async ({
  page,
  ledger,
}) => {
  const group = await euroGroup(ledger);
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}`);
  const dialog = await openAddExpense(page);
  await dialog.getByLabel('What was it for?').fill('Keyboard dinner');
  const amount = dialog.getByRole('textbox', { name: /^Amount,/ });
  await amount.fill('1842.50');
  await amount.press('Tab');
  await expect(amount).toHaveValue('1,842.50');
  await page.keyboard.press('Shift+Tab');
  await expect(amount).toBeFocused();
  // The caret after "1,8", then Backspace.
  await amount.press('Home');
  for (let step = 0; step < 3; step++) await amount.press('ArrowRight');
  await amount.press('Backspace');
  await expect(amount).toHaveValue('142.50');
  // The caret stayed after the 1: the next digit goes there.
  await page.keyboard.type('9');
  await expect(amount).toHaveValue('1,942.50');
  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith(`/api/groups/${group}/expenses`),
  );
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ amountMinor: 194250 });
  await expect(dialog).toBeHidden();
});

test('a point typed after the 12 in 1,250 reads 12.50 and saves it (#773)', async ({
  page,
  ledger,
}) => {
  const group = await euroGroup(ledger);
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}`);
  const dialog = await openAddExpense(page);
  await dialog.getByLabel('What was it for?').fill('Keyboard dinner');
  const amount = dialog.getByRole('textbox', { name: /^Amount,/ });
  await amount.click();
  await page.keyboard.type('1250');
  await expect(amount).toHaveValue('1,250');
  // The caret after "1,2", then a point: the field's own comma goes, the caret after the point.
  await amount.press('Home');
  for (let step = 0; step < 3; step++) await amount.press('ArrowRight');
  await page.keyboard.type('.');
  await expect(amount).toHaveValue('12.50');
  expect(await amount.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(3);
  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith(`/api/groups/${group}/expenses`),
  );
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ amountMinor: 1250 });
  await expect(dialog).toBeHidden();
});

test('Undo after 1,234 steps back to 123, so a 5 saves 1,235, never 51,234 (#773)', async ({
  page,
  ledger,
}) => {
  const group = await euroGroup(ledger);
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}`);
  const dialog = await openAddExpense(page);
  await dialog.getByLabel('What was it for?').fill('Keyboard dinner');
  const amount = dialog.getByRole('textbox', { name: /^Amount,/ });
  await amount.click();
  await page.keyboard.type('1234');
  await expect(amount).toHaveValue('1,234');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(amount).toHaveValue('123');
  await page.keyboard.type('5');
  await expect(amount).toHaveValue('1,235');
  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith(`/api/groups/${group}/expenses`),
  );
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ amountMinor: 123500 });
  await expect(dialog).toBeHidden();
});
