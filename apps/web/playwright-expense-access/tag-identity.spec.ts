import { test, expect, dataOf, expensePath, generatedExpense } from './fixtures';

test('Tag rename preserves manual and recurring reads, filtering and archive guards', async ({
  ledger,
}) => {
  const generatedId = await generatedExpense(ledger);
  const group = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}`));
  const rent = group.tags.find((tag: { name: string }) => tag.name === 'Rent');
  await dataOf(
    await ledger.priya.patch(`/api/groups/${ledger.groupB}/tags/${rent._id}`, {
      data: { name: 'Monthly housing' },
    }),
  );
  for (const id of [ledger.expenseB, generatedId]) {
    expect(await dataOf(await ledger.priya.get(expensePath(ledger.groupB, id)))).toMatchObject({
      tagId: rent._id,
      tag: 'Monthly housing',
    });
  }
  const list = await dataOf(
    await ledger.priya.get(`/api/groups/${ledger.groupB}/expenses?tagId=${rent._id}`),
  );
  expect(list.expenses.map((expense: { _id: string }) => expense._id)).toEqual(
    expect.arrayContaining([ledger.expenseB, generatedId]),
  );
  const templates = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/recurring`));
  expect(templates[0]).toMatchObject({ tagId: rent._id, tag: 'Monthly housing' });
  await dataOf(
    await ledger.priya.patch(`/api/groups/${ledger.groupB}/tags/${rent._id}`, {
      data: { isArchived: true },
    }),
  );
  const deletion = await ledger.priya.delete(`/api/groups/${ledger.groupB}/tags/${rent._id}`);
  expect(deletion.status()).toBe(400);
  expect((await deletion.json()).error).toContain('recurring template');
  const current = await dataOf(await ledger.priya.get(expensePath(ledger.groupB, ledger.expenseB)));
  const edited = await dataOf(
    await ledger.priya.patch(expensePath(ledger.groupB, ledger.expenseB), {
      headers: { 'X-Splitbook-Revision': String(current.revision ?? 0) },
      data: {
        description: 'Corrected tagged expense',
        tagId: rent._id,
      },
    }),
  );
  expect(edited).toMatchObject({ tagId: rent._id, description: 'Corrected tagged expense' });
});

for (const profile of [
  { name: 'desktop-light', width: 1440, height: 1000, mode: 'light' },
  { name: 'desktop-dark', width: 1440, height: 1000, mode: 'dark' },
  { name: 'mobile-light', width: 390, height: 844, mode: 'light' },
  { name: 'mobile-dark', width: 390, height: 844, mode: 'dark' },
] as const) {
  test(`${profile.name}: Rename dialog preserves entered text and filters by stable identity`, async ({
    ledger,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.emulateMedia({ colorScheme: profile.mode });
    await page.context().addCookies((await ledger.priya.storageState()).cookies);
    const baseURL = process.env.EXPENSE_ACCESS_BASE_URL!;
    await page.goto(`${baseURL}/groups/${ledger.groupB}/settings`);
    await page.getByRole('button', { name: 'Actions for tag Rent', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename Tag' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', profile.mode);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('menu')).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath('rename-dialog.png'),
      animations: 'disabled',
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await dialog.getByRole('textbox', { name: 'Tag name' }).fill('Groceries');
    await dialog.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog.getByText('A tag with this name already exists')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Tag name' })).toHaveValue('Groceries');
    await dialog.getByRole('textbox', { name: 'Tag name' }).fill('Housing costs');
    await dialog.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Actions for tag Housing costs', exact: true }),
    ).toBeVisible();
    const group = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}`));
    const tag = group.tags.find((item: { name: string }) => item.name === 'Housing costs');
    await page.goto(`${baseURL}/groups/${ledger.groupB}`);
    await page.getByRole('button', { name: 'Show filters', exact: true }).click();
    const response = page.waitForResponse(
      (value) =>
        value.url().includes(`/api/groups/${ledger.groupB}/expenses?`) &&
        new URL(value.url()).searchParams.get('tagId') === tag._id,
    );
    await page.getByRole('button', { name: 'Housing costs', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByText('Private rent', { exact: true })).toBeVisible();
  });
}
