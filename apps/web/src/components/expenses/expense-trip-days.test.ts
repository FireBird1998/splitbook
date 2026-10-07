import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import { tripDayLabel } from '@/components/trip-summary/trip-days';
import ExpenseTable from './ExpenseTable';
import { tripDayHeadings } from './expense-trip-days';

/*
 * A Trip's Expenses by trip day (#316): the headings over each day's rows and the day totals,
 * in the viewer's time zone. Every instant is written in UTC and every day read in a named
 * zone; expected labels come from the app's own day formatter, so the tests hold in any zone
 * they run in. Fictional people and figures.
 */

const GROUP = 'c00000000000000000000001';
const ALEX = { _id: 'a00000000000000000000001', name: 'Alex Rivera', image: null };
const SAM = { _id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const NOW = new Date('2026-09-25T06:00:00Z');
// The Trip as the forms store it: 17 to 20 September, each day at UTC midnight.
const TRIP = {
  startDate: '2026-09-17T00:00:00.000Z',
  endDate: '2026-09-20T00:00:00.000Z',
  currency: 'INR',
  now: NOW,
};

let sequence = 0;
function expense(
  date: string,
  description: string,
  minor: number,
  extra: Partial<ExpenseRead> = {},
): ExpenseRead {
  sequence += 1;
  return {
    _id: `e${String(sequence).padStart(23, '0')}`,
    group: GROUP,
    description,
    currency: 'INR',
    amount: minor / 100,
    amountMinor: minor,
    moneyVersion: 1,
    date,
    createdAt: date,
    updatedAt: date,
    category: 'other',
    tag: 'Transport',
    tagId: null,
    paidBy: [{ user: ALEX, amount: minor / 100, amountMinor: minor }],
    splitBetween: [
      { user: ALEX, amount: minor / 200, amountMinor: minor / 2 },
      { user: SAM, amount: minor / 200, amountMinor: minor / 2 },
    ],
    splitMethod: 'equal',
    recurringExpense: null,
    ...extra,
  };
}

// Newest first, as the list shows them by default.
const EXPENSES = [
  expense('2026-09-20T00:00:00.000Z', 'Beach shack lunch', 186000),
  expense('2026-09-18T20:00:00.000Z', 'Late dinner', 9000),
  expense('2026-09-18T00:00:00.000Z', 'Villa stay', 280000),
  expense('2026-09-18T00:00:00.000Z', 'Breakfast café', 38000),
  expense('2026-09-17T00:00:00.000Z', 'Airport cab', 64000),
];

const headingsOf = (map: Map<string, { label: string; totals: { amountMinor: number }[] }>) =>
  [...map.entries()].map(([id, heading]) => [
    EXPENSES.find((entry) => entry._id === id)?.description ?? id,
    heading.label,
    heading.totals.map((total) => total.amountMinor),
  ]);

describe('trip day headings', () => {
  it('head each day’s first Expense with its trip day and the day’s total, exactly', () => {
    const headings = tripDayHeadings(EXPENSES, { ...TRIP, timeZone: 'UTC' });
    expect(headingsOf(headings)).toEqual([
      ['Beach shack lunch', `Day 4 · ${tripDayLabel('2026-09-20', 2026)}`, [186000]],
      ['Late dinner', `Day 2 · ${tripDayLabel('2026-09-18', 2026)}`, [327000]],
      ['Airport cab', `Day 1 · ${tripDayLabel('2026-09-17', 2026)}`, [64000]],
    ]);
    expect([...headings.values()].map((heading) => heading.expenseCount)).toEqual([1, 3, 1]);
  });

  it('follow the viewer’s time zone: a late dinner is the next day in Kolkata', () => {
    const headings = tripDayHeadings(EXPENSES, { ...TRIP, timeZone: 'Asia/Kolkata' });
    expect(headingsOf(headings)).toEqual([
      ['Beach shack lunch', `Day 4 · ${tripDayLabel('2026-09-20', 2026)}`, [186000]],
      ['Late dinner', `Day 3 · ${tripDayLabel('2026-09-19', 2026)}`, [9000]],
      ['Villa stay', `Day 2 · ${tripDayLabel('2026-09-18', 2026)}`, [318000]],
      ['Airport cab', `Day 1 · ${tripDayLabel('2026-09-17', 2026)}`, [64000]],
    ]);
  });

  it('read the Trip’s dates in the same zone, so its first day’s Expense is on Day 1', () => {
    // UTC midnight is the evening before in New York.
    const headings = tripDayHeadings(EXPENSES, { ...TRIP, timeZone: 'America/New_York' });
    expect(headingsOf(headings).at(-1)).toEqual([
      'Airport cab',
      `Day 1 · ${tripDayLabel('2026-09-16', 2026)}`,
      [64000],
    ]);
  });

  it('name days outside the Trip’s dates, and number none without a first day', () => {
    const outside = [
      expense('2026-09-22T00:00:00.000Z', 'Laundry', 3000),
      expense('2026-09-01T00:00:00.000Z', 'Train tickets', 60000),
    ];
    expect(
      [...tripDayHeadings(outside, { ...TRIP, timeZone: 'UTC' }).values()].map((h) => h.label),
    ).toEqual([
      `After the trip · ${tripDayLabel('2026-09-22', 2026)}`,
      `Before the trip · ${tripDayLabel('2026-09-01', 2026)}`,
    ]);
    expect(
      [
        ...tripDayHeadings(outside, {
          ...TRIP,
          startDate: null,
          endDate: null,
          timeZone: 'UTC',
        }).values(),
      ].map((h) => h.label),
    ).toEqual([tripDayLabel('2026-09-22', 2026), tripDayLabel('2026-09-01', 2026)]);
  });

  it('keep a legacy Trip’s other currency apart, never converted, the Trip’s first', () => {
    const lounge = expense('2026-09-17T00:00:00.000Z', 'Lounge passes', 2500, {
      currency: 'EUR',
    });
    const [day] = [
      ...tripDayHeadings([lounge, EXPENSES[4]], { ...TRIP, timeZone: 'UTC' }).values(),
    ];
    expect(day.totals).toEqual([
      { currency: 'INR', amountMinor: 64000, amount: 640 },
      { currency: 'EUR', amountMinor: 2500, amount: 25 },
    ]);
  });
});

describe('the Expenses table by trip day', () => {
  function render(
    dayHeadings: ReturnType<typeof tripDayHeadings> | null,
    openId: string | null = null,
  ) {
    return renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(ExpenseTable, {
          expenses: EXPENSES,
          userId: ALEX._id,
          recurringExpensesEnabled: false,
          label: 'Expenses',
          caption: 'Expenses, newest first.',
          openId,
          onToggle: () => {},
          panelId: 'expense-panel',
          dayHeadings,
        }),
      ),
    );
  }

  /** Each body row's cells, as text. */
  function bodyRows(html: string): string[][] {
    const body = /<tbody\b[\s\S]*?<\/tbody>/.exec(html)?.[0] ?? '';
    return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
      [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => text(cell)),
    );
  }

  it('puts a heading row with the day’s total above each day’s rows', () => {
    const html = render(tripDayHeadings(EXPENSES, { ...TRIP, timeZone: 'Asia/Kolkata' }));
    const headings = bodyRows(html).filter((cells) => cells.length === 3);
    expect(headings).toEqual([
      [`Day 4 · ${tripDayLabel('2026-09-20', 2026)}`, 'Day total ₹1,860.00', ''],
      [`Day 3 · ${tripDayLabel('2026-09-19', 2026)}`, 'Day total ₹90.00', ''],
      [`Day 2 · ${tripDayLabel('2026-09-18', 2026)}`, 'Day total ₹3,180.00', ''],
      [`Day 1 · ${tripDayLabel('2026-09-17', 2026)}`, 'Day total ₹640.00', ''],
    ]);
    // Each heading names its row and spans the columns before Amount.
    expect(
      html.match(/<th[^>]*scope="row"[^>]*colSpan="4"|<th[^>]*colSpan="4"[^>]*scope="row"/gi),
    ).toHaveLength(4);
    expect(html.match(/data-expense-id=/g)).toHaveLength(5);
    // The heading rows are not Expenses: nothing to open.
    expect(html.match(/data-trip-day="2026-09-18"/g)).toHaveLength(1);
  });

  it('opens a row under a heading in the side panel, as any other row', () => {
    const villa = EXPENSES.find((entry) => entry.description === 'Villa stay')!;
    const html = render(
      tripDayHeadings(EXPENSES, { ...TRIP, timeZone: 'Asia/Kolkata' }),
      villa._id,
    );
    const row = new RegExp(`<tr[^>]*data-expense-id="${villa._id}"[\\s\\S]*?</tr>`).exec(html)![0];
    expect(row).toMatch(/aria-expanded="true"/);
    expect(row).toContain('aria-controls="expense-panel"');
    // The day's heading comes before it, and opens nothing itself.
    expect(html.indexOf('data-trip-day="2026-09-18"')).toBeLessThan(html.indexOf(villa._id));
    expect(html.match(/aria-controls=/g)).toHaveLength(1);
  });

  it('is unchanged without headings, as for every other Theme', () => {
    const html = render(null);
    expect(html).not.toContain('data-trip-day');
    expect(bodyRows(html)).toHaveLength(5);
  });
});
