import { test, expect, dataOf } from './fixtures';
import type { Page } from '@playwright/test';
import type { Ledger } from './fixtures';
import type { ExpenseDraftValues } from '@splitbook/shared/validators/expense-draft';
async function setup(page: Page, ledger: Ledger, changes: ExpenseDraftValues = {}) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL!;
  await page.context().addCookies((await ledger.priya.storageState()).cookies);
  const group = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}`));
  const draft = (
    await dataOf(
      await ledger.priya.post(`/api/groups/${ledger.groupB}/drafts`, {
        headers: { 'Idempotency-Key': 'review-lost-reply-fixture' },
        data: {
          drafts: [
            {
              description: 'Review recovery meal',
              amount: 12.34,
              currency: 'INR',
              category: 'food',
              date: '2026-10-14',
              tagId: group.tags[0]._id,
              paidBy: [{ user: 'a00000000000000000000003', amount: 12.34 }],
              splitMethod: 'equal',
              splitBetween: [{ user: 'a00000000000000000000003' }],
              ...changes,
            },
          ],
        },
      }),
      201,
    )
  )[0];
  await page.goto(`${origin}/groups/${ledger.groupB}/review`);
  return draft;
}

test('payer and Tag quick fixes cover their needs, announce Ready, and wait for explicit save (#712)', async ({
  page,
  ledger,
}) => {
  await setup(page, ledger, { paidBy: undefined, tagId: undefined });
  const needs = page.getByRole('region', { name: 'Needs details', exact: true });
  await expect(page.getByRole('region', { name: 'Ready', exact: true })).toHaveCount(0);
  await needs
    .getByRole('group', { name: 'Who paid for Review recovery meal' })
    .getByRole('button', { name: 'You, suggested' })
    .click();
  await expect(needs).toContainText('Review recovery meal');
  await expect(needs.getByRole('group', { name: 'Who paid for Review recovery meal' })).toHaveCount(
    0,
  );
  const tags = needs.getByRole('group', { name: 'Tag for Review recovery meal' });
  await tags.getByRole('button').first().click();
  await expect(page.getByRole('region', { name: 'Ready', exact: true })).toContainText(
    'Review recovery meal',
  );
  await expect(
    page.locator('[aria-live="polite"]').filter({ hasText: 'Review recovery meal moved to Ready' }),
  ).toBeAttached();
  const drafts = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/drafts`));
  expect(drafts).toHaveLength(1);
  expect(drafts[0].values.paidBy).toEqual([{ user: 'a00000000000000000000003' }]);
  expect(drafts[0].values.tagId).toBeTruthy();
  const expenses = await dataOf(
    await ledger.priya.get(`/api/groups/${ledger.groupB}/expenses?limit=100`),
  );
  expect(
    expenses.expenses.some(
      (row: { description: string }) => row.description === 'Review recovery meal',
    ),
  ).toBe(false);
});
for (const mode of ['single', 'ready'] as const) {
  test(`Check again after a lost ${mode} save reply and reload creates exactly one Expense`, async ({
    page,
    ledger,
  }) => {
    await setup(page, ledger);
    const savePath = `/api/groups/${ledger.groupB}/drafts/save`;
    let originalBody = '';
    let saves = 0;
    await page.route(`**${savePath}`, async (route) => {
      saves++;
      if (saves === 1) {
        originalBody = route.request().postData()!;
        const applied = await route.fetch();
        expect(applied.status()).toBe(200);
        expect((await applied.json()).data[0].status).toBe('saved');
        await route.abort('failed');
      } else {
        expect(route.request().postData()).toBe(originalBody);
        await route.continue();
      }
    });
    if (mode === 'single') {
      await page.getByRole('button', { name: 'Review Review recovery meal', exact: true }).click();
      await page
        .getByRole('region', { name: 'Review expense' })
        .getByRole('button', { name: 'Save expense', exact: true })
        .click();
    } else {
      await page.getByRole('button', { name: 'Save 1 ready', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Confirm save' }).click();
    }
    await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
    expect(saves).toBe(1);
    const expenses = await dataOf(
      await ledger.priya.get(`/api/groups/${ledger.groupB}/expenses?limit=100`),
    );
    expect(
      expenses.expenses.filter(
        (row: { description: string }) => row.description === 'Review recovery meal',
      ),
    ).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
    expect(saves).toBe(1);
    await page.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Expense saved' })).toBeVisible();
    expect(saves).toBe(2);
    const after = await dataOf(
      await ledger.priya.get(`/api/groups/${ledger.groupB}/expenses?limit=100`),
    );
    expect(
      after.expenses.filter(
        (row: { description: string }) => row.description === 'Review recovery meal',
      ),
    ).toHaveLength(1);
    expect(
      await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/drafts`)),
    ).toHaveLength(0);
  });
}

test('Next flushes recent typing; offline account items cannot be edited or saved', async ({
  page,
  ledger,
}) => {
  const draft = await setup(page, ledger);
  await page.getByRole('button', { name: 'Review one at a time' }).click();
  const panel = page.getByRole('region', { name: 'Review expense' });
  await panel.getByLabel('What was it for?').fill('Review just typed');
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Done for now' })).toBeVisible();
  const kept = (await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/drafts`)))[0];
  expect(kept.id).toBe(draft.id);
  expect(kept.values.description).toBe('Review just typed');
  await page.getByRole('button', { name: 'Review Review just typed', exact: true }).click();
  await page.context().setOffline(true);
  await expect(panel.getByLabel('What was it for?')).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Save expense', exact: true })).toBeDisabled();
  await expect(panel).toContainText('read-only');
  await page.context().setOffline(false);
});
