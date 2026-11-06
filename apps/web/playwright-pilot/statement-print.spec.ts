import { expect, test } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { enterAsPersona } from '../playwright/fixtures';

test('statement print uses clean A4 light colours in every theme', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  const response = await page.request.post('/api/groups', {
    data: {
      name: 'Ferry statement',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
  });
  expect(response.status()).toBe(201);
  const id = (await response.json()).data._id;
  const expense = await page.request.post(`/api/groups/${id}/expenses`, {
    data: {
      description: 'Ferry tickets',
      date: '2026-09-01',
      amount: 101.01,
      currency: 'INR',
      category: 'transport',
      tag: 'General',
      paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 101.01 }],
      splitMethod: 'equal',
      splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
    },
  });
  expect(expense.status(), await expense.text()).toBe(201);
  await page.goto(`/groups/${id}/statement?tz=Asia%2FKolkata&from=2026-09-01&to=2026-09-10`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ferry statement · Statement');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('aside')).toBeHidden();
  // The logo prints in one ink (#646): one artwork, its shapes black on a clear box. The
  // paper's background on the image would turn black with them and print a solid block.
  const logo = page.locator('.statement-logo img:visible');
  await expect(logo).toHaveCount(1);
  expect(
    await logo.evaluate((image) => {
      const style = getComputedStyle(image);
      return { background: style.backgroundColor, filter: style.filter };
    }),
  ).toEqual({ background: 'rgba(0, 0, 0, 0)', filter: 'brightness(0)' });
  await expect(page.locator('.statement-paper')).toHaveScreenshot('statement-print.png', {
    animations: 'disabled',
  });
});

/** The 180 mm between A4's 15 mm margins, at the 96 px to the inch print uses. */
const A4_CONTENT_WIDTH = Math.round((180 / 25.4) * 96);

// #646: on the A4 sheet "₹54,000.00" broke as "₹54,000. / 00" and a date as "2026-06- / 05".
// At the printed width, every figure, date and name-with-amount stays on one line, and no table
// is wider than the page (print never scrolls).
test('statement print keeps every amount and date on one line at A4 width', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  const response = await page.request.post('/api/groups', {
    data: {
      name: 'Backwaters statement',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
  });
  expect(response.status()).toBe(201);
  const id = (await response.json()).data._id;
  for (const [description, amount, date] of [
    [
      'Houseboat for the whole group, all meals and two nights on the backwaters, booked early',
      54000,
      '2026-06-05',
    ],
    ['Ferry and taxis', 7500, '2026-06-06'],
  ] as const) {
    const expense = await page.request.post(`/api/groups/${id}/expenses`, {
      data: {
        description,
        date,
        amount,
        currency: 'INR',
        category: 'transport',
        tag: 'General',
        paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
      },
    });
    expect(expense.status(), await expense.text()).toBe(201);
  }
  await page.setViewportSize({ width: A4_CONTENT_WIDTH, height: 1123 });
  await page.goto(`/groups/${id}/statement?tz=Asia%2FKolkata&from=2026-06-01&to=2026-06-30`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Backwaters statement · Statement',
  );
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('aside')).toBeHidden();
  await expect(page.locator('.statement-paper')).toContainText('₹54,000.00');

  const report = await page.locator('.statement-paper').evaluate((paper) => {
    // A piece of text is on one line when all its line boxes share a top, give or take the
    // baseline difference between Outfit and the mono figures.
    const lines = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
      if (rects.length === 0) return 1;
      const tops = rects.map((rect) => rect.top);
      const height = Math.min(...rects.map((rect) => rect.height));
      return Math.max(...tops) - Math.min(...tops) < height / 2 ? 1 : 2;
    };
    const units = [
      ...paper.querySelectorAll(
        '.statement-amount, .statement-line, .statement-when, th.statement-money, th.statement-date',
      ),
    ];
    const tables = [...paper.querySelectorAll('.statement-table-region')].map((region) => ({
      label: region.getAttribute('aria-label'),
      scrolls: region.scrollWidth > region.clientWidth + 1,
      wide: region.querySelector('table')!.getBoundingClientRect().width > paper.clientWidth + 1,
    }));
    return {
      checked: units.length,
      wrapped: units.filter((unit) => lines(unit) > 1).map((unit) => unit.textContent),
      overflowing: tables
        .filter((table) => table.scrolls || table.wide)
        .map((table) => table.label),
    };
  });
  // Paid, Share, Net and Balance, the Expenses' amounts, payers and shares, their dates, and
  // the headings: something to check, and none of it wrapped.
  expect(report.checked).toBeGreaterThan(10);
  expect(report.wrapped).toEqual([]);
  expect(report.overflowing).toEqual([]);
});
