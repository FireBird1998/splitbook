import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { buildDemoSeedPlan, daysAgoDate } from '../src/lib/demo/seed-plan';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';

/*
 * #895: a line never starts with "·". Each " · " between a line's parts has a no-break space
 * before the dot, so a line that wraps there ends with the dot. The Expenses table's split,
 * "Equally · 2", never splits at all, and a payment's rate keeps "fetched 5 Nov 17:44" whole.
 * #899: a signed amount, "−€20.00", never leaves its sign at a line's end, and a payment's
 * record keeps every word inside its card. #900: the Trip's Expenses table shows every column
 * whole beside the side panel. Checked as drawn: where each character lands, at every width
 * and text size below.
 */

const { alex, sam, priya } = DEMO_PERSONA_IDS;

// Date uses EEE d MMM, with a year appended on older Expenses. In Outfit, May is the widest
// short month and 20 May is the widest day + month once the weekday stacks above it.
const WIDEST_DAY = '2026-05-20T12:00:00.000Z';
const WIDEST_DAY_WITH_YEAR = '2000-05-20T12:00:00.000Z';
const TWO_DIGIT_NOVEMBER = '2026-11-10T12:00:00.000Z';
const VIEWER_TODAY = new Date('2026-11-11T12:00:00.000Z');

test.use({ timezoneId: 'UTC' });

/** Widths from a small laptop to a wide screen, in 32 px steps. */
const WIDTHS = Array.from({ length: 21 }, (_, step) => 960 + step * 32);
/** The browser's text size, as its setting makes it: every rem grows. */
const TEXT_SIZES = [100, 110, 125, 150, 175, 200];

async function open(page: Page, ledger: Ledger, path: string) {
  await page.clock.setFixedTime(VIEWER_TODAY);
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}${path}`);
}

async function textSize(page: Page, percent: number) {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = `${size}%`;
  }, percent);
}

/**
 * The lines `root` draws, as their words: each character's box, in reading order, starts a new
 * line when it lands below the one before it and back to its left.
 */
function drawnLines(root: Locator) {
  return root.evaluate((element) => {
    const lines: string[] = [];
    const range = document.createRange();
    let last: DOMRect | null = null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node as Text).data;
      for (let at = 0; at < text.length; at++) {
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const box = range.getClientRects()[0];
        if (!box || (!box.width && !box.height)) continue;
        if (/\s/.test(text[at])) {
          if (lines.length) lines[lines.length - 1] += ' ';
          continue;
        }
        const below = last && box.top > last.top + last.height / 2 && box.left < last.left;
        if (!last || below) lines.push('');
        lines[lines.length - 1] += text[at];
        last = box;
      }
    }
    return lines.map((line) => line.trim());
  });
}

/** The text nodes under `card` that draw any character past its left or right edge. */
function outsideCard(card: Locator) {
  return card.evaluate((element) => {
    const edge = element.getBoundingClientRect();
    const range = document.createRange();
    const past: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      range.selectNodeContents(node);
      const boxes = [...range.getClientRects()].filter((box) => box.width > 0);
      if (boxes.some((box) => box.left < edge.left - 0.5 || box.right > edge.right + 0.5))
        past.push((node as Text).data);
    }
    return past;
  });
}

/** Sam paid for two in each of these, so the table reads "Equally · 2" beside each. */
async function twoPersonHousehold(ledger: Ledger) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Split words ${randomUUID().slice(0, 6)}`,
          category: 'home',
          defaultCurrency: 'INR',
          alternateCurrencies: [],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  for (const [description, amount] of [
    ['Electricity for the whole flat, September and October', 3480],
    ['Groceries from the weekly market, vegetables and fruit', 1260],
    ['Internet, the fibre plan with the faster upload', 999],
  ] as const)
    await dataOf(
      await ledger.sam.post(`/api/groups/${group}/expenses`, {
        data: {
          description,
          amount,
          currency: 'INR',
          category: 'housing',
          tag: 'Utilities',
          date: WIDEST_DAY,
          paidBy: [{ user: sam, amount }],
          splitMethod: 'equal',
          splitBetween: [{ user: alex }, { user: sam }],
        },
      }),
      201,
    );
  return group;
}

test('the Expenses table never starts a line with "·" and keeps "Equally · 2" whole (#895)', async ({
  page,
  ledger,
}) => {
  const group = await twoPersonHousehold(ledger);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, ledger, `/groups/${group}`);
  const table = page.getByRole('main').getByRole('table');
  const splits = table.getByRole('cell', { name: /^Equally\s·\s2$/ });
  await expect(splits).toHaveCount(3);

  const broken: string[] = [];
  for (const percent of [100, 200])
    for (const width of WIDTHS) {
      await textSize(page, percent);
      await page.setViewportSize({ width, height: 900 });
      for (const line of await drawnLines(table))
        if (line.startsWith('·')) broken.push(`${width}px ${percent}%: "${line}"`);
      for (const cell of await splits.all()) {
        const lines = await drawnLines(cell);
        if (lines.length > 1) broken.push(`${width}px ${percent}%: ${JSON.stringify(lines)}`);
      }
    }
  expect(broken).toEqual([]);
});

test('a payment’s record keeps its rates, their fetched time and its date whole, a sign with its figure, and stays inside its card (#895, #899)', async ({
  page,
  ledger,
}) => {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Rate words ${randomUUID().slice(0, 6)}`,
          category: 'trip',
          defaultCurrency: 'INR',
          alternateCurrencies: ['EUR'],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  await dataOf(
    await ledger.sam.post(`/api/groups/${group}/expenses`, {
      data: {
        description: 'Pastéis de nata',
        amount: 40,
        currency: 'EUR',
        category: 'food',
        tag: 'Food',
        date: WIDEST_DAY,
        paidBy: [{ user: sam, amount: 40 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
    }),
    201,
  );
  await dataOf(
    await ledger.alex.post(`/api/groups/${group}/settlements`, {
      data: {
        paidTo: sam,
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 184200,
        paidCurrency: 'INR',
        appliedRate: '92.1',
        rateKind: 'suggested',
        suggestedRate: '92.1',
        rateSource: 'frankfurter',
        rateAsOf: '2026-05-20',
        rateFetchedAt: '2026-05-20T17:44:00.000Z',
      },
    }),
    201,
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, ledger, `/groups/${group}/activity`);
  await page.getByRole('button', { name: /You paid Sam Chen ₹1,842\.00 to clear €20\.00/ }).click();
  const card = page.getByRole('region', { name: 'Payment', exact: true });
  const fetched = card.getByText(/fetched\s/);
  await expect(fetched).toBeVisible();
  const when = '20 May 17:44';
  await expect(fetched).toContainText(`fetched ${when}`);

  // #899: the Debt before the payment, "−€20.00", keeps its sign: no line ends with it.
  const pair = card.getByText(/^You and Sam in EUR:/);
  await expect(pair).toBeVisible();
  const recorded = card.getByText(/^Recorded by you/);
  await expect(card.getByText(/^₹92\.10\sper\s€$/)).toHaveCount(2);

  const broken: string[] = [];
  for (const width of [960, 1280, 1600])
    for (const percent of TEXT_SIZES) {
      await page.setViewportSize({ width, height: 900 });
      await textSize(page, percent);
      const lines = await drawnLines(fetched);
      if (
        !lines.some((line) => line.endsWith(`fetched ${when}`)) ||
        lines.some((line) => line.startsWith('·'))
      )
        broken.push(`${width}px ${percent}%: ${JSON.stringify(lines)}`);
      const pairLines = (await drawnLines(pair)).map((line) => line.replace(/\u2060/g, ''));
      if (pairLines.some((line) => /[−+]$/.test(line)))
        broken.push(`${width}px ${percent}%: ${JSON.stringify(pairLines)}`);
      // The rate used and the suggested rate, each "₹92.10 per €" on one line.
      for (const rate of await card.getByText(/^₹92\.10\sper\s€$/).all()) {
        const rateLines = await drawnLines(rate);
        if (rateLines.length > 1)
          broken.push(`${width}px ${percent}%: ${JSON.stringify(rateLines)}`);
      }
      // The header's "Fri 6 Nov, 03:21" keeps its day and month together.
      const headerLines = await drawnLines(recorded);
      if (/\d\n\p{L}/u.test(headerLines.join('\n')))
        broken.push(`${width}px ${percent}%: ${JSON.stringify(headerLines)}`);
      for (const text of await outsideCard(card))
        broken.push(`${width}px ${percent}%: past the card: ${JSON.stringify(text)}`);
    }
  expect(broken).toEqual([]);
});

/** The demo's Goa Friends Trip, as `pnpm web demo:seed` writes it: three members, seven Expenses. */
async function demoTrip(ledger: Ledger) {
  const plan = buildDemoSeedPlan();
  const tripSeedDay = new Date('2026-05-27T12:00:00.000Z');
  const day = (daysAgo: number) => daysAgoDate(daysAgo, tripSeedDay).toISOString();
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Goa words ${randomUUID().slice(0, 6)}`,
          category: 'trip',
          defaultCurrency: plan.currency,
          alternateCurrencies: [],
          startDate: day(10).slice(0, 10),
          endDate: day(7).slice(0, 10),
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  await joinGroup(ledger.alex, ledger.priya, group);
  const actors: Record<string, Ledger['alex']> = {
    [alex]: ledger.alex,
    [sam]: ledger.sam,
    [priya]: ledger.priya,
  };
  for (const expense of plan.expenses) {
    const { description, amount, currency, category, tag, paidBy, splitMethod } = expense;
    await dataOf(
      await actors[paidBy[0]!.user]!.post(`/api/groups/${group}/expenses`, {
        data: {
          ...{ description, amount, currency, category, tag, paidBy, splitMethod },
          splitBetween: expense.splitBetween,
          date: day(expense.daysAgo),
        },
      }),
      201,
    );
  }
  return group;
}

test('the Trip’s Expenses table shows every column whole beside the side panel (#900)', async ({
  page,
  ledger,
}) => {
  const group = await demoTrip(ledger);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, ledger, `/groups/${group}`);
  const table = page.getByRole('main').getByRole('table');
  await expect(table.getByRole('row', { name: /Beachside villa/ })).toBeVisible();

  const cut: string[] = [];
  for (const width of [1280, 1366, 1440, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(table.getByRole('columnheader', { name: 'You' })).toBeVisible();
    // Each header cell, and each cell whose words are money, inside the card's edges.
    const outside = await table.evaluate((element) => {
      const card = element.closest('section')!.getBoundingClientRect();
      const scroller = element.parentElement!;
      const cells = [...element.querySelectorAll('th[scope="col"], td')].filter(
        (cell) => cell.matches('th') || /₹/.test(cell.textContent ?? ''),
      );
      return [
        ...(scroller.scrollWidth > scroller.clientWidth
          ? [`scrolls ${scroller.scrollWidth - scroller.clientWidth}px`]
          : []),
        ...cells
          .filter((cell) => {
            const box = cell.getBoundingClientRect();
            return box.left < card.left - 0.5 || box.right > card.right + 0.5;
          })
          .map((cell) => JSON.stringify(cell.textContent)),
      ];
    });
    for (const where of outside) cut.push(`${width}px: ${where}`);
    // With room to spare: the columns at their narrowest leave at least 16 px, as fonts draw a
    // little wider on Linux than on macOS (#901's CI run).
    const slack = await table.evaluate((element) => {
      const room = element.parentElement!.clientWidth;
      element.style.width = 'min-content';
      element.style.minWidth = '0';
      const narrowest = element.getBoundingClientRect().width;
      element.style.width = '';
      element.style.minWidth = '';
      return Math.floor(room - narrowest);
    });
    if (slack < 16) cut.push(`${width}px: only ${slack}px to spare`);
    // Each split, such as "By percentage · 3", on one line.
    for (const cell of await table.getByRole('cell', { name: /^(Equally|By\s)/ }).all()) {
      const lines = await drawnLines(cell);
      if (lines.length > 1) cut.push(`${width}px: ${JSON.stringify(lines)}`);
    }
  }
  expect(cut).toEqual([]);
});

/** A Group with Alex, Sam and Priya and these Expenses, each recorded by its payer. */
async function groupWith(
  ledger: Ledger,
  name: string,
  date: string,
  expenses: Array<Record<string, unknown> & { paidBy: Array<{ user: string; amount: number }> }>,
) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `${name} ${randomUUID().slice(0, 6)}`,
          category: 'home',
          defaultCurrency: 'INR',
          alternateCurrencies: ['CHF'],
        },
      }),
      201,
    )
  )._id as string;
  await joinGroup(ledger.alex, ledger.sam, group);
  await joinGroup(ledger.alex, ledger.priya, group);
  const actors: Record<string, Ledger['alex']> = {
    [alex]: ledger.alex,
    [sam]: ledger.sam,
    [priya]: ledger.priya,
  };
  for (const expense of expenses)
    await dataOf(
      await actors[expense.paidBy[0]!.user]!.post(`/api/groups/${group}/expenses`, {
        data: { category: 'housing', tag: 'Utilities', date, ...expense },
      }),
      201,
    );
  return group;
}

const LONG_NAME = 'Priyamvada Venkataraghavan-Subramaniam';

/** Shows Priya as LONG_NAME in this Group's Expenses read only, so no other test meets it. */
async function withLongName(page: Page, group: string) {
  await page.route(`**/api/groups/${group}/expenses**`, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll('"Priya Shah"', JSON.stringify(LONG_NAME));
    await route.fulfill({ response, body });
  });
}

/** CHF 10,000,000.00 paid by `payer`, split equally between `between` or 60/40 by percentage. */
function tenMillion(description: string, payer: string, between: string[], byPercentage = false) {
  return {
    description,
    amount: 10_000_000,
    currency: 'CHF',
    paidBy: [{ user: payer, amount: 10_000_000 }],
    splitMethod: byPercentage ? 'percentage' : 'equal',
    splitBetween: between.map((user, index) =>
      byPercentage ? { user, percentage: index ? 40 : 60 } : { user },
    ),
  };
}

/** Where the table scrolls, and each header or cell (or only You's) past its card's edges. */
function pastTheCard(table: Locator, only: 'all' | 'You' = 'all') {
  return table.evaluate((element, only) => {
    const card = element.closest('section')!.getBoundingClientRect();
    const scroller = element.parentElement!;
    const cells = [...element.querySelectorAll('tr')].flatMap((row) =>
      only === 'You' ? [row.lastElementChild!] : [...row.querySelectorAll('th[scope="col"], td')],
    );
    return [
      ...(only === 'all' && scroller.scrollWidth > scroller.clientWidth
        ? [`scrolls ${scroller.scrollWidth - scroller.clientWidth}px`]
        : []),
      ...cells
        .filter((cell) => {
          const box = cell.getBoundingClientRect();
          return box.left < card.left - 0.5 || box.right > card.right + 0.5;
        })
        .map((cell) => JSON.stringify(cell.textContent)),
    ];
  }, only);
}

/**
 * Each amount, in Amount and You, whose figure isn't whole on one line. A currency code may sit
 * on the line above its figure, as "CHF" over "10,000,000.00" in a narrow table (#942).
 */
async function brokenAmounts(table: Locator) {
  const broken: string[] = [];
  for (const amount of await table.getByText(/^−?(CHF\s|₹)[\d,]+\.\d\d$/).all()) {
    const lines = await drawnLines(amount);
    const whole =
      /^−?(CHF\s|₹)[\d,]+\.\d\d$/.test(lines.join(' ')) &&
      (lines.length === 1 || (lines.length === 2 && lines[0] === 'CHF'));
    if (!whole) broken.push(JSON.stringify(lines));
  }
  return broken;
}

/**
 * Each text in the Amount and You columns (headers too) that is covered or cut where it ends:
 * what the page draws at its last glyph isn't its own cell, or that glyph is past the card. A
 * pinned You once covered the end of Amount ("CHF 10,000,000.0", header "Amou") (#942).
 */
async function coveredFigures(table: Locator) {
  // Bring the card into the viewport without scrolling the table sideways. An off-screen glyph
  // has no hit target, even when both columns fit and nothing overlaps it.
  await table.locator('..').scrollIntoViewIfNeeded();
  return table.evaluate((element) => {
    const card = element.closest('section')!.getBoundingClientRect();
    const headers = [...element.querySelectorAll('thead th')];
    const at = (name: string) => headers.findIndex((th) => th.textContent?.trim() === name);
    const columns = [at('Amount'), at('You')];
    const problems: string[] = [];
    for (const row of element.querySelectorAll('tr')) {
      const cells = [...row.children].filter((cell) => /^T[HD]$/.test(cell.tagName));
      for (const cell of columns.map((column) => cells[column]).filter(Boolean)) {
        const walker = document.createTreeWalker(cell!, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent!.trim();
          // Skip what is read aloud only ("you", "nothing to settle").
          if (!text || getComputedStyle(node.parentElement!).position === 'absolute') continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const box of [...range.getClientRects()].filter((rect) => rect.width > 1)) {
            const drawn = document.elementFromPoint(box.right - 1, box.top + box.height / 2);
            if (box.right > card.right + 0.5) problems.push(`${JSON.stringify(text)} cut`);
            else if (!drawn || !cell!.contains(drawn))
              problems.push(`${JSON.stringify(text)} covered`);
          }
        }
      }
    }
    return problems;
  });
}

/**
 * Each Paid by drawn in more than two lines, counting the initials where they sit on a line of
 * their own: stacked, "SC" over "Sam Chen", as beside it "SC Sam / Chen" (#942). The long name
 * may take more.
 */
function tallPayers(table: Locator) {
  return table.evaluate((element, long) => {
    const headers = [...element.querySelectorAll('thead th')];
    const column = headers.findIndex((th) => th.textContent?.trim() === 'Paid by');
    const tall: string[] = [];
    for (const row of element.querySelectorAll('tbody tr')) {
      const cell = [...row.children].filter((child) => child.tagName === 'TD')[column];
      const label = cell?.querySelector(':scope > span');
      const name = [...(label?.childNodes ?? [])].find((node) => node.nodeType === Node.TEXT_NODE);
      if (!label || !name || name.textContent === long) continue;
      const range = document.createRange();
      range.selectNodeContents(name);
      const tops = new Set([...range.getClientRects()].map((box) => Math.round(box.top)));
      const initials = label.querySelector(':scope > div')!.getBoundingClientRect();
      const lines = tops.size + (initials.bottom <= Math.min(...tops) + 1 ? 1 : 0);
      if (lines > 2) tall.push(`${JSON.stringify(name.textContent)} in ${lines} lines`);
    }
    return tall;
  }, LONG_NAME);
}

/** How the long name is drawn: each line whole words of it, broken after a space or hyphen. */
async function brokenName(table: Locator) {
  const words = new Set(LONG_NAME.split(/\s+|(?<=-)/));
  const drawn = await table.evaluate((element, name) => {
    const range = document.createRange();
    const shown: string[][] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node as Text).data !== name) continue;
      const lines: string[] = [];
      let top: number | null = null;
      for (let at = 0; at < name.length; at++) {
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const box = range.getClientRects()[0];
        if (!box || (!box.width && !box.height)) continue;
        if (top === null || box.top > top + box.height / 2) lines.push('');
        top = box.top;
        lines[lines.length - 1] += name[at];
      }
      shown.push(lines.map((line) => line.trim()));
    }
    return shown;
  }, LONG_NAME);
  return [
    ...(drawn.length === 1 ? [] : [`the name is shown ${drawn.length} times`]),
    ...drawn
      .flat()
      .filter((line) => !line.split(/\s+|(?<=-)/).every((word) => words.has(word)))
      .map((line) => `"${line}"`),
  ];
}

// #942: beside the side panel at 1280 px, Priya renamed "Priyamvada Venkataraghavan-Subramaniam"
// made the table 665 px in a 626 px card, two Expenses of CHF 10,000,000.00 made it 673 px, and
// both together 713 px, so the You column went behind a scroller and each figure in it was cut.
// The name wraps only between its words and after its hyphen; each figure is whole on its own
// line, a code such as "CHF" above it; and nothing scrolls. The long-name Group has the
// Household's widest rows (a ₹54,000.00 rent, "By shares", "By percentage"): without the
// table's stacking it needs about 660 px. The Designer's review: stacked, "Sam Chen" took a line
// a word under the initials, three lines where it had two; a short name now takes two at most,
// in the long-name Group's other rows and in a Group of short names alike.
async function checkExpenseTableFits(page: Page, ledger: Ledger, date: string, label: string) {
  const named = await groupWith(ledger, 'Long name', date, [
    {
      description: 'Flat rent',
      amount: 54_000,
      currency: 'INR',
      paidBy: [{ user: alex, amount: 54_000 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }, { user: priya }],
    },
    {
      description: 'House-warming party snacks',
      amount: 3240,
      currency: 'INR',
      paidBy: [{ user: sam, amount: 3240 }],
      splitMethod: 'shares',
      splitBetween: [
        { user: alex, shares: 1 },
        { user: sam, shares: 2 },
        { user: priya, shares: 1 },
      ],
    },
    {
      description: 'AC servicing — two rooms',
      amount: 1800,
      currency: 'INR',
      paidBy: [{ user: alex, amount: 1800 }],
      splitMethod: 'percentage',
      splitBetween: [
        { user: alex, percentage: 60 },
        { user: sam, percentage: 40 },
      ],
    },
    {
      description: 'Monthly staples — rice, dal, oil',
      amount: 1864.5,
      currency: 'INR',
      paidBy: [{ user: priya, amount: 1864.5 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }, { user: priya }],
    },
  ]);
  const large = await groupWith(ledger, 'Large amounts', date, [
    tenMillion('Security deposit', sam, [alex, sam]),
    tenMillion('Renovation fund', alex, [alex, sam]),
  ]);
  const both = await groupWith(ledger, 'Large amounts, long name', date, [
    tenMillion('Security deposit', priya, [alex, priya]),
    tenMillion('Renovation fund', alex, [alex, sam]),
  ]);
  const everyday = await groupWith(ledger, 'Everyday', date, [
    {
      description: 'Monthly staples — rice, dal, oil',
      amount: 1864.5,
      currency: 'INR',
      paidBy: [{ user: priya, amount: 1864.5 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }, { user: priya }],
    },
    {
      description: 'House-warming party snacks',
      amount: 3240,
      currency: 'INR',
      paidBy: [{ user: sam, amount: 3240 }],
      splitMethod: 'shares',
      splitBetween: [
        { user: alex, shares: 1 },
        { user: sam, shares: 2 },
        { user: priya, shares: 1 },
      ],
    },
  ]);
  await withLongName(page, named);
  await withLongName(page, both);

  const cut: string[] = [];
  for (const [group, shown, where] of [
    [named, LONG_NAME, 'long name'],
    [large, /CHF\s10,000,000\.00/, 'CHF'],
    [both, LONG_NAME, 'both'],
    [everyday, 'Sam Chen', 'everyday'],
  ] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, ledger, `/groups/${group}`);
    const table = page.getByRole('main').getByRole('table');
    await expect(table.getByText(shown).first()).toBeVisible();
    await expect(table.getByRole('cell', { name: label, exact: true }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    for (const width of [1280, 1366, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      // ResizeObserver remeasures the table's columns on the next animation frame.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(table.getByRole('columnheader', { name: 'You' })).toBeVisible();
      for (const problem of [
        ...(await pastTheCard(table)),
        ...(await brokenAmounts(table)),
        ...(await coveredFigures(table)),
        ...(await tallPayers(table)),
        ...(shown === LONG_NAME ? await brokenName(table) : []),
      ])
        cut.push(`${where} ${width}px: ${problem}`);
    }
  }
  expect(cut).toEqual([]);
}

for (const [date, label] of [
  [TWO_DIGIT_NOVEMBER, 'Tue 10 Nov'],
  [WIDEST_DAY, 'Wed 20 May'],
  [WIDEST_DAY_WITH_YEAR, 'Sat 20 May 2000'],
] as const) {
  test(`the Expenses table keeps You in its card with a long name, CHF 10,000,000.00 or both (#942): ${label}`, async ({
    page,
    ledger,
  }) => {
    await checkExpenseTableFits(page, ledger, date, label);
  });
}

// #942: with the long name, a split "By percentage" and CHF 10,000,000.00 all at once, the
// columns need more than the card beside the side panel at 1280 px even stacked (652 px of 624
// in Chromium on macOS); at 1440 px, on one line, they needed 802 px of 784. The table scrolled
// at both, and You, pinned at the card's edge, covered the end of Amount at rest: header "Amou",
// figure "CHF 10,000,000.0" (the Designer's review). Now the table stacks where its rows need it
// (fitting at 1440) and moves its columns closer where even that can't fit (614 px at 1280), so
// at rest nothing scrolls and no figure is covered or cut; scrolled, You is still whole.
test('You stays in view with a long name, a split By percentage and CHF 10,000,000.00 at once (#942)', async ({
  page,
  ledger,
}) => {
  const group = await groupWith(ledger, 'Everything at once', WIDEST_DAY, [
    tenMillion('Security deposit', priya, [alex, priya]),
    tenMillion('Renovation fund', alex, [alex, sam], true),
  ]);
  await withLongName(page, group);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, ledger, `/groups/${group}`);
  const table = page.getByRole('main').getByRole('table');
  await expect(table.getByText(LONG_NAME)).toBeVisible();
  await expect(table.getByRole('cell', { name: /^By percentage/ })).toBeVisible();

  const cut: string[] = [];
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(table.getByRole('columnheader', { name: 'You' })).toBeVisible();
    for (const scrolled of [false, true]) {
      await table.evaluate((element, scrolled) => {
        element.parentElement!.scrollLeft = scrolled ? element.parentElement!.scrollWidth : 0;
      }, scrolled);
      for (const problem of [
        ...(await pastTheCard(table, 'You')),
        ...(scrolled ? [] : await coveredFigures(table)),
        ...(await brokenAmounts(table)),
        ...(await tallPayers(table)),
        ...(await brokenName(table)),
      ])
        cut.push(`${width}px ${scrolled ? 'scrolled' : 'at rest'}: ${problem}`);
    }
  }
  expect(cut).toEqual([]);
});
