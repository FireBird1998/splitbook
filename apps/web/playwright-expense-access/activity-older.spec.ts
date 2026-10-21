import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf } from './fixtures';

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: Load older activity opens a Group's history beyond 50 events (#800)`, async ({
    page,
    ledger,
  }) => {
    // Write through HTTP so pagination, membership and the shared page decoder all participate.
    for (let i = 1; i <= 51; i++) {
      await dataOf(
        await ledger.alex.post(`/api/groups/${ledger.groupA}/expenses`, {
          data: {
            description: `History item ${i}`,
            amount: 10,
            currency: 'INR',
            category: 'food',
            tag: 'Groceries',
            date: '2026-10-21',
            paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 10 }],
            splitMethod: 'equal',
            splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
          },
        }),
        201,
      );
    }
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.context().addCookies((await ledger.alex.storageState()).cookies);
    await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${ledger.groupA}/activity`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const events = page.getByText(/^You added “History item \d+”$/);
    await expect(events).toHaveCount(50);
    await expect(events.first()).toHaveText('You added “History item 51”');
    await expect(events.last()).toHaveText('You added “History item 2”');
    await expect(page.getByText('You added “History item 1”', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Load older activity', exact: true }).click();
    await expect(events).toHaveCount(51);
    await expect(events.last()).toHaveText('You added “History item 1”');
    await expect(page.getByText('You created the group', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Load older activity', exact: true }),
    ).toHaveCount(0);
  });
}
