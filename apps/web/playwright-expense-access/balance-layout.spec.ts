import { test, expect, dataOf, openAddExpense } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`desktop ${colorScheme}: balance amounts remain unobstructed when scrolled beside the Add action`, async ({
    page,
    ledger,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await dataOf(
      await ledger.priya.post(`/api/groups/${ledger.groupB}/expenses`, {
        data: {
          description: 'Visible balance',
          amount: 100,
          currency: 'INR',
          category: 'other',
          tag: 'Rent',
          date: new Date().toISOString(),
          paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 100 }],
          splitMethod: 'equal',
          splitBetween: [{ user: DEMO_PERSONA_IDS.sam }],
        },
      }),
      201,
    );
    const baseURL = process.env.EXPENSE_ACCESS_BASE_URL;
    if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL))
      throw new Error('Isolated app required');
    await page.context().addCookies((await ledger.sam.storageState()).cookies);
    // Route compilation and data loading can outlast the UI assertion budget.
    // Start observing before navigation so even a cached response is included.
    const groupPath = `/api/groups/${ledger.groupB}`;
    const loaded = Promise.all(
      [groupPath, `${groupPath}/balances`, `${groupPath}/settlements`].map((pathname) =>
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === pathname && response.request().method() === 'GET',
        ),
      ),
    );
    await page.goto(`${baseURL}/groups/${ledger.groupB}?tab=balances`);
    for (const response of await loaded) {
      expect(response.status()).toBe(200);
      await response.finished();
    }
    // Everyone's bars (#313) carry each position's exact amount at the row's end.
    const positions = page.getByRole('region', { name: 'Everyone', exact: true });
    const amounts = positions.getByTestId('everyone-amount').filter({ hasText: /₹100\.00/ });
    await expect(amounts).toHaveCount(2);
    await expect(page.getByRole('status', { name: 'Loading payments' })).toBeHidden();
    for (const amount of await amounts.all()) {
      // Put each right-aligned amount where the former fixed action obscured it.
      await amount.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        window.scrollBy(0, rect.y + rect.height / 2 - (window.innerHeight - 52));
      });
      await expect
        .poll(() =>
          amount.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.right - 8, rect.y + rect.height / 2);
            return hit === element || (hit !== null && element.contains(hit));
          }),
        )
        .toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`balances-${colorScheme}.png`) });
    // Add expense is in the top bar (#304), and opens this Group's form.
    await openAddExpense(page);
  });
}

// #944: at 390 px an empty Note's visually hidden "No note" sat outside the Payments table's
// scroll box, where the table is wider than the screen, and widened the whole page: Maple House's
// Balances scrolled 478 px sideways into blank space. Only the table scrolls sideways.
test('phone: a payment without a note never makes the Balances page scroll sideways (#944)', async ({
  page,
  ledger,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/settlements`, {
      data: { paidTo: DEMO_PERSONA_IDS.sam, amount: 25, currency: 'INR' },
    }),
    201,
  );
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupB}?tab=balances`);
  const payments = page.getByRole('region', { name: 'Payments table', exact: true });
  await expect(payments.getByText('No note', { exact: true }).first()).toBeAttached();
  // The table is wider than the screen, and scrolls inside its own box.
  expect(await payments.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await page.mouse.wheel(400, 0);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
});
