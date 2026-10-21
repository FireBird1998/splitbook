import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

/*
 * #732: a line or a To review item in a currency the Group doesn't list, as the boards "Quick
 * add with an unlisted currency" and "To review: a currency not on the list" show them, light
 * and dark. The member adds the currency to the Group, or changes to a listed one; the amount is
 * kept as entered and never converted.
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

/** Lisbon & Tokyo, a fictional Trip Alex runs with Sam: rupees, with euros and yen. */
async function lisbonAndTokyo(ledger: Ledger) {
  const name = `Lisbon & Tokyo ${randomUUID().slice(0, 8)}`;
  const created = await dataOf(
    await ledger.alex.post('/api/groups', {
      data: {
        name,
        category: 'trip',
        defaultCurrency: 'INR',
        alternateCurrencies: ['EUR', 'JPY'],
      },
    }),
    201,
  );
  const group = created._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  const food = (created.tags as Array<{ _id: string; name: string }>).find(
    (tag) => tag.name === 'Food',
  )!._id;
  return { group, name, food };
}

/** Items Alex set aside in To review, paid by Alex and shared with Sam. */
async function setAside(
  ledger: Ledger,
  group: string,
  food: string,
  items: Array<[description: string, amount: number, currency: string]>,
) {
  await dataOf(
    await ledger.alex.post(`/api/groups/${group}/drafts`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: {
        drafts: items.map(([description, amount, currency]) => ({
          description,
          amount,
          currency,
          category: 'food',
          date: '2026-10-12',
          tagId: food,
          paidBy: [{ user: alex, amount }],
          splitMethod: 'equal',
          splitBetween: [{ user: alex }, { user: sam }],
        })),
      },
    }),
    201,
  );
}

/** Let adding a currency reach the server, then lose its reply. */
async function loseAddReply(page: Page, group: string) {
  await page.route(`**/api/groups/${group}/currencies`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    return route.abort('failed');
  });
}

async function expensesOf(ledger: Ledger, group: string) {
  const page = await dataOf(await ledger.alex.get(`/api/groups/${group}/expenses?limit=100`));
  return page.expenses as Array<{ description: string; amount: number; currency: string }>;
}

/** Type a line once the page has hydrated: a fill before then is lost. */
async function type(page: Page, line: string) {
  const field = page.getByRole('textbox', { name: 'Quick add' });
  const chips = page.getByRole('list', { name: 'How Splitbook reads it' });
  await expect(async () => {
    await field.fill(line);
    await expect(chips).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return { field, chips };
}

for (const scheme of ['light', 'dark'] as const) {
  test(`desktop ${scheme}: Quick add adds CHF to the Group, then adds the Expense in CHF (#732)`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    const { group, name } = await lisbonAndTokyo(ledger);
    await enter(page, ledger.alex, `/groups/${group}/expenses`);
    const quickAdd = page.getByRole('region', { name: 'Quick add' });
    const { field, chips } = await type(page, 'CHF 86 dinner in Zürich');

    await expect(chips).toContainText('Amount · not on the list');
    await expect(chips).toContainText('CHF 86.00');
    await expect(field).toHaveAccessibleDescription(
      new RegExp(`^CHF isn’t one of ${name}’s currencies\\.`),
    );
    await expect(quickAdd.getByRole('button', { name: 'Add expense' })).toBeDisabled();
    await expect(quickAdd.getByRole('button', { name: 'Use another currency' })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`732-quick-add-unlisted-${scheme}.png`),
      animations: 'disabled',
    });

    await quickAdd.getByRole('button', { name: `Add CHF to ${name}` }).click();
    await expect(quickAdd).toContainText(`Read as CHF, one of ${name}’s currencies.`);
    const group1 = await dataOf(await ledger.alex.get(`/api/groups/${group}`));
    expect(group1.alternateCurrencies).toEqual(['EUR', 'JPY', 'CHF']);
    await page.screenshot({
      path: testInfo.outputPath(`732-quick-add-listed-${scheme}.png`),
      animations: 'disabled',
    });

    await field.press('Enter');
    await expect(field).toHaveValue('');
    await expect(quickAdd).toContainText('Added Dinner in Zürich, CHF 86.00.');
    expect(
      (await expensesOf(ledger, group)).filter((row) => row.description === 'Dinner in Zürich'),
    ).toEqual([expect.objectContaining({ amount: 86, currency: 'CHF' })]);
  });
}

test('Quick add reads an unlisted line in another of the Group’s currencies, unconverted (#732)', async ({
  page,
  ledger,
}) => {
  const { group } = await lisbonAndTokyo(ledger);
  await enter(page, ledger.alex, `/groups/${group}/expenses`);
  const quickAdd = page.getByRole('region', { name: 'Quick add' });
  const { field, chips } = await type(page, 'CHF 86 dinner in Zürich');
  await quickAdd.getByRole('button', { name: 'Use another currency' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['INR', 'EUR', 'JPY']);
  await page.getByRole('menuitem', { name: 'EUR' }).click();
  await expect(chips).toContainText('€86.00');

  await field.press('Enter');
  await expect(field).toHaveValue('');
  expect(
    (await expensesOf(ledger, group)).filter((row) => row.description === 'Dinner in Zürich'),
  ).toEqual([expect.objectContaining({ amount: 86, currency: 'EUR' })]);
  const after = await dataOf(await ledger.alex.get(`/api/groups/${group}`));
  expect(after.alternateCurrencies).toEqual(['EUR', 'JPY']);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`desktop ${scheme}: To review changes one item’s currency and adds CHF for another (#732)`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    const { group, name, food } = await lisbonAndTokyo(ledger);
    await setAside(ledger, group, food, [
      ['Dinner in Zürich', 86, 'CHF'],
      ['Lunch in Geneva', 40.5, 'CHF'],
      ['Taxi to Alfama', 18.4, 'EUR'],
    ]);
    await enter(page, ledger.alex, `/groups/${group}/review`);
    const needs = page.getByRole('region', { name: 'Needs details', exact: true });
    const ready = page.getByRole('region', { name: 'Ready', exact: true });
    const dinner = needs.getByRole('group', { name: 'Currency for Dinner in Zürich' });
    await expect(dinner).toContainText(
      `CHF isn’t one of ${name}’s currencies. Add it, or change this Expense’s currency.`,
    );
    await expect(dinner).toContainText(
      'Adding lets everyone use CHF, the 3rd of 4 extra currencies. Changing keeps 86.00 and changes only the currency; nothing is converted.',
    );
    await expect(needs).toContainText('Currency not listed');
    await expect(ready).toContainText('Taxi to Alfama');
    await page.screenshot({
      path: testInfo.outputPath(`732-to-review-unlisted-${scheme}.png`),
      animations: 'disabled',
      fullPage: true,
    });

    await dinner.getByRole('combobox', { name: 'Change currency to' }).selectOption('EUR');
    await expect(ready).toContainText('Dinner in Zürich');
    await expect(ready).toContainText('€86.00');

    const lunch = needs.getByRole('group', { name: 'Currency for Lunch in Geneva' });
    await lunch.getByRole('button', { name: `Add CHF to ${name}` }).click();
    await expect(ready).toContainText('Lunch in Geneva');
    await expect(needs).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`732-to-review-fixed-${scheme}.png`),
      animations: 'disabled',
      fullPage: true,
    });

    const drafts = await dataOf(await ledger.alex.get(`/api/groups/${group}/drafts`));
    const values = Object.fromEntries(
      drafts.map((draft: { values: { description: string } }) => [
        draft.values.description,
        draft.values,
      ]),
    );
    expect(values['Dinner in Zürich']).toMatchObject({ amount: 86, currency: 'EUR' });
    expect(values['Lunch in Geneva']).toMatchObject({ amount: 40.5, currency: 'CHF' });
    const after = await dataOf(await ledger.alex.get(`/api/groups/${group}`));
    expect(after.alternateCurrencies).toEqual(['EUR', 'JPY', 'CHF']);
    expect(await expensesOf(ledger, group)).toEqual([]);
  });
}

test('Quick add takes CHF as added when its reply is lost (#732)', async ({ page, ledger }) => {
  const { group, name } = await lisbonAndTokyo(ledger);
  await enter(page, ledger.alex, `/groups/${group}/expenses`);
  const quickAdd = page.getByRole('region', { name: 'Quick add' });
  const { field } = await type(page, 'CHF 86 dinner in Zürich');
  await loseAddReply(page, group);
  await quickAdd.getByRole('button', { name: `Add CHF to ${name}` }).click();
  await expect(quickAdd).toContainText(`Read as CHF, one of ${name}’s currencies.`);
  await expect(quickAdd).not.toContainText('Couldn’t add the currency');
  await field.press('Enter');
  await expect(field).toHaveValue('');
  expect(
    (await expensesOf(ledger, group)).filter((row) => row.description === 'Dinner in Zürich'),
  ).toEqual([expect.objectContaining({ amount: 86, currency: 'CHF' })]);
});

test('To review takes CHF as added when its reply is lost (#732)', async ({ page, ledger }) => {
  const { group, name, food } = await lisbonAndTokyo(ledger);
  await setAside(ledger, group, food, [['Dinner in Zürich', 86, 'CHF']]);
  await enter(page, ledger.alex, `/groups/${group}/review`);
  const needs = page.getByRole('region', { name: 'Needs details', exact: true });
  await loseAddReply(page, group);
  await needs
    .getByRole('group', { name: 'Currency for Dinner in Zürich' })
    .getByRole('button', { name: `Add CHF to ${name}` })
    .click();
  await expect(page.getByRole('region', { name: 'Ready', exact: true })).toContainText(
    'Dinner in Zürich',
  );
  await expect(needs).toHaveCount(0);
  await expect(page.getByText('Check the expense details and try again.')).toHaveCount(0);
});

test('To review says why adding a currency was refused, in the refusal’s own words (#732)', async ({
  page,
  ledger,
}) => {
  const { group, name, food } = await lisbonAndTokyo(ledger);
  await setAside(ledger, group, food, [['Dinner in Zürich', 86, 'CHF']]);
  await enter(page, ledger.alex, `/groups/${group}/review`);
  // A refusal the Group, read again, doesn't contradict: CHF stays unlisted.
  await page.route(`**/api/groups/${group}/currencies`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Only current members can add a currency.' }),
        })
      : route.continue(),
  );
  const needs = page.getByRole('region', { name: 'Needs details', exact: true });
  await needs
    .getByRole('group', { name: 'Currency for Dinner in Zürich' })
    .getByRole('button', { name: `Add CHF to ${name}` })
    .click();
  await expect(page.getByText('Only current members can add a currency.')).toBeVisible();
  await expect(page.getByText('Check the expense details and try again.')).toHaveCount(0);
  await expect(needs).toContainText('Dinner in Zürich');
});

test('To review offers only a change once the Group’s list filled after it loaded, keeping the refusal’s words (#804)', async ({
  page,
  ledger,
}) => {
  const { group, name, food } = await lisbonAndTokyo(ledger);
  await setAside(ledger, group, food, [['Dinner in Zürich', 86, 'CHF']]);
  await enter(page, ledger.alex, `/groups/${group}/review`);
  const needs = page.getByRole('region', { name: 'Needs details', exact: true });
  const dinner = needs.getByRole('group', { name: 'Currency for Dinner in Zürich' });
  const add = dinner.getByRole('button', { name: `Add CHF to ${name}` });
  await expect(add).toBeVisible();
  // Meanwhile Sam fills the list: 4 extra currencies, the most a Group can have.
  for (const currency of ['GBP', 'USD'])
    await dataOf(
      await ledger.sam.post(`/api/groups/${group}/currencies`, { data: { currency } }),
      201,
    );
  await add.click();
  await expect(page.getByText('A Group can have at most 4 extra currencies.')).toBeVisible();
  await expect(dinner).toContainText(
    `CHF isn’t one of ${name}’s currencies. Change this Expense’s currency.`,
  );
  await expect(dinner).toContainText(
    `${name} already has 4 extra currencies, the most a Group can have. An admin can remove one nothing uses in Group settings.`,
  );
  await expect(add).toHaveCount(0);
  await expect(page.getByText('A Group can have at most 4 extra currencies.')).toBeVisible();
});
