import type { Page } from '@playwright/test';
import { test, expect, dataOf, expensePath, joinGroup, type Ledger } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

/*
 * #199: a tab only shows, and only writes as, the account it was rendered for.
 *
 * Tab 1 shows Alex's pages. In tab 2 (same browser context, so the same
 * cookies and localStorage) the session moves to Sam. Tab 1 must never render
 * Sam's figures beside Alex's name or record anything as Sam; it reloads and
 * ends on a page freshly rendered for whoever is signed in now.
 */

const ALEX = DEMO_PERSONA_IDS.alex;
const SAM = DEMO_PERSONA_IDS.sam;
const PRIYA = DEMO_PERSONA_IDS.priya;
const INVITATION_GROUP = 'Sam-only pending invitation';

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  return `${origin}${path}`;
}

const rent = (
  description: string,
  amount: number,
  payer: string,
  shares: Array<[user: string, amount: number]>,
) => ({
  description,
  amount,
  currency: 'INR',
  category: 'housing',
  tag: 'Rent',
  date: new Date().toISOString(),
  paidBy: [{ user: payer, amount }],
  splitMethod: 'exact',
  splitBetween: shares.map(([user, share]) => ({ user, amount: share })),
});

const money = (amount: number) =>
  amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Something tab 1 must never show while it is Alex's page: an element, or text inside one. */
type Marker = { within: string; text?: string };

/**
 * The `ledger` fixture gives Alex and Sam no shared Group and zero balances.
 * Share Alex's Group with Sam (and Priya, so the two accounts' figures there
 * differ), then give Sam figures and an invitation Alex never sees. Sam's
 * amounts carry odd paise, so they do not coincide with Alex's.
 * Returns what only Sam's pages show.
 */
async function giveSamDistinctFigures(ledger: Ledger): Promise<Marker[]> {
  await joinGroup(ledger.alex, ledger.sam, ledger.groupA);
  await joinGroup(ledger.alex, ledger.priya, ledger.groupA);
  const shared = rent('Synthetic shared rent', 933.33, SAM, [
    [ALEX, 300],
    [SAM, 300],
    [PRIYA, 333.33],
  ]);
  await dataOf(
    await ledger.sam.post(`/api/groups/${ledger.groupA}/expenses`, { data: shared }),
    201,
  );
  const samOnly = rent('Synthetic flat rent', 2469.38, PRIYA, [
    [PRIYA, 1234.69],
    [SAM, 1234.69],
  ]);
  await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/expenses`, { data: samOnly }),
    201,
  );
  const invitationGroup = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: { name: INVITATION_GROUP, category: 'other', defaultCurrency: 'INR' },
    }),
    201,
  );
  await dataOf(
    await ledger.priya.post(`/api/groups/${invitationGroup._id}/invite`, {
      data: { email: 'sam.demo@splitbook.local' },
    }),
    201,
  );

  // The isolated app keeps earlier tests' Groups (in any currency), so totals are read, not assumed.
  type Bucket = { currency: string; youOwe: number; youAreOwed: number };
  const buckets = async (actor: Ledger['alex']): Promise<Bucket[]> =>
    (await dataOf(await actor.get('/api/user/balances'))).buckets;
  const samRupees = (await buckets(ledger.sam)).find((bucket) => bucket.currency === 'INR')!;
  const samTotals = [money(samRupees.youOwe), money(samRupees.youAreOwed)];
  const alexTotals = (await buckets(ledger.alex)).flatMap((bucket) => [
    money(bucket.youOwe),
    money(bucket.youAreOwed),
  ]);
  expect(alexTotals.filter((total) => samTotals.includes(total))).toEqual([]);
  const invitedTo = async (actor: Ledger['alex']) =>
    (await dataOf(await actor.get('/api/invitations'))).map(
      (invitation: { group: { name: string } }) => invitation.group.name,
    );
  expect(await invitedTo(ledger.sam)).toContain(INVITATION_GROUP);
  expect(await invitedTo(ledger.alex)).not.toContain(INVITATION_GROUP);

  const totals = 'section[aria-labelledby="current-balance-heading"]';
  const sharedGroupCard = `.MuiPaper-root:has(a[href="/groups/${ledger.groupA}"])`;
  return [
    ...samTotals.map((text) => ({ within: totals, text })),
    { within: sharedGroupCard, text: money(633.33) }, // Sam's balance in the Group they share
    { within: 'body', text: 'Settle with Priya' }, // Sam's next action (Alex's is to pay Sam)
    { within: 'body', text: INVITATION_GROUP }, // Sam's invitation
    { within: `a[href="/groups/${ledger.groupB}"]` }, // a Group only Sam belongs to
  ];
}

type ApiCall = { method: string; path: string; expectedAccount?: string; document: number };
type ApiAnswer = { method: string; path: string; status: number; code?: string; data: boolean };

/**
 * Records every app API request tab 1 sends (Better Auth's `/api/auth/*`
 * excluded) and the answer it gets, numbered by the document that sent it:
 * each main-frame navigation, including the reload, starts a new document.
 */
async function recordApi(page: Page, options: { passDuplicateCheck?: boolean } = {}) {
  const tab = { document: 0, calls: [] as ApiCall[], answers: new Map<number, ApiAnswer[]>() };
  page.on('request', (request) => {
    if (request.isNavigationRequest()) {
      if (request.frame() === page.mainFrame()) tab.document += 1;
      return;
    }
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith('/api/') || pathname.startsWith('/api/auth/')) return;
    tab.calls.push({
      method: request.method(),
      path: pathname,
      expectedAccount: request.headers()['x-expected-account'],
      document: tab.document,
    });
  });
  await page.route(
    (url) => url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/'),
    async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const document = tab.document;
      if (options.passDuplicateCheck && pathname.endsWith('/expenses/check-duplicate')) {
        // Let a save reach its write; otherwise its duplicate check is the request refused.
        return route.fulfill({ json: { data: { isDuplicate: false } } });
      }
      let response;
      try {
        response = await route.fetch();
      } catch {
        return route.abort().catch(() => {}); // The test or the page has already moved on.
      }
      const body = await response.json().catch(() => null);
      const answers = tab.answers.get(document) ?? [];
      answers.push({
        method: request.method(),
        path: pathname,
        status: response.status(),
        code: body?.code,
        data: Boolean(body && 'data' in body),
      });
      tab.answers.set(document, answers);
      await route.fulfill({ response }).catch(() => {});
    },
  );
  return tab;
}
type ApiRecord = Awaited<ReturnType<typeof recordApi>>;

/** Every app API request tab 1 sent while it showed Alex's pages said it expected Alex. */
function expectOnlyAlexRequests(api: ApiRecord, lastAlexDocument: number) {
  const sent = api.calls.filter((call) => call.document <= lastAlexDocument);
  expect(sent.length).toBeGreaterThan(0);
  expect(sent.filter((call) => call.expectedAccount !== ALEX)).toEqual([]);
}

function accountChangedAnswers(api: ApiRecord, document: number) {
  return (api.answers.get(document) ?? []).filter((answer) => answer.status === 419);
}

/**
 * Report anything Sam-only that appears in tab 1's current document. The
 * observer lives in that document alone, so a reload ends the watch.
 */
async function watchCurrentDocument(page: Page, markers: Marker[]) {
  const rendered: string[] = [];
  await page.exposeFunction('__staleTabRendered', (marker: string) => {
    rendered.push(marker);
  });
  await page.evaluate((markers) => {
    const report = (window as unknown as { __staleTabRendered: (marker: string) => void })
      .__staleTabRendered;
    (window as unknown as { __renderedForAlex: boolean }).__renderedForAlex = true;
    const check = () => {
      for (const { within, text } of markers) {
        const shown = [...document.querySelectorAll(within)].some(
          (element) => text === undefined || (element.textContent ?? '').includes(text),
        );
        if (shown) report(text === undefined ? within : `${text} in ${within}`);
      }
    };
    check();
    new MutationObserver(check).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }, markers);
  return rendered;
}

/** Emulate hiding or showing the tab: both swr and Better Auth listen for visibilitychange. */
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((visibility) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => visibility === 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** Enter from the persona picker, clicking again if the first click landed before hydration. */
async function enterAs(page: Page, name: 'Alex Rivera' | 'Sam Chen') {
  let entered = false;
  const onResponse = (response: { url(): string; status(): number }) => {
    const { pathname } = new URL(response.url());
    if (pathname === '/api/auth/demo-persona/sign-in' && response.status() === 200) entered = true;
  };
  page.on('response', onResponse);
  try {
    const button = page.getByRole('button', { name: `Enter as ${name}` });
    await expect(button).toBeVisible();
    await expect(async () => {
      if (!entered) await button.click({ timeout: 1_000 }).catch(() => {});
      expect(entered).toBe(true);
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
  } finally {
    page.off('response', onResponse);
  }
}

async function expectSessionFor(page: Page, userId: string) {
  const session = await (await page.request.get(appURL('/api/auth/get-session'))).json();
  expect(session?.user?.id).toBe(userId);
}

async function expectAlexDashboard(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: /, Alex$/ })).toBeVisible();
  await expect(page.getByText('Alex Rivera', { exact: true }).first()).toBeVisible();
  // Alex's own figures have loaded: his next action is to pay Sam.
  await expect(page.getByText('Settle with Sam Chen', { exact: true })).toBeVisible();
}

async function waitForReload(api: ApiRecord, lastAlexDocument: number) {
  await expect.poll(() => api.document, { timeout: 30_000 }).toBeGreaterThan(lastAlexDocument);
}

/** Sam's own Dashboard shows everything tab 1 watched for, so the watch was not vacuous. */
async function expectSamFigures(page: Page, samOnly: Marker[]) {
  for (const { within, text } of samOnly)
    await expect(
      page.locator(within, text === undefined ? {} : { hasText: text }).first(),
    ).toBeVisible();
}

/** A page loaded after the switch: the stale document's marker is gone and Sam is signed in. */
async function expectFreshPageForSam(page: Page) {
  await expect(page.getByText('Sam Chen', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => '__renderedForAlex' in window)).toBe(false);
}

/**
 * Tab 2 is a persona picker opened before Alex signed in; tab 1 then enters as
 * Alex. `switchToSam` enters as Sam from the stale picker: no sign-out, so
 * nothing is broadcast to tab 1.
 */
async function staleSignIn(page: Page, ledger: Ledger, options?: { passDuplicateCheck?: boolean }) {
  const samOnly = await giveSamDistinctFigures(ledger);
  // A local dev server compiles a route on its first visit and then refreshes open pages;
  // a refreshed picker would follow Alex's session to his Dashboard. Compile them first.
  const group = `/groups/${ledger.groupA}`;
  for (const path of ['/dashboard', '/groups', group, `${group}/settings`])
    expect((await ledger.alex.get(path)).status()).toBe(200);
  const picker = await page.context().newPage();
  await picker.goto(appURL('/'));
  await expect(picker.getByRole('button', { name: 'Enter as Sam Chen' })).toBeVisible();
  const api = await recordApi(page, options);
  await page.goto(appURL('/'));
  await enterAs(page, 'Alex Rivera');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expectAlexDashboard(page);
  return {
    api,
    samOnly,
    switchToSam: async () => {
      await enterAs(picker, 'Sam Chen');
      await expectSessionFor(picker, SAM);
    },
  };
}

test('sign-out path: a hidden Alex tab never shows Sam’s figures and ends on a fresh page', async ({
  page,
  ledger,
}) => {
  const samOnly = await giveSamDistinctFigures(ledger);
  const api = await recordApi(page);
  await page.goto(appURL('/'));
  await enterAs(page, 'Alex Rivera');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expectAlexDashboard(page);
  const lastAlexDocument = api.document;
  const rendered = await watchCurrentDocument(page, samOnly);

  const other = await page.context().newPage();
  await other.goto(appURL('/dashboard'));
  await expectAlexDashboard(other);
  await setVisibility(page, 'hidden');
  await other.getByRole('button', { name: 'Account menu' }).click();
  await other.getByRole('menuitem', { name: 'Sign Out' }).click();
  await expect(other).toHaveURL(appURL('/'));
  await enterAs(other, 'Sam Chen');
  await expect(other.getByRole('heading', { level: 1, name: /, Sam$/ })).toBeVisible();
  await expectSamFigures(other, samOnly);

  // Show tab 1 again, unless the sign-out broadcast has already reloaded it.
  if (api.document === lastAlexDocument) await setVisibility(page, 'visible').catch(() => {});
  await waitForReload(api, lastAlexDocument);
  await page.waitForLoadState();
  if (new URL(page.url()).pathname === '/login') {
    // The broadcast reloaded it before Sam entered.
    await expect(page.getByRole('button', { name: 'Enter as Sam Chen' })).toBeVisible();
    expect(await page.evaluate(() => '__renderedForAlex' in window)).toBe(false);
  } else {
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1, name: /, Sam$/ })).toBeVisible();
    await expectFreshPageForSam(page);
  }
  expect(rendered).toEqual([]);
  expectOnlyAlexRequests(api, lastAlexDocument);
});

test('stale sign-in path, hidden tab: shown again, it reloads for Sam without showing his figures', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  const { api, samOnly, switchToSam } = await staleSignIn(page, ledger);
  const lastAlexDocument = api.document;
  const rendered = await watchCurrentDocument(page, samOnly);
  await setVisibility(page, 'hidden');
  await switchToSam();
  await page.clock.runFor(65_000);
  await setVisibility(page, 'visible');
  await waitForReload(api, lastAlexDocument);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: /, Sam$/ })).toBeVisible();
  await expectFreshPageForSam(page);
  await expectSamFigures(page, samOnly);
  expect(rendered).toEqual([]);
  expectOnlyAlexRequests(api, lastAlexDocument);
});

test('stale sign-in path, visible tab: the next poll is answered 419 ACCOUNT_CHANGED and reloads', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  const { api, samOnly, switchToSam } = await staleSignIn(page, ledger);
  const lastAlexDocument = api.document;
  const rendered = await watchCurrentDocument(page, samOnly);
  await switchToSam();
  // No broadcast, no focus: only the Dashboard's 30 s poll can notice.
  await page.clock.runFor(31_000);
  await waitForReload(api, lastAlexDocument);
  expect(accountChangedAnswers(api, lastAlexDocument).length).toBeGreaterThan(0);
  for (const answer of accountChangedAnswers(api, lastAlexDocument))
    expect(answer).toMatchObject({ method: 'GET', code: 'ACCOUNT_CHANGED', data: false });
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: /, Sam$/ })).toBeVisible();
  await expectFreshPageForSam(page);
  await expectSamFigures(page, samOnly);
  expect(rendered).toEqual([]);
  expectOnlyAlexRequests(api, lastAlexDocument);
});

test('stale sign-in path, visible tab: following the Groups link never shows Sam’s Groups under Alex’s sidebar', async ({
  page,
  ledger,
}) => {
  const { api, samOnly, switchToSam } = await staleSignIn(page, ledger);
  const lastAlexDocument = api.document;
  const rendered = await watchCurrentDocument(page, samOnly);
  await switchToSam();
  await page
    .getByRole('complementary', { name: 'Splitbook' })
    .getByRole('link', { name: 'Groups', exact: true })
    .click();
  await waitForReload(api, lastAlexDocument);
  // The Groups page rendered for Sam inside Alex's layout still expected Alex.
  expect(accountChangedAnswers(api, lastAlexDocument)).toContainEqual(
    expect.objectContaining({ path: '/api/groups', code: 'ACCOUNT_CHANGED', data: false }),
  );
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.locator(`a[href="/groups/${ledger.groupB}"]`).first()).toBeVisible();
  await expectFreshPageForSam(page);
  expect(rendered).toEqual([]);
  expectOnlyAlexRequests(api, lastAlexDocument);
});

/** What a stale write could change in one Group, read through Alex's own API session. */
async function ledgerSnapshot(ledger: Ledger, groupId: string) {
  const group = `/api/groups/${groupId}`;
  const expenses = await dataOf(await ledger.alex.get(`${group}/expenses`));
  const activity = await dataOf(await ledger.alex.get(`${group}/activity`));
  const { members } = await dataOf(await ledger.alex.get(group));
  return {
    members: members.map((member: { user: { _id: string }; role: string }) => ({
      user: member.user._id,
      role: member.role,
    })),
    expenses: expenses.expenses.map(
      (expense: { _id: string; description: string; revision?: number; createdBy: unknown }) => ({
        id: expense._id,
        description: expense.description,
        revision: expense.revision ?? 0,
        createdBy: expense.createdBy,
      }),
    ),
    editedRecord:
      groupId === ledger.groupA
        ? await dataOf(await ledger.alex.get(expensePath(ledger.groupA, ledger.expenseA)))
        : null,
    settlements: await dataOf(await ledger.alex.get(`${group}/settlements`)),
    activity: activity.activities.map((event: { _id: string; type: string }) => event._id),
  };
}

/** A write tab 1 can start: the Group it touches, the page it starts from and the request it sends. */
type StaleWrite = {
  name: string;
  prepare: (
    ledger: Ledger,
  ) => Promise<{ group: string; page: string; method: string; path: string }>;
  open: (page: Page) => Promise<ReturnType<Page['getByRole']>>;
  /** Shows the refused write was one the new session could really have made. */
  stillPossible?: (ledger: Ledger, group: string) => Promise<void>;
};

const writes: StaleWrite[] = [
  {
    name: 'create an Expense with Alex as payer',
    prepare: async (ledger) => ({
      group: ledger.groupA,
      page: `/groups/${ledger.groupA}`,
      method: 'POST',
      path: `/api/groups/${ledger.groupA}/expenses`,
    }),
    open: async (page: Page) => {
      await page.getByRole('button', { name: 'Add expense' }).last().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('What was it for?').fill('Stale tab groceries');
      await dialog.getByLabel('Amount').fill('321.00');
      await expect(dialog.getByText(/^You paid/)).toBeVisible(); // the page's account pays
      return dialog.getByRole('button', { name: 'Save expense', exact: true });
    },
  },
  {
    name: 'edit Alex’s Expense',
    prepare: async (ledger) => ({
      group: ledger.groupA,
      page: `/groups/${ledger.groupA}`,
      method: 'PATCH',
      path: expensePath(ledger.groupA, ledger.expenseA),
    }),
    open: async (page: Page) => {
      const row = page.getByRole('button', { name: /Private rent, ₹1,200\.00/ });
      await row.getByLabel('Expense actions').click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('What was it for?').fill('Edited from a stale tab');
      return dialog.getByRole('button', { name: 'Save changes', exact: true });
    },
  },
  {
    name: 'record a settlement from Alex to Sam',
    prepare: async (ledger) => ({
      group: ledger.groupA,
      page: `/groups/${ledger.groupA}?tab=balances`,
      method: 'POST',
      path: `/api/groups/${ledger.groupA}/settlements`,
    }),
    open: async (page: Page) => {
      await page.getByRole('button', { name: 'Record settlement', exact: true }).click();
      const dialog = page.getByRole('dialog').filter({
        has: page.getByRole('heading', { name: 'Record settlement', exact: true }),
      });
      await expect(dialog.getByRole('spinbutton', { name: 'Amount' })).toHaveValue('300');
      return dialog.getByRole('button', { name: 'Save settlement', exact: true });
    },
  },
  {
    name: 'leave a Group',
    // A Group Sam could really leave (settled up, and Alex stays its admin), so a
    // leave sent with Sam's session would succeed unless the server refuses it.
    prepare: async (ledger) => {
      const created = await dataOf(
        await ledger.alex.post('/api/groups', {
          data: { name: 'Synthetic leave household', category: 'other', defaultCurrency: 'INR' },
        }),
        201,
      );
      await joinGroup(ledger.alex, ledger.sam, created._id);
      return {
        group: created._id,
        page: `/groups/${created._id}/settings`,
        method: 'POST',
        path: `/api/groups/${created._id}/leave`,
      };
    },
    open: async (page: Page) => {
      await page.getByRole('button', { name: 'Leave Group' }).click();
      const dialog = page.getByRole('dialog', { name: /^Leave/ });
      return dialog.getByRole('button', { name: 'Leave Group' });
    },
    stillPossible: async (ledger, group) => {
      expect(await dataOf(await ledger.sam.post(`/api/groups/${group}/leave`))).toEqual({
        message: 'Left group',
        archived: false,
      });
    },
  },
];

for (const write of writes) {
  test(`stale sign-in path, write: ${write.name} from an open dialog is answered 419 and records nothing`, async ({
    page,
    ledger,
  }) => {
    await page.clock.install();
    const { api, switchToSam } = await staleSignIn(page, ledger, { passDuplicateCheck: true });
    const { group, page: start, method, path } = await write.prepare(ledger);
    await page.goto(appURL(start));
    const save = await write.open(page);
    await expect(save).toBeEnabled();
    const lastAlexDocument = api.document;
    const before = await ledgerSnapshot(ledger, group);
    const dialogFeedback = await watchCurrentDocument(page, [
      { within: '[role="dialog"] [role="alert"]' },
    ]);
    // Hold every timer, so no poll or focus refetch notices the switch before the save does.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
    await switchToSam();
    await save.click();
    await waitForReload(api, lastAlexDocument);
    await page.clock.resume();

    expect(
      (api.answers.get(lastAlexDocument) ?? []).filter(
        (answer) => answer.method === method && answer.path === path,
      ),
    ).toEqual([{ method, path, status: 419, code: 'ACCOUNT_CHANGED', data: false }]);
    expect(await ledgerSnapshot(ledger, group)).toEqual(before);
    await expectFreshPageForSam(page);
    expect(dialogFeedback).toEqual([]);
    expectOnlyAlexRequests(api, lastAlexDocument);
    await write.stillPossible?.(ledger, group);
  });
}
