import { expect, test, type Page } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  openNavigation,
  reviewScreenshot,
} from './fixtures';

/**
 * The Group page (#305): the header from the design canvas, and tabs that are links with their
 * own addresses, so Back, reload and old links all land on the right tab. Everything here only
 * reads the seeded trip, so it runs in any order with the other journeys.
 */

const GROUP = `/groups/${DEMO_GROUP_ID}`;

const sections = (page: Page) =>
  page.getByRole('main').getByRole('navigation', { name: `${DEMO_TRIP_NAME} sections` });

/** The tab the page shows: its link is the only one marked current, and the address is its own. */
async function expectTab(page: Page, label: string, slug: string) {
  await page.waitForURL((url) => url.pathname === `${GROUP}/${slug}`);
  await expect(sections(page).getByRole('link', { name: label, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sections(page).locator('[aria-current]')).toHaveCount(1);
}

/** What each tab shows of the seeded trip once it has loaded. */
const TABS = [
  { label: 'Expenses', slug: 'expenses', shows: 'Trip SIM cards' },
  { label: 'Balances', slug: 'balances', shows: 'Record payment' },
  { label: 'Activity', slug: 'activity', shows: 'Trip SIM cards' },
  { label: 'Members', slug: 'members', shows: 'Priya Shah' },
] as const;

test('the header shows the Group’s icon, name, Theme, members, currency, Invite and settings', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  // From the shell's Group list, the Group opens on Expenses.
  const navigation = await openNavigation(page);
  await navigation
    .getByRole('navigation', { name: 'Your Groups' })
    .getByRole('link', { name: new RegExp(`^${DEMO_TRIP_NAME} `) })
    .click();
  await expectTab(page, 'Expenses', 'expenses');
  await expectThemeApplied(page, testInfo);

  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: DEMO_TRIP_NAME })).toBeVisible();
  await expect(main.locator('[data-group-theme="trip"]')).toBeVisible();
  await expect(main.getByText('Trip · 3 members · INR', { exact: true })).toBeVisible();
  await expect(
    main.getByRole('img', { name: 'Members: you, Sam Chen and Priya Shah' }),
  ).toBeVisible();
  await expect(main.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: `${DEMO_TRIP_NAME} settings` })).toHaveAttribute(
    'href',
    `${GROUP}/settings`,
  );
  // The shell's navigation replaces the old "← Dashboard" link.
  await expect(main.getByRole('link', { name: /Dashboard/ })).toHaveCount(0);
  // A Trip keeps its boarding-pass strip and setup checklist above the tabs.
  await expect(
    main.getByRole('region', { name: new RegExp(`^${DEMO_TRIP_NAME} trip,`) }),
  ).toBeVisible();
  await expect(sections(page).getByRole('link')).toHaveText([
    'Expenses',
    'Balances',
    'Activity',
    'Members',
  ]);
  await reviewScreenshot(page, testInfo, 'group-header');
});

test('each tab is a link with its own address; Back, Forward and reload land on the right tab', async ({
  page,
}) => {
  await enterAsPersona(page, 'alex');
  await page.goto(GROUP);
  await expectTab(page, 'Expenses', 'expenses');
  const main = page.getByRole('main');
  await expect(main.getByText(TABS[0].shows).first()).toBeVisible({ timeout: 30_000 });

  for (const { label, slug, shows } of TABS.slice(1)) {
    await sections(page).getByRole('link', { name: label, exact: true }).click();
    await expectTab(page, label, slug);
    // The local suite runs `next dev`, which may still be compiling the tab's reads.
    await expect(main.getByText(shows).first()).toBeVisible({ timeout: 30_000 });
  }

  // Back walks the tabs in reverse, each with its own content.
  for (const { label, slug, shows } of [...TABS].reverse().slice(1)) {
    await page.goBack();
    await expectTab(page, label, slug);
    await expect(main.getByText(shows).first()).toBeVisible();
  }
  await page.goForward();
  await expectTab(page, 'Balances', 'balances');

  // A reload, or the address opened afresh (a shared link), stays on the tab.
  await page.reload();
  await expectTab(page, 'Balances', 'balances');
  await expect(main.getByRole('heading', { name: 'Settle up' })).toBeVisible();
  await page.goto(`${GROUP}/members`);
  await expectTab(page, 'Members', 'members');
});

test('the old ?tab=balances and ?action=add-expense links still open the right place', async ({
  page,
}) => {
  await enterAsPersona(page, 'alex');
  const main = page.getByRole('main');

  await page.goto(`${GROUP}?tab=balances`);
  await expectTab(page, 'Balances', 'balances');
  expect(new URL(page.url()).search).toBe('');
  await expect(main.getByRole('heading', { name: 'Settle up' })).toBeVisible({ timeout: 30_000 });

  await page.goto(`${GROUP}?action=add-expense`);
  await page.waitForURL((url) => url.pathname === `${GROUP}/expenses`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Add expense')).toBeVisible({ timeout: 30_000 });
  // The form opens once: the address drops the request, so reloading doesn't reopen it.
  await expect.poll(() => new URL(page.url()).search).toBe('');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expectTab(page, 'Expenses', 'expenses');
  await page.reload();
  await expectTab(page, 'Expenses', 'expenses');
  await expect(main.getByText('Trip SIM cards').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Members lists everyone by name with their role, never an email, and Invite opens the invite flow', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  await page.goto(`${GROUP}/members`);
  await expectThemeApplied(page, testInfo);
  const main = page.getByRole('main');
  const roster = main.getByRole('region', { name: /^Members/ });

  await expect(roster.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveText([
    /Alex Rivera \(you\)\s*Admin$/,
    /Sam Chen\s*Member$/,
    /Priya Shah\s*Member$/,
  ]);
  // Names only: no member's email anywhere on the page.
  await expect(main).not.toContainText('@');
  // Role changes and leaving stay in Group settings, which an admin is pointed to.
  await expect(roster.getByRole('link', { name: 'Group settings' })).toHaveAttribute(
    'href',
    `${GROUP}/settings`,
  );
  await expect(roster.getByRole('button')).toHaveText(['Invite']);

  await roster.getByRole('button', { name: 'Invite', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Invite Members' });
  await expect(invite).toBeVisible();
  await invite.getByRole('button', { name: 'Close invite dialog' }).click();
  await expect(invite).toHaveCount(0);
  await reviewScreenshot(page, testInfo, 'group-members');
});

// The Expenses tab is checked whole, its rows and summary included (#310).
test('every tab passes axe', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  for (const { label, slug, shows } of TABS) {
    await page.goto(`${GROUP}/${slug}`);
    await expectTab(page, label, slug);
    await expectThemeApplied(page, testInfo);
    await expect(page.getByRole('main').getByText(shows).first()).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(page, testInfo, `group-${slug}`);
  }
});
