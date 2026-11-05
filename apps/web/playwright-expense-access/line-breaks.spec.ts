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

/** Widths from a small laptop to a wide screen, in 32 px steps. */
const WIDTHS = Array.from({ length: 21 }, (_, step) => 960 + step * 32);
/** The browser's text size, as its setting makes it: every rem grows. */
const TEXT_SIZES = [100, 110, 125, 150, 175, 200];

async function open(page: Page, ledger: Ledger, path: string) {
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
          date: new Date().toISOString(),
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
        date: new Date().toISOString(),
        paidBy: [{ user: sam, amount: 40 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
    }),
    201,
  );
  // Frankfurter's rates of the day before, fetched at 17:44 that day, in the viewer's time.
  const day = new Date();
  day.setDate(day.getDate() - 1);
  const asOf = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const fetchedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 17, 44);
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
        rateAsOf: asOf,
        rateFetchedAt: fetchedAt.toISOString(),
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
  const month = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[fetchedAt.getMonth()];
  const when = `${fetchedAt.getDate()} ${month} 17:44`;
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
  const day = (daysAgo: number) => daysAgoDate(daysAgo).toISOString().slice(0, 10);
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Goa words ${randomUUID().slice(0, 6)}`,
          category: 'trip',
          defaultCurrency: plan.currency,
          alternateCurrencies: [],
          startDate: day(10),
          endDate: day(7),
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
          date: daysAgoDate(expense.daysAgo).toISOString(),
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
    // Each split, such as "By percentage · 3", on one line.
    for (const cell of await table.getByRole('cell', { name: /^(Equally|By\s)/ }).all()) {
      const lines = await drawnLines(cell);
      if (lines.length > 1) cut.push(`${width}px: ${JSON.stringify(lines)}`);
    }
  }
  expect(cut).toEqual([]);
});
