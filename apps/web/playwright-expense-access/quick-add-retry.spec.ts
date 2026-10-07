import type { Page, Request } from '@playwright/test';
import { test, expect, dataOf, type Ledger } from './fixtures';

/**
 * Quick add (#320) saves through the Expense form's own request, so a lost reply is the same
 * unconfirmed save: the field keeps the line and its request, and sending it again reuses the
 * idempotency key, so the Expense is recorded once. Mirrors `retry-ui.spec.ts` for the form.
 */

const UNCONFIRMED =
  'This Expense may already be recorded: the reply never arrived. Press Enter to send the same record again, so it can’t be counted twice.';

async function openQuickAdd(page: Page, ledger: Ledger) {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}/expenses`);
  return page.getByRole('textbox', { name: 'Quick add' });
}

/** Type a line once the page has hydrated: a fill before then is lost. */
async function type(page: Page, line: string) {
  const field = page.getByRole('textbox', { name: 'Quick add' });
  const chips = page.getByRole('list', { name: 'How Splitbook reads it' });
  await expect(async () => {
    await field.fill(line);
    await expect(chips).toBeVisible({ timeout: 1_000 });
  }).toPass();
  // The description names the Household's Groceries Tag, so Enter can add it.
  await expect(
    chips.getByRole('button', { name: 'Tag: Groceries, suggested, not chosen yet. Change Tag' }),
  ).toBeVisible();
}

/** Commit the first create for real, then lose its reply; let later ones through. */
async function loseFirstReply(page: Page, ledger: Ledger) {
  const keys: string[] = [];
  const createPath = `/api/groups/${ledger.groupB}/expenses`;
  await page.route(`**${createPath}`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      return route.abort('failed');
    }
    return route.continue();
  });
  const isCreate = (request: Request) =>
    new URL(request.url()).pathname === createPath && request.method() === 'POST';
  return { keys, isCreate };
}

async function recorded(ledger: Ledger, description: string) {
  const expenses = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/expenses`));
  const activity = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/activity`));
  return {
    expenses: expenses.expenses.filter(
      (expense: { description: string }) => expense.description === description,
    ).length,
    added: activity.activities.filter(
      (event: { type: string; metadata: { description?: string } }) =>
        event.type === 'expense_added' && event.metadata.description === description,
    ).length,
  };
}

test('a lost Quick add reply is an unconfirmed save; Enter retries the same request once', async ({
  page,
  ledger,
}) => {
  const field = await openQuickAdd(page, ledger);
  const line = 'Lost reply groceries 101.01';
  await type(page, line);
  const { keys, isCreate } = await loseFirstReply(page, ledger);

  const responseLost = page.waitForEvent('requestfailed', isCreate);
  await field.press('Enter');
  await responseLost;
  const alert = page.getByRole('region', { name: 'Quick add' }).getByRole('alert');
  await expect(alert).toHaveText(UNCONFIRMED);
  await expect(field).toHaveValue(line);
  await expect(field).toHaveAccessibleDescription(new RegExp(UNCONFIRMED.slice(0, 40)));

  const retried = page.waitForResponse((response) => isCreate(response.request()));
  await field.press('Enter');
  const created = await retried;
  expect(created.status()).toBe(201);
  await created.finished();
  await expect(field).toHaveValue('');
  await expect(alert).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(await recorded(ledger, 'Lost reply groceries')).toEqual({ expenses: 1, added: 1 });
});

test('clearing the line keeps the unconfirmed save: typing it again is the same request', async ({
  page,
  ledger,
}) => {
  const field = await openQuickAdd(page, ledger);
  const line = 'Cleared groceries 7.13';
  await type(page, line);
  const { keys, isCreate } = await loseFirstReply(page, ledger);

  const responseLost = page.waitForEvent('requestfailed', isCreate);
  await field.press('Enter');
  await responseLost;
  await expect(
    page.getByRole('alert').filter({ hasText: 'may already be recorded' }),
  ).toBeVisible();
  await field.press('Escape');
  await expect(field).toHaveValue('');
  // Clearing alone sends nothing.
  expect(keys).toHaveLength(1);

  await type(page, line);
  await expect(
    page.getByRole('alert').filter({ hasText: 'may already be recorded' }),
  ).toBeVisible();
  const retried = page.waitForResponse((response) => isCreate(response.request()));
  await field.press('Enter');
  expect((await retried).status()).toBe(201);
  await expect(field).toHaveValue('');
  expect(keys).toEqual([keys[0], keys[0]]);
  expect(await recorded(ledger, 'Cleared groceries')).toEqual({ expenses: 1, added: 1 });
});

test('a changed line after a lost reply is a new Expense with a new key', async ({
  page,
  ledger,
}) => {
  const field = await openQuickAdd(page, ledger);
  await type(page, 'First groceries 7.13');
  const { keys, isCreate } = await loseFirstReply(page, ledger);

  const responseLost = page.waitForEvent('requestfailed', isCreate);
  await field.press('Enter');
  await responseLost;
  await type(page, 'Second groceries 7.13');
  // A changed line is no longer the unconfirmed one, and editing sends nothing.
  await expect(page.getByRole('alert').filter({ hasText: 'may already be recorded' })).toHaveCount(
    0,
  );
  expect(keys).toHaveLength(1);
  const created = page.waitForResponse((response) => isCreate(response.request()));
  await field.press('Enter');
  expect((await created).status()).toBe(201);
  await expect(field).toHaveValue('');
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
  expect(await recorded(ledger, 'First groceries')).toEqual({ expenses: 1, added: 1 });
  expect(await recorded(ledger, 'Second groceries')).toEqual({ expenses: 1, added: 1 });
});
