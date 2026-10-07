import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import type {
  GroupInsightsByTagRead,
  GroupInsightsRead,
} from '@splitbook/shared/group-insights-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { DETAIL_IDS, SEPTEMBER_DETAIL } from '@/lib/test-utils/insights-month-detail';
import { anchors, text } from '@/lib/test-utils/markup';
import ByTagCard, { type ByTagCardProps } from './ByTagCard';
import GroupInsightsView, { type GroupInsightsViewProps } from './GroupInsightsView';
import RecurringExpensesCard, { type RecurringExpensesCardProps } from './RecurringExpensesCard';
import WhoPaidCard, { type WhoPaidCardProps } from './WhoPaidCard';
import {
  byTagModel,
  dayLabel,
  ordinal,
  payersOf,
  recurringModel,
  whoPaidModel,
} from './insights-cards';

/*
 * The Month in detail on a Group's Insights tab (#315), rendered as the server renders it: By
 * Tag, Who paid this month and Recurring Expenses, each in every state (loading, no Expenses,
 * failed with Try again, and its own data malformed), and the Recurring Expenses card only
 * while the product-wide switch (#289) is on. Fictional Household and figures.
 */

const GROUP = 'c00000000000000000000001';
const { alex, sam, priya } = DETAIL_IDS;

const earlier = (month: string, spentMinor: number) => ({
  month,
  spentMinor,
  expenseCount: 10,
  yourShareMinor: 500000,
  youPaidMinor: 400000,
  recurringCount: 3,
});

/** Maple House's September 2026 against March to August, as the read answers. */
const READ: GroupInsightsRead = {
  timeZone: 'Asia/Kolkata',
  month: '2026-09',
  compare: 6,
  firstMonth: '2026-03',
  currency: 'INR',
  window: { from: '2026-03-01', to: '2026-09-30' },
  months: [
    earlier('2026-03', 1500000),
    earlier('2026-04', 1698000),
    earlier('2026-05', 1764000),
    earlier('2026-06', 1921000),
    earlier('2026-07', 1805000),
    earlier('2026-08', 1738500),
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
  biggestExpense: null,
  otherCurrencies: [],
  recurringExpenses: true,
  hasExpenses: true,
  ...SEPTEMBER_DETAIL,
};

/** By Tag in a Group's first Month: nothing earlier to average. */
const FIRST_BY_TAG: GroupInsightsByTagRead = {
  earlierMonths: [],
  tags: SEPTEMBER_DETAIL.byTag.tags.map((tag) => ({
    ...tag,
    averageMinor: null,
    differenceMinor: null,
    direction: null,
    changePercent: null,
  })),
};

/** September as a Group's first Month: nothing earlier to compare. */
const FIRST: GroupInsightsRead = {
  ...READ,
  firstMonth: '2026-09',
  window: { from: '2026-09-01', to: '2026-09-30' },
  months: READ.months.slice(-1),
  average: null,
  change: null,
  byTag: FIRST_BY_TAG,
};

const html = (element: ReactElement) =>
  renderToStaticMarkup(createElement(ThemeProvider, { theme: createAppTheme('light') }, element));

/** Each table row's cells as text, the first table only, header rows included. */
function tableRows(markup: string): string[][] {
  const table = /<table\b[\s\S]*?<\/table>/.exec(markup)?.[0] ?? '';
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => text(cell)),
  );
}

/** The opening tag of the element carrying an attribute. */
const tagWith = (markup: string, attribute: string) =>
  new RegExp(`<[a-z]+\\b[^>]*${attribute}[^>]*>`).exec(markup)?.[0] ?? '';

const noop = () => {};

describe('the cards’ wording', () => {
  it('numbers days of the month', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28, 31].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '28th',
      '31st',
    ]);
  });

  it('reads a calendar day the same in every zone, with its year only when it differs', () => {
    // Built from the day's parts, so the run's zone (CI also uses UTC−11 and UTC+14) can't move it.
    expect(dayLabel('2026-10-05', '2026')).toBe('Mon 5 Oct');
    expect(dayLabel('2026-09-05', '2026')).toBe('Sat 5 Sep');
    expect(dayLabel('2027-01-05', '2026')).toBe('Tue 5 Jan 2027');
  });

  it('names who pays a template, the viewer as You', () => {
    const priyaShah = { id: priya, name: 'Priya Shah' };
    const samChen = { id: sam, name: 'Sam Chen' };
    expect(payersOf([priyaShah], alex)).toBe('Priya Shah pays');
    expect(payersOf([{ id: alex, name: 'Alex Rivera' }], alex)).toBe('You pay');
    expect(payersOf([samChen, priyaShah], alex)).toBe('Sam Chen and Priya Shah pay');
    expect(payersOf([samChen, priyaShah, { id: alex, name: 'Alex Rivera' }], alex)).toBe(
      'Sam Chen and 2 others pay',
    );
  });
});

describe('By Tag', () => {
  const render = (props: Partial<ByTagCardProps> = {}) =>
    html(createElement(ByTagCard, { read: READ, state: 'ready', onRetry: noop, ...props }));

  it('compares each Tag with its own average, the Month left out', () => {
    const model = byTagModel(READ, SEPTEMBER_DETAIL.byTag);
    expect(model.subtitle).toBe('September vs the 6-month average, March to August 2026');
    expect(model.averageName).toBe('6-month average');
    expect(
      model.rows.map((row) => [row.name, row.spentText, row.averageText, row.changeText]),
    ).toEqual([
      ['Household', '₹5,890.00', '₹5,410.00', '+8.9%'],
      ['Utilities', '₹4,962.00', '₹4,540.00', '+9.3%'],
      ['Groceries', '₹3,988.00', '₹4,215.00', '−5.4%'],
      // Nothing earlier: new this month.
      ['Untagged', '₹3,580.00', '₹0.00', 'New'],
    ]);
    // Bars and ticks against the largest figure, Household's ₹5,890.00.
    expect(model.rows.map((row) => [row.bar, row.tick])).toEqual([
      [100, 91.85],
      [84.24, 77.08],
      [67.71, 71.56],
      [60.78, 0],
    ]);
  });

  it('names the one Month it compares with, or says there is nothing earlier', () => {
    const oneByTag = { ...SEPTEMBER_DETAIL.byTag, earlierMonths: ['2026-08'] };
    const one: GroupInsightsRead = {
      ...READ,
      compare: 1,
      months: READ.months.slice(-2),
      average: { monthCount: 1, spentMinor: 1738500, yourShareMinor: 0, youPaidMinor: 0 },
      byTag: oneByTag,
    };
    const model = byTagModel(one, oneByTag);
    expect(model.subtitle).toBe('September vs August 2026');
    expect(model.averageName).toBe('August');
    const first = byTagModel(FIRST, FIRST_BY_TAG);
    expect(first.subtitle).toBe('September 2026 · nothing earlier to compare');
    expect(first.averageName).toBeNull();
    expect(first.rows.map((row) => [row.averageText, row.changeText, row.tick])).toEqual(
      Array(4).fill([null, '–', null]),
    );
  });

  it('draws bars hidden from assistive technology, with the same table for it', () => {
    const markup = render();
    expect(tagWith(markup, 'data-testid="tag-bars"')).toContain('aria-hidden="true"');
    expect(markup.match(/data-testid="tag-bar-row"/g)).toHaveLength(4);
    expect(markup.match(/data-testid="tag-average-tick"/g)).toHaveLength(4);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Chart</);
    expect(tableRows(markup)).toEqual([
      ['Tag', 'September', '6-month average', 'Change'],
      ['Household', '₹5,890.00', '₹5,410.00', '+8.9%'],
      ['Utilities', '₹4,962.00', '₹4,540.00', '+9.3%'],
      ['Groceries', '₹3,988.00', '₹4,215.00', '−5.4%'],
      ['Untagged', '₹3,580.00', '₹0.00', 'New'],
    ]);
    expect(text(markup)).toContain(
      'Spending by Tag in September 2026, in INR, against the 6-month average, March to August 2026',
    );
  });

  it('shows the table in a region the keyboard can scroll', () => {
    const markup = render({ initialView: 'table' });
    expect(markup).not.toContain('data-testid="tag-bars"');
    const region = tagWith(markup, 'role="region"');
    expect(region).toContain('aria-label="Spending by Tag table"');
    expect(region).toContain('tabindex="0"');
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Table</);
    expect(tableRows(markup)).toHaveLength(5);
  });

  it('has no average columns or ticks in the Group’s first Month', () => {
    const markup = render({ read: FIRST, initialView: 'table' });
    expect(tableRows(markup)[0]).toEqual(['Tag', 'September']);
    expect(render({ read: FIRST })).not.toContain('tag-average-tick');
  });

  it('loads, fails with Try again, and has nothing to show, each on its own', () => {
    const loading = render({ read: undefined, state: 'loading' });
    expect(loading).toContain('aria-label="Loading spending by Tag"');
    expect(loading).not.toContain('<table');

    const failed = render({ read: undefined, state: 'failed' });
    expect(failed).toContain('role="alert"');
    expect(text(failed)).toContain('Spending by Tag could not be loaded. Try again');

    const empty = render({ state: 'empty' });
    expect(text(empty)).toContain('No Expenses yet');
    expect(empty).not.toContain('role="alert"');

    const quiet = render({ read: { ...READ, byTag: { ...SEPTEMBER_DETAIL.byTag, tags: [] } } });
    expect(text(quiet)).toContain('Nothing spent in September 2026');
    expect(quiet).not.toContain('Show Tags as');
  });

  it('fails alone when its own data is malformed', () => {
    const markup = render({ read: { ...READ, byTag: { earlierMonths: [], tags: 'none' } } });
    expect(text(markup)).toContain('Spending by Tag could not be loaded. Try again');
    expect(markup).not.toContain('<table');
  });
});

describe('Who paid this month', () => {
  const render = (props: Partial<WhoPaidCardProps> = {}) =>
    html(
      createElement(WhoPaidCard, {
        groupId: GROUP,
        userId: alex,
        read: READ,
        state: 'ready',
        onRetry: noop,
        ...props,
      }),
    );

  it('gives each member’s Paid against their Share and the Month net, exact', () => {
    const markup = render();
    expect(tableRows(markup)).toEqual([
      ['Member', '', 'Paid', 'Share', 'Month net'],
      // Each name follows its avatar's initials, which assistive technology doesn't hear.
      ['PS Priya Shah', '', '₹6,677.00', '₹6,140.00', '+₹537.00 paid more than their share'],
      ['SC Sam Chen', '', '₹6,533.00', '₹6,140.00', '+₹393.00 paid more than their share'],
      ['AR You', '', '₹5,210.00', '₹6,140.00', '−₹930.00 paid less than your share'],
    ]);
    expect(markup.match(/<div[^>]*aria-hidden="true"[^>]*>PS<\/div>/g)).toHaveLength(1);
    expect(text(markup)).toContain('September 2026 · each share is ₹6,140.00');
    expect(text(markup)).toContain('What each member paid in September 2026 against their share');
    // The word is Paid.
    expect(markup).not.toMatch(/front/i);
  });

  it('keeps its bars from assistive technology, in a region the keyboard can scroll', () => {
    const markup = render();
    const region = tagWith(markup, 'role="region"');
    expect(region).toContain('aria-label="Who paid this month table"');
    expect(region).toContain('tabindex="0"');
    for (const cell of markup.match(/<td[^>]*class="bar"[^>]*>/g) ?? [])
      expect(cell).toContain('aria-hidden="true"');
    expect(markup.match(/data-testid="share-tick"/g)).toHaveLength(3);
    expect(anchors(markup)).toContainEqual({
      href: `/groups/${GROUP}/balances`,
      current: null,
      text: 'See Balances',
    });
  });

  it('says when shares differ, and marks someone no longer in the Group', () => {
    const model = whoPaidModel(
      READ,
      {
        members: [
          {
            id: sam,
            name: 'Sam Chen',
            isMember: false,
            paidMinor: 1842000,
            shareMinor: 921000,
            netMinor: 921000,
          },
          {
            id: alex,
            name: 'Alex Rivera',
            isMember: true,
            paidMinor: 0,
            shareMinor: 921000,
            netMinor: -921000,
          },
          {
            id: priya,
            name: 'Priya Shah',
            isMember: true,
            paidMinor: 0,
            shareMinor: 0,
            netMinor: 0,
          },
        ],
      },
      { userId: alex },
    );
    expect(model.subtitle).toBe('September 2026 · Paid against each member’s share');
    expect(model.rows.map((row) => [row.name, row.former, row.netNote])).toEqual([
      ['Sam Chen', true, 'paid more than their share'],
      ['You', false, 'paid less than your share'],
      ['Priya Shah', false, 'paid their share'],
    ]);
  });

  it('loads, fails with Try again, and has nothing to show, each on its own', () => {
    expect(render({ read: undefined, state: 'loading' })).toContain(
      'aria-label="Loading who paid this month"',
    );
    expect(text(render({ read: undefined, state: 'failed' }))).toContain(
      'Who paid this month could not be loaded. Try again',
    );
    expect(text(render({ state: 'empty' }))).toContain('No Expenses yet');
    const nothing = {
      ...READ,
      months: [...READ.months.slice(0, -1), { ...READ.months[6], spentMinor: 0, expenseCount: 0 }],
      whoPaid: {
        members: SEPTEMBER_DETAIL.whoPaid.members.map((member) => ({
          ...member,
          paidMinor: 0,
          shareMinor: 0,
          netMinor: 0,
        })),
      },
    };
    const markup = render({ read: nothing });
    expect(text(markup)).toContain('Nothing paid in September 2026');
    expect(markup).not.toContain('<table');
  });

  it('fails alone when its own data is malformed', () => {
    // Paids that don't add up to the Month's Spent.
    const members = SEPTEMBER_DETAIL.whoPaid.members.map((member, index) =>
      index === 0 ? { ...member, paidMinor: member.paidMinor + 1 } : member,
    );
    const markup = render({ read: { ...READ, whoPaid: { members } } });
    expect(text(markup)).toContain('Who paid this month could not be loaded. Try again');
  });
});

describe('Recurring Expenses', () => {
  const render = (props: Partial<RecurringExpensesCardProps> = {}) =>
    html(
      createElement(RecurringExpensesCard, {
        groupId: GROUP,
        userId: alex,
        currentMonth: '2026-10',
        canManage: true,
        read: READ,
        state: 'ready',
        onRetry: noop,
        ...props,
      }),
    );

  it('lists each template’s amount, schedule, what it added this Month and its next date', () => {
    const model = recurringModel(READ, SEPTEMBER_DETAIL.recurring, {
      userId: alex,
      currentMonth: '2026-10',
    });
    expect(model.subtitle).toBe('₹4,849.00 · 3 of 14 Expenses in September');
    expect(
      model.rows.map((row) => [row.description, row.amountText, row.schedule, row.added, row.next]),
    ).toEqual([
      [
        'Cook',
        '₹3,000.00',
        'Monthly on the 5th · Priya Shah pays',
        'Added Sat 5 Sep',
        'Next Mon 5 Oct',
      ],
      [
        'Water purifier service',
        '₹850.00',
        'Monthly on the 21st · Sam Chen pays',
        'Added Mon 21 Sep',
        'Next Wed 21 Oct',
      ],
      ['Wi-Fi', '₹999.00', 'Monthly on the 28th · You pay', 'Added Mon 28 Sep', 'Next Wed 28 Oct'],
    ]);
    const markup = render();
    expect(text(markup)).toContain(
      'Cook ₹3,000.00 Monthly on the 5th · Priya Shah pays Added Sat 5 Sep Next Mon 5 Oct',
    );
    expect(markup).toContain('aria-label="Recurring Expenses"');
  });

  it('says when a template is paused or has ended, and when it falls on a short month’s end', () => {
    const [cook] = SEPTEMBER_DETAIL.recurring.templates;
    const model = recurringModel(
      READ,
      {
        addedInMonth: { count: 3, spentMinor: 900000 },
        templates: [
          { ...cook, dayOfMonth: 31, nextDate: '2026-10-31', addedOn: null },
          { ...cook, paused: true, nextDate: null },
          { ...cook, nextDate: null },
        ],
      },
      { userId: alex, currentMonth: '2026-10' },
    );
    expect(model.rows.map((row) => [row.schedule, row.added, row.next])).toEqual([
      ['Monthly on the 31st or the month’s last day · Priya Shah pays', null, 'Next Sat 31 Oct'],
      ['Monthly on the 5th · Priya Shah pays', 'Added Sat 5 Sep', 'Paused'],
      ['Monthly on the 5th · Priya Shah pays', 'Added Sat 5 Sep', 'Ended'],
    ]);
  });

  it('links an admin to where recurring Expenses are managed', () => {
    for (const state of ['ready', 'loading', 'failed'] as const)
      expect(anchors(render({ state, read: state === 'ready' ? READ : undefined }))).toContainEqual(
        {
          href: `/groups/${GROUP}/settings#recurring-expenses`,
          current: null,
          text: 'Manage',
        },
      );
    expect(render()).toContain('aria-label="Manage recurring Expenses"');
    expect(text(render())).not.toContain('Only the Group’s admins');
  });

  it('tells a member who isn’t an admin who can change them, with no Manage link', () => {
    const markup = render({ canManage: false });
    expect(anchors(markup)).toEqual([]);
    expect(text(markup)).toContain('Wi-Fi');
    expect(text(markup)).toContain('Only the Group’s admins can change recurring Expenses.');
    const none = render({
      canManage: false,
      read: { ...READ, recurring: { addedInMonth: { count: 3, spentMinor: 0 }, templates: [] } },
    });
    expect(text(none)).toContain('When an admin adds rent, Wi-Fi or another monthly Expense');
  });

  it('loads, fails with Try again, and has none yet, each on its own', () => {
    expect(render({ read: undefined, state: 'loading' })).toContain(
      'aria-label="Loading recurring Expenses"',
    );
    expect(text(render({ read: undefined, state: 'failed' }))).toContain(
      'Recurring Expenses could not be loaded. Try again',
    );
    const none = render({
      read: { ...READ, recurring: { addedInMonth: { count: 3, spentMinor: 0 }, templates: [] } },
    });
    expect(text(none)).toContain('No recurring Expenses yet');
    // A Group without Expenses yet can still have templates.
    expect(text(render({ state: 'empty' }))).toContain('Cook');
  });

  it('fails alone when its own data is malformed', () => {
    const markup = render({ read: { ...READ, recurring: undefined } });
    expect(text(markup)).toContain('Recurring Expenses could not be loaded. Try again');
  });

  it('renders nothing at all when the read says recurring Expenses are off', () => {
    expect(render({ read: { ...READ, recurringExpenses: false } })).toBe('');
  });
});

describe('the recurring gate on the tab', () => {
  const view = (props: Partial<GroupInsightsViewProps> = {}) =>
    html(
      createElement(GroupInsightsView, {
        groupId: GROUP,
        userId: alex,
        address: { month: '2026-09', compare: 6 },
        currentMonth: '2026-10',
        recurringTheme: true,
        recurringExpensesEnabled: true,
        isAdmin: true,
        read: READ,
        failed: false,
        onRetry: noop,
        onCompareChange: noop,
        ...props,
      }),
    );

  const offRead: GroupInsightsRead = {
    ...READ,
    recurringExpenses: false,
    months: READ.months.map((entry) => ({
      month: entry.month,
      spentMinor: entry.spentMinor,
      expenseCount: entry.expenseCount,
      yourShareMinor: entry.yourShareMinor,
      youPaidMinor: entry.youPaidMinor,
    })),
    recurring: undefined,
  };

  it('shows the card while the switch is on, in a Household', () => {
    const markup = view();
    expect(markup).toContain('id="recurring-expenses-heading"');
    expect(text(markup)).toContain('Recurring Expenses ₹4,849.00 · 3 of 14 Expenses in September');
  });

  it('shows no card, heading, empty state or link while the switch is off, in every state', () => {
    for (const props of [
      { recurringExpensesEnabled: false, read: offRead },
      { recurringExpensesEnabled: false, read: undefined },
      { recurringExpensesEnabled: false, read: undefined, failed: true },
      // The page's switch is on, but the read, newer, says off.
      { recurringExpensesEnabled: true, read: offRead },
    ]) {
      const markup = view(props);
      expect(markup).not.toContain('recurring-expenses');
      expect(markup).not.toMatch(/Recurring Expenses|recurring Expenses yet/);
    }
    // And no word of them anywhere once the read says off.
    expect(view({ recurringExpensesEnabled: false, read: offRead })).not.toMatch(/recurring/i);
  });

  it('shows no card in a Theme without recurring Expenses', () => {
    expect(view({ recurringTheme: false })).not.toContain('recurring-expenses');
  });

  it('loads and fails with the rest of the tab while the switch is on', () => {
    expect(view({ read: undefined })).toContain('aria-label="Loading recurring Expenses"');
    const failed = view({ read: undefined, failed: true });
    expect(failed.match(/role="alert"/g)).toHaveLength(5);
    expect(text(failed)).toContain('Recurring Expenses could not be loaded.');
  });

  it('fails only the card whose data is malformed', () => {
    const markup = view({ read: { ...READ, byTag: undefined } });
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(text(markup)).toContain('Spending by Tag could not be loaded.');
    expect(text(markup)).toContain('₹6,677.00');
    expect(text(markup)).toContain('Wi-Fi');
  });
});
