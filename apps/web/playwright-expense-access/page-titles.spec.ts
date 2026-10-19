import { test, expect, dataOf } from './fixtures';

test('page titles identify Home, Settings and every Group tab', async ({ page, ledger }) => {
  // Nine full document loads share this journey, including cold Group tabs.
  test.slow();
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  const base = process.env.EXPENSE_ACCESS_BASE_URL!;
  const group = await dataOf(await ledger.alex.get(`/api/groups/${ledger.groupA}`));
  for (const [path, title] of [
    ['/dashboard', 'Home'],
    ['/settings', 'Settings'],
    [`/groups/${ledger.groupA}`, group.name],
    ...['expenses', 'balances', 'insights', 'activity', 'members', 'settings'].map((tab) => [
      `/groups/${ledger.groupA}/${tab}`,
      tab === 'expenses' ? group.name : `${group.name} · ${tab[0].toUpperCase()}${tab.slice(1)}`,
    ]),
  ]) {
    await page.goto(`${base}${path}`);
    await expect(page).toHaveTitle(`${title} · Splitbook`);
  }
});

test('Join titles name only valid invitations, and private Group titles require membership', async ({
  page,
  ledger,
}) => {
  const base = process.env.EXPENSE_ACCESS_BASE_URL!;
  const invite = await dataOf(
    await ledger.alex.post(`/api/groups/${ledger.groupA}/invite-link`, { data: {} }),
    201,
  );
  await page.goto(`${base}/join/${invite.inviteCode}`);
  await expect(page).toHaveTitle('Join Synthetic access household · Splitbook');
  await page.goto(`${base}/join/not-a-valid-link`);
  await expect(page).toHaveTitle('Join a Group · Splitbook');
  const expired = await dataOf(
    await ledger.alex.post(`/api/groups/${ledger.groupA}/invite-link`, {
      data: { expiresInDays: -1 },
    }),
    201,
  );
  await page.goto(`${base}/join/${expired.inviteCode}`);
  await expect(page).toHaveTitle('Join a Group · Splitbook');
  await page.goto(`${base}/groups/${ledger.groupA}/expenses`);
  await expect(page).not.toHaveTitle(/Synthetic access household/);
  await page.context().addCookies((await ledger.priya.storageState()).cookies);
  await page.goto(`${base}/groups/${ledger.groupA}/expenses`);
  await expect(page).toHaveTitle('Group · Splitbook');
});
