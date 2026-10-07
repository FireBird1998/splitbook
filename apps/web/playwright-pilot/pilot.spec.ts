import { expect, test } from '@playwright/test';
import { DEMO_GROUP_ID, enterAsPersona, expectThemeApplied } from '../playwright/fixtures';
import { installPilotFixtures, expectAccessible, groupBalances, settledSummary } from './fixtures';

test('pending invitations do not claim nothing needs you', async ({ page }) => {
  await installPilotFixtures(page, { '/api/groups': [], '/api/user/balances': settledSummary });
  await enterAsPersona(page, 'alex');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/invitations', async (route) => {
    await pending;
    await route.fallback();
  });
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No groups yet' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading invitations' })).toBeVisible();
    await expect(page.getByText('Nothing needs you')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByText('Nothing needs you')).toBeVisible();
});

test('pending payments are loading, not an empty result', async ({ page }) => {
  await installPilotFixtures(page);
  await enterAsPersona(page, 'alex');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/groups/${DEMO_GROUP_ID}/settlements`, async (route) => {
    await pending;
    await route.fulfill({ json: { data: [] } });
  });
  try {
    await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
    await expect(page.getByRole('heading', { name: 'Settle up' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading payments' })).toBeVisible();
    await expect(page.getByText('No payments yet. Record one when someone pays.')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByText('No payments yet. Record one when someone pays.')).toBeVisible();
});

for (const section of [
  { path: '/api/groups', message: 'Groups could not be loaded.', retry: 'Retry' },
  { path: '/api/invitations', message: 'Invitations could not be loaded.', retry: 'Try again' },
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
      page.getByRole('region', { name: 'Your balances' }).getByText('₹1,480.00', { exact: true }),
    ).toBeVisible();
    // The suggested payment stays in Needs you whichever read failed beside it.
    await expect(
      page
        .getByRole('region', { name: 'Needs you' })
        .getByRole('link', { name: /^Record payment: You pay Sam Chen/ }),
    ).toBeVisible();
    failing = false;
    await error.getByRole('button', { name: section.retry }).click();
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
  await expect(
    page
      .getByRole('region', { name: 'All-time balance' })
      .getByText('You’re owed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record Alex Rivera’s payment to you', exact: true }),
  ).toBeVisible();
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
  // Needs you can't list payments without the read, and never says nothing needs you.
  await expect(
    page.getByRole('alert').filter({ hasText: 'Suggested payments could not be loaded.' }),
  ).toBeVisible();
  await expect(page.getByText('Nothing needs you')).toHaveCount(0);
  failing = false;
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(error).toHaveCount(0);
  // In the page: Next's route announcer is an alert of its own, outside main.
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('empty dashboard and settled balances remain distinct from errors', async ({ page }) => {
  await installPilotFixtures(page, {
    '/api/groups': [],
    '/api/user/balances': settledSummary,
    [`/api/groups/${DEMO_GROUP_ID}/balances`]: { balances: [], debts: [], currency: 'INR' },
    [`/api/groups/${DEMO_GROUP_ID}/settlements`]: [],
  });
  await enterAsPersona(page, 'alex');
  await expect(page.getByRole('heading', { name: 'No groups yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create your first group' })).toBeVisible();
  await expect(page.getByText('No balances yet')).toBeVisible();
  await expect(page.getByText('Nothing needs you')).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
  await expect(page.getByRole('heading', { name: 'All settled up' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('a Payments failure preserves debts, warns about mixed currency, and recovers', async ({
  page,
}) => {
  await installPilotFixtures(page, {
    [`/api/groups/${DEMO_GROUP_ID}/balances`]: {
      ...groupBalances,
      hasMixedCurrencies: true,
      byCurrency: [
        { currency: 'INR', balances: groupBalances.balances, debts: groupBalances.debts },
        { currency: 'EUR', balances: [], debts: [] },
      ],
    },
  });
  let failing = true;
  await page.route(`**/api/groups/${DEMO_GROUP_ID}/settlements`, async (route) => {
    if (failing) await route.fulfill({ status: 500, json: { error: 'Internal diagnostic' } });
    else await route.fulfill({ json: { data: [] } });
  });
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
  await expect(page.getByRole('heading', { name: 'Settle up' })).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Each balance is shown separately' }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Balance currency' })).toBeVisible();
  const error = page.getByRole('alert').filter({ hasText: 'Payments could not be loaded.' });
  await expect(error).toBeVisible();
  failing = false;
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByText('No payments yet. Record one when someone pays.')).toBeVisible();
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
    // Each card announces its own loading.
    await expect(page.getByRole('status', { name: 'Loading your balances' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading what needs you' })).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page.getByRole('region', { name: 'Your balances' }).getByText('Net', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0);
});

test('narrow and breakpoint layouts keep Record reachable, and Record moves focus into the form', async ({
  page,
}) => {
  await installPilotFixtures(page);
  await enterAsPersona(page, 'alex');
  await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
  const record = page.getByRole('button', { name: 'Record your payment to Sam Chen', exact: true });
  const form = page.getByRole('region', { name: 'Record payment', exact: true });
  for (const width of [320, 600, 1199, 1200]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(record).toBeVisible();
    await record.scrollIntoViewIfNeeded();
    await expect(record).toBeInViewport();
    // A visible DOM node can still sit behind a fixed navigation/action bar.
    await record.click({ trial: true });
    const bounds = await record.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    // Record payment fits the width too, with nothing scrolling the page sideways.
    const formBounds = await form.boundingBox();
    expect(formBounds!.x + formBounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
  await record.focus();
  await page.keyboard.press('Enter');
  // Record fills the form in on the page and moves focus to the amount, then the form's order.
  const amount = form.getByRole('textbox', { name: 'Amount paid' });
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue('1480.00');
  await page.keyboard.press('Tab');
  await expect(form.getByRole('textbox', { name: 'Note, optional' })).toBeFocused();
  await page.keyboard.press('Tab');
  const save = form.getByRole('button', { name: 'Record payment ₹1,480.00', exact: true });
  await expect(save).toBeFocused();
  await expect(save).toBeEnabled();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(amount).toBeFocused();
});

for (const screen of ['dashboard', 'balances'] as const) {
  test(`${screen} loaded presentation is accessible and visually stable`, async ({
    page,
  }, testInfo) => {
    await installPilotFixtures(page);
    await enterAsPersona(page, 'alex');
    if (screen === 'balances') await page.goto(`/groups/${DEMO_GROUP_ID}?tab=balances`);
    if (screen === 'balances')
      await expect(page.getByRole('heading', { name: 'Settle up' })).toBeVisible();
    else
      await expect(
        page
          .getByRole('region', { name: 'Needs you' })
          .getByRole('link', { name: /^Record payment/ }),
      ).toBeVisible();
    await expectThemeApplied(page, testInfo);
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

test('balances presents a safe retryable error independently of Payments', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'Settle up' })).toBeVisible();
});
