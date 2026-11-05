import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { DEMO_PERSONA_IDS, DEMO_PERSONAS } from '../src/lib/demo-personas';
import { SEARCH_LABEL } from '../src/components/search/search-label';
import { test, expect, dataOf, joinGroup, openAddExpense, type Ledger } from './fixtures';

// #834: controls built on a bare ButtonBase draw the theme's keyboard focus ring, and a mouse
// click draws none. Where a parent clips, the ring is drawn inside the control instead, without
// its halo. #848: the pager and charts draw it too; checkboxes, radios and switches draw it inside,
// clear of the label beside them.

const SAM = DEMO_PERSONAS.find((persona) => persona.key === 'sam')!.name;

/** A Group in euros and rupees where Alex owes Sam in one and Sam owes Alex in the other. */
async function twoCurrencyGroup(ledger: Ledger) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Focus ${randomUUID().slice(0, 8)}`,
          category: 'trip',
          defaultCurrency: 'EUR',
          alternateCurrencies: ['INR'],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  const dinner = (payer: 'alex' | 'sam', owes: 'alex' | 'sam', amount: number, currency: string) =>
    ledger[payer].post(`/api/groups/${group}/expenses`, {
      data: {
        description: `Dinner in ${currency}`,
        amount,
        currency,
        category: 'food',
        tag: 'Food',
        date: new Date().toISOString(),
        paidBy: [{ user: DEMO_PERSONA_IDS[payer], amount }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS[owes] }],
      },
    });
  await dataOf(await dinner('sam', 'alex', 40, 'EUR'), 201);
  await dataOf(await dinner('alex', 'sam', 900, 'INR'), 201);
  // A payment in another currency, so Activity has a row that opens its card (#727).
  await dataOf(
    await ledger.alex.post(`/api/groups/${group}/settlements`, {
      data: {
        paidTo: DEMO_PERSONA_IDS.sam,
        amount: 10,
        currency: 'EUR',
        amountPaidMinor: 90000,
        paidCurrency: 'INR',
        appliedRate: '90',
        rateKind: 'entered',
      },
    }),
    201,
  );
  return group;
}

/** A Trip in five currencies, each with a balance and spending, so its tabs fill a phone's row. */
async function fiveCurrencyTrip(ledger: Ledger) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Five currencies ${randomUUID().slice(0, 8)}`,
          category: 'trip',
          defaultCurrency: 'EUR',
          alternateCurrencies: ['INR', 'USD', 'GBP', 'JPY'],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  for (const [payer, owes, amount, currency] of [
    ['sam', 'alex', 1842.5, 'EUR'],
    ['alex', 'sam', 18425, 'INR'],
    ['sam', 'alex', 1260.75, 'USD'],
    ['alex', 'sam', 940.2, 'GBP'],
    ['sam', 'alex', 184250, 'JPY'],
  ] as const)
    await dataOf(
      await ledger[payer].post(`/api/groups/${group}/expenses`, {
        data: {
          description: `Hotel in ${currency}`,
          amount,
          currency,
          category: 'housing',
          tag: 'Stay',
          date: new Date().toISOString(),
          paidBy: [{ user: DEMO_PERSONA_IDS[payer], amount }],
          splitMethod: 'equal',
          splitBetween: [{ user: DEMO_PERSONA_IDS[owes] }],
        },
      }),
      201,
    );
  return group;
}

/** A Group with one more Expense than the Expenses list shows a page (50), so it has a pager. */
async function twoPageGroup(ledger: Ledger) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Pager ${randomUUID().slice(0, 8)}`,
          category: 'home',
          defaultCurrency: 'INR',
          alternateCurrencies: [],
        },
      }),
      201,
    )
  )._id as string;
  for (let i = 1; i <= 51; i++)
    await dataOf(
      await ledger.alex.post(`/api/groups/${group}/expenses`, {
        data: {
          description: `Groceries ${i}`,
          amount: 100 + i,
          currency: 'INR',
          category: 'food',
          tag: 'Groceries',
          date: new Date().toISOString(),
          paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 100 + i }],
          splitMethod: 'equal',
          splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
        },
      }),
      201,
    );
  return group;
}

async function signIn(page: Page, ledger: Ledger, path: string) {
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}${path}`);
}

/** The first ancestor whose padding box cuts off the control's box grown by `reach` px, if any. */
function clippedBy(control: Locator, reach: number) {
  return control.evaluate((element, reach) => {
    const box = element.getBoundingClientRect();
    for (
      let node = element.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const edge = node.getBoundingClientRect();
      const top = edge.top + node.clientTop;
      const left = edge.left + node.clientLeft;
      if (
        box.top - reach < top ||
        box.left - reach < left ||
        box.right + reach > left + node.clientWidth ||
        box.bottom + reach > top + node.clientHeight
      )
        return `${node.tagName.toLowerCase()}.${node.className}`;
    }
    return null;
  }, reach);
}

/**
 * How the currency tabs sit in their switch: the rows they wrap to, the rows their widths allow
 * across the switch's full width, the first tab's offset from the switch's edge, and how far the
 * tablist's box reaches past its tabs. Room for the ring mustn't take any of that (#834).
 */
function tabLayout(tablist: Locator) {
  return tablist.evaluate((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')].map((tab) =>
      tab.getBoundingClientRect(),
    );
    const switchRow = list.closest('.MuiTabs-root')!.parentElement!;
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    let allowed = 1;
    let used = 0;
    for (const tab of tabs) {
      if (used > 0 && used + gap + tab.width > switchRow.clientWidth) {
        allowed += 1;
        used = tab.width;
      } else used += used > 0 ? gap + tab.width : tab.width;
    }
    const box = list.getBoundingClientRect();
    return {
      rows: new Set(tabs.map((tab) => Math.round(tab.top))).size,
      allowed,
      fromSwitchEdge: Math.round(tabs[0]!.left - switchRow.getBoundingClientRect().left),
      tablistPastTabs: {
        top: Math.round(tabs[0]!.top - box.top),
        left: Math.round(tabs[0]!.left - box.left),
      },
    };
  });
}

/** The theme's focus.main, as the browser writes a colour. */
async function focusMain(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--mui-palette-focus-main)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
}

/**
 * Where the ring's element and the elements beside it sit in their parent, and the parent's size:
 * what would move if the ring took room. Relative to the parent, so the page scrolling or
 * something above it settling doesn't count.
 */
function layoutAround(ring: Locator) {
  return ring.evaluate((element) => {
    const parent = element.parentElement!.getBoundingClientRect();
    return [
      element,
      element.previousElementSibling,
      element.nextElementSibling,
      element.parentElement,
    ].map((node) => {
      if (!node) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x: x - parent.x, y: y - parent.y, width, height };
    });
  });
}

/** How far past the label's start the ring reaches, from its outline: 0 or less is clear of it. */
function ringIntoLabel(ring: Locator) {
  return ring.evaluate((element) => {
    const label = element.closest('label')!.querySelector('.MuiFormControlLabel-label')!;
    const style = getComputedStyle(element);
    const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
    return element.getBoundingClientRect().right + reach - label.getBoundingClientRect().left;
  });
}

/**
 * Pressed with the mouse and let go elsewhere, so it takes focus without acting, the control
 * draws no ring; Tabbed back to, it draws the theme's ring in focus.main: outside it with the
 * halo, or inside it without, where a parent clips. `ring` is the element that draws it, when
 * that isn't the control that takes focus (a checkbox's input, a switch's). Nothing around the
 * ring moves when it shows (#848).
 */
async function expectKeyboardRingOnly(
  page: Page,
  control: Locator,
  { inset = false, ring = control }: { inset?: boolean; ring?: Locator } = {},
) {
  await control.scrollIntoViewIfNeeded();
  const before = await layoutAround(ring);
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(control).toBeFocused();
  await expect(ring).toHaveCSS('outline-style', 'none');
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  await expect(ring).toHaveCSS('outline-style', 'solid');
  await expect(ring).toHaveCSS('outline-width', '2px');
  await expect(ring).toHaveCSS('outline-color', await focusMain(page));
  await expect(ring).toHaveCSS('outline-offset', inset ? '-2px' : '2px');
  await expect(ring).toHaveCSS('box-shadow', inset ? 'none' : /0px 0px 0px 4px/);
  // An outer ring reaches 4px past the control; an inset one stays inside it.
  expect(await clippedBy(ring, inset ? 0 : 4)).toBeNull();
  expect(await layoutAround(ring)).toEqual(before);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test('the Expenses toolbar filter pills (#834)', async ({ page, ledger }) => {
      await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}`);
      const pills = page.getByRole('search', { name: /^Find Expenses in / }).getByRole('button');
      await expect(pills.first()).toBeVisible();
      for (const pill of await pills.all()) await expectKeyboardRingOnly(page, pill);
    });

    test('the search launcher (#834)', async ({ page, ledger }) => {
      await signIn(page, ledger, '/dashboard');
      const launcher = page
        .getByRole('button', { name: SEARCH_LABEL })
        .filter({ visible: true })
        .first();
      await expectKeyboardRingOnly(page, launcher);
    });

    test('an Activity payment row (#834)', async ({ page, ledger }) => {
      await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}?tab=activity`);
      const row = page.locator('button[aria-expanded]').filter({ hasText: SAM }).first();
      await expect(row).toBeVisible();
      await expectKeyboardRingOnly(page, row);
    });

    test('the Group chooser’s choices (#834)', async ({ page, ledger }) => {
      await twoCurrencyGroup(ledger);
      await signIn(page, ledger, '/dashboard');
      await page
        .getByRole('button', { name: /^Add expense/ })
        .first()
        .click();
      const choices = page.getByRole('dialog').getByRole('listitem').getByRole('button');
      await expect(choices.first()).toBeVisible();
      await expectKeyboardRingOnly(page, choices.first());
      await expectKeyboardRingOnly(page, choices.last());
    });

    test('Quick add’s payer menu chip and split chip (#834)', async ({ page, ledger }) => {
      await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}`);
      await page.getByRole('textbox', { name: 'Quick add', exact: true }).fill('Lunch 24');
      const read = page.getByRole('list', { name: 'How Splitbook reads it' });
      await expectKeyboardRingOnly(page, read.locator('[aria-haspopup="menu"]').first());
      await expectKeyboardRingOnly(page, read.locator('[aria-haspopup="dialog"]').first());
    });

    test('the selected currency tab on Balances, its ring outside its selected border (#834)', async ({
      page,
      ledger,
    }) => {
      await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}?tab=balances`);
      const selected = page
        .getByRole('tablist', { name: 'Balances in' })
        .getByRole('tab', { selected: true });
      await expect(selected).toBeVisible();
      // Its border is primary.main, as focus.main is in light, so the ring has to sit outside it.
      await expectKeyboardRingOnly(page, selected);
    });

    test.describe('on a phone', () => {
      test.use({ viewport: { width: 390, height: 844 } });

      test('an Expense card’s row, inside a Paper that clips (#834)', async ({ page, ledger }) => {
        await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}`);
        const row = page.locator('[data-expense-id] > button').first();
        await expect(row).toBeVisible();
        await expectKeyboardRingOnly(page, row, { inset: true });
      });
    });

    test('Quick pick, fixed by #830, keeps its ring whole (#834)', async ({ page, ledger }) => {
      await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}`);
      const dialog = await openAddExpense(page);
      await expectKeyboardRingOnly(page, dialog.getByRole('button', { name: /Groceries/ }));
    });

    test('the Expenses pager’s page numbers (#848)', async ({ page, ledger }) => {
      await signIn(page, ledger, `/groups/${await twoPageGroup(ledger)}`);
      const pager = page.getByRole('navigation', { name: 'pagination navigation' });
      // 51 Expenses take a moment to read.
      await expect(pager).toBeVisible({ timeout: 15_000 });
      await expectKeyboardRingOnly(page, pager.getByRole('button', { name: 'Page 1 of Expenses' }));
      await expectKeyboardRingOnly(
        page,
        pager.getByRole('button', { name: 'Go to page 2 of Expenses' }),
      );
      await expectKeyboardRingOnly(
        page,
        pager.getByRole('button', { name: 'Go to next page of Expenses' }),
      );
    });

    test('an Expenses row’s checkbox and the select-all checkbox, inside their round box (#848)', async ({
      page,
      ledger,
    }) => {
      await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}`);
      const table = page.getByRole('table');
      const rowBox = table.getByRole('checkbox', { name: /^Select Dinner in / }).first();
      await expect(rowBox).toBeVisible();
      const root = (checkbox: Locator) =>
        checkbox.locator('xpath=ancestor::span[contains(@class,"MuiCheckbox-root")][1]');
      await expectKeyboardRingOnly(page, rowBox, { ring: root(rowBox), inset: true });
      await expect(rowBox).not.toBeChecked();
      const all = table.getByRole('checkbox', { name: /^Select all / });
      await expectKeyboardRingOnly(page, all, { ring: root(all), inset: true });
      await expect(root(all)).toHaveCSS('border-radius', '50%');
    });

    test('the Settings switch, inside the whole switch and clear of its label (#848)', async ({
      page,
      ledger,
    }) => {
      await signIn(page, ledger, '/settings');
      const toggle = page.getByRole('switch', { name: 'Single-key shortcuts' });
      await expect(toggle).toBeEnabled();
      const whole = toggle.locator('xpath=ancestor::span[contains(@class,"MuiSwitch-root")][1]');
      await expectKeyboardRingOnly(page, toggle, { ring: whole, inset: true });
      expect(await ringIntoLabel(whole)).toBeLessThanOrEqual(0);
      await expect(whole).toHaveCSS('border-radius', '999px');
      await expect(toggle).toBeChecked();
    });

    test('a chart focused by script while the keyboard is in use, as with x-charts’ keyboard navigation (#848)', async ({
      page,
      ledger,
    }) => {
      await signIn(page, ledger, `/groups/${await twoCurrencyGroup(ledger)}?tab=insights`);
      // Tab skips the chart (#881), so it takes focus only from a click or a script.
      const chart = page.locator('svg.MuiChartsSurface-root').first();
      await expect(chart).toBeVisible();
      await chart.scrollIntoViewIfNeeded();
      const before = await layoutAround(chart);
      await chart.click();
      await expect(chart).toBeFocused();
      await expect(chart).toHaveCSS('outline-style', 'none');
      await expect(chart).toHaveCSS('box-shadow', 'none');
      await page.keyboard.press('Shift+Tab');
      await chart.evaluate((svg) => (svg as SVGElement).focus());
      await expect(chart).toBeFocused();
      await expect(chart).toHaveCSS('outline-style', 'solid');
      await expect(chart).toHaveCSS('outline-width', '2px');
      await expect(chart).toHaveCSS('outline-color', await focusMain(page));
      await expect(chart).toHaveCSS('outline-offset', '2px');
      await expect(chart).toHaveCSS('box-shadow', /0px 0px 0px 4px/);
      expect(await clippedBy(chart, 4)).toBeNull();
      expect(await layoutAround(chart)).toEqual(before);
    });
  });
}

// The currency tabs keep main's place: the room for their ring takes no width, so they wrap as
// the full row allows and the page below doesn't move (#834).
for (const [width, tab, label] of [
  [360, 'balances', 'Balances in'],
  [340, 'insights', 'Spending in'],
  [390, 'balances', 'Balances in'],
] as const) {
  test(`at ${width} px, the ${tab} currency tabs wrap as the full row allows, and ring (#834)`, async ({
    page,
    ledger,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await signIn(page, ledger, `/groups/${await fiveCurrencyTrip(ledger)}?tab=${tab}`);
    const tablist = page.getByRole('tablist', { name: label });
    await expect(tablist.getByRole('tab')).toHaveCount(5);
    const layout = await tabLayout(tablist);
    expect(layout.rows).toBe(layout.allowed);
    expect(layout.fromSwitchEdge).toBe(0);
    expect(layout.tablistPastTabs).toEqual({ top: 0, left: 0 });
    await expectKeyboardRingOnly(page, tablist.getByRole('tab', { selected: true }));
  });
}
