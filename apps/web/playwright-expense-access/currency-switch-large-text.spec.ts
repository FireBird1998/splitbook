import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';

// #854: at 200% text a currency tab is never wider than its row, and its words wrap between
// themselves, never inside a number. At 100% text the tabs are as they were.

/** A Trip in five currencies with long figures: Alex owes in some and is owed in the others. */
async function longFiguresTrip(ledger: Ledger) {
  const group = (
    await dataOf(
      await ledger.alex.post('/api/groups', {
        data: {
          name: `Long figures ${randomUUID().slice(0, 8)}`,
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
    ['sam', 'alex', 18425.5, 'EUR'],
    ['alex', 'sam', 1842500, 'INR'],
    ['sam', 'alex', 12607.75, 'USD'],
    ['alex', 'sam', 9402.2, 'GBP'],
    ['sam', 'alex', 1842500, 'JPY'],
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

async function open(page: Page, ledger: Ledger, group: string, tab: string, label: string) {
  await page.context().addCookies((await ledger.alex.storageState()).cookies);
  await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL}/groups/${group}?tab=${tab}`);
  const tablist = page.getByRole('tablist', { name: label });
  await expect(tablist.getByRole('tab')).toHaveCount(5);
  return tablist;
}

/** Text at twice its size, as a browser's text size setting makes it: every rem doubles. */
async function doubleText(page: Page) {
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.locator('html')).toHaveCSS('font-size', '32px');
}

/**
 * Each tab's box against its row, whether its content is cut off, the lines it takes, and any
 * word (a run without spaces: a currency code, an amount) its lines split.
 */
function tabsInRow(tablist: Locator) {
  return tablist.evaluate((list) => {
    const row = list.closest('.MuiTabs-root')!.parentElement!.getBoundingClientRect();
    return [...list.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => {
      const box = tab.getBoundingClientRect();
      const split: string[] = [];
      const words: DOMRect[] = [];
      const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (const word of node.textContent!.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, word.index!);
          range.setEnd(node, word.index! + word[0].length);
          const rects = [...range.getClientRects()];
          if (new Set(rects.map((rect) => Math.round(rect.top))).size > 1) split.push(word[0]);
          words.push(...rects);
        }
      // Words of different sizes share a line when their boxes overlap from top to bottom.
      let lines = 0;
      let bottom = -Infinity;
      for (const rect of words.sort((a, b) => a.top - b.top)) {
        if (rect.top >= bottom - 1) lines += 1;
        bottom = Math.max(bottom, rect.bottom);
      }
      return {
        tab: tab.textContent,
        inRow: box.left >= row.left - 0.5 && box.right <= row.right + 0.5,
        cutOff: tab.scrollWidth > tab.clientWidth,
        lines,
        split,
      };
    });
  });
}

for (const [tab, label] of [
  ['balances', 'Balances in'],
  ['insights', 'Spending in'],
] as const) {
  for (const width of [320, 360]) {
    test(`at ${width} px with 200% text, every ${tab} currency tab fits its row and no number splits (#854)`, async ({
      page,
      ledger,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const tablist = await open(page, ledger, await longFiguresTrip(ledger), tab, label);
      await doubleText(page);
      for (const measured of await tabsInRow(tablist))
        expect(measured, measured.tab!).toMatchObject({ inRow: true, cutOff: false, split: [] });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }

  // At 100% text every tab keeps its code on one line and its figure on the next, as before.
  for (const width of [340, 360, 412]) {
    test(`at ${width} px with 100% text, each ${tab} currency tab keeps two lines (#854)`, async ({
      page,
      ledger,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const tablist = await open(page, ledger, await longFiguresTrip(ledger), tab, label);
      for (const measured of await tabsInRow(tablist))
        expect(measured, measured.tab!).toMatchObject({
          inRow: true,
          cutOff: false,
          lines: 2,
          split: [],
        });
    });
  }
}
