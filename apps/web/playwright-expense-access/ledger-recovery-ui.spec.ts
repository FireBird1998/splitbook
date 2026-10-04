import { test, expect, dataOf } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

test('Settlement retry reuses its key and a new identical payment receives a fresh key', async ({
  page,
  ledger,
}) => {
  await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/expenses`, {
      data: {
        description: 'Shared purchase awaiting payments',
        amount: 1000,
        currency: 'INR',
        category: 'other',
        tag: 'Rent',
        date: new Date().toISOString(),
        paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 1000 }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.sam }],
      },
    }),
    201,
  );
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}?tab=balances`);
  const keys: string[] = [];
  await page.route(`**/api/groups/${ledger.groupB}/settlements`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      return route.abort('failed');
    }
    return route.continue();
  });
  const record = page.getByRole('button', { name: 'Record settlement', exact: true });
  await record.click();
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Record settlement', exact: true }),
  });
  await dialog.getByRole('spinbutton', { name: 'Amount' }).fill('250.25');
  await dialog.getByLabel('Note (optional)').fill('Identical separate payments');
  await dialog.getByRole('button', { name: 'Save settlement', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('spinbutton', { name: 'Amount' })).toHaveValue('250.25');
  await expect(dialog.getByLabel('Note (optional)')).toHaveValue('Identical separate payments');
  await dialog.getByRole('button', { name: 'Save settlement', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  const path = `/api/groups/${ledger.groupB}/settlements`;
  const first = await dataOf(await ledger.sam.get(path));
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ amount: 250.25, amountMinor: 25025 });

  // Closing and starting a second action must rotate the key even for equal payloads.
  await record.click();
  await dialog.getByRole('spinbutton', { name: 'Amount' }).fill('250.25');
  await dialog.getByLabel('Note (optional)').fill('Identical separate payments');
  await dialog.getByRole('button', { name: 'Save settlement', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(keys).toHaveLength(3);
  expect(keys[2]).toBeTruthy();
  expect(keys[2]).not.toBe(keys[0]);
  const final = await dataOf(await ledger.sam.get(path));
  expect(final).toHaveLength(2);
  expect(new Set(final.map((row: { _id: string }) => row._id)).size).toBe(2);
  expect(final.map((row: { amountMinor: number }) => row.amountMinor)).toEqual([25025, 25025]);
  const balances = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/balances`));
  expect(balances.debts).toEqual([
    expect.objectContaining({
      amount: 499.5,
      from: expect.objectContaining({ _id: DEMO_PERSONA_IDS.sam }),
    }),
  ]);
  const activity = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/activity`));
  expect(
    activity.activities.filter((event: { type: string }) => event.type === 'settlement_recorded'),
  ).toHaveLength(2);
});

test('recurring stale edits retain the draft until Reload latest and then save the new revision', async ({
  page,
  ledger,
}) => {
  const now = new Date();
  const path = `/api/groups/${ledger.groupB}/recurring`;
  const template = await dataOf(
    await ledger.priya.post(path, {
      data: {
        description: 'Recurring conflict fixture',
        amount: 100,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 100 }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.priya }, { user: DEMO_PERSONA_IDS.sam }],
        dayOfMonth: 1,
        startsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      },
    }),
    201,
  );
  await page.context().addCookies((await ledger.priya.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}/settings`);
  await page
    .getByRole('button', { name: 'Actions for recurring expense Recurring conflict fixture' })
    .click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit recurring expense' });
  const description = dialog.getByLabel('Description');
  await description.fill('Retain this recurring draft');
  await dataOf(
    await ledger.priya.patch(`${path}/${template._id}`, {
      headers: { 'X-Splitbook-Revision': String(template.revision ?? 0) },
      data: { description: 'Saved in the other recurring editor' },
    }),
  );
  const save = dialog.getByRole('button', { name: 'Save changes', exact: true });
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText('changed while you were editing');
  await expect(description).toHaveValue('Retain this recurring draft');
  await expect(save).toBeDisabled();
  const latest = await dataOf(await ledger.priya.get(path));
  expect(latest.find((row: { _id: string }) => row._id === template._id)).toMatchObject({
    description: 'Saved in the other recurring editor',
    revision: (template.revision ?? 0) + 1,
  });
  await dialog.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(description).toHaveValue('Saved in the other recurring editor');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(save).toBeEnabled();
  await description.fill('Saved after recurring conflict recovery');
  await save.click();
  await expect(dialog).toBeHidden();
  const final = await dataOf(await ledger.priya.get(path));
  expect(final.find((row: { _id: string }) => row._id === template._id)).toMatchObject({
    description: 'Saved after recurring conflict recovery',
    revision: (template.revision ?? 0) + 2,
  });
});
