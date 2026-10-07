import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import type { GroupInsightsRead } from '@splitbook/shared/group-insights-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { anchors, text } from '@/lib/test-utils/markup';
import GroupInsightsView, { type GroupInsightsViewProps } from './GroupInsightsView';

/*
 * A Group's Insights tab (#314), rendered as the server renders it: the Month navigation and
 * the range, the stat cards, and monthly spending with its average, in every state (loading,
 * no Expenses yet, a failed read with Try again). Fictional Household and figures.
 */

const GROUP = 'c00000000000000000000001';
const ALEX = 'a00000000000000000000001';
const PRIYA = 'a00000000000000000000003';

const month = (key: string, spentMinor: number) => ({
  month: key,
  spentMinor,
  expenseCount: 10,
  yourShareMinor: 500000,
  youPaidMinor: 400000,
  recurringCount: 2,
});

const READ: GroupInsightsRead = {
  timeZone: 'Asia/Kolkata',
  month: '2026-09',
  compare: 6,
  firstMonth: '2026-03',
  currency: 'INR',
  window: { from: '2026-03-01', to: '2026-09-30' },
  months: [
    month('2026-03', 1500000),
    month('2026-04', 1698000),
    month('2026-05', 1764000),
    month('2026-06', 1921000),
    month('2026-07', 1805000),
    month('2026-08', 1738500),
    {
      month: '2026-09',
      spentMinor: 1842000,
      expenseCount: 14,
      yourShareMinor: 614000,
      youPaidMinor: 521000,
      recurringCount: 3,
    },
  ],
  average: { monthCount: 6, spentMinor: 1737750, yourShareMinor: 500000, youPaidMinor: 400000 },
  change: { direction: 'up', differenceMinor: 104250, changePercent: 6 },
  biggestExpense: {
    id: 'd00000000000000000000001',
    description: 'Cook (September)',
    amountMinor: 300000,
    date: '2026-09-05T00:00:00.000Z',
    paidBy: [{ id: PRIYA, name: 'Priya Shah' }],
  },
  otherCurrencies: [],
  recurringExpenses: true,
  hasExpenses: true,
};

/** A Month as the read gives it while recurring Expenses are off: no recurring count. */
const withoutRecurringCount = (entry: GroupInsightsRead['months'][number]) => ({
  month: entry.month,
  spentMinor: entry.spentMinor,
  expenseCount: entry.expenseCount,
  yourShareMinor: entry.yourShareMinor,
  youPaidMinor: entry.youPaidMinor,
});

function render(props: Partial<GroupInsightsViewProps> = {}) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(GroupInsightsView, {
        groupId: GROUP,
        userId: ALEX,
        address: { month: '2026-09', compare: 6 },
        currentMonth: '2026-10',
        recurringTheme: true,
        read: READ,
        failed: false,
        onRetry: () => {},
        onCompareChange: () => {},
        ...props,
      }),
    ),
  );
}

/** The markup of the figures section, by its label. */
function figures(html: string): string {
  return (
    /<section[^>]*aria-label="[^"]* in figures"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
  );
}

/** Each table row's cells, as text, header and footer rows included. */
function tableRows(html: string): string[][] {
  const table = /<table\b[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => text(cell)),
  );
}

describe('the Month navigation and range', () => {
  it('names the Month and links the Month before, keeping the range', () => {
    const html = render({ address: { month: '2026-09', compare: 12 } });
    expect(html).toMatch(/<h2[^>]*>September 2026<\/h2>/);
    expect(anchors(html).find(({ href }) => href.includes('/insights'))).toEqual({
      // The markup escapes the ampersand.
      href: `/groups/${GROUP}/insights?month=2026-08&amp;compare=12`,
      current: null,
      text: '',
    });
    expect(html).toContain('aria-label="Previous month, August 2026"');
    expect(html).toContain('aria-label="Next month, October 2026"');
  });

  it('turns next off at the current Month, and says why', () => {
    const html = render({ address: { month: '2026-10', compare: 6 }, read: undefined });
    expect(html).toMatch(
      /<button[^>]*aria-label="Next month, unavailable: October is the current month"[^>]*aria-disabled="true"|<button[^>]*aria-disabled="true"[^>]*aria-label="Next month, unavailable: October is the current month"/,
    );
    expect(html).not.toContain('Next month, November 2026');
  });

  it('turns previous off at the Group’s first Month, and says why', () => {
    const first = { ...READ, month: '2026-03', months: [month('2026-03', 1500000)] };
    const html = render({ address: { month: '2026-03', compare: 6 }, read: first });
    expect(html).toContain(
      'aria-label="Previous month, unavailable: this Group has nothing before March 2026"',
    );
  });

  it('offers 1, 6 and 12 months, with the address’s pressed', () => {
    const html = render({ address: { month: '2026-09', compare: 12 }, read: undefined });
    expect(html).toContain('aria-label="Compare with the months before"');
    expect(html).toMatch(/aria-pressed="false"[^>]*>1 month</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>6 months</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>12 months</);
  });
});

describe('the stat cards', () => {
  it('show Spent against the average, Your share and You paid, Expenses and the biggest Expense', () => {
    const cards = text(figures(render()));
    expect(cards).toContain('Spent ₹18,420.00 +6.0% vs 6-month average ₹17,377.50');
    expect(cards).toContain('Your share ₹6,140.00 You paid ₹5,210.00');
    expect(cards).toContain('Expenses 14 3 added by recurring Expenses');
    expect(cards).toContain('Biggest expense ₹3,000.00 Cook (September) · Priya Shah paid');
    expect(figures(render())).toContain('aria-label="September 2026 in figures"');
  });

  it('leave out the recurring count while recurring Expenses are off', () => {
    const off: GroupInsightsRead = {
      ...READ,
      recurringExpenses: false,
      months: READ.months.map(withoutRecurringCount),
    };
    const html = render({ read: off });
    expect(text(figures(html))).toContain('Expenses 14');
    expect(html).not.toMatch(/recurring/i);
  });

  it('say so when a Month has no Expenses, and when there is nothing earlier', () => {
    const quiet: GroupInsightsRead = {
      ...READ,
      firstMonth: '2026-09',
      months: [
        {
          month: '2026-09',
          spentMinor: 0,
          expenseCount: 0,
          yourShareMinor: 0,
          youPaidMinor: 0,
          recurringCount: 0,
        },
      ],
      average: null,
      change: null,
      biggestExpense: null,
    };
    const cards = text(figures(render({ read: quiet })));
    expect(cards).toContain('Spent ₹0.00 The Group’s first month: nothing earlier to compare');
    expect(cards).toContain('Biggest expense – None No Expenses in September 2026');
  });
});

describe('monthly spending', () => {
  it('has a table with a row per Month and an average row', () => {
    const html = render({ initialView: 'table' });
    expect(tableRows(html)).toEqual([
      ['Month', 'Spent', 'Your share'],
      ['March 2026', '₹15,000.00', '₹5,000.00'],
      ['April 2026', '₹16,980.00', '₹5,000.00'],
      ['May 2026', '₹17,640.00', '₹5,000.00'],
      ['June 2026', '₹19,210.00', '₹5,000.00'],
      ['July 2026', '₹18,050.00', '₹5,000.00'],
      ['August 2026', '₹17,385.00', '₹5,000.00'],
      ['September 2026', '₹18,420.00', '₹6,140.00'],
      ['6-month average', '₹17,377.50', '₹5,000.00'],
    ]);
    expect(html).toMatch(/<tfoot>[\s\S]*6-month average[\s\S]*<\/tfoot>/);
    expect(html.match(/scope="row"/g)).toHaveLength(8);
    expect(text(html)).toContain(
      'The whole Group’s spending in INR, by month, with your share and the 6-month average',
    );
    expect(text(html)).toContain('INR · March to September 2026 · whole Group');
    expect(text(html)).toContain('September is ₹1,042.50 above the 6-month average.');
  });

  it('hides the chart from assistive technology and gives it the same table', () => {
    const html = render({ initialView: 'chart' });
    expect(html).toMatch(/<div[^>]*aria-hidden="true"[^>]*data-testid="monthly-columns"/);
    expect(tableRows(html).at(-1)).toEqual(['6-month average', '₹17,377.50', '₹5,000.00']);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Chart</);
  });

  it('has no average row when there is nothing earlier to average', () => {
    const first: GroupInsightsRead = {
      ...READ,
      firstMonth: '2026-09',
      months: READ.months.slice(-1),
      average: null,
      change: null,
    };
    const html = render({ read: first, initialView: 'table' });
    expect(html).not.toContain('<tfoot');
    expect(tableRows(html)).toHaveLength(2);
  });
});

describe('the tab’s states', () => {
  it('announces that it is loading, with no figures and no table', () => {
    const html = render({ read: undefined });
    expect(html).toContain('aria-label="Loading the figures for September 2026"');
    expect(html).toContain('aria-label="Loading monthly spending"');
    expect(html).not.toContain('<table');
    expect(text(html)).not.toContain('₹');
    // The navigation is there before the figures.
    expect(html).toContain('aria-label="Previous month, August 2026"');
  });

  it('shows a read for another Month as loading, never under this Month’s name', () => {
    const html = render({ address: { month: '2026-08', compare: 6 } });
    expect(html).toContain('aria-label="Loading the figures for August 2026"');
    expect(text(html)).not.toContain('₹18,420.00');
  });

  it('explains a failed read safely, with Try again on each card', () => {
    const html = render({ read: undefined, failed: true });
    expect(html.match(/role="alert"/g)).toHaveLength(2);
    expect(text(html)).toContain('The figures for September 2026 could not be loaded.');
    expect(text(html)).toContain('Monthly spending could not be loaded.');
    expect(text(html).match(/Try again/g)).toHaveLength(2);
    expect(html).not.toContain('<table');
  });

  it('keeps the figures it has when a refresh fails', () => {
    const html = render({ failed: true });
    expect(html).not.toContain('role="alert"');
    expect(text(figures(html))).toContain('₹18,420.00');
  });

  it('says there are no Expenses yet, which is neither an error nor loading', () => {
    const empty: GroupInsightsRead = {
      ...READ,
      hasExpenses: false,
      firstMonth: '2026-09',
      months: [
        {
          month: '2026-09',
          spentMinor: 0,
          expenseCount: 0,
          yourShareMinor: 0,
          youPaidMinor: 0,
          recurringCount: 0,
        },
      ],
      average: null,
      change: null,
      biggestExpense: null,
    };
    const html = render({ read: empty });
    expect(text(html).match(/No Expenses yet/g)).toHaveLength(2);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('<table');
  });

  it('notes a legacy Group’s Expenses in other currencies', () => {
    const html = render({
      read: { ...READ, otherCurrencies: [{ currency: 'EUR', spentMinor: 2550, expenseCount: 1 }] },
    });
    expect(text(html)).toContain(
      'Only INR Expenses are counted here. One Expense in these months is in another currency and left out, never converted: 1 in EUR (€25.50).',
    );
  });
});
