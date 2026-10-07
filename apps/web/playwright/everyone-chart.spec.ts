import { expect, test, type Page } from '@playwright/test';
import { darkTokens, lightTokens } from '../src/lib/theme/tokens';
import { DEMO_HOUSEHOLD_ID, DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import {
  enterAsPersona,
  expectedTheme,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  isPhone,
  reviewScreenshot,
} from './fixtures';

/**
 * Balances' "Everyone" (#313) on the seeded Household: each member's all-time net as a
 * diverging bar, owed to the right and owes to the left, with a tooltip, and a Table view that
 * adds who settles with whom. Journeys elsewhere record payments in the Household, so the
 * figures are compared with the Balances read rather than assumed.
 */

interface Person {
  _id: string;
  name: string;
}
interface BalancesRead {
  currency: string;
  balances: { user: Person; balance: number }[];
  debts: { from: Person; to: Person; amount: number }[];
}

const { alex } = DEMO_PERSONA_IDS;

/** "₹1,060.00" for an amount in rupees, as the card writes it. */
const rupees = (amount: number) =>
  `₹${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (amount: number) => (amount > 0 ? `+${rupees(amount)}` : `−${rupees(amount)}`);
const firstName = (person: Person) => (person._id === alex ? 'you' : person.name.split(' ')[0]);
const shownName = (person: Person) => (person._id === alex ? 'You' : person.name);

/** "rgb(26, 154, 110)" for "#1a9a6e", as getComputedStyle reports a colour. */
function rgb(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

async function balancesRead(page: Page, groupId: string): Promise<BalancesRead> {
  const response = await page.request.get(`/api/groups/${groupId}/balances`);
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}

async function openEveryone(page: Page) {
  await page.goto(`/groups/${DEMO_HOUSEHOLD_ID}/balances`);
  const card = page.getByRole('region', { name: 'Everyone', exact: true });
  // The local suite runs `next dev`, which may still be compiling the tab's reads.
  await expect(card.getByRole('button', { name: 'Chart', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  return card;
}

test('Everyone draws each position as a diverging bar, labelled with its exact amount', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const card = await openEveryone(page);
  await expectThemeApplied(page, testInfo);
  const read = await balancesRead(page, DEMO_HOUSEHOLD_ID);
  const open = read.balances.filter((balance) => balance.balance !== 0);
  expect(open.length, 'the seed leaves the Household with open balances').toBeGreaterThan(1);

  await expect(card.getByText(`All-time net · ${read.currency}`, { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Chart', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // The bars are hidden from assistive technology, which reads the table instead.
  const chart = card.getByTestId('everyone-chart');
  await expect(chart).toHaveAttribute('aria-hidden', 'true');
  await expect(card.getByRole('table')).toHaveCount(1);

  // Owed first, largest first, owes last: each row's exact amount and its position in words.
  const expected = [...open].sort((a, b) => b.balance - a.balance);
  await expect(chart.getByTestId('everyone-amount').filter({ hasText: /[+−]/ })).toHaveText(
    expected.map(
      (balance) =>
        new RegExp(
          `^${signed(balance.balance).replace(/[+.]/g, '\\$&')}\\s*${balance.balance > 0 ? 'gets back' : 'owes'}$`,
        ),
    ),
  );

  // A bar for each open position, in the diverging tokens, either side of the zero line.
  const tokens = expectedTheme(testInfo) === 'dark' ? darkTokens : lightTokens;
  const bars = chart.getByTestId('everyone-bar');
  await expect(bars).toHaveCount(open.length);
  const drawn = await bars.evaluateAll((elements) =>
    elements.map((bar) => {
      const box = bar.getBoundingClientRect();
      const axis = bar.parentElement!.getBoundingClientRect();
      return {
        standing: bar.dataset.standing,
        color: getComputedStyle(bar).backgroundColor,
        left: box.left,
        right: box.right,
        width: box.width,
        centre: axis.left + axis.width / 2,
      };
    }),
  );
  for (const [index, bar] of drawn.entries()) {
    const owed = expected[index].balance > 0;
    expect(bar.standing).toBe(owed ? 'owed' : 'owes');
    expect(bar.color).toBe(rgb(owed ? tokens.diverging.positive : tokens.diverging.negative));
    expect(bar.width).toBeGreaterThan(0);
    if (owed) expect(bar.left).toBeGreaterThanOrEqual(bar.centre);
    else expect(bar.right).toBeLessThanOrEqual(bar.centre);
  }
  // The largest position reaches furthest.
  const largest = expected.reduce((a, b) => (Math.abs(b.balance) > Math.abs(a.balance) ? b : a));
  expect(Math.max(...drawn.map((bar) => bar.width))).toBe(drawn[expected.indexOf(largest)].width);
  await expect(chart.getByTestId('everyone-scale')).toHaveText(/^−.+0\+.+$/);

  // The page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'everyone-chart');
  await card.scrollIntoViewIfNeeded();
  await reviewScreenshot(page, testInfo, 'everyone-chart');
});

test('a bar’s tooltip says who settles with them', async ({ page }, testInfo) => {
  test.skip(isPhone(testInfo), 'Hover is a pointer gesture; phones read the table.');
  await enterAsPersona(page, 'alex');
  const card = await openEveryone(page);
  const read = await balancesRead(page, DEMO_HOUSEHOLD_ID);
  const owes = read.balances
    .filter((balance) => balance.balance < 0)
    .sort((a, b) => a.balance - b.balance)[0];
  const rows = card.getByTestId('everyone-row');
  const row = rows.filter({ hasText: shownName(owes.user) });
  await row.getByTestId('everyone-track').hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(shownName(owes.user));
  await expect(tooltip).toContainText(`${signed(owes.balance)} · owes`);
  for (const debt of read.debts.filter((entry) => entry.from._id === owes.user._id))
    await expect(tooltip).toContainText(`${firstName(debt.to)} ${rupees(debt.amount)}`);
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();
});

test('the Table view lists each position and who settles with whom', async ({ page }, testInfo) => {
  await enterAsPersona(page, 'alex');
  const card = await openEveryone(page);
  await expectThemeApplied(page, testInfo);
  const read = await balancesRead(page, DEMO_HOUSEHOLD_ID);

  await card.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card.getByTestId('everyone-chart')).toHaveCount(0);
  const table = card.getByRole('table', { name: /^Everyone’s all-time net in / });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText([
    'Member',
    'All-time net',
    'Position',
    'Settled by',
  ]);

  for (const balance of read.balances) {
    const row = table.getByRole('row').filter({
      has: page.getByRole('rowheader', { name: shownName(balance.user), exact: true }),
    });
    const cells = row.getByRole('cell');
    if (balance.balance === 0) {
      await expect(cells).toHaveText(['₹0.00', 'Settled up', /Nobody/]);
      continue;
    }
    await expect(cells.nth(0)).toHaveText(signed(balance.balance));
    await expect(cells.nth(1)).toHaveText(balance.balance > 0 ? 'Gets back' : 'Owes');
    // Settled by: the suggested payments, the same ones Settle up lists.
    const settledBy = cells.nth(2);
    if (balance.balance < 0) {
      await expect(settledBy).toHaveText(/^Pays /);
      for (const debt of read.debts.filter((entry) => entry.from._id === balance.user._id))
        await expect(settledBy).toContainText(`${firstName(debt.to)} ${rupees(debt.amount)}`);
    } else {
      await expect(settledBy).toHaveText(/^Gets /);
      for (const debt of read.debts.filter((entry) => entry.to._id === balance.user._id))
        await expect(settledBy).toContainText(
          `${rupees(debt.amount)} from ${firstName(debt.from)}`,
        );
    }
  }
  // Names only, never an email.
  await expect(table).not.toContainText('@');

  // A wide table scrolls inside the card, never the page, and takes focus to scroll by key.
  const frame = card.getByRole('region', { name: 'Everyone table' });
  await expect(frame).toHaveAttribute('tabindex', '0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await expectNoSeriousA11yViolations(page, testInfo, 'everyone-table');
  await card.scrollIntoViewIfNeeded();
  await reviewScreenshot(page, testInfo, 'everyone-table');

  await card.getByRole('button', { name: 'Chart', exact: true }).click();
  await expect(card.getByTestId('everyone-chart')).toBeVisible();
});

test('Everyone says when everyone is settled up, and recovers from a failed read', async ({
  page,
}) => {
  await enterAsPersona(page, 'alex');
  const path = `**/api/groups/${DEMO_HOUSEHOLD_ID}/balances`;
  let answer: 'settled' | 'fail' | 'real' = 'settled';
  await page.route(path, async (route) => {
    if (answer === 'real') return route.fallback();
    if (answer === 'fail')
      return route.fulfill({ status: 500, json: { error: 'Internal diagnostic' } });
    const response = await route.fetch();
    const { data } = await response.json();
    const settled = {
      ...data,
      balances: data.balances.map((balance: { user: Person }) => ({ ...balance, balance: 0 })),
      debts: [],
      byCurrency: data.byCurrency.map((bucket: BalancesRead) => ({
        ...bucket,
        balances: bucket.balances.map((balance) => ({ ...balance, balance: 0 })),
        debts: [],
      })),
    };
    await route.fulfill({ response, json: { status: 200, data: settled } });
  });

  await page.goto(`/groups/${DEMO_HOUSEHOLD_ID}/balances`);
  const card = page.getByRole('region', { name: 'Everyone', exact: true });
  await expect(card).toContainText('Everyone is settled up in INR.', { timeout: 30_000 });
  await expect(card.getByRole('button', { name: 'Chart' })).toHaveCount(0);
  await expect(card.getByRole('alert')).toHaveCount(0);

  answer = 'fail';
  await page.reload();
  const error = card.getByRole('alert');
  await expect(error).toHaveText(/Everyone’s positions could not be loaded\./, {
    timeout: 30_000,
  });
  await expect(page.getByText(/Internal diagnostic/)).toHaveCount(0);
  answer = 'real';
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(card.getByRole('button', { name: 'Chart', exact: true })).toBeVisible();
  await expect(card.getByRole('alert')).toHaveCount(0);
});
