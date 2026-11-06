import { expect, test, type Browser, type TestInfo } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { enterAsPersona, isPhone, type PersonaKey } from '../playwright/fixtures';

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

/** A persona's own signed-in page, beside the test's. */
async function personaPage(browser: Browser, testInfo: TestInfo, persona: PersonaKey) {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const page = await context.newPage();
  await enterAsPersona(page, persona);
  return page;
}

// #646: on screen the statement is an A4 sheet, 180 mm between its margins. At full screen type
// the Expenses table, with a name and an amount on each Paid by and Share line, was wider than
// that: it scrolled, the macOS scrollbar hid, and readers saw "$413" for $413.50. From the md
// breakpoint the sheet's tables take print's type and padding, so every figure shows, unscrolled.
test('on screen the statement’s tables fit the A4 sheet at 1280 and at md', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'On a phone a wide table scrolls inside the sheet.');
  await enterAsPersona(page, 'alex');
  const response = await page.request.post('/api/groups', {
    data: {
      name: 'Kerala and Singapore statement',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: ['USD'],
    },
  });
  expect(response.status()).toBe(201);
  const id = (await response.json()).data._id;
  const invite = await page.request.post(`/api/groups/${id}/invite-link`, { data: {} });
  expect(invite.status(), await invite.text()).toBe(201);
  const code = (await invite.json()).data.inviteCode;
  const sam = await personaPage(browser, testInfo, 'sam');
  const priya = await personaPage(browser, testInfo, 'priya');
  for (const member of [sam, priya]) {
    const joined = await member.request.post(`/api/join/${code}`);
    expect(joined.status(), await joined.text()).toBe(201);
  }
  // Each member pays one of each currency's equal Expenses and shares all three, and the INR
  // payment goes back the other way, so the test leaves everyone settled: later tests read the
  // personas' real balances.
  const everyone = [DEMO_PERSONA_IDS.alex, DEMO_PERSONA_IDS.sam, DEMO_PERSONA_IDS.priya];
  for (const [currency, amount, descriptions] of [
    [
      'INR',
      154000.5,
      [
        'Houseboat for the whole group, all meals and two nights on the backwaters, booked early',
        'Homestay in Munnar, three rooms for three nights with breakfast',
        'Kathakali tickets and the green room tour before the show',
      ],
    ],
    [
      'USD',
      1240.5,
      [
        'Singapore hotel, two nights near the river, with the late check-out',
        'Night safari tickets',
        'Chilli crab',
      ],
    ],
  ] as const) {
    for (const [index, description] of descriptions.entries()) {
      const expense = await page.request.post(`/api/groups/${id}/expenses`, {
        data: {
          description,
          date: '2026-09-15',
          amount,
          currency,
          category: 'food',
          tag: 'General',
          paidBy: [{ user: everyone[index], amount }],
          splitMethod: 'equal',
          splitBetween: everyone.map((user) => ({ user })),
        },
      });
      expect(expense.status(), await expense.text()).toBe(201);
    }
  }
  for (const [payer, from, to] of [
    [sam, DEMO_PERSONA_IDS.sam, DEMO_PERSONA_IDS.alex],
    [page, DEMO_PERSONA_IDS.alex, DEMO_PERSONA_IDS.sam],
  ] as const) {
    const payment = await payer.request.post(`/api/groups/${id}/settlements`, {
      data: {
        paidBy: from,
        paidTo: to,
        amount: 25000,
        currency: 'INR',
        note: 'Houseboat, my part',
      },
      headers: {
        'Idempotency-Key': `statement-screen-${from}-${testInfo.project.name}-${Date.now()}`,
      },
    });
    expect(payment.status(), await payment.text()).toBe(201);
  }
  await Promise.all([sam.context().close(), priya.context().close()]);

  // 1280, a laptop's screen; 900, MUI's md, where the sheet takes its 15 mm margins.
  for (const width of [1280, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/groups/${id}/statement?tz=Asia%2FKolkata`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Kerala and Singapore statement · Statement',
    );
    await expect(page.locator('.statement-paper')).toContainText('₹51,333.50');
    await page.evaluate(() => document.fonts.ready);
    const tables = await page.locator('.statement-paper').evaluate((paper) =>
      [...paper.querySelectorAll('section[aria-label$=" statement"]')].flatMap((section) =>
        [...section.querySelectorAll('.statement-table-region')].map((region) => {
          const right = region.getBoundingClientRect().right;
          return {
            table: `${section.getAttribute('aria-label')}: ${region.getAttribute('aria-label')}`,
            scrolls: region.scrollWidth > region.clientWidth,
            // A figure past the region's edge is cut off however the region scrolls.
            cut: [...region.querySelectorAll('.statement-amount')].filter(
              (amount) => amount.getBoundingClientRect().right > right + 0.5,
            ).length,
          };
        }),
      ),
    );
    // Two currencies, each with contributions, balances, Expenses and (INR) payments.
    expect(tables.length, `${width}px`).toBe(7);
    expect(
      tables.filter((table) => table.scrolls || table.cut),
      `${width}px`,
    ).toEqual([]);
  }
});
