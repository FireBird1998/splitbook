import { test, expect, dataOf } from './fixtures';
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
    const positions = page.getByText('Net positions', { exact: true }).locator('..');
    const amounts = positions.getByText(/₹100\.00/);
    await expect(amounts).toHaveCount(2);
    await expect(page.getByRole('status', { name: 'Loading settlement history' })).toBeHidden();
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
    // The page's own Add action; the top bar has one too (#304).
    await page.getByRole('main').getByRole('button', { name: 'Add expense', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /Add expense/i })).toBeVisible();
  });
}
