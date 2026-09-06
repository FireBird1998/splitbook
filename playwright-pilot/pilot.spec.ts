import { expect, test } from '@playwright/test';
import { DEMO_GROUP_ID, enterAsPersona } from '../playwright/fixtures';
import { installPilotFixtures, expectAccessible, groupBalances } from './fixtures';

for (const section of [
  { path: '/api/groups', message: 'Groups could not be loaded.' },
  { path: '/api/invitations', message: 'Pending actions could not be loaded.' },
]) {
  test(`dashboard recovers ${section.path} without losing loaded balances`, async ({ page }) => {
    await installPilotFixtures(page);
    let failing = true;
    await page.route(`**${section.path}`, async (route) => {
      if (failing) await route.fulfill({ status: 500, json: { error: 'Internal diagnostic' } });
      else await route.fallback();
    });
    await enterAsPersona(page, 'alex');
    const error = page.getByRole('alert').filter({ hasText: section.message });
    await expect(error).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Current balance' }).getByText('₹1,480.00'),
    ).toBeVisible();
    failing = false;
    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(error).toHaveCount(0);
  });
}

test('balances announces loading then shows owed-to-you direction', async ({ page }) => {
  await installPilotFixtures(page);
  await enterAsPersona(page, 'sam');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/groups/${DEMO_GROUP_ID}/balances`, async (route) => {
    await pending;
    await route.fallback();
  });
  try {
    await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
    await expect(page.getByRole('status', { name: 'Loading balances' })).toBeVisible();
    await expect(page.getByText('Settled', { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByText('Others owe you', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record settlement', exact: true })).toBeVisible();
});

test('dashboard keeps loaded groups visible and retries a safe balance error', async ({ page }) => {
  let failing = true;
  await page.route('**/api/user/balances', async (route) => {
    if (failing)
      await route.fulfill({
        status: 500,
        json: { error: 'Internal diagnostic: private backend detail' },
      });
    else await route.continue();
  });
  await enterAsPersona(page, 'alex');
  const error = page.getByRole('alert').filter({ hasText: 'Balances could not be loaded.' });
  await expect(error).toBeVisible();
  await expect(page.getByText('Goa Friends Trip', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Internal diagnostic/)).toHaveCount(0);
  await expect(page.getByText('Settled', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Balance unavailable', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Create your first group', { exact: true })).toHaveCount(0);
  failing = false;
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(error).toHaveCount(0);
});

test('empty dashboard and settled balances remain distinct from errors', async ({ page }) => {
  await installPilotFixtures(page, {
    '/api/groups': [],
    '/api/user/balances': { buckets: [], groups: [], hasMixedCurrencies: false },
    [`/api/groups/${DEMO_GROUP_ID}/balances`]: { balances: [], debts: [], currency: 'INR' },
    [`/api/groups/${DEMO_GROUP_ID}/settlements`]: [],
  });
  await enterAsPersona(page, 'alex');
  await expect(page.getByRole('heading', { name: 'No groups yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create your first group' })).toBeVisible();
  await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
  await expect(page.getByRole('heading', { name: 'All settled up' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('settlement history failure preserves debts, warns about mixed currency, and recovers', async ({
  page,
}) => {
  await installPilotFixtures(page, {
    [`/api/groups/${DEMO_GROUP_ID}/balances`]: { ...groupBalances, hasMixedCurrencies: true },
  });
  let failing = true;
  await page.route(`**/api/groups/${DEMO_GROUP_ID}/settlements`, async (route) => {
    if (failing) await route.fulfill({ status: 500, json: { error: 'Internal diagnostic' } });
    else await route.fulfill({ json: { data: [] } });
  });
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
  await expect(page.getByText('Who pays whom', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'different currency' })).toBeVisible();
  const error = page.getByRole('alert').filter({ hasText: 'Could not load settlement history.' });
  await expect(error).toBeVisible();
  failing = false;
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByText('No settlements yet — record one when someone pays.')).toBeVisible();
});

test('initial dashboard loading is announced until requests finish', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const endpoint of ['groups', 'user/balances', 'invitations']) {
    await page.route(`**/api/${endpoint}`, async (route) => {
      await pending;
      await route.continue();
    });
  }
  try {
    await page.reload();
    await expect(page.getByRole('status', { name: 'Loading dashboard' })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByText('Current balance', { exact: true })).toBeVisible();
});

test('narrow and breakpoint layouts keep settlement controls reachable and return dialog focus', async ({
  page,
}) => {
  await installPilotFixtures(page);
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
  const record = page.getByRole('button', { name: 'Record settlement', exact: true });
  for (const width of [320, 600, 1199, 1200]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(record).toBeVisible();
    const bounds = await record.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  }
  await record.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // MUI may initially focus its modal container. Focus must enter the modal,
  // then follow its form order, remain trapped, and return to the trigger.
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const focused = document.activeElement;
        return (
          focused !== document.body &&
          (element.contains(focused) || Boolean(focused?.contains(element)))
        );
      }),
    )
    .toBe(true);
  const amount = dialog.getByRole('spinbutton', { name: 'Amount' });
  if (!(await amount.evaluate((element) => element === document.activeElement)))
    await page.keyboard.press('Tab');
  await expect(amount).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Note (optional)')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Save settlement' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(amount).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(record).toBeFocused();
});

for (const screen of ['dashboard', 'balances'] as const) {
  test(`${screen} loaded presentation is accessible and visually stable`, async ({
    page,
  }, testInfo) => {
    await installPilotFixtures(page);
    await enterAsPersona(page, 'alex');
    if (screen === 'balances') await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
    await expect(
      page.getByText(screen === 'balances' ? 'Who pays whom' : 'Current balance', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => page.locator('html').getAttribute('data-theme'))
      .toBe(testInfo.project.name.endsWith('dark') ? 'dark' : 'light');
    await expectAccessible(page, testInfo);
    await page.evaluate(() => document.fonts.ready);
    expect(
      process.platform === 'linux' || Boolean(process.env.DESIGN_BROWSER_WS),
      'Generate and compare baselines in the documented Linux browser environment.',
    ).toBe(true);
    await expect(page).toHaveScreenshot(`${screen}.png`, {
      fullPage: true,
      animations: 'disabled',
      stylePath: 'playwright-pilot/visual.css',
    });
  });
}

test('balances presents a safe retryable error independently of settlement history', async ({
  page,
}) => {
  await enterAsPersona(page, 'alex');
  let failing = true;
  await page.route(`**/api/groups/${DEMO_GROUP_ID}/balances`, async (route) => {
    if (failing)
      await route.fulfill({ status: 500, json: { error: 'Internal diagnostic: unavailable DB' } });
    else await route.continue();
  });
  await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
  const error = page.getByRole('alert').filter({ hasText: 'Balances could not be loaded.' });
  await expect(error).toBeVisible();
  await expect(page.getByText(/Internal diagnostic/)).toHaveCount(0);
  await expect(page.getByText('Settled', { exact: true })).toHaveCount(0);
  failing = false;
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Who pays whom', { exact: true })).toBeVisible();
});
