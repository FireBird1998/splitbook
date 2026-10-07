import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

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
/** Home's cards (#306, #308) say Try again; the Groups list page says Retry. */
const retryName = (path: string) => (path === '/dashboard' ? 'Try again' : 'Retry');
/** The empty state of the Groups list page, or of Home's Groups table. */
const noGroupsYet = /^No groups yet$/i;

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
      await expect(page.getByText(noGroupsYet)).toHaveCount(0);
      // Home's heading counts the Groups only from a list it could read (#306).
      await expect(page.getByText(/\b0 Groups\b/)).toHaveCount(0);
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
      const retry = error.getByRole('button', { name: retryName(path), exact: true });
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
    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/groups' && response.status() === 200,
    );
    await page.clock.runFor(31_000);
    await refreshed;
    const error = page.getByRole('alert').filter({ hasText: staleMessage });
    await expect(error).toBeVisible();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(noGroupsYet)).toHaveCount(0);
    await expect(page.getByText('UNSUPPORTED-private-payload')).toHaveCount(0);
    await page.unroute('**/api/groups');
    await error.getByRole('button', { name: retryName(path), exact: true }).click();
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
  await expect(page.getByRole('main').getByText(privateName, { exact: true })).toBeVisible();
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
        // The page's own content. The sidebar still lists the Group: its name comes from the
        // Groups list, a separate read that verified it (#303).
        await expect(page.getByRole('main').getByText(group.name, { exact: true })).toHaveCount(0);
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
        else
          await expect(
            page.getByRole('main').getByText(group.name, { exact: true }).first(),
          ).toBeVisible();
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
    // The Group page's own content; the sidebar's Group list is a separate read (#303).
    const content =
      surface === 'settings'
        ? page.getByLabel('Group Name', { exact: true })
        : page.getByRole('main').getByText(group.name, { exact: true }).first();
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
    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === apiPath && response.status() === 200,
    );
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

/*
 * #201: losing access to a Group deletes what the tab holds for it on the
 * first refused read, not when the Group's own 30 s poll next runs.
 */
const SAM = DEMO_PERSONA_IDS.sam;
const PRIYA = DEMO_PERSONA_IDS.priya;

/**
 * A Trip Priya runs and shares with Sam, so Sam's header shows his balance and
 * the trip total, Balances a payment and Activity both. Odd paise keep each
 * figure distinct from everything else on the page.
 */
async function sharedTrip(ledger: Ledger, name: string) {
  const trip = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: { name, category: 'trip', defaultCurrency: 'INR' },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, trip._id);
  await dataOf(
    await ledger.priya.post(`/api/groups/${trip._id}/expenses`, {
      data: {
        description: 'Synthetic lantern dinner',
        amount: 1357.9,
        currency: 'INR',
        category: 'food',
        tag: 'Food',
        date: new Date().toISOString(),
        paidBy: [{ user: PRIYA, amount: 1357.9 }],
        splitMethod: 'equal',
        splitBetween: [{ user: PRIYA }, { user: SAM }],
      },
    }),
    201,
  );
  await dataOf(
    await ledger.sam.post(`/api/groups/${trip._id}/settlements`, {
      data: { paidTo: PRIYA, amount: 123.45, currency: 'INR', note: 'Synthetic lantern refund' },
    }),
    201,
  );
  return trip._id as string;
}

// Sam owes half of 1,357.90 less the 123.45 he paid back.
const balance = '555.50';
const tripTotal = '1,357.90';
const lostContent = [
  'Synthetic lantern dinner',
  balance,
  tripTotal,
  '123.45',
  'Synthetic lantern refund',
  'Forbidden',
];

for (const { tab, poll, read, tabPath = read, shows, empty } of [
  {
    tab: 'Expenses',
    poll: 10_000,
    read: 'expenses',
    shows: ['Synthetic lantern dinner'],
    // A failed first read says the list could not be loaded, never that it is empty.
    empty: 'No expenses yet',
  },
  {
    tab: 'Balances',
    poll: 15_000,
    read: 'balances',
    shows: ['Synthetic lantern refund', balance],
    empty: 'All settled up',
  },
  {
    tab: 'Insights',
    poll: 20_000,
    // A Trip's Insights is its Trip summary (#316).
    read: 'trip-summary',
    tabPath: 'insights',
    // The trip's Spent, and its biggest day's biggest Expense.
    shows: [tripTotal, 'Synthetic lantern dinner'],
    empty: 'No Expenses yet',
  },
  {
    tab: 'Activity',
    poll: 10_000,
    read: 'activity',
    shows: ['“Synthetic lantern dinner”'],
    empty: 'No activity yet',
  },
]) {
  test(`${tab} tab: the first refused read after Sam is removed deletes the Group's content, and Retry after he is back shows none of it`, async ({
    page,
    ledger,
  }) => {
    const name = `Synthetic lantern trip from ${tab}`;
    const groupId = await sharedTrip(ledger, name);
    const groupPath = `/api/groups/${groupId}`;
    const readPath = `${groupPath}/${read}`;
    const main = page.getByRole('main');
    const header = main.getByRole('region', { name: new RegExp(`^${name} trip,`) });

    await page.clock.install();
    await enter(page, ledger, `/groups/${groupId}`);
    // The local suite runs `next dev`, which may still be compiling these routes.
    await expect(header).toContainText(balance, { timeout: 30_000 });
    await expect(header).toContainText(tripTotal);
    const tabLink = main
      .getByRole('navigation', { name: `${name} sections` })
      .getByRole('link', { name: tab, exact: true });
    if (tab !== 'Expenses') await tabLink.click();
    await page.waitForURL((url) => url.pathname === `/groups/${groupId}/${tabPath}`);
    for (const text of shows) await expect(main.getByText(text).first()).toBeVisible();
    // Hold every timer: only the tab's own poll may run, never the Group's 30 s poll.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
    const groupReads: number[] = [];
    page.on('response', (response) => {
      if (response.request().method() === 'GET' && new URL(response.url()).pathname === groupPath)
        groupReads.push(response.status());
    });

    await dataOf(await ledger.priya.delete(`${groupPath}/members/${SAM}`));
    const refused = page.waitForResponse(
      (response) => new URL(response.url()).pathname === readPath && response.status() === 403,
    );
    await page.clock.runFor(poll);
    await refused;

    const denied = main.getByRole('alert').filter({ hasText: 'Group could not be loaded.' });
    await expect(denied).toBeVisible();
    await expect(main).toHaveText(/^\s*Group could not be loaded\.\s*Retry\s*$/);
    for (const text of [name, ...lostContent]) await expect(main).not.toContainText(text);
    expect(groupReads).toEqual([]);

    // Deleted, not hidden: back in the Group, with every read below it failing,
    // nothing from before the denial can come back.
    await joinGroup(ledger.priya, ledger.sam, groupId);
    await page.route(
      (url) => url.pathname.startsWith(`${groupPath}/`),
      (route) => route.fulfill({ status: 503, json: { error: 'Synthetic outage' } }),
    );
    const reread = page.waitForResponse(
      (response) => new URL(response.url()).pathname === groupPath && response.status() === 200,
    );
    const outage = page.waitForResponse(
      (response) => new URL(response.url()).pathname === readPath && response.status() === 503,
    );
    await denied.getByRole('button', { name: 'Retry', exact: true }).click();
    await reread;
    await expect(header).toBeVisible();
    // Back on the tab the member was on: the tab is the address.
    expect(new URL(page.url()).pathname).toBe(`/groups/${groupId}/${tabPath}`);
    await expect(tabLink).toHaveAttribute('aria-current', 'page');
    await outage;
    await expect(header).toContainText('Balance unavailable');
    await expect(header).not.toContainText('Trip total');
    // Unread is not empty: the tab must not claim there is nothing to show.
    for (const text of empty ? [...lostContent, empty] : lostContent)
      await expect(main).not.toContainText(text);
  });
}

const subReads = (groupPath: string) => (url: URL) => url.pathname.startsWith(`${groupPath}/`);
const outage = { status: 503, json: { error: 'Synthetic outage' } };

test('a Household reopened after Sam is back shows no month figures or dialog from before the loss', async ({
  page,
  ledger,
}) => {
  const household = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: { name: 'Synthetic lantern household', category: 'home', defaultCurrency: 'INR' },
    }),
    201,
  );
  const groupPath = `/api/groups/${household._id}`;
  await joinGroup(ledger.priya, ledger.sam, household._id);
  await dataOf(
    await ledger.sam.post(`${groupPath}/expenses`, {
      data: {
        description: 'Synthetic lantern groceries',
        amount: 864.26,
        currency: 'INR',
        category: 'food',
        tag: 'Groceries',
        date: new Date().toISOString(),
        paidBy: [{ user: SAM, amount: 864.26 }],
        splitMethod: 'equal',
        splitBetween: [{ user: PRIYA }, { user: SAM }],
      },
    }),
    201,
  );
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const main = page.getByRole('main');
  // The Month bar's figures (#310), Spent first. The bar itself stays when they can't load.
  const monthFigures = main
    .getByRole('region', { name: / summary$/ })
    .getByRole('definition')
    .first();

  const sections = main.getByRole('navigation', { name: 'Synthetic lantern household sections' });
  const expensesTab = `/groups/${household._id}/expenses`;

  await page.clock.install();
  // Opened the way a Dashboard card's "Add expense" opens it: the old link lands on the
  // Expenses tab, keeps the Month and opens the form once.
  await enter(page, ledger, `/groups/${household._id}?month=${month}&action=add-expense`);
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
  await page.waitForURL((url) => url.pathname === expensesTab && url.search === `?month=${month}`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(monthFigures).toContainText('864.26');
  // The Month bar belongs to the Expenses tab (#305): Balances always include every Month.
  await sections.getByRole('link', { name: 'Balances', exact: true }).click();
  await expect(main.getByText('432.13').first()).toBeVisible();
  await expect(monthFigures).toHaveCount(0);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === expensesTab && url.search === `?month=${month}`);
  await expect(monthFigures).toContainText('864.26');
  await main.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  await dataOf(await ledger.priya.delete(`${groupPath}/members/${SAM}`));
  const refused = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${groupPath}/expenses` && response.status() === 403,
  );
  await page.clock.runFor(10_000);
  await refused;
  const denied = main.getByRole('alert').filter({ hasText: 'Group could not be loaded.' });
  await expect(denied).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Time runs again, so anything the reopened page would defer gets to run.
  await page.clock.resume();

  await joinGroup(ledger.priya, ledger.sam, household._id);
  await page.route(subReads(groupPath), (route) => route.fulfill(outage));
  const reread = page.waitForResponse(
    (response) => new URL(response.url()).pathname === groupPath && response.status() === 200,
  );
  const unavailable = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${groupPath}/`) && response.status() === 503,
  );
  await denied.getByRole('button', { name: 'Retry', exact: true }).click();
  await reread;
  // Neither the dialog left open before the loss nor the deep link's opens again by itself.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(main.getByText('Synthetic lantern household', { exact: true })).toBeVisible();
  await expect(sections.getByRole('link', { name: 'Expenses', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await unavailable;
  await expect(monthFigures).toHaveCount(0);
  for (const text of ['864.26', '432.13']) await expect(main).not.toContainText(text);
});

test('a non-member, and a member who has left, get the same refusal on every tab and from the old links', async ({
  page,
  ledger,
}) => {
  // Sixteen page loads, each of a route the local `next dev` may still be compiling.
  test.slow();
  // groupA is Alex's alone; Sam joined this one and then left it.
  const left = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: { name: 'Synthetic lantern flat Sam left', category: 'home', defaultCurrency: 'INR' },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, left._id);
  await dataOf(await ledger.sam.post(`/api/groups/${left._id}/leave`));
  const main = page.getByRole('main');

  for (const groupId of [ledger.groupA, left._id]) {
    for (const path of [
      '',
      '/expenses',
      '/balances',
      '/insights',
      '/activity',
      '/members',
      '?tab=balances',
      '?action=add-expense',
    ]) {
      await enter(page, ledger, `/groups/${groupId}${path}`);
      const denied = main.getByRole('alert').filter({ hasText: 'Group could not be loaded.' });
      // The local suite runs `next dev`, which may still be compiling these routes.
      await expect(denied, path).toBeVisible({ timeout: 30_000 });
      await expect(main, path).toHaveText(/^\s*Group could not be loaded\.\s*Retry\s*$/);
      await expect(page.getByRole('dialog'), path).toHaveCount(0);
    }
  }
});

test('the Dashboard after a loss shows none of the lost Group, even when its refetch fails', async ({
  page,
  ledger,
}) => {
  const name = 'Synthetic lantern trip on the Dashboard';
  const groupId = await sharedTrip(ledger, name);
  const groupPath = `/api/groups/${groupId}`;
  // Sam's totals across every Group the isolated app holds, so read rather than assumed.
  const rupees = (await dataOf(await ledger.sam.get('/api/user/balances'))).buckets.find(
    (bucket: { currency: string }) => bucket.currency === 'INR',
  );
  const owed = rupees.youOwe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const main = page.getByRole('main');
  const card = main.locator(`a[href="/groups/${groupId}"]`);
  const totals = main.locator('section[aria-labelledby="home-balances-heading"]');

  await page.clock.install();
  await enter(page, ledger, '/dashboard');
  await expect(card.first()).toBeVisible({ timeout: 30_000 });
  await expect(totals).toContainText(owed);
  await card.first().click();
  await expect(main.getByRole('region', { name: new RegExp(`^${name} trip,`) })).toContainText(
    balance,
    { timeout: 30_000 },
  );

  // Every refetch of the account's Groups and balances now fails: the sidebar's, as the loss
  // clears them (#303), and the Dashboard's.
  for (const path of ['/api/groups', '/api/user/balances'])
    await page.route(
      (url) => url.pathname === path,
      (route) => route.fulfill(outage),
    );
  const refetched = ['/api/groups', '/api/user/balances'].map((path) =>
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === path && response.status() === 503,
    ),
  );
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  await dataOf(await ledger.priya.delete(`${groupPath}/members/${SAM}`));
  const refused = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${groupPath}/expenses` && response.status() === 403,
  );
  await page.clock.runFor(10_000);
  await refused;
  await expect(
    main.getByRole('alert').filter({ hasText: 'Group could not be loaded.' }),
  ).toBeVisible();
  await Promise.all(refetched);

  await page.clock.resume();
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(card).toHaveCount(0);
  for (const text of [name, balance, owed]) await expect(main).not.toContainText(text);
});

test('saving Group settings preserves fields and updates the list, dashboard Theme and trip dates through client navigation', async ({
  page,
  ledger,
}) => {
  const apiPath = `/api/groups/${ledger.groupB}`;
  const settingsPath = `/groups/${ledger.groupB}/settings`;
  const before = await dataOf(await ledger.priya.get(apiPath));
  // Warm the account-scoped list before editing so navigation also exercises invalidation.
  await enter(page, ledger, '/groups', 'priya');
  await page.locator(`a[href="${settingsPath}"]`).click();
  await expect(page.getByLabel('Group Name', { exact: true })).toHaveValue(before.name);
  const name = 'Shared contract spring trip';
  await page.getByLabel('Group Name', { exact: true }).fill(name);
  await page
    .getByLabel('Description', { exact: true })
    .fill('Saved through the actual settings form');
  await page.getByRole('combobox', { name: /^Category / }).click();
  await page.getByRole('option', { name: /Trip$/ }).click();
  await page.getByLabel('Start date', { exact: true }).fill('2032-04-10');
  await page.getByLabel('End date', { exact: true }).fill('2032-04-14');
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === apiPath && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Group info updated', { exact: true })).toBeVisible();
  const persisted = await dataOf(await ledger.priya.get(apiPath));
  expect(persisted).toMatchObject({
    name,
    description: 'Saved through the actual settings form',
    category: 'trip',
    startDate: '2032-04-10T00:00:00.000Z',
    endDate: '2032-04-14T00:00:00.000Z',
    defaultCurrency: before.defaultCurrency,
    alternateCurrencies: before.alternateCurrencies,
    members: before.members,
    tags: before.tags,
  });

  // The shell's sidebar (#303): its Group list follows the save, Theme icon included.
  const sidebar = page.getByRole('complementary', { name: 'Splitbook' });
  const row = sidebar
    .getByRole('navigation', { name: 'Your Groups' })
    .getByRole('link', { name: new RegExp(`^${name}( |$)`) });
  await expect(row).toBeVisible();
  await expect(row.locator('[data-group-theme="trip"]')).toHaveCount(1);
  await sidebar.getByRole('link', { name: 'Groups', exact: true }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole('main').getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByText('Apr 10, 2032 – Apr 14, 2032', { exact: true })).toBeVisible();
  await sidebar
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  // The Groups table's Theme line, a Trip's with its dates, proves the saved Theme and trip
  // dates reached Home (#308).
  const trip = page
    .getByRole('region', { name: 'Groups' })
    .getByRole('link', { name: /^Shared contract spring trip / });
  await expect(trip).toBeVisible();
  await expect(trip).toHaveAccessibleName(/Trip · Apr 10–14, 2032$/);
  await sidebar.getByRole('link', { name: 'Groups', exact: true }).click();
  await page.locator(`a[href="${settingsPath}"]`).click();
  await expect(page.getByLabel('Group Name', { exact: true })).toHaveValue(name);
  await expect(page.getByRole('combobox', { name: /^Category / })).toContainText('Trip');
  await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('2032-04-10');
  await expect(page.getByLabel('End date', { exact: true })).toHaveValue('2032-04-14');
});
