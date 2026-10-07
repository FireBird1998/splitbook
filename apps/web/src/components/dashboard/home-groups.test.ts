import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import type { GroupRead } from '@splitbook/shared/group-read';
import type {
  GroupLastChangeRead,
  SpendingThisMonthRead,
} from '@splitbook/shared/user-spending-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { anchors, text } from '@/lib/test-utils/markup';
import type { CardRead, GroupBalanceAmounts } from './home-reads';
import { WhereItWentView, type WhereItWentViewAs } from './WhereItWentCard';
import { whereItWentModel } from './where-it-went';
import { lastChangeLabel, themeLine, tripDatesLabel } from './groups-table';

/*
 * Home's "Where it went" and Groups table (#308), rendered to static markup as the server
 * renders them: every state of each card, and the figures each takes from its own read.
 * Fictional people, Groups and figures throughout.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}));

const { GroupsTableView } = await import('./GroupsTableCard');

function render(element: ReactElement, mode: 'light' | 'dark' = 'light') {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
  );
}

const noop = () => {};

/** The opening tag of the element carrying `attribute`, or '' when there is none. */
function openingTag(html: string, attribute: string): string {
  const at = html.indexOf(attribute);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
}
const loading = { status: 'loading' } as const;
const failed = { status: 'error' } as const;
const ready = <T>(value: T): CardRead<T> => ({ status: 'ready', value });

const maple = 'b00000000000000000000001';
const goa = 'b00000000000000000000002';
const lisbon = 'b00000000000000000000003';
const football = 'b00000000000000000000004';

const THIS_MONTH: SpendingThisMonthRead = {
  month: '2026-10',
  byCategory: [
    {
      currency: 'INR',
      totalMinor: 941666,
      expenseCount: 9,
      categories: [
        { category: 'housing', shareMinor: 600000, expenseCount: 2 },
        { category: 'food', shareMinor: 300000, expenseCount: 5 },
        { category: 'transport', shareMinor: 41666, expenseCount: 2 },
      ],
    },
    {
      currency: 'EUR',
      totalMinor: 1250,
      expenseCount: 1,
      categories: [{ category: 'travel', shareMinor: 1250, expenseCount: 1 }],
    },
  ],
  groups: [
    { groupId: maple, spent: [{ currency: 'INR', totalMinor: 1842000, expenseCount: 7 }] },
    {
      groupId: goa,
      spent: [
        { currency: 'EUR', totalMinor: 2500, expenseCount: 1 },
        { currency: 'INR', totalMinor: 984000, expenseCount: 4 },
      ],
    },
    { groupId: lisbon, spent: [] },
    { groupId: football, spent: [{ currency: 'INR', totalMinor: 320000, expenseCount: 2 }] },
  ],
};

describe('Where it went', () => {
  const card = (thisMonth: CardRead<SpendingThisMonthRead>, initialView?: WhereItWentViewAs) =>
    render(createElement(WhereItWentView, { thisMonth, onRetry: noop, initialView }));

  it('shows this month’s share by Category as bars, the largest first, with the table for screen readers', () => {
    for (const mode of ['light', 'dark'] as const) {
      const html = render(
        createElement(WhereItWentView, { thisMonth: ready(THIS_MONTH), onRetry: noop }),
        mode,
      );
      expect(html).toMatch(/<section[^>]*aria-labelledby="where-it-went-heading"/);
      expect(text(html)).toContain('Where it went Your share by Category · October · INR');
      // The bars are hidden from assistive technology, which reads the table instead.
      expect(html).toMatch(/<div[^>]*aria-hidden="true"[^>]*data-testid="category-bars"/);
      const bars = [...html.matchAll(/data-testid="category-bar"/g)];
      expect(bars).toHaveLength(3);
      const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
      expect(text(table)).toBe(
        'Your share by Category in October, in INR Category Expenses Your share ' +
          'Housing 2 ₹6,000.00 Food & Drink 5 ₹3,000.00 Transport 2 ₹416.66 Total 9 ₹9,416.66',
      );
    }
  });

  it('draws each bar against the largest Category', () => {
    const model = whereItWentModel(THIS_MONTH)!;
    expect(model.rows.map((row) => [row.label, row.text, Math.round(row.width)])).toEqual([
      ['Housing', '₹6,000.00', 100],
      ['Food & Drink', '₹3,000.00', 50],
      ['Transport', '₹416.66', 7],
    ]);
  });

  it('shows one currency at a time, with a switch when there are several', () => {
    const html = card(ready(THIS_MONTH));
    expect(html).toMatch(/role="group"[^>]*aria-label="Currency"/);
    expect(text(html)).toMatch(/INR EUR Chart Table/);
    const eur = whereItWentModel(THIS_MONTH, 'EUR')!;
    expect(eur.currency).toBe('EUR');
    expect(eur.rows.map((row) => [row.label, row.text])).toEqual([['Travel', '€12.50']]);
    // One currency only: no switch.
    const single = card(ready({ ...THIS_MONTH, byCategory: THIS_MONTH.byCategory.slice(0, 1) }));
    expect(single).not.toContain('aria-label="Currency"');
    expect(single).toContain('aria-label="View as"');
  });

  it('shows the table itself in the Table view, with no bars', () => {
    const html = card(ready(THIS_MONTH), 'table');
    expect(html).not.toContain('category-bars');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Table/);
    expect(text(html)).toContain('Housing 2 ₹6,000.00');
  });

  it('lets the keyboard reach the shown table, which may scroll, but never the hidden copy', () => {
    const shown = card(ready(THIS_MONTH), 'table');
    expect(openingTag(shown, 'aria-label="Your share by Category table"')).toMatch(
      /^<div(?=[^>]*\brole="region")(?=[^>]*\btabindex="0")/i,
    );
    // Behind the bars, the copy for screen readers is no keyboard stop.
    const behindBars = card(ready(THIS_MONTH));
    const tableAt = behindBars.indexOf('<table');
    expect(behindBars.slice(behindBars.lastIndexOf('<div', tableAt), tableAt)).not.toMatch(
      /tabindex|role="region"/i,
    );
    expect(behindBars).not.toContain('aria-label="Your share by Category table"');
  });

  it('is empty, calmly, when nothing is shared this month', () => {
    const html = card(ready({ ...THIS_MONTH, byCategory: [] }));
    expect(text(html)).toBe(
      'Where it went Your share by Category · October Nothing spent yet this month ' +
        'Your share of each Expense this month will show here, by Category.',
    );
    expect(html).not.toContain('role="alert"');
  });

  it('announces loading, with no figure', () => {
    const html = card(loading);
    expect(html).toContain('role="status" aria-label="Loading where your money went"');
    expect(text(html)).toBe('Where it went Your share by Category · this month');
  });

  it('fails on its own with Try again, never showing a figure', () => {
    const html = card(failed);
    expect(html).toContain('role="alert"');
    expect(text(html)).toBe(
      'Where it went Your share by Category · this month ' +
        'Spending by Category could not be loaded. Try again',
    );
  });
});

const ALEX = 'a00000000000000000000001';
const person = (n: number, name: string) => ({
  _id: `a0000000000000000000000${n}`,
  name,
  email: `person${n}@example.test`,
});
const PEOPLE = [
  person(1, 'Alex Rivera'),
  person(2, 'Sam Chen'),
  person(3, 'Priya Shah'),
  person(4, 'Maya Singh'),
  person(5, 'Jon Weber'),
  person(6, 'Lea Costa'),
  person(7, 'Dev Kapoor'),
  person(8, 'Ana Lima'),
];

function group(
  _id: string,
  name: string,
  category: GroupRead['category'],
  people: number,
  extra: Partial<GroupRead> = {},
): GroupRead {
  return {
    _id,
    name,
    category,
    defaultCurrency: 'INR',
    startDate: null,
    endDate: null,
    // The viewer is listed last, to show the avatars put them first.
    members: [...PEOPLE.slice(1, people), PEOPLE[0]].map((user) => ({
      user,
      role: 'member',
      joinedAt: '2026-01-01T00:00:00.000Z',
    })),
    ...extra,
  } as GroupRead;
}

const GROUPS = [
  group(maple, 'Maple House', 'home', 3),
  group(goa, 'Goa Friends Trip', 'trip', 3, {
    startDate: '2026-09-17T00:00:00.000Z',
    endDate: '2026-09-20T00:00:00.000Z',
  }),
  group(lisbon, 'Lisbon Offsite', 'work', 4, { defaultCurrency: 'EUR' }),
  group(football, 'Sunday Football', 'other', 8),
];

const BALANCES = new Map<string, GroupBalanceAmounts>([
  [maple, [{ currency: 'INR', balance: -1480 }]],
  [
    goa,
    [
      { currency: 'EUR', balance: 12.5 },
      { currency: 'INR', balance: 620 },
    ],
  ],
  [lisbon, [{ currency: 'EUR', balance: 30 }]],
  [football, []],
]);

/** Times in the runner's own zone, as the viewer's browser reads them. */
const NOW = new Date(2026, 9, 7, 12, 0);
const LAST_CHANGES: GroupLastChangeRead[] = [
  { groupId: maple, at: new Date(2026, 9, 7, 9, 14).toISOString() },
  { groupId: goa, at: new Date(2026, 9, 6, 20, 2).toISOString() },
  { groupId: lisbon, at: new Date(2026, 7, 28, 11, 0).toISOString() },
  { groupId: football, at: null },
];

interface TableReads {
  layout?: 'table' | 'rows';
  /** Null: the Groups list hasn't answered. */
  groups?: GroupRead[] | null;
  groupsFailed?: boolean;
  balances?: CardRead<Map<string, GroupBalanceAmounts>>;
  thisMonth?: CardRead<SpendingThisMonthRead>;
  lastChanges?: CardRead<GroupLastChangeRead[]>;
}

function table({
  layout,
  groups = GROUPS,
  groupsFailed = false,
  balances = ready(BALANCES),
  thisMonth = ready(THIS_MONTH),
  lastChanges = ready(LAST_CHANGES),
}: TableReads = {}) {
  return render(
    createElement(GroupsTableView, {
      userId: ALEX,
      layout,
      groups: groups ?? undefined,
      groupsFailed,
      onRetryGroups: noop,
      balances,
      thisMonth,
      lastChanges,
      onRetryFigures: noop,
      now: NOW,
    }),
  );
}

/** The desktop table's body rows, each as its cells' text. */
function tableRows(html: string): string[][] {
  const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
  return [...body.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(([row]) =>
    [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => text(cell)),
  );
}

/** The phone rows, each as its text. */
function phoneRows(html: string): string[] {
  const list = html.slice(html.indexOf('<ul'), html.indexOf('</ul>'));
  return [...list.matchAll(/<li\b[\s\S]*?<\/li>/g)].map(([row]) => text(row));
}

describe('the Groups table', () => {
  it('shows every Group: Theme with a Trip’s dates, avatars with +N, spent this month, the balance and Last change', () => {
    const html = table();
    expect(html).toMatch(/<section[^>]*aria-labelledby="home-groups-heading"/);
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(text(head)).toBe('Group Members Spent in October Your balance Last change');
    expect(tableRows(html)).toEqual([
      [
        'Maple House Household',
        'AR SC PS',
        '₹18,420.00',
        '−₹1,480.00 you owe ₹1,480.00',
        'Today, 9:14 AM',
      ],
      [
        'Goa Friends Trip Trip · Sep 17–20',
        'AR SC PS',
        // A legacy Group in two currencies: each on its own line, its own currency first.
        '₹9,840.00 €25.00',
        '+₹620.00 you are owed ₹620.00 +€12.50 you are owed €12.50',
        'Yesterday, 8:02 PM',
      ],
      // Nothing spent this month: zero in the Group's own currency.
      ['Lisbon Offsite Work', 'AR SC +2', '€0.00', '+€30.00 you are owed €30.00', 'Aug 28'],
      ['Sunday Football General', 'AR SC +6', '₹3,200.00', 'Settled up', '– No changes yet'],
    ]);
    // The avatars say who is in the Group, viewer first; past three, two and "+N".
    expect(html).toContain('role="img" aria-label="Members: you, Sam Chen and Priya Shah"');
    const football = html.slice(html.indexOf(`data-group-id="${GROUPS[3]._id}"`));
    expect(text(football.slice(0, football.indexOf('</tr>')))).toContain('AR SC +6');
    expect(html).toContain(`<time dateTime="${LAST_CHANGES[0].at}">Today, 9:14\u00a0AM</time>`);
  });

  it('lets the keyboard reach and scroll the table in a narrow card', () => {
    expect(openingTag(table(), 'aria-label="Groups table"')).toMatch(
      /^<div(?=[^>]*\brole="region")(?=[^>]*\btabindex="0")/i,
    );
    // A phone's rows don't scroll sideways: no extra keyboard stop.
    expect(table({ layout: 'rows' })).not.toContain('aria-label="Groups table"');
  });

  it('opens each Group from its row, and has New Group', () => {
    const links = anchors(table());
    expect(links.filter(({ href }) => href === `/groups/${maple}`)).toHaveLength(1);
    // A phone's row is itself the link.
    const rows = anchors(table({ layout: 'rows' }));
    expect(rows.find(({ href }) => href === `/groups/${maple}`)?.text).toBe(
      'Maple House Household −₹1,480.00 you owe ₹1,480.00 Today, 9:14 AM',
    );
    expect(links.find(({ href }) => href === '/groups/new')?.text).toBe('New Group');
  });

  it('collapses on a phone to rows with the name, the balance and the last change', () => {
    const html = table({ layout: 'rows' });
    expect(html).not.toContain('<table');
    expect(phoneRows(html)).toEqual([
      'Maple House Household −₹1,480.00 you owe ₹1,480.00 Today, 9:14 AM',
      'Goa Friends Trip Trip · Sep 17–20 +₹620.00 you are owed ₹620.00 +€12.50 you are owed €12.50 Yesterday, 8:02 PM',
      'Lisbon Offsite Work +€30.00 you are owed €30.00 Aug 28',
      'Sunday Football General Settled up – No changes yet',
    ]);
  });

  it('shows each figure loading on its own, never a figure or a failure', () => {
    const html = table({ balances: loading, thisMonth: loading, lastChanges: loading });
    expect(tableRows(html).map((row) => row.slice(2))).toEqual(GROUPS.map(() => ['', '', '']));
    expect(text(html)).not.toMatch(/Not available|could not be loaded/);
    // Until the read says which Month it is.
    expect(text(html)).toContain('Spent this month');
  });

  it('marks figures whose read failed as not available, and offers Try again', () => {
    const html = table({ balances: failed, lastChanges: failed });
    const [maple] = tableRows(html);
    expect(maple).toEqual([
      'Maple House Household',
      'AR SC PS',
      '₹18,420.00',
      '– Not available',
      '– Not available',
    ]);
    expect(text(html)).toContain('Some figures could not be loaded. Try again');
  });

  it('claims nothing for a Group a read doesn’t cover yet, without calling it a failure', () => {
    const fresh = group('b00000000000000000000009', 'Brand new Group', 'other', 1);
    const html = table({ groups: [...GROUPS, fresh] });
    expect(tableRows(html).at(-1)).toEqual([
      'Brand new Group General',
      'AR',
      '– Not available',
      '– Not available',
      '– Not available',
    ]);
    expect(text(html)).not.toContain('Some figures could not be loaded');
  });

  it('never rounds a balance it can’t read exactly', () => {
    const html = table({
      balances: ready(new Map([[maple, [{ currency: 'INR', balance: 14.805 }]]])),
    });
    expect(tableRows(html)[0][3]).toBe('– Not available');
  });

  it('announces loading until the Groups list answers', () => {
    const html = table({ groups: null });
    expect(html).toContain('role="status" aria-label="Loading your Groups"');
    expect(html).not.toContain('<table');
  });

  it('fails on its own with Try again when the Groups list can’t be read', () => {
    const html = table({ groups: null, groupsFailed: true });
    expect(text(html)).toBe('Groups New Group Your Groups could not be loaded. Try again');
  });

  it('keeps the Groups it showed when a refresh fails, and says so', () => {
    const html = table({ groupsFailed: true });
    expect(text(html)).toContain(
      'Groups could not be refreshed. Showing previously loaded Groups. Try again',
    );
    expect(tableRows(html)).toHaveLength(4);
  });

  it('invites a member with no Groups to start one', () => {
    const html = table({ groups: [] });
    expect(text(html)).toBe(
      'Groups New Group No Groups yet Start one with New Group, or join one from an invitation.',
    );
    expect(html).not.toContain('role="alert"');
  });
});

describe('the Groups table’s wording', () => {
  it('writes a Trip’s dates as calendar days, whatever the zone', () => {
    const at = (day: string) => `${day}T00:00:00.000Z`;
    expect(tripDatesLabel(at('2026-09-17'), at('2026-09-20'), NOW)).toBe('Sep 17–20');
    expect(tripDatesLabel(at('2026-09-29'), at('2026-10-02'), NOW)).toBe('Sep 29 – Oct 2');
    expect(tripDatesLabel(at('2026-09-17'), at('2026-09-17'), NOW)).toBe('Sep 17');
    expect(tripDatesLabel(at('2032-04-10'), at('2032-04-14'), NOW)).toBe('Apr 10–14, 2032');
    expect(tripDatesLabel(at('2026-12-29'), at('2027-01-02'), NOW)).toBe('Dec 29 – Jan 2, 2027');
    expect(tripDatesLabel(at('2026-09-17'), null, NOW)).toBe('From Sep 17');
    expect(tripDatesLabel(null, at('2026-09-20'), NOW)).toBe('Until Sep 20');
    expect(tripDatesLabel(null, null, NOW)).toBeNull();
  });

  it('gives a Trip its dates and every other Theme its name', () => {
    const dates = { startDate: '2026-09-17T00:00:00.000Z', endDate: '2026-09-20T00:00:00.000Z' };
    expect(themeLine({ category: 'trip', ...dates }, NOW)).toBe('Trip · Sep 17–20');
    expect(themeLine({ category: 'trip', startDate: null, endDate: null }, NOW)).toBe('Trip');
    expect(themeLine({ category: 'home', ...dates }, NOW)).toBe('Household');
  });

  it('says when a Group last changed in the viewer’s own day', () => {
    expect(lastChangeLabel(new Date(2026, 9, 7, 0, 5), NOW)).toBe('Today, 12:05\u00a0AM');
    expect(lastChangeLabel(new Date(2026, 9, 6, 23, 59), NOW)).toBe('Yesterday, 11:59\u00a0PM');
    expect(lastChangeLabel(new Date(2026, 9, 5, 23, 59), NOW)).toBe('Oct 5');
    expect(lastChangeLabel(new Date(2025, 11, 31, 10, 0), NOW)).toBe('Dec 31, 2025');
  });
});
