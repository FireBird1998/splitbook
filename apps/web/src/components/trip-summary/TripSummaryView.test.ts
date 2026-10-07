import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { tripSummary, type TripExpense } from '@splitbook/shared/trip-summary';
import {
  parseTripSummaryResponse,
  type TripSummaryRead,
} from '@splitbook/shared/trip-summary-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { anchors, text } from '@/lib/test-utils/markup';
import TripSummaryView, { type TripSummaryViewProps } from './TripSummaryView';

/*
 * A Trip's Insights tab (#316), rendered as the server renders it: the whole trip in figures,
 * day by day with its Chart/Table switch, the wrap-up with Record only on the viewer's own
 * payments, and By Tag linking to the filtered Expenses, in every state (loading, no Expenses
 * yet, a failed read with Try again). Fictional people, Tags and figures; days are calendar
 * days, the same in any zone.
 */

const GROUP = 'c00000000000000000000001';
const ALEX = { id: 'a00000000000000000000001', name: 'Alex Rivera' };
const SAM = { id: 'a00000000000000000000002', name: 'Sam Chen' };
const PRIYA = { id: 'a00000000000000000000003', name: 'Priya Shah' };
const PEOPLE = [ALEX, SAM, PRIYA];
const TRANSPORT = { id: 'e00000000000000000000001', name: 'Transport' };
const STAY = { id: 'e00000000000000000000002', name: 'Stay' };

let sequence = 0;
function expense(
  day: string,
  description: string,
  payer: { id: string },
  shares: number[],
  tag: TripExpense['tag'] = TRANSPORT,
): TripExpense {
  sequence += 1;
  const total = shares.reduce((sum, share) => sum + share, 0);
  return {
    id: `d${String(sequence).padStart(23, '0')}`,
    description,
    currency: 'INR',
    date: `${day}T00:00:00Z`,
    moneyVersion: 1,
    amount: total / 100,
    amountMinor: total,
    paidBy: [{ user: payer.id, amount: total / 100, amountMinor: total }],
    splitBetween: shares.map((share, index) => ({
      user: PEOPLE[index].id,
      amount: share / 100,
      amountMinor: share,
    })),
    tag,
  };
}

function read(expenses: TripExpense[]): TripSummaryRead {
  const summary = tripSummary({
    memberId: ALEX.id,
    timeZone: 'Asia/Kolkata',
    currency: 'INR',
    startDate: '2026-09-17T00:00:00Z',
    endDate: '2026-09-20T00:00:00Z',
    expenses,
  });
  const named = (id: string) => PEOPLE.find((person) => person.id === id)!;
  // As the route sends it, through the read's own decoder.
  return parseTripSummaryResponse({
    status: 200,
    data: {
      ...summary,
      suggestedPayments: summary.suggestedPayments.map((payment) => ({
        from: named(payment.from),
        to: named(payment.to),
        amountMinor: payment.amountMinor,
      })),
      hasExpenses: expenses.length > 0,
    },
  });
}

const READ = read([
  expense('2026-09-17', 'Airport cab', SAM, [21333, 21334, 21333]),
  expense('2026-09-18', 'Villa stay', SAM, [93333, 93334, 93333], STAY),
  expense('2026-09-18', 'Breakfast café', PRIYA, [12667, 12667, 12666], { id: null, name: 'Café' }),
  expense('2026-09-20', 'Scooter rental', ALEX, [80000, 80000, 80000]),
]);

function render(props: Partial<TripSummaryViewProps> = {}) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(TripSummaryView, {
        groupId: GROUP,
        userId: ALEX.id,
        today: '2026-09-25',
        timeZone: 'Asia/Kolkata',
        read: READ,
        failed: false,
        onRetry: () => {},
        ...props,
      }),
    ),
  );
}

/** A card's markup, by the heading that labels it. */
function card(html: string, headingId: string): string {
  const start = html.indexOf(`aria-labelledby="${headingId}"`);
  if (start < 0) return '';
  const open = html.lastIndexOf('<section', start);
  let depth = 0;
  const tag = /<(\/?)section\b[^>]*>/g;
  tag.lastIndex = open;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(open, match.index + match[0].length);
  }
  return html.slice(open);
}

const whole = (html: string) => card(html, 'trip-whole-heading');
const days = (html: string) => card(html, 'trip-days-heading');
const wrapUpCard = (html: string) => card(html, 'trip-wrap-up-heading');
const tags = (html: string) => card(html, 'trip-tags-heading');

/** The card's links, with the `&` the markup escapes in an address read back. */
const hrefs = (html: string) =>
  anchors(html).map((anchor) => ({ ...anchor, href: anchor.href.replaceAll('&amp;', '&') }));

/** Share wrap-up: the Trip's whole-trip statement, in the viewer's zone (#319). */
const SHARE = {
  href: `/groups/${GROUP}/statement?tz=Asia%2FKolkata&scope=trip`,
  current: null,
  text: 'Share wrap-up',
};

/** Each table row's cells, as text, header and footer rows included. */
function tableRows(html: string): string[][] {
  const table = /<table\b[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => text(cell)),
  );
}

describe('the whole trip', () => {
  it('shows Spent, the member’s share, what they paid and per person per day, in one currency', () => {
    const figures = text(whole(render()));
    expect(figures).toContain('Whole trip · INR');
    expect(figures).toContain('Spent ₹6,220.00 4 Expenses over 4 days');
    expect(figures).toContain('Your share ₹2,073.33 In all 4 of its Expenses');
    expect(figures).toContain('You paid ₹2,400.00 ₹326.67 more than your share');
    expect(figures).toContain('Per person per day ₹518.33 3 people · 4 days');
    // One currency: no second-currency row.
    expect(text(render())).not.toMatch(/EUR|Kept apart|converted/);
  });
});

describe('day by day', () => {
  it('hides the chart from assistive technology and gives it the same table', () => {
    const html = days(render({ initialView: 'chart' }));
    expect(html).toMatch(/<div[^>]*aria-hidden="true"[^>]*data-testid="trip-day-columns"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Chart</);
    expect(tableRows(html).at(-1)).toEqual(['Whole trip', '4', '₹6,220.00', '₹2,073.33']);
    // Hidden, the table is no stop for the keyboard.
    expect(html).not.toContain('role="region"');
    expect(text(html)).toContain(
      'Fri 18 Sep was the biggest day: Villa stay was ₹2,800.00 of its ₹3,180.00.',
    );
  });

  it('has a table with a row per day, the daily average and the whole trip', () => {
    const html = days(render({ initialView: 'table' }));
    expect(tableRows(html)).toEqual([
      ['Day', 'Expenses', 'Spent', 'Your share'],
      ['Day 1 · Thu 17 Sep', '1', '₹640.00', '₹213.33'],
      ['Day 2 · Fri 18 Sep', '2', '₹3,180.00', '₹1,060.00'],
      ['Day 3 · Sat 19 Sep', '0', '₹0.00', '₹0.00'],
      ['Day 4 · Sun 20 Sep', '1', '₹2,400.00', '₹800.00'],
      ['Daily average', '–', '₹1,555.00', '–'],
      ['Whole trip', '4', '₹6,220.00', '₹2,073.33'],
    ]);
    expect(html).not.toContain('data-testid="trip-day-columns"');
    expect(text(html)).toContain('The trip’s spending in INR, day by day, with your share');
    // It scrolls sideways inside the card, so the keyboard can reach and scroll it.
    expect(html).toMatch(
      /<div[^>]*role="region"[^>]*aria-label="Day by day, as a table"[^>]*tabindex="0"|<div[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="Day by day, as a table"/,
    );
  });

  it('lists Expenses outside the Trip’s dates as rows, and notes them under the chart', () => {
    const outside = read([
      expense('2026-09-18', 'Villa stay', SAM, [93333, 93334, 93333], STAY),
      expense('2026-08-30', 'Train tickets', SAM, [20000, 20000, 20000]),
    ]);
    const html = days(render({ read: outside, initialView: 'table' }));
    expect(tableRows(html)).toContainEqual([
      'Before the trip Sun 30 Aug',
      '1',
      '₹600.00',
      '₹200.00',
    ]);
    expect(text(html)).toContain(
      'Expenses dated outside the trip’s days count in the whole trip, but aren’t drawn here: ₹600.00 before it (1 Expense).',
    );
  });
});

describe('the wrap-up', () => {
  it('offers Record only on the viewer’s own payments, linking to Balances with the pair', () => {
    const html = wrapUpCard(render());
    expect(text(html)).toContain('The trip ended on Sun 20 Sep. Settle while it’s fresh.');
    expect(text(html)).toContain('Priya Shah pays Sam Chen ₹1,366.65 Priya or Sam records it');
    expect(text(html)).toContain('Priya Shah pays you ₹326.67');
    expect(hrefs(html)).toEqual([
      {
        href: `/groups/${GROUP}/balances?paidBy=${PRIYA.id}`,
        current: null,
        text: 'Record',
      },
      SHARE,
    ]);
    expect(html).toContain('aria-label="Record payment: Priya Shah pays you, ₹326.67"');
  });

  it('offers no Record to a member who is party to none of them', () => {
    const html = wrapUpCard(render({ userId: 'a00000000000000000000009' }));
    expect(hrefs(html)).toEqual([SHARE]);
    expect(text(html)).toContain('Priya Shah pays Alex Rivera ₹326.67 Priya or Alex records it');
  });

  it('says everyone is settled up when nothing is owed', () => {
    const settled = { ...READ, suggestedPayments: [] };
    const html = wrapUpCard(render({ read: settled }));
    expect(text(html)).toContain('Everyone is settled up');
    expect(hrefs(html)).toEqual([SHARE]);
  });
});

describe('Share wrap-up', () => {
  it('opens the Trip’s statement for the whole trip, in the viewer’s zone, in the same tab', () => {
    const html = wrapUpCard(render({ timeZone: 'America/New_York' }));
    const end = html.indexOf('Share wrap-up</a>') + 'Share wrap-up</a>'.length;
    const link = html.slice(html.lastIndexOf('<a ', end), end);
    expect(hrefs(link)).toEqual([
      {
        href: `/groups/${GROUP}/statement?tz=America%2FNew_York&scope=trip`,
        current: null,
        text: 'Share wrap-up',
      },
    ]);
    // A link, not a Record action: no new tab, and described by what it opens.
    expect(link).not.toContain('target=');
    expect(link).not.toContain('Record');
    expect(link).toContain('aria-describedby="trip-wrap-up-share-note"');
    expect(text(html)).toContain(
      'Opens the trip’s statement to print or save as a PDF: what was spent, everyone’s Paid and Share, and who pays whom.',
    );
  });

  it('is there for every member, whoever pays whom, and once everyone is settled up', () => {
    for (const html of [
      wrapUpCard(render()),
      wrapUpCard(render({ userId: 'a00000000000000000000009' })),
      wrapUpCard(render({ read: { ...READ, suggestedPayments: [] } })),
    ])
      expect(hrefs(html).filter((anchor) => anchor.text === 'Share wrap-up')).toEqual([SHARE]);
  });

  it('waits for the wrap-up: none while it loads, after a failed read, or before any Expense', () => {
    for (const html of [
      wrapUpCard(render({ read: undefined })),
      wrapUpCard(render({ read: undefined, failed: true })),
      wrapUpCard(render({ read: read([]) })),
    ]) {
      expect(text(html)).not.toContain('Share wrap-up');
      expect(hrefs(html)).toEqual([]);
    }
  });
});

describe('By Tag', () => {
  it('links each Tag to the Expenses tab filtered by it, with its share of spend and count', () => {
    const html = tags(render());
    expect(text(html)).toContain('Whole trip · INR');
    expect(anchors(html).map(({ href }) => href)).toEqual([
      `/groups/${GROUP}/expenses?tag=${TRANSPORT.id}`,
      `/groups/${GROUP}/expenses?tag=${STAY.id}`,
    ]);
    expect(html).toContain(
      'aria-label="Transport: ₹3,040.00, 49% of INR spend, 2 Expenses. Show these Expenses"',
    );
    expect(text(html)).toContain('Café ₹380.00 6% of spend · 1 Expense');
  });
});

describe('the tab’s states', () => {
  it('announces that each card is loading, with no figures and no table', () => {
    const html = render({ read: undefined });
    for (const label of [
      'Loading the trip’s figures',
      'Loading day by day',
      'Loading the wrap-up',
      'Loading spending by Tag',
    ])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain('<table');
    expect(text(html)).not.toContain('₹');
  });

  it('explains a failed read safely, with Try again on each card', () => {
    const html = render({ read: undefined, failed: true });
    expect(html.match(/role="alert"/g)).toHaveLength(4);
    for (const message of [
      'The trip’s figures could not be loaded.',
      'Day by day could not be loaded.',
      'The wrap-up could not be loaded.',
      'By Tag could not be loaded.',
    ])
      expect(text(html)).toContain(message);
    expect(text(html).match(/Try again/g)).toHaveLength(4);
    expect(html).not.toContain('<table');
  });

  it('keeps what it has when a refresh fails', () => {
    const html = render({ failed: true });
    expect(html).not.toContain('role="alert"');
    expect(text(whole(html))).toContain('₹6,220.00');
  });

  it('says there are no Expenses yet on each card, which is neither an error nor loading', () => {
    const html = render({ read: read([]) });
    expect(text(html).match(/No Expenses yet/g)).toHaveLength(4);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('<table');
  });
});
