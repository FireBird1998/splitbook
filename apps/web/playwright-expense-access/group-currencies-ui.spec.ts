import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

/*
 * #721: a Group's currencies in its settings, as the boards "Group currencies, as an admin",
 * "Remove refused while in use" and "A member adds a currency" show them, light and dark.
 */

const { alex, sam } = DEMO_PERSONA_IDS;

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  return `${origin}${path}`;
}

async function enter(page: Page, actor: APIRequestContext, path: string) {
  await page.context().addCookies((await actor.storageState()).cookies);
  await page.goto(appURL(path));
}

/** Lisbon & Tokyo, a fictional Trip Alex runs with Sam: rupees, with euros, yen and pounds. */
async function lisbonAndTokyo(ledger: Ledger) {
  const name = `Lisbon & Tokyo ${randomUUID().slice(0, 8)}`;
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name,
          category: 'trip',
          defaultCurrency: 'INR',
          alternateCurrencies: ['EUR', 'JPY', 'GBP'],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  return { group, name };
}

const dinner = (description: string, amount: number, currency: string, day: number) => ({
  description,
  amount,
  currency,
  category: 'food',
  tag: 'Food',
  date: `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`,
  paidBy: [{ user: alex, amount }],
  splitMethod: 'equal',
  splitBetween: [{ user: alex }, { user: sam }],
});

const currencies = (page: Page) => page.getByRole('region', { name: 'Currencies' });
const rows = (page: Page) =>
  currencies(page).getByRole('list', { name: 'Extra currencies' }).getByRole('listitem');

for (const scheme of ['light', 'dark'] as const) {
  test(`desktop ${scheme}: an admin sees what uses each currency, and can’t remove one in use (#721)`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    const { group, name } = await lisbonAndTokyo(ledger);
    for (const expense of [
      dinner('Ramen at Ichiran', 2500, 'JPY', 9),
      dinner('Taxi to Haneda', 6800, 'JPY', 8),
      dinner('Tram 28', 6, 'EUR', 3),
    ])
      await dataOf(await ledger.alex.post(`/api/groups/${group}/expenses`, { data: expense }), 201);
    await dataOf(
      await ledger.sam.post(`/api/groups/${group}/settlements`, {
        data: { paidTo: alex, amount: 3, currency: 'EUR' },
      }),
      201,
    );
    await dataOf(
      await ledger.sam.post(`/api/groups/${group}/drafts`, {
        headers: { 'Idempotency-Key': `currencies-sam-${randomUUID()}` },
        data: {
          drafts: [
            { ...dinner('Sushi breakfast', 4200, 'JPY', 10), date: '2026-10-10' },
            { ...dinner('Onsen', 3000, 'JPY', 11), date: '2026-10-11' },
          ],
        },
      }),
      201,
    );

    await enter(page, ledger.alex, `/groups/${group}/settings`);
    await expect(
      currencies(page).getByText(
        'Money is already recorded in INR, so the main currency can’t change.',
      ),
    ).toBeVisible();
    await expect(currencies(page).getByText('3 of 4', { exact: true })).toBeVisible();
    await expect(rows(page)).toHaveText([
      /^EUR\s*Euro\s*In use\s*1 Expense · 1 Settlement · added by you, \d+ \w+\s*Remove$/,
      /^JPY\s*Japanese Yen\s*In use\s*2 Expenses · 2 items in To review · whole amounts only · added by you, \d+ \w+\s*Remove$/,
      /^GBP\s*British Pound\s*Nothing uses it · added by you, \d+ \w+\s*Remove$/,
    ]);
    await currencies(page).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`721-currencies-admin-${scheme}.png`),
      animations: 'disabled',
    });

    // Yen is still in use: the refusal says what uses it, and only counts Sam's To review items.
    await currencies(page).getByRole('button', { name: 'Remove JPY', exact: true }).click();
    const refusal = page.getByRole('dialog', { name: 'JPY can’t be removed yet' });
    await expect(refusal).toContainText(
      `${name} still uses JPY. Change these to another currency, or delete them, then remove it.`,
    );
    await expect(refusal).toContainText('2 Expenses');
    await expect(refusal).toContainText('Ramen at Ichiran and Taxi to Haneda');
    await expect(refusal).toContainText('2 items in members’ To review');
    await expect(refusal).toContainText(
      'Only their owners can see them. They need to save, change or delete them.',
    );
    await expect(refusal).not.toContainText('Sushi breakfast');
    await expect(refusal).toContainText(
      'Removing GBP works now, because nothing uses it. Removing asks you to confirm, and Activity shows who removed it.',
    );
    await refusal.getByRole('button', { name: 'Show them', exact: true }).click();
    await expect(refusal.getByRole('link', { name: 'Ramen at Ichiran' })).toHaveAttribute(
      'href',
      new RegExp(`^/groups/${group}/expenses\\?expense=[a-f0-9]{24}$`),
    );
    await page.screenshot({
      path: testInfo.outputPath(`721-remove-refused-${scheme}.png`),
      animations: 'disabled',
    });
    await refusal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(refusal).toBeHidden();

    // Pounds are unused: removing asks first, then goes, and Activity says who removed it.
    await currencies(page).getByRole('button', { name: 'Remove GBP', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove GBP?' });
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(rows(page)).toHaveCount(3);
    await currencies(page).getByRole('button', { name: 'Remove GBP', exact: true }).click();
    await confirm.getByRole('button', { name: 'Remove GBP', exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(rows(page)).toHaveCount(2);
    await expect(currencies(page).getByText('2 of 4', { exact: true })).toBeVisible();
    expect(
      (await dataOf(await ledger.sam.get(`/api/groups/${group}`))).alternateCurrencies,
    ).toEqual(['EUR', 'JPY']);
    await page.goto(appURL(`/groups/${group}/activity`));
    await expect(page.getByText('You removed GBP from the Group’s currencies')).toBeVisible();
    await expect(page.getByText('Nothing used it', { exact: true })).toBeVisible();
  });

  test(`desktop ${scheme}: a member adds a currency they search for (#721)`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    const { group, name } = await lisbonAndTokyo(ledger);

    await enter(page, ledger.sam, `/groups/${group}/settings`);
    await expect(
      currencies(page).getByText('Only admins can remove a currency. Ask Alex Rivera.'),
    ).toBeVisible();
    await expect(currencies(page).getByRole('button', { name: /^Remove / })).toHaveCount(0);
    await currencies(page)
      .getByRole('button', { name: /^Currency to add/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Add a currency' });
    await expect(dialog).toContainText(`${name} · 3 of 4 extra currencies`);
    await expect(dialog).toContainText(
      'INR, EUR, JPY and GBP are already on the list, so they aren’t shown. Codes outside the 30 Splitbook supports can’t be added.',
    );
    const list = dialog.getByRole('listbox', { name: 'Currencies you can add' });
    await dialog.getByRole('searchbox', { name: 'Search currencies' }).fill('singapore');
    await expect(list.getByRole('option')).toHaveText([/^SGD\s*Singapore Dollar/]);
    await dialog.getByRole('searchbox', { name: 'Search currencies' }).fill('');
    await expect(list.getByRole('option')).toHaveCount(26);
    await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
    await list.getByRole('option', { name: /^CHF/ }).click();
    await expect(list.getByRole('option', { selected: true })).toHaveText(/^CHF\s*Swiss Franc/);
    await page.screenshot({
      path: testInfo.outputPath(`721-member-adds-${scheme}.png`),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Add CHF', exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(rows(page).last()).toHaveText(
      /^CHF\s*Swiss Franc\s*Nothing uses it · added by you, \d+ \w+$/,
    );
    await expect(currencies(page).getByText('4 of 4', { exact: true })).toBeVisible();
    await expect(currencies(page).getByRole('button', { name: /^Currency to add/ })).toHaveCount(0);
    expect(
      (await dataOf(await ledger.alex.get(`/api/groups/${group}`))).alternateCurrencies,
    ).toEqual(['EUR', 'JPY', 'GBP', 'CHF']);
  });
}
