import { randomUUID } from 'node:crypto';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';

/*
 * #812: Leave Group, when the Group holds money involving the member in a currency Splitbook no
 * longer supports. That money is in no Balance, so leaving is allowed, and the dialog says
 * leaving doesn't settle it (the Designer's line, light and dark); with no such money the dialog
 * is as it was. No API writes such money, so the Group's Balances read is answered here with the
 * server's own field added; the server's side is pinned by the integration tests.
 */

const NOTE =
  'Some of this Group’s money is in DEM, a currency Splitbook no longer supports. It isn’t in Balances, so leaving doesn’t settle it.';

async function berlin(ledger: Ledger) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Berlin & Paris ${randomUUID().slice(0, 6)}`,
          category: 'trip',
          defaultCurrency: 'INR',
          alternateCurrencies: [],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  return group;
}

/** Sam's Group settings, with the Leave Group dialog open. */
async function openLeave(page: Page, ledger: Ledger, group: string, codes: string[] | null) {
  if (codes)
    await page.route(`**/api/groups/${group}/balances`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, data: { ...body.data, unsupportedCurrencies: codes } },
      });
    });
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}/settings`);
  await page.getByRole('button', { name: 'Leave Group', exact: true }).click();
  return page.getByRole('dialog');
}

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`812-${name}.png`), animations: 'disabled' });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`desktop ${scheme}: Leave Group names money in a currency Splitbook no longer supports (#812)`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    const group = await berlin(ledger);
    const dialog = await openLeave(page, ledger, group, ['DEM']);
    await expect(dialog.getByRole('alert')).toHaveText(NOTE);
    await expect(dialog.getByRole('button')).toHaveText(['Cancel', 'Leave Group']);
    await shoot(page, testInfo, `leave-dem-${scheme}`);
  });

  test(`desktop ${scheme}: Leave Group is as it was with no such money (#812)`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    const group = await berlin(ledger);
    const dialog = await openLeave(page, ledger, group, null);
    await expect(dialog).toContainText('You won’t see this Group or its balances any more.');
    await expect(dialog).not.toContainText('no longer supports');
    await shoot(page, testInfo, `leave-none-${scheme}`);
  });
}

test('leaving still works with such money named (#812)', async ({ page, ledger }) => {
  const group = await berlin(ledger);
  const dialog = await openLeave(page, ledger, group, ['DEM']);
  await expect(dialog.getByRole('alert')).toHaveText(NOTE);
  await dialog.getByRole('button', { name: 'Leave Group' }).click();
  await page.waitForURL('**/dashboard');
  const groups = (await dataOf(await ledger.sam.get('/api/groups'))) as Array<{ _id: string }>;
  expect(groups.some((row) => row._id === group)).toBe(false);
});
