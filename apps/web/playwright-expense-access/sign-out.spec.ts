import type { Page, Route } from '@playwright/test';
import { test, expect, type Ledger } from './fixtures';
import { UNAUTHORIZED_BODY } from '../src/lib/auth/proxy-rules';

/**
 * Signing out against reads still running on the page it leaves (#476). Sign Out goes to the
 * landing page; a read that answers 401 because the session ended must not send the tab to
 * /login instead. Any other ended session still does.
 */

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  return `${origin}${path}`;
}

/** Sam on `path`, once the shell shows `ready`: the account menu, or on a phone the drawer's button. */
async function enterAsSam(page: Page, ledger: Ledger, path: string, ready = 'Account menu') {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(appURL(path));
  await expect(page.getByRole('button', { name: ready })).toBeVisible();
}

/** Open the phone's navigation drawer. A click that lands before the page hydrates does nothing. */
async function openDrawer(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Navigation menu' });
  await expect(async () => {
    if (!(await drawer.isVisible()))
      await page.getByRole('button', { name: 'Open navigation menu' }).click({ timeout: 1_000 });
    await expect(drawer).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return drawer;
}

/** Sign Sam out from outside this tab, as another tab of the same browser would. */
async function signOutElsewhere(page: Page) {
  const response = await page.request.post(appURL('/api/auth/sign-out'), {
    headers: { Origin: appURL('') },
    data: {},
  });
  expect(response.status(), await response.text()).toBe(200);
}

/**
 * Run the page clock 31 s at a time until `done`. The Groups list arms its 30 s refresh only once
 * its last read has settled, so a single jump can land before the timer exists.
 */
async function runClockUntil(page: Page, done: () => boolean) {
  await expect(async () => {
    if (!done()) await page.clock.runFor(31_000);
    expect(done()).toBe(true);
  }).toPass({ timeout: 10_000 });
}

/**
 * Start the Groups list's next refresh (every 30 s) and keep it in flight, unanswered, so the
 * test decides when and how it answers. `settled` resolves with the status the read got, or why it
 * failed, such as the page leaving; it listens from the moment the read is held (#576).
 */
async function holdNextGroupsRefresh(page: Page) {
  let held: Route | undefined;
  await page.route('**/api/groups', async (route) => {
    if (held || route.request().method() !== 'GET') return route.fallback();
    held = route;
  });
  await runClockUntil(page, () => held !== undefined);
  const read = held!.request();
  const settled = Promise.race([
    page
      .waitForResponse((response) => response.request() === read, { timeout: 0 })
      .then((response) => response.status()),
    page
      .waitForEvent('requestfailed', { predicate: (request) => request === read, timeout: 0 })
      .then((request) => `failed: ${request.failure()?.errorText}`),
  ]);
  // A test that fails before it awaits this still ends without a stray rejection.
  void settled.catch(() => {});
  return { route: held!, settled };
}

/** Errors the page raised and left unhandled, such as a rejected Sign Out nobody caught. */
function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Make Sign Out unreachable, as offline; `failed` resolves once its request has failed. */
async function signOutUnreachable(page: Page) {
  await page.route('**/api/auth/sign-out', (route) => route.abort('internetdisconnected'));
  const failed = page.waitForEvent(
    'requestfailed',
    (request) => new URL(request.url()).pathname === '/api/auth/sign-out',
  );
  return { failed };
}

/**
 * Make the server refuse Sign Out, as when it couldn't end the session (SESSION_NOT_ENDED):
 * Sam is still signed in. `answered` resolves with the refusal.
 */
async function signOutRefused(page: Page) {
  await page.route('**/api/auth/sign-out', (route) =>
    route.fulfill({
      status: 500,
      json: {
        code: 'SESSION_NOT_ENDED',
        message: 'The session could not be ended. Try signing out again.',
      },
    }),
  );
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/sign-out',
  );
  return { answered };
}

/**
 * Sam's session ends in another tab of this browser: this tab, still on the Groups list and in its
 * account, goes to sign in, back to that list, when a read answers 401 or its session check reloads.
 */
async function endedElsewhereGoesToSignIn(page: Page) {
  await signOutElsewhere(page);
  const signIn = appURL('/login?callbackUrl=%2Fgroups');
  await runClockUntil(page, () => page.url() === signIn);
  await expect(page).toHaveURL(signIn);
}

/** What Sam is told when Sign Out can't reach the server (#536), or the server refuses it (#550). */
const UNREACHABLE = 'Couldn’t sign out. Check your connection and try again.';
const REFUSED = 'Couldn’t sign out. Try again.';

/**
 * Sam is told Sign Out didn't end the session: announced politely by the status region, and shown
 * in the notice, so the words are on the page twice.
 */
async function expectToldSignOutFailed(page: Page, message: string) {
  await expect(page.getByRole('status').filter({ hasText: message })).toHaveText(message);
  await expect(page.getByText(message)).toHaveCount(2);
}

/** Hold the landing page's document, as a slow server or network would, until released. */
async function holdLandingPage(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(appURL('/'), async (route) => {
    requested = true;
    await released;
    // A navigation that replaced this one has already cancelled it.
    await route.continue().catch(() => {});
  });
  return { release, requested: () => requested };
}

/** The app's writes the page sends from now on: method and path, never through Better Auth. */
function appWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (
      request.method() !== 'GET' &&
      pathname.startsWith('/api/') &&
      !pathname.startsWith('/api/auth/')
    )
      writes.push(`${request.method()} ${pathname}`);
  });
  return writes;
}

test('Sign Out lands on the landing page even when a read answers 401 after the session ends', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  await enterAsSam(page, ledger, '/groups');
  const refresh = await holdNextGroupsRefresh(page);
  const landing = await holdLandingPage(page);
  const writes = appWrites(page);

  const signedOut = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/sign-out',
  );
  await page.getByRole('button', { name: 'Account menu' }).click();
  // Not awaited until the landing page is let through: a click waits for a navigation the page
  // asks for while it is finishing, and when the sign-out answers quickly, that is the landing
  // page this test holds (#576).
  const signingOut = page.getByRole('menuitem', { name: 'Sign Out' }).click();
  void signingOut.catch(() => {});
  expect((await signedOut).ok()).toBe(true);
  await expect.poll(landing.requested).toBe(true);

  // The session has ended, so the refresh answers as the server now would, while the page Sam
  // left is still loaded and the landing page is on its way. The held read either gets that
  // answer or fails because the page left: only the answer is right while the landing page waits.
  await refresh.route.fulfill({ status: 401, json: UNAUTHORIZED_BODY });
  expect(await refresh.settled).toBe(401);
  landing.release();
  await signingOut;
  // The landing page loads in its own time once let through: 30 s, as settlement-attempt's
  // Sign Out test allows.
  await expect(page).toHaveURL(appURL('/'), { timeout: 30_000 });
  // The tab Sam left saved nothing, under his account or any other.
  expect(writes).toEqual([]);
});

test('a session ended elsewhere still sends the tab to sign in, back to the page it was on', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  await enterAsSam(page, ledger, '/groups');
  // Signed out from another tab of this browser: its cookie is gone here too.
  await endedElsewhereGoesToSignIn(page);
});

test('a Sign Out that cannot reach the server keeps the tab, and a later ended session still goes to sign in', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  await enterAsSam(page, ledger, '/groups');
  const errors = pageErrors(page);
  const unreachable = await signOutUnreachable(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await unreachable.failed;
  // Sam is told, and stays signed in on the page, with nothing left unhandled (#536).
  await expectToldSignOutFailed(page, UNREACHABLE);
  await expect(page).toHaveURL(appURL('/groups'));
  expect(errors).toEqual([]);

  // Signed out from another tab later: this tab is no longer leaving, so it goes to sign in.
  await endedElsewhereGoesToSignIn(page);
});

test('a Sign Out the server refuses keeps the tab signed in and says so (#550)', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  await enterAsSam(page, ledger, '/groups');
  const errors = pageErrors(page);
  const refused = await signOutRefused(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  expect((await refused.answered).status()).toBe(500);
  await expectToldSignOutFailed(page, REFUSED);
  await expect(page).toHaveURL(appURL('/groups'));
  expect(errors).toEqual([]);

  // The tab stayed, in its account: a session ended later still sends it to sign in, from here.
  await endedElsewhereGoesToSignIn(page);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a Sign Out from the drawer that cannot reach the server still says so once the drawer closes (#566)', async ({
    page,
    ledger,
  }) => {
    await page.clock.install();
    await enterAsSam(page, ledger, '/groups', 'Open navigation menu');
    const errors = pageErrors(page);
    const unreachable = await signOutUnreachable(page);
    const drawer = await openDrawer(page);
    await drawer.getByRole('button', { name: 'Account menu' }).click();
    // From here the notice's 6 s run only as the test says.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
    await page.getByRole('menuitem', { name: 'Sign Out' }).click();
    await unreachable.failed;
    // The open drawer hides the page from assistive technology, so it announces the failure.
    await expect(drawer.getByRole('status')).toHaveText(UNREACHABLE);
    // The account menu finishes closing, its backdrop with it.
    await page.clock.runFor(500);

    // The drawer closes, and with it everything inside it; the notice was never in it.
    await drawer.getByRole('button', { name: 'Close navigation menu' }).click();
    await page.clock.runFor(1_000);
    await expect(drawer).toHaveCount(0);
    await expectToldSignOutFailed(page, UNREACHABLE);
    await expect(page).toHaveURL(appURL('/groups'));

    // It leaves after its own 6 s, as on a desktop, and the Snackbar then slides away.
    await page.clock.runFor(6_000);
    await expect(page.getByRole('status').filter({ hasText: UNREACHABLE })).toHaveCount(0);
    await page.clock.runFor(1_000);
    await expect(page.getByText(UNREACHABLE)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test('a Sign Out from Settings that cannot reach the server says so and keeps the page (#536)', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  await enterAsSam(page, ledger, '/settings');
  const errors = pageErrors(page);
  const unreachable = await signOutUnreachable(page);
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await unreachable.failed;
  await expectToldSignOutFailed(page, UNREACHABLE);
  await expect(page).toHaveURL(appURL('/settings'));
  expect(errors).toEqual([]);
});
