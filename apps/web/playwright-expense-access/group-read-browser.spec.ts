import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, dataOf, type Ledger } from './fixtures';

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  return `${origin}${path}`;
}

async function enter(page: Page, ledger: Ledger, path: string, actor: 'sam' | 'priya' = 'sam') {
  await page.context().addCookies((await ledger[actor].storageState()).cookies);
  await page.goto(appURL(path));
}

const initialMessage = 'Groups could not be loaded.';
const staleMessage = 'Groups could not be refreshed. Showing previously loaded groups.';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  for (const path of ['/groups', '/dashboard']) {
    test(`${viewport.name} ${path} rejects the whole malformed list and recovers with keyboard Retry`, async ({
      page,
      ledger,
    }) => {
      await page.setViewportSize(viewport);
      const validName = `Valid Group on ${viewport.name} ${path}`;
      await dataOf(
        await ledger.sam.post('/api/groups', {
          data: { name: validName, category: 'other', defaultCurrency: 'INR' },
        }),
        201,
      );
      await page.route('**/api/groups', async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const payload = await response.json();
        expect(payload.data.length).toBeGreaterThan(1);
        // A valid row alongside an invalid row must not become a partial account.
        payload.data.find((group: { _id: string }) => group._id === ledger.groupB).members[0].user =
          null;
        await route.fulfill({ response, json: payload });
      });
      await enter(page, ledger, path);
      const error = page.getByRole('alert').filter({ hasText: initialMessage });
      await expect(error).toBeVisible();
      await expect(page.getByText(validName, { exact: true })).toHaveCount(0);
      await expect(page.getByText('No groups yet', { exact: true })).toHaveCount(0);
      await expect(page.getByText('No recent activity or pending actions.')).toHaveCount(0);
      await expect(error).not.toContainText('members');
      // Inspect the settled error UI, after the dashboard entrance animation.
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      const accessibility = await new AxeBuilder({ page })
        .include('[role="alert"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await page.unroute('**/api/groups');
      const retry = error.getByRole('button', { name: 'Retry', exact: true });
      await retry.focus();
      await expect(retry).toBeFocused();
      await retry.press('Enter');
      await expect(error).toHaveCount(0);
      await expect(page.getByText(validName, { exact: true }).first()).toBeVisible();
    });
  }
}

for (const path of ['/groups', '/dashboard']) {
  test(`${path} keeps verified cards after a malformed refresh and clears the warning on Retry`, async ({
    page,
    ledger,
  }) => {
    await page.clock.install();
    const name = `Retained Group ${path}`;
    await dataOf(
      await ledger.sam.post('/api/groups', {
        data: { name, category: 'other', defaultCurrency: 'INR' },
      }),
      201,
    );
    await enter(page, ledger, path);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await page.route('**/api/groups', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.data[0].defaultCurrency = 'UNSUPPORTED-private-payload';
      await route.fulfill({ response, json: payload });
    });
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/groups' && response.status() === 200);
    await page.clock.runFor(31_000);
    await refreshed;
    const error = page.getByRole('alert').filter({ hasText: staleMessage });
    await expect(error).toBeVisible();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('No groups yet', { exact: true })).toHaveCount(0);
    await expect(page.getByText('UNSUPPORTED-private-payload')).toHaveCount(0);
    await page.unroute('**/api/groups');
    await error.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });
}

test('a structurally valid list belonging to another account is rejected and Retry restores the signed-in account', async ({
  page,
  ledger,
}) => {
  const foreign = await (await ledger.alex.get('/api/groups')).json();
  await page.route('**/api/groups', (route) => route.fulfill({ status: 200, json: foreign }));
  await enter(page, ledger, '/groups');
  const error = page.getByRole('alert').filter({ hasText: initialMessage });
  await expect(error).toBeVisible();
  await expect(page.locator(`a[href="/groups/${ledger.groupA}"]`)).toHaveCount(0);
  await page.unroute('**/api/groups');
  await error.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.locator(`a[href="/groups/${ledger.groupB}"]`).first()).toBeVisible();
  await expect(page.locator(`a[href="/groups/${ledger.groupA}"]`)).toHaveCount(0);
});

test('sign-out clears Group cards and a late prior-account refresh cannot populate the next account', async ({
  page,
  ledger,
}) => {
  const privateName = 'Sam-only late response Group';
  await dataOf(
    await ledger.sam.post('/api/groups', {
      data: { name: privateName, category: 'other', defaultCurrency: 'INR' },
    }),
    201,
  );
  await page.clock.install();
  await enter(page, ledger, '/groups');
  await expect(page.getByText(privateName, { exact: true })).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured = false;
  await page.route('**/api/groups', async (route) => {
    if (captured) return route.continue();
    captured = true;
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.clock.runFor(31_000);
    await expect.poll(() => captured).toBe(true);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Enter as Alex Rivera' })).toBeVisible();
    await expect(page.getByText(privateName, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Enter as Alex Rivera' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    release();
    await expect(page.locator(`a[href="/groups/${ledger.groupA}"]`).first()).toBeVisible();
    await expect(page.getByText(privateName, { exact: true })).toHaveCount(0);
    await expect(page.locator(`a[href="/groups/${ledger.groupB}"]`)).toHaveCount(0);
  } finally {
    release();
  }
});

for (const width of [1280, 390]) {
  for (const surface of ['detail', 'settings']) {
    for (const failure of ['unpopulated member', 'different requested identity']) {
      test(`${width}px ${surface} rejects ${failure} and recovers with Retry`, async ({
        page,
        ledger,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        const apiPath = `/api/groups/${ledger.groupB}`;
        const pagePath = `/groups/${ledger.groupB}${surface === 'settings' ? '/settings' : ''}`;
        const group = await dataOf(await ledger.priya.get(apiPath));
        await page.route(`**${apiPath}`, async (route) => {
          const response = await route.fetch();
          const payload = await response.json();
          if (failure === 'unpopulated member') payload.data.members[0].user = null;
          else payload.data._id = ledger.groupA;
          await route.fulfill({ response, json: payload });
        });
        await enter(page, ledger, pagePath, 'priya');
        const error = page.getByRole('alert').filter({ hasText: 'Group could not be loaded.' });
        await expect(error).toBeVisible();
        await expect(page.getByText(group.name, { exact: true })).toHaveCount(0);
        await expect(page.getByLabel('Group Name', { exact: true })).toHaveCount(0);
        const accessibility = await new AxeBuilder({ page })
          .include('[role="alert"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(accessibility.violations).toEqual([]);
        await page.unroute(`**${apiPath}`);
        await error.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
        await expect(error).toHaveCount(0);
        if (surface === 'settings')
          await expect(page.getByLabel('Group Name', { exact: true })).toHaveValue(group.name);
        else await expect(page.getByText(group.name, { exact: true }).first()).toBeVisible();
      });
    }
  }
}

for (const surface of ['detail', 'settings']) {
  test(`${surface} retains malformed-refresh cache, removes it after denied access, and never revives it on a later outage`, async ({
    page,
    ledger,
  }) => {
    const apiPath = `/api/groups/${ledger.groupB}`;
    const pagePath = `/groups/${ledger.groupB}${surface === 'settings' ? '/settings' : ''}`;
    const group = await dataOf(await ledger.priya.get(apiPath));
    const content =
      surface === 'settings'
        ? page.getByLabel('Group Name', { exact: true })
        : page.getByText(group.name, { exact: true }).first();
    await page.clock.install();
    const loaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === apiPath &&
        response.request().method() === 'GET' &&
        response.status() === 200,
    );
    await enter(page, ledger, pagePath, 'priya');
    await loaded;
    await expect(content).toBeVisible();
    let failure = 'malformed';
    await page.route(`**${apiPath}`, async (route) => {
      if (failure !== 'malformed')
        return route.fulfill({
          status: failure === 'denied' ? 403 : 503,
          json: { error: 'Private diagnostic must not be shown' },
        });
      const response = await route.fetch();
      const payload = await response.json();
      payload.data.members[0].user = null;
      await route.fulfill({ response, json: payload });
    });
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === apiPath && response.status() === 200);
    await page.clock.runFor(31_000);
    await refreshed;
    const stale = page
      .getByRole('alert')
      .filter({ hasText: 'Group could not be refreshed. Showing previously loaded group.' });
    await expect(stale).toBeVisible();
    await expect(content).toBeVisible();
    failure = 'denied';
    await stale.getByRole('button', { name: 'Retry', exact: true }).click();
    const error = page.getByRole('alert').filter({ hasText: 'Group could not be loaded.' });
    await expect(error).toBeVisible();
    await expect(content).toHaveCount(0);
    failure = 'outage';
    const rejected = page.waitForResponse(
      (response) => new URL(response.url()).pathname === apiPath && response.status() === 503,
    );
    await error.getByRole('button', { name: 'Retry', exact: true }).click();
    await rejected;
    await expect(error).toBeVisible();
    await expect(content).toHaveCount(0);
    await expect(page.getByText('Private diagnostic must not be shown')).toHaveCount(0);
    await page.unroute(`**${apiPath}`);
    await error.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(content).toBeVisible();
  });
}
