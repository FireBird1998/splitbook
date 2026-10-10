import { queryKeyPath, type QueryKey } from '@splitbook/shared/query-keys';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider, getContrastRatio } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime } from '@splitbook/shared/date';
import {
  expenseDateForPeriod,
  nextPeriod,
  toPeriod,
} from '@splitbook/shared/recurring-due-periods';
import { format } from 'date-fns';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import type { GroupRead } from '@splitbook/shared/group-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { darkTokens, lightTokens } from '@/lib/theme/tokens';
import { HttpResponseError } from '@/lib/utils/fetcher';
import { text } from '@/lib/test-utils/markup';

/*
 * #311: the Expense side panel as the server renders it. Its sections, the leftover explanation,
 * the Repeats row behind the product-wide switch (#289), the history, and the empty, lost,
 * loading and failed states; then the Expenses tab opening the Expense its address names, beside
 * the table on a computer and below its card on a phone. The reads are stand-ins.
 */

const navigation = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/groups/c00000000000000000000001/expenses',
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

/** Whether the page renders for a computer (the md breakpoint up) or a phone. */
const media = vi.hoisted(() => ({ computer: true }));
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => media.computer }));

/** What each read returns, by the longest start of its path; anything else is still loading. */
const reads = vi.hoisted(() => new Map<string, { data?: unknown; error?: Error }>());
vi.mock('swr', async (original) => {
  const actual = await original<typeof import('swr')>();
  return {
    ...actual,
    default: (queryKey: QueryKey | null) => {
      const key = queryKey ? queryKeyPath(queryKey) : null;
      const match = key
        ? [...reads]
            .filter(([prefix]) => key.startsWith(prefix))
            .sort(([a], [b]) => b.length - a.length)[0]
        : undefined;
      const read = match?.[1];
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

const { default: ExpensePanel, panelDay } = await import('./ExpensePanel');
const { default: ExpenseListView } = await import('./ExpenseListView');

const GROUP = 'c00000000000000000000001';
const ALEX = { _id: 'a00000000000000000000001', name: 'Alex Rivera', image: null };
const SAM = { _id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const PRIYA = { _id: 'a00000000000000000000003', name: 'Priya Shah', image: null };
const WIFI_TEMPLATE = 'f00000000000000000000001';
const at = (day: number, hour = 9) =>
  new Date(Date.UTC(new Date().getUTCFullYear(), 8, day, hour, 10)).toISOString();

type Person = typeof ALEX;
const row = (user: Person, minor: number) => ({ user, amount: minor / 100, amountMinor: minor });

/**
 * ₹2,860.00 Sam paid, split equally as shared money splits it: ₹953.33 each and the paisa left
 * over to the first member by id, who is the viewer, Alex.
 */
function electricity(extra: Record<string, unknown> = {}) {
  return {
    _id: 'e00000000000000000000002',
    group: GROUP,
    revision: 2,
    description: 'Electricity bill',
    currency: 'INR',
    amount: 2860,
    amountMinor: 286000,
    moneyVersion: 1,
    date: at(29, 12),
    createdAt: at(29, 14),
    updatedAt: at(29, 15),
    category: 'housing',
    tag: 'Utilities',
    tagId: 'd00000000000000000000001',
    notes: 'August–September meter cycle',
    isDeleted: false,
    createdBy: SAM,
    paidBy: [row(SAM, 286000)],
    splitBetween: [row(SAM, 95333), row(ALEX, 95334), row(PRIYA, 95333)],
    splitMethod: 'equal' as const,
    recurringExpense: null,
    editHistory: [
      {
        editedBy: PRIYA,
        editedAt: at(29, 15),
        changes: {
          amount: { old: 2680, new: 2860 },
          amountMinor: { old: 268000, new: 286000 },
        },
      },
    ],
    ...extra,
  };
}

/** Wi-Fi, which a recurring Expense added: ₹999.00 split exactly three ways. */
const wifi = () =>
  electricity({
    _id: 'e00000000000000000000003',
    description: 'Wi-Fi',
    amount: 999,
    amountMinor: 99900,
    paidBy: [row(PRIYA, 99900)],
    splitBetween: [row(ALEX, 33300), row(SAM, 33300), row(PRIYA, 33300)],
    notes: '',
    editHistory: [],
    recurringExpense: WIFI_TEMPLATE,
  });

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

type PanelState = Parameters<typeof ExpensePanel>[0]['state'];
const panel = (state: PanelState, mode: 'light' | 'dark' = 'light') =>
  render(
    createElement(ExpensePanel, {
      id: 'expense-panel',
      state,
      userId: ALEX._id,
      onClose: vi.fn(),
      onRetry: vi.fn(),
      onEdit: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete: vi.fn(),
    }),
    mode,
  );
const opened = (
  expense = electricity(),
  history: 'loading' | 'ready' | 'failed' = 'ready',
  repeats: string | null = null,
): PanelState => ({ kind: 'open', expense, history, repeats });

/** The panel's who-owes-what rows, as their cells read. */
const owes = (html: string) => {
  const table = /<table\b[^>]*>[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
  return [...table.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)]
    .flatMap(([, body]) => [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)])
    .map(([, cells]) => text(cells));
};

beforeEach(() => {
  reads.clear();
  navigation.search = '';
  media.computer = true;
});

describe('the side panel with an Expense open', () => {
  it('is a named region with the amount, the member’s position, Edit and Duplicate, then every section, and Delete last', () => {
    const html = panel(opened());
    expect(html).toMatch(
      /<section\b[^>]*id="expense-panel"[^>]*aria-label="Electricity bill details"/,
    );
    expect(html).toMatch(/<h2\b[^>]*>Electricity bill<\/h2>/);
    expect(text(html)).toBe(
      [
        'Expense',
        '🏠 Electricity bill',
        `${panelDay(electricity().date)} · Utilities`,
        '₹2,860.00 You owe Sam Chen ₹953.34',
        'Edit Duplicate',
        'Who owes what Equally · 3',
        'Person Paid Share',
        'SC Sam Chen ₹2,860.00 ₹953.33',
        'AR You – nothing ₹953.34',
        'PS Priya Shah – nothing ₹953.33',
        'The leftover ₹0.01 went to you, so the total is exact. It goes to the shares rounded down the most, and a fixed member order settles a tie.',
        'Category Housing',
        'Notes August–September meter cycle',
        'History Edits keep a record',
        `PS Priya Shah changed the amount ₹2,680.00 → ₹2,860.00 · ${formatDateTime(at(29, 15))}`,
        `SC Sam Chen added this Expense ${formatDateTime(at(29, 14))}`,
        'Delete Expense',
      ].join(' '),
    );
    expect([...html.matchAll(/<h3\b[^>]*>([^<]*)<\/h3>/g)].map(([, title]) => title)).toEqual([
      'Who owes what',
      'History',
    ]);
    expect(controlsInsideButtons(html)).toEqual([]);
  });

  it('shows who owes what exactly, from the stored shares, as a table with Paid and Share', () => {
    const html = panel(opened());
    expect(html).toMatch(/<table\b[^>]*aria-labelledby="[^"]+"/);
    expect(owes(html)).toEqual([
      'SC Sam Chen ₹2,860.00 ₹953.33',
      'AR You – nothing ₹953.34',
      'PS Priya Shah – nothing ₹953.33',
    ]);
    expect(html.match(/<th\b[^>]*scope="row"/g)).toHaveLength(3);
  });

  it('explains a leftover by the rule and names who got it, never as the payer’s', () => {
    const note = /The leftover[^<]*/.exec(panel(opened()))![0];
    expect(note).toContain('went to you');
    expect(note).toContain('a fixed member order settles a tie');
    expect(note).not.toMatch(/pa(id|yer)/i);
    // Sam paid; had the paisa gone to him, it still wouldn't be put down to his paying.
    const stored = electricity({
      splitBetween: [row(SAM, 95334), row(ALEX, 95333), row(PRIYA, 95333)],
    });
    expect(/The leftover[^<]*/.exec(panel(opened(stored)))![0]).toBe(
      'The leftover ₹0.01 went to Sam Chen, so the total is exact.',
    );
    // An even split has nothing left over to explain.
    expect(panel(opened(wifi()))).not.toContain('leftover');
  });

  it('says what the Expense means for the member, whichever side they are on', () => {
    // The amount, then the position, up to the actions (none are offered here).
    const position = (expense: ReturnType<typeof electricity>, userId: string) =>
      /^Expense \S+ .+? · Utilities ₹[\d,.]+ (.*?) Who owes what/.exec(
        text(
          render(
            createElement(ExpensePanel, {
              id: 'p',
              state: opened(expense),
              userId,
              onClose: vi.fn(),
              onRetry: vi.fn(),
            }),
          ),
        ),
      )?.[1];
    expect(position(electricity(), ALEX._id)).toBe('You owe Sam Chen ₹953.34');
    expect(position(electricity(), SAM._id)).toBe('You lent ₹1,906.67');
    // Rent, where each flatmate pays the landlord their own third.
    const rent = electricity({
      paidBy: [row(SAM, 1800000), row(ALEX, 1800000), row(PRIYA, 1800000)],
      splitBetween: [row(SAM, 1800000), row(ALEX, 1800000), row(PRIYA, 1800000)],
      amount: 54000,
      amountMinor: 5400000,
    });
    expect(position(rent, ALEX._id)).toBe('You paid your share');
    // Someone who is in neither, and two people owed, so no one is named.
    expect(position(electricity(), 'a00000000000000000000009')).toBe('You’re not part of it');
    const twoPaid = electricity({ paidBy: [row(SAM, 143000), row(PRIYA, 143000)] });
    expect(position(twoPaid, ALEX._id)).toBe('You owe ₹953.34');
    // In the panel, the member's own row is "You", and the leftover went to "you".
    expect(text(panel(opened()))).toContain('AR You – nothing ₹953.34');
  });

  it('shows Repeats only when it has one: the list leaves it out while recurring Expenses are off', () => {
    expect(text(panel(opened(wifi(), 'ready', 'Monthly on the 28th · next 28 Oct')))).toContain(
      'Category Housing Repeats Monthly on the 28th · next 28 Oct History',
    );
    expect(text(panel(opened(wifi(), 'ready', null)))).not.toMatch(/Repeats|Monthly/);
  });

  it('says while its history loads, and offers Try again when it can’t be loaded', () => {
    expect(text(panel(opened(electricity(), 'loading')))).toContain(
      'History Edits keep a record Loading its history…',
    );
    const failed = panel(opened(electricity(), 'failed'));
    expect(text(failed)).toContain(
      'History Edits keep a record This Expense’s history could not be loaded. Try again',
    );
    expect(failed).toContain('role="alert"');
  });

  it('shows the position in readable status colours on their tints, in light and dark', () => {
    for (const tokens of [lightTokens, darkTokens])
      for (const tone of ['positive', 'negative'] as const)
        expect(
          getContrastRatio(tokens.status[tone], tokens[tone].bg),
          `${tokens.mode} ${tone}`,
        ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the side panel with nothing to show', () => {
  it('is quiet with nothing open', () => {
    const html = panel({ kind: 'empty' });
    expect(html).toMatch(/<section\b[^>]*id="expense-panel"[^>]*aria-label="Expense details"/);
    expect(text(html)).toBe(
      'No Expense open Pick an Expense to see who owes what, its notes and its history.',
    );
    expect(html).not.toContain('<button');
  });

  it('says plainly when the open Expense has gone, and can be closed', () => {
    const html = panel({ kind: 'lost' });
    expect(text(html)).toBe(
      'This Expense isn’t here any more It was deleted, or it’s no longer in this Group. ' +
        'Pick another Expense to see its details.',
    );
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<button\b[^>]*aria-label="Close Expense details"/);
  });

  it('loads, and fails with Try again, when opened from a link', () => {
    expect(panel({ kind: 'loading' })).toMatch(
      /role="status"[^>]*aria-label="Loading the Expense"|aria-label="Loading the Expense"[^>]*role="status"/,
    );
    expect(text(panel({ kind: 'failed' }))).toBe(
      'Expense This Expense could not be loaded. Try again',
    );
  });
});

describe('the Expenses tab with an Expense open', () => {
  const group = {
    _id: GROUP,
    name: 'Banyan Court Flat 4B',
    description: '',
    createdBy: ALEX._id,
    defaultCurrency: 'INR',
    currencyLocked: true,
    alternateCurrencies: [],
    category: 'home',
    startDate: null,
    endDate: null,
    isArchived: false,
    tags: [],
    createdAt: at(1),
    updatedAt: at(1),
    members: [ALEX, SAM, PRIYA].map((user) => ({
      user: { ...user, email: `${user.name.split(' ')[0].toLowerCase()}@example.test` },
      role: 'member' as const,
      joinedAt: at(1),
    })),
  } as unknown as GroupRead;
  const LIST = `/api/groups/${GROUP}/expenses?`;
  const record = (id: string) => `/api/groups/${GROUP}/expenses/${id}`;
  const listed = (...expenses: Array<ReturnType<typeof electricity>>) => ({
    data: {
      expenses: expenses.map(({ editHistory, notes, revision, isDeleted, ...rest }) => {
        void [editHistory, notes, revision, isDeleted];
        return rest as unknown as ExpenseRead;
      }),
      pagination: { page: 1, limit: 50, total: expenses.length, totalPages: 1 },
      summary: { count: expenses.length, totalsByCurrency: [], userOwes: 0, userGetsBack: 0 },
    },
  });
  const tab = (recurringExpensesEnabled = false) =>
    render(
      createElement(ExpenseListView, {
        groupId: GROUP,
        userId: ALEX._id,
        group,
        monthCycle: true,
        recurringExpensesEnabled,
      }),
    );

  it('shows the Expense the address names in the panel beside the table, its row marked', () => {
    navigation.search = `expense=${electricity()._id}`;
    reads.set(LIST, listed(electricity(), wifi()));
    reads.set(record(electricity()._id), { data: electricity() });
    const html = tab();
    expect(html).toContain('<table');
    expect(html).toMatch(
      /<section\b[^>]*id="expense-panel"[^>]*aria-label="Electricity bill details"/,
    );
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html).toMatch(
      /data-expense-id="e00000000000000000000002"[\s\S]*?<button\b[^>]*aria-expanded="true"[^>]*aria-controls="expense-panel"/,
    );
    expect(text(html)).toContain('PS Priya Shah changed the amount ₹2,680.00 → ₹2,860.00');
  });

  it('shows the list’s row until the Expense’s own read arrives, its history still loading', () => {
    navigation.search = `expense=${electricity()._id}`;
    reads.set(LIST, listed(electricity()));
    expect(text(tab())).toContain('Electricity bill');
    expect(text(tab())).toContain('Loading its history…');
  });

  it('is quiet beside the table with nothing open', () => {
    reads.set(LIST, listed(electricity()));
    expect(text(tab())).toContain('No Expense open');
  });

  it('has Repeats only while recurring Expenses are switched on, with the schedule when read', () => {
    navigation.search = `expense=${wifi()._id}`;
    reads.set(LIST, listed(wifi()));
    reads.set(record(wifi()._id), { data: wifi() });
    expect(text(tab(false))).not.toMatch(/Repeats|Monthly/);
    expect(text(tab(true))).toContain('Category Housing Repeats Monthly History');

    const now = new Date();
    reads.set(`/api/groups/${GROUP}/recurring`, {
      data: new Map([
        [
          WIFI_TEMPLATE,
          {
            dayOfMonth: 28,
            startsOn: '2026-01-01T00:00:00.000Z',
            endsOn: null,
            isPaused: false,
            lastGeneratedFor: toPeriod(now),
          },
        ],
      ]),
    });
    const next = format(expenseDateForPeriod(nextPeriod(toPeriod(now)), 28), 'd MMM');
    expect(text(tab(true))).toContain(`Repeats Monthly on the 28th · next ${next}`);
    expect(text(tab(false))).not.toMatch(/Repeats|Monthly/);
  });

  it('says the open Expense has gone when it was deleted or isn’t found', () => {
    navigation.search = `expense=${electricity()._id}`;
    reads.set(LIST, listed(wifi()));
    reads.set(record(electricity()._id), { data: electricity({ isDeleted: true }) });
    expect(text(tab())).toContain('This Expense isn’t here any more');
    reads.set(record(electricity()._id), {
      error: new HttpResponseError('Expense not found', 404),
    });
    expect(text(tab())).toContain('This Expense isn’t here any more');
    expect(tab()).not.toContain('Expense not found');
  });

  it('loads, then offers Try again, for a link to an Expense the list doesn’t show', () => {
    navigation.search = `expense=${electricity()._id}`;
    reads.set(LIST, listed(wifi()));
    expect(tab()).toContain('aria-label="Loading the Expense"');
    reads.set(record(electricity()._id), { error: new HttpResponseError('pool closed', 500) });
    expect(text(tab())).toContain('This Expense could not be loaded. Try again');
    expect(tab()).not.toContain('pool closed');
  });

  it('ignores an address that names no Expense', () => {
    navigation.search = 'expense=../balances';
    reads.set(LIST, listed(electricity()));
    expect(text(tab())).toContain('No Expense open');
  });

  it('keeps a phone’s Expense below its card, with no side panel', () => {
    media.computer = false;
    navigation.search = `expense=${electricity()._id}`;
    reads.set(LIST, listed(electricity(), wifi()));
    reads.set(record(electricity()._id), { data: electricity() });
    const html = tab();
    expect(html).not.toContain('<table');
    expect(html).not.toContain('id="expense-panel"');
    expect(html).toMatch(
      /aria-expanded="true"[^>]*aria-controls="expense-e00000000000000000000002-details"|aria-controls="expense-e00000000000000000000002-details"[^>]*aria-expanded="true"/,
    );
    expect(html).toMatch(/<section\b[^>]*aria-label="Electricity bill details"/);
    expect(text(html)).toContain('Split (Equally)');
  });
});
