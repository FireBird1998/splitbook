import { queryKeyPath, type QueryKey } from '@splitbook/shared/query-keys';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider, getContrastRatio } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpensePageRead, ExpenseRead } from '@splitbook/shared/expense-page-read';
import type { GroupRead } from '@splitbook/shared/group-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { darkTokens, lightTokens } from '@/lib/theme/tokens';
import { text } from '@/lib/test-utils/markup';

/*
 * #310: the Expenses tab as the server renders it. The table, the phone cards, the list's
 * loading, failed and empty states, the recurring icon behind the product switch, the Month
 * bar's wording, and the toolbar. The reads are stand-ins; everything they feed is real.
 */

const navigation = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/groups/c00000000000000000000001/expenses',
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

/** What each read returns, by the start of its path; anything else is still loading. */
const reads = vi.hoisted(() => new Map<string, { data?: unknown; error?: Error }>());
vi.mock('swr', async (original) => {
  const actual = await original<typeof import('swr')>();
  return {
    ...actual,
    default: (queryKey: QueryKey | null) => {
      const key = queryKey ? queryKeyPath(queryKey) : null;
      const read = key ? [...reads].find(([prefix]) => key.startsWith(prefix))?.[1] : undefined;
      return {
        ...read,
        data:
          read?.data === undefined
            ? undefined
            : {
                status: 200,
                data:
                  read.data instanceof Map
                    ? [...read.data].map(([_id, value]) => ({ _id, ...value }))
                    : read.data,
              },
        isValidating: false,
        isLoading: !read,
        mutate: vi.fn(),
      };
    },
  };
});

const { default: ExpenseTable, expenseDay } = await import('./ExpenseTable');
const { default: ExpenseCard } = await import('./ExpenseCard');
const { default: ExpenseDetails } = await import('./ExpenseDetails');
const { default: ExpenseListView } = await import('./ExpenseListView');
const { default: ExpenseToolbar, amountRangeLabel } = await import('./ExpenseToolbar');
const { DEFAULT_EXPENSE_LIST_QUERY } = await import('./expense-list-query');
const { default: MonthCycleBar } = await import('@/components/groups/MonthCycleBar');
const { default: MonthMemberTable } = await import('@/components/groups/MonthMemberTable');

const GROUP = 'c00000000000000000000001';
const ALEX = { _id: 'a00000000000000000000001', name: 'Alex Rivera', image: null };
const SAM = { _id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const PRIYA = { _id: 'a00000000000000000000003', name: 'Priya Shah', image: null };
const TIME = '2026-09-01T00:00:00.000Z';

type Person = typeof ALEX;
function expense(
  id: number,
  description: string,
  tag: string,
  paidBy: Person,
  shares: Array<[Person, number]>,
  extra: Partial<ExpenseRead> = {},
): ExpenseRead {
  const total = shares.reduce((sum, [, minor]) => sum + minor, 0);
  return {
    _id: `e0000000000000000000000${id}`,
    group: GROUP,
    description,
    currency: 'INR',
    amount: total / 100,
    amountMinor: total,
    moneyVersion: 1,
    date: `${new Date().getFullYear()}-09-${String(30 - id).padStart(2, '0')}T06:00:00.000Z`,
    createdAt: TIME,
    updatedAt: TIME,
    category: 'other',
    tag,
    tagId: null,
    paidBy: [{ user: paidBy, amount: total / 100, amountMinor: total }],
    splitBetween: shares.map(([user, minor]) => ({
      user,
      amount: minor / 100,
      amountMinor: minor,
    })),
    splitMethod: 'equal',
    recurringExpense: null,
    ...extra,
  };
}

const EXPENSES = [
  expense(1, 'Weekly groceries', 'Groceries', ALEX, [
    [ALEX, 41650],
    [SAM, 41650],
    [PRIYA, 41650],
  ]),
  expense(2, 'Electricity bill', 'Utilities', SAM, [
    [SAM, 95334],
    [ALEX, 95333],
    [PRIYA, 95333],
  ]),
  expense(
    3,
    'Wi-Fi',
    'Utilities',
    PRIYA,
    [
      [ALEX, 33300],
      [SAM, 33300],
      [PRIYA, 33300],
    ],
    { recurringExpense: 'f00000000000000000000001' },
  ),
  expense(4, 'Takeaway pizza', 'Dining', PRIYA, [
    [SAM, 59000],
    [PRIYA, 59000],
  ]),
];

const page = (expenses: ExpenseRead[], summary: Partial<ExpensePageRead['summary']> = {}) => ({
  expenses,
  pagination: { page: 1, limit: 50, total: expenses.length, totalPages: 1 },
  summary: {
    count: expenses.length,
    totalAmount: 0,
    totalsByCurrency: [{ currency: 'INR', totalAmount: 6289.5 }],
    userOwes: 1286.33,
    userGetsBack: 833,
    ...summary,
  },
});

function group(category: GroupRead['category']): GroupRead {
  return {
    _id: GROUP,
    name: category === 'home' ? 'Maple House' : 'Goa Friends Trip',
    description: '',
    image: undefined,
    createdBy: ALEX._id,
    defaultCurrency: 'INR',
    currencyLocked: true,
    alternateCurrencies: [],
    category,
    startDate: null,
    endDate: null,
    isArchived: false,
    tags: [
      {
        _id: 'd00000000000000000000001',
        name: 'Groceries',
        isArchived: false,
        isDeleted: false,
        createdAt: TIME,
      },
      {
        _id: 'd00000000000000000000002',
        name: 'Old Tag',
        isArchived: false,
        isDeleted: true,
        createdAt: TIME,
      },
    ],
    createdAt: TIME,
    updatedAt: TIME,
    members: [ALEX, SAM, PRIYA].map((user) => ({
      user: {
        ...user,
        email: `${user.name.split(' ')[0].toLowerCase()}@example.test`,
        image: undefined,
      },
      role: user === ALEX ? ('admin' as const) : ('member' as const),
      joinedAt: TIME,
    })),
  } as GroupRead;
}

function render(element: ReactElement, mode: 'light' | 'dark' = 'light') {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
  );
}

/** Every button's content: a control inside another shows up as a tag inside one. */
function controlsInsideButtons(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    .map(([, inner]) => inner)
    .filter((inner) => /<(button|a|input|select|textarea)\b|role="(button|link)"/.test(inner));
}

const rows = (html: string) =>
  [...html.matchAll(/<tr\b[^>]*data-expense-id[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => text(cell)),
  );

function table(recurringExpensesEnabled: boolean, openId: string | null = null) {
  return render(
    createElement(ExpenseTable, {
      expenses: EXPENSES,
      userId: ALEX._id,
      recurringExpensesEnabled,
      label: 'Expenses, September 2026',
      caption: 'Expenses in September 2026, newest first. Select an Expense to see its details.',
      openId,
      onToggle: vi.fn(),
      panelId: 'expense-panel',
    }),
  );
}

beforeEach(() => {
  reads.clear();
  navigation.search = '';
});

describe('the Expense table', () => {
  it('has the design canvas’s columns, in a labelled section with a caption', () => {
    const html = table(false);
    expect(
      [...html.matchAll(/<th\b[^>]*scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map(([, th]) => text(th)),
    ).toEqual(['Date', 'Description', 'Paid by', 'Split', 'Amount', 'You']);
    expect(html).toMatch(/<section\b[^>]*aria-label="Expenses, September 2026"/);
    expect(html).toMatch(/<caption\b[^>]*>Expenses in September 2026, newest first\./);
  });

  it('shows each Expense’s date, description and Tag, who paid, the split, the amount and an exact position', () => {
    expect(rows(table(false))).toEqual([
      [
        expenseDay(EXPENSES[0].date),
        'Weekly groceries Groceries',
        'AR You',
        'Equally · 3',
        '₹1,249.50',
        'you lent ₹833.00',
      ],
      [
        expenseDay(EXPENSES[1].date),
        'Electricity bill Utilities',
        'SC Sam Chen',
        'Equally · 3',
        '₹2,860.00',
        'you owe ₹953.33',
      ],
      [
        expenseDay(EXPENSES[2].date),
        'Wi-Fi Utilities',
        'PS Priya Shah',
        'Equally · 3',
        '₹999.00',
        'you owe ₹333.00',
      ],
      [
        expenseDay(EXPENSES[3].date),
        'Takeaway pizza Dining',
        'PS Priya Shah',
        'Equally · 2',
        '₹1,180.00',
        '— nothing to settle',
      ],
    ]);
  });

  it('dates a row as "Wed 30 Sep", with the year only when it isn’t this year', () => {
    // Noon on the day in the zone the tests run in, sent as the API sends dates: the table shows
    // the viewer's own day, as the rest of the app does, so these hold in every zone CI runs
    // (#227), from UTC−11 to UTC+14.
    const localNoon = (year: number, month: number, day: number) =>
      new Date(year, month - 1, day, 12).toISOString();
    const now = new Date(localNoon(2026, 10, 7));
    expect(expenseDay(localNoon(2026, 9, 30), now)).toBe('Wed 30 Sep');
    expect(expenseDay(localNoon(2025, 9, 30), now)).toBe('Tue 30 Sep 2025');
    expect(expenseDay(localNoon(2026, 1, 1), now)).toBe('Thu 1 Jan');
    expect(expenseDay(localNoon(2025, 12, 31), now)).toBe('Wed 31 Dec 2025');
  });

  it('shows a repeat icon only on an Expense a recurring Expense added, and only while the switch is on', () => {
    expect(table(true).match(/aria-label="Repeats monthly"/g)).toHaveLength(1);
    expect(rows(table(true))[2][1]).toBe('Wi-Fi Utilities');
    const wifi = table(true).match(
      /<tr\b[^>]*data-expense-id="e00000000000000000000003"[\s\S]*?<\/tr>/,
    )![0];
    expect(wifi).toMatch(/<svg\b(?=[^>]*role="img")(?=[^>]*aria-label="Repeats monthly")[^>]*>/);
    expect(table(false)).not.toContain('Repeats monthly');
  });

  it('opens an Expense in the side panel from a button in its row, with no control inside another', () => {
    const closed = table(false);
    expect(controlsInsideButtons(closed)).toEqual([]);
    expect(closed.match(/<button\b[^>]*aria-expanded="false"/g)).toHaveLength(4);
    expect(closed).not.toContain('aria-controls');
    expect(closed).not.toMatch(/role="button"/);

    // The open row is marked, and its button names the panel beside the table (#311): nothing
    // opens below the row any more.
    const open = table(false, EXPENSES[1]._id);
    expect(open).toMatch(/<button\b[^>]*aria-expanded="true"[^>]*aria-controls="expense-panel"/);
    expect(open.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(open).not.toMatch(/colspan/i);
    expect(rows(open)).toHaveLength(4);
    expect(controlsInsideButtons(open)).toEqual([]);
  });
});

describe('an Expense card on a phone', () => {
  const card = (row: ExpenseRead, recurringExpensesEnabled = false, isExpanded = false) =>
    render(
      createElement(ExpenseCard, {
        expense: row,
        userId: ALEX._id,
        recurringExpensesEnabled,
        isExpanded,
        onToggleExpand: vi.fn(),
        details: createElement('p', null, 'Opened'),
        detailsId: 'card-details',
      }),
    );

  it('is one button with what it was, who paid, the split, the Tag, the amount and the exact position', () => {
    const html = card(EXPENSES[1]);
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(text(html)).toBe(
      // The Category's emoji is hidden from screen readers.
      '📋 Electricity bill Sam Chen paid · Equally · 3 Utilities ₹2,860.00 you owe ₹953.33',
    );
    expect(html).toMatch(/<span\b[^>]*aria-hidden="true"[^>]*>📋<\/span>/);
    expect(text(card(EXPENSES[0]))).toContain(
      'You paid · Equally · 3 Groceries ₹1,249.50 you lent ₹833.00',
    );
    expect(controlsInsideButtons(html)).toEqual([]);
  });

  it('names its details only while they are open', () => {
    expect(card(EXPENSES[1])).not.toContain('aria-controls');
    expect(card(EXPENSES[1], false, true)).toMatch(
      /aria-expanded="true"[^>]*aria-controls="card-details"|aria-controls="card-details"[^>]*aria-expanded="true"/,
    );
  });

  it('shows the repeat icon only while recurring Expenses are on', () => {
    expect(card(EXPENSES[2], true)).toContain('aria-label="Repeats monthly"');
    expect(card(EXPENSES[2], false)).not.toContain('Repeats monthly');
  });
});

describe('an opened Expense’s details', () => {
  const details = (
    recurringExpensesEnabled: boolean,
    history: 'loading' | 'ready' | 'failed' = 'ready',
  ) =>
    render(
      createElement(ExpenseDetails, {
        id: 'opened',
        expense: EXPENSES[2],
        userId: ALEX._id,
        recurringExpensesEnabled,
        history,
        onRetryHistory: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      }),
    );

  it('says it repeats only while recurring Expenses are on', () => {
    expect(text(details(true))).toContain('Repeats monthly');
    expect(text(details(false))).not.toMatch(/Repeats|Recurring/);
  });

  it('is a named section with Edit and Delete', () => {
    const html = details(false);
    expect(html).toMatch(/<section\b[^>]*aria-label="Wi-Fi details"/);
    expect(text(html)).toMatch(/Edit Delete$/);
  });

  it('offers Try again when its history can’t be loaded', () => {
    expect(text(details(false, 'failed'))).toContain(
      'This Expense’s history could not be loaded. Try again',
    );
  });
});

describe('the Expense list', () => {
  const list = (category: GroupRead['category'] = 'trip', props: Record<string, unknown> = {}) =>
    render(
      createElement(ExpenseListView, {
        groupId: GROUP,
        userId: ALEX._id,
        group: group(category),
        onAddExpense: vi.fn(),
        monthCycle: category === 'home',
        ...props,
      }),
    );
  const LIST = `/api/groups/${GROUP}/expenses`;

  it('shows a loading state while the first page loads', () => {
    const html = list();
    expect(html).toMatch(
      /role="status"[^>]*aria-label="Loading Expenses"|aria-label="Loading Expenses"[^>]*role="status"/,
    );
  });

  it('says a failed load failed and offers Try again, never the raw error', () => {
    reads.set(LIST, { error: new Error('MongoServerError: connection 7 to 10.0.0.4 closed') });
    const html = list();
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('Expenses could not be loaded. Try again');
    expect(html).not.toMatch(/MongoServerError|10\.0\.0\.4/);
  });

  it('keeps the list it has when a refresh fails, and says so', () => {
    reads.set(LIST, { data: page(EXPENSES), error: new Error('Internal diagnostic') });
    const html = list();
    expect(text(html)).toContain(
      'Expenses could not be refreshed. Showing the list loaded before. Try again',
    );
    expect(text(html)).toContain('Weekly groceries');
    expect(html).not.toContain('Internal diagnostic');
  });

  it('keeps cards on a phone, under day headings, with no control inside another', () => {
    reads.set(LIST, { data: page(EXPENSES) });
    const html = list();
    // The server renders the phone layout; the table takes over from the md breakpoint.
    expect(html).not.toContain('<table');
    const cards = html.slice(html.search(/<section\b[^>]*aria-label="Expenses"/));
    expect(cards).not.toBe(html);
    expect(cards.match(/<button\b[^>]*aria-expanded="false"/g)).toHaveLength(4);
    expect(controlsInsideButtons(html)).toEqual([]);
  });

  it('shows a summary outside a Household, with "You owe" and "You get back"', () => {
    reads.set(LIST, { data: page(EXPENSES) });
    expect(text(list())).toMatch(
      /Spent ₹6,289.50 Expenses 4 You owe ₹1,286.33 You get back ₹833.00/,
    );
  });

  it('leaves the summary to the Month bar in a Household, and leaves out the date quick-filters', () => {
    reads.set(LIST, { data: page(EXPENSES) });
    const html = list('home');
    expect(text(html)).not.toContain('You get back');
    expect(text(html)).not.toMatch(/Date Any time/);
    expect(text(list('trip'))).toMatch(/Date Any time/);
  });

  it('offers the first Expense when there are none', () => {
    reads.set(LIST, { data: page([]) });
    expect(text(list())).toContain(
      'No expenses yet Add a shared cost — tags and equal split are ready. Add first expense',
    );
  });

  it('says nothing matches, with Clear filters, when filters leave nothing', () => {
    navigation.search = 'search=zzz&involvesMe=1';
    reads.set(LIST, { data: page([]) });
    const html = text(list());
    expect(html).toContain('No matching Expenses');
    expect(html).toContain('0 Expenses match');
    expect(html).toMatch(/Clear filters$/);
  });

  it('fills its search from a ?search= link', () => {
    navigation.search = 'search=Trip%20SIM%20cards';
    expect(list()).toMatch(/<input\b[^>]*value="Trip SIM cards"/);
  });
});

describe('the toolbar', () => {
  const toolbar = (change: Partial<typeof DEFAULT_EXPENSE_LIST_QUERY> = {}, dateWindows = true) =>
    render(
      createElement(ExpenseToolbar, {
        query: { ...DEFAULT_EXPENSE_LIST_QUERY, ...change },
        onChange: vi.fn(),
        groupName: 'Maple House',
        currency: 'INR',
        members: [
          { id: ALEX._id, label: 'You' },
          { id: SAM._id, label: 'Sam Chen' },
        ],
        tags: [{ id: 'd00000000000000000000001', label: 'Groceries' }],
        dateWindows,
      }),
    );

  it('is a search region with the search field and every filter, the sort last', () => {
    const html = toolbar();
    expect(html).toMatch(/role="search"[^>]*aria-label="Find Expenses in Maple House"/);
    expect(html).toMatch(/<input\b[^>]*aria-label="Search Expenses in Maple House"/);
    expect(text(html)).toBe(
      'Paid by Anyone Tag All Amount Any Involves me Date Any time Newest first',
    );
    expect(html).toContain('aria-label="Sort: Newest first"');
    expect(html).toMatch(/aria-pressed="false"[^>]*>Involves me/);
    expect(text(toolbar({}, false))).not.toContain('Date');
  });

  it('shows the filters in use, and Clear filters', () => {
    const html = toolbar({
      paidBy: SAM._id,
      tag: 'd00000000000000000000001',
      involvesMe: true,
      min: '500',
      sort: 'largest',
    });
    expect(text(html)).toBe(
      'Paid by Sam Chen Tag Groceries Amount ₹500.00 or more Involves me Date Any time Largest first Clear filters',
    );
    expect(html).toMatch(/aria-pressed="true"/);
  });

  it('writes an amount range the way the Group’s currency does', () => {
    expect(amountRangeLabel('500', '1249.5', 'INR')).toBe('₹500.00 – ₹1,249.50');
    expect(amountRangeLabel(null, '20', 'INR')).toBe('Up to ₹20.00');
    expect(amountRangeLabel(null, null, 'INR')).toBe('Any');
  });

  it('opens a custom date window’s days under it', () => {
    expect(text(toolbar({ when: 'custom', from: '2026-09-01', to: '2026-10-05' }))).toContain(
      'Choose 31 days or fewer.',
    );
  });
});

describe('the Household Month bar', () => {
  const bar = (summary: Parameters<typeof MonthCycleBar>[0]['summary'], failed = false) =>
    render(createElement(MonthCycleBar, { currency: 'INR', summary, failed, onRetry: vi.fn() }));

  it('shows Spent, Your share, You paid and Expenses, worded with "Paid", never "fronted"', () => {
    navigation.search = 'month=2026-08';
    const html = bar({ spent: 18420, share: 6140, paid: 5210, count: 14 });
    expect(html).toMatch(/<section\b[^>]*aria-label="August 2026 summary"/);
    expect(html).toMatch(/<h2\b[^>]*>August 2026<\/h2>/);
    expect(text(html)).toMatch(
      /Spent ₹18,420.00 Your share ₹6,140.00 You paid ₹5,210.00 Expenses 14$/,
    );
    expect([...html.matchAll(/<dt\b[^>]*>([^<]*)<\/dt>/g)].map(([, term]) => term)).toEqual([
      'Spent',
      'Your share',
      'You paid',
      'Expenses',
    ]);
    expect(html).not.toMatch(/fronted/i);
  });

  it('marks the period it shows, and says why Next can’t go past this Month', () => {
    navigation.search = '';
    const allTime = bar({ spent: 1, share: 1, paid: 1, count: 1 });
    expect(allTime).toMatch(/aria-label="All time summary"/);
    expect(allTime).toMatch(/aria-pressed="true"[^>]*>All time/);
    expect(allTime).toContain('aria-label="Next month, unavailable while showing all time"');
    const month = new Date().toLocaleString('en-US', { month: 'long' });
    navigation.search = `month=${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const current = bar({ spent: 1, share: 1, paid: 1, count: 1 });
    expect(current).toMatch(/aria-pressed="true"[^>]*>This month/);
    expect(current).toContain(
      `aria-label="Next month, unavailable: ${month} is the current month"`,
    );
    expect(current).toMatch(/aria-disabled="true"/);
  });

  it('loads, and fails with Try again, on its own', () => {
    navigation.search = 'month=2026-08';
    expect(text(bar(null))).toContain(
      'Spent Loading Your share Loading You paid Loading Expenses Loading',
    );
    expect(text(bar(null, true))).toContain('August 2026’s figures could not be loaded. Try again');
  });

  it('heads the per-member table "Paid", never "Fronted"', () => {
    const html = render(
      createElement(MonthMemberTable, {
        rows: [{ user: { _id: ALEX._id, name: ALEX.name }, paid: 5210, share: 6140, net: 930 }],
        currency: 'INR',
        userId: ALEX._id,
        monthName: 'August',
      }),
    );
    expect(text(html)).toContain('Paid Share Net');
    expect(text(html)).toContain('share − paid');
    expect(html).not.toMatch(/fronted/i);
  });
});

describe('the "you owe" and "you lent" captions', () => {
  it('reach 4.5:1 on every surface a row or summary has, in light and dark', () => {
    for (const tokens of [lightTokens, darkTokens]) {
      for (const color of [tokens.status.negative, tokens.status.positive, tokens.textSecondary])
        for (const surface of [tokens.surface, tokens.surfaceHover, tokens.brand.bg, tokens.bg])
          expect(
            getContrastRatio(color, surface),
            `${tokens.mode} ${color} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('use the status colours, not the 3.92:1 and 3.56:1 accents they used before', () => {
    const html = table(false);
    for (const accent of [lightTokens.negative.main, lightTokens.positive.main])
      expect(html.toLowerCase()).not.toContain(accent);
    expect(html.toLowerCase()).toContain(lightTokens.status.negative);
    expect(html.toLowerCase()).toContain(lightTokens.status.positive);
  });
});
