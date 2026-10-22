import { randomUUID } from 'node:crypto';
import { test, expect, dataOf, joinGroup, openAddExpense } from './fixtures';

test('a quick pick focused from the keyboard has room for its whole ring (#830)', async ({
  page,
  ledger,
}) => {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: { name: `Quick pick ${randomUUID()}`, category: 'trip', defaultCurrency: 'EUR' },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}`);
  const dialog = await openAddExpense(page);
  const chip = dialog.getByRole('button', { name: /Groceries/ });
  // Back from the description, which has focus, to the first quick pick.
  for (let press = 0; press < 12; press++) {
    if (await chip.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Shift+Tab');
  }
  await expect(chip).toBeFocused();
  await expect(chip).toHaveCSS('outline-style', 'solid');
  // The ring reaches 4px past the chip: 2px of outline after a 2px gap, and the 4px halo. The
  // scroll row clips anything past its padding.
  const room = await chip.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const row = element.parentElement!.getBoundingClientRect();
    return { top: box.top - row.top, left: box.left - row.left, bottom: row.bottom - box.bottom };
  });
  expect(room.top).toBeGreaterThanOrEqual(4);
  expect(room.left).toBeGreaterThanOrEqual(4);
  expect(room.bottom).toBeGreaterThanOrEqual(4);
});
