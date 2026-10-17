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

async function enterAsSam(page: Page, ledger: Ledger, path: string) {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(appURL(path));
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
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
 * Start the Groups list's next refresh (every 30 s) and keep it in flight, unanswered, so the
 * test decides when and how it answers.
 */
async function holdNextGroupsRefresh(page: Page) {
  let held: Route | undefined;
  await page.route('**/api/groups', async (route) => {
    if (held || route.request().method() !== 'GET') return route.fallback();
    held = route;
  });
  await page.clock.runFor(31_000);
  await expect.poll(() => held !== undefined).toBe(true);
  return held!;
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

test('Sign Out lands on the landing page even when a read answers 401 after the session ends', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  await enterAsSam(page, ledger, '/groups');
  const refresh = await holdNextGroupsRefresh(page);
  const landing = await holdLandingPage(page);

  const signedOut = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/sign-out',
  );
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  expect((await signedOut).ok()).toBe(true);
  await expect.poll(landing.requested).toBe(true);

  // The session has ended, so the refresh answers as the server now would, while the page Sam
  // left is still loaded and the landing page is on its way.
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/groups' && response.status() === 401,
  );
  await refresh.fulfill({ status: 401, json: UNAUTHORIZED_BODY });
  await answered;
  landing.release();
  await expect(page).toHaveURL(appURL('/'));
});

test('a session ended elsewhere still sends the tab to sign in, back to the page it was on', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  await enterAsSam(page, ledger, '/groups');
  // Signed out from another tab of this browser: its cookie is gone here too.
  await signOutElsewhere(page);
  await page.clock.runFor(31_000);
  await expect(page).toHaveURL(appURL('/login?callbackUrl=%2Fgroups'));
});

test('a Sign Out that cannot reach the server keeps the tab, and a later ended session still goes to sign in', async ({
  page,
  ledger,
}) => {
  await page.clock.install();
  await enterAsSam(page, ledger, '/groups');
  await page.route('**/api/auth/sign-out', (route) => route.abort('internetdisconnected'));
  const unreachable = page.waitForEvent(
    'requestfailed',
    (request) => new URL(request.url()).pathname === '/api/auth/sign-out',
  );
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await unreachable;
  await expect(page).toHaveURL(appURL('/groups'));

  // Signed out from another tab later: this tab is no longer leaving, so it goes to sign in.
  await signOutElsewhere(page);
  await page.clock.runFor(31_000);
  await expect(page).toHaveURL(appURL('/login?callbackUrl=%2Fgroups'));
});
