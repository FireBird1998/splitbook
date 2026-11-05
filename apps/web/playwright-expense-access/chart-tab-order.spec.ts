import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, type Ledger } from './fixtures';

// #881: each chart sits in an aria-hidden box, and its table carries the numbers. Chromium let
// Tab reach the chart's svg, because it clips, so a screen reader user met an empty Tab stop.
// Tab now goes from the control before the chart straight to the one after it.

/** A Group of Alex's alone, of the given Theme, with one Expense of his today. */
async function groupWithSpending(ledger: Ledger, category: 'home' | 'trip') {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Charts ${randomUUID().slice(0, 8)}`,
          category,
          defaultCurrency: 'INR',
          alternateCurrencies: [],
        },
      }),
      201,
    )
  )._id as string;
  await dataOf(
    await ledger.alex.post(`/api/groups/${group}/expenses`, {
      data: {
        description: 'Groceries',
        amount: 1840,
        currency: 'INR',
        category: 'food',
        tag: category === 'trip' ? 'Food' : 'Groceries',
        date: new Date().toISOString(),
        paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 1840 }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
      },
    }),
    201,
  );
  return group;
}

/**
 * Marks the Tab stops either side of the chart, in document order: the last before it and the
 * first after it, leaving out the chart itself. Nothing else in the Tab order moves, so Tab goes
 * from one to the other.
 */
async function markStopsAround(chart: Locator) {
  await chart.evaluate((svg) => {
    const stops = [
      ...document.querySelectorAll<HTMLElement | SVGElement>(
        'a[href], button, input, select, textarea, [tabindex]',
      ),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        element.getClientRects().length > 0 &&
        !svg.contains(element),
    );
    const before = stops
      .filter((element) => element.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING)
      .at(-1)!;
    const after = stops.find(
      (element) => element.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_PRECEDING,
    )!;
    before.setAttribute('data-stop', 'before');
    after.setAttribute('data-stop', 'after');
  });
}

async function expectTabSkipsChart(page: Page, chart: Locator) {
  await expect(chart).toBeVisible();
  await markStopsAround(chart);
  const before = page.locator('[data-stop="before"]');
  await before.scrollIntoViewIfNeeded();
  await before.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(before).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(chart).not.toBeFocused();
  await expect(page.locator('[data-stop="after"]')).toBeFocused();
  // And back the other way.
  await page.keyboard.press('Shift+Tab');
  await expect(before).toBeFocused();
  const axe = await new AxeBuilder({ page }).withRules(['aria-hidden-focus']).analyze();
  expect(axe.violations).toEqual([]);
}

async function signIn(page: Page, ledger: Ledger, path: string) {
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}${path}`);
}

test('Tab skips the Insights chart (#881)', async ({ page, ledger }) => {
  await signIn(page, ledger, `/groups/${await groupWithSpending(ledger, 'home')}?tab=insights`);
  await expectTabSkipsChart(
    page,
    page.getByTestId('monthly-columns').locator('svg.MuiChartsSurface-root'),
  );
});

test('Tab skips the Trip summary’s day chart (#881)', async ({ page, ledger }) => {
  await signIn(page, ledger, `/groups/${await groupWithSpending(ledger, 'trip')}?tab=insights`);
  await expectTabSkipsChart(
    page,
    page.getByTestId('trip-day-columns').locator('svg.MuiChartsSurface-root'),
  );
});

test('Tab skips the Home spending chart (#881)', async ({ page, ledger }) => {
  await groupWithSpending(ledger, 'home');
  await signIn(page, ledger, '/dashboard');
  await expectTabSkipsChart(
    page,
    page.getByTestId('spending-columns').locator('svg.MuiChartsSurface-root'),
  );
});
