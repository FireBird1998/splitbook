import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExpenseWindowSummary,
  GroupFinancialState,
  KeptDraft,
  MobileExpense,
  MobileGroup,
} from '../data/types';
import { GroupExpensesView, expenseDays } from './group-expenses';
import { inTimeZone } from '../test-utils/time-zone';
import { mockDeviceLocale } from '../test-utils/device-locale';
import { refreshedLabel } from './refresh-feedback';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import {
  findHosts,
  flatten,
  hairSpace,
  labelRuns,
  largeTextWindows,
  layoutHeight,
  middleCutEnd,
  tailCutOverrun,
  unreadText,
} from '../test-utils/layout';
import { activateWithScreenReader, setWindow, touchAlong } from '../test-utils/native';
import { ThemeContext } from './theme';

// #116: the Expenses destination's summary, rows, pagination and draft states, rendered.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const you = 'a00000000000000000000001',
  sam = 'a00000000000000000000002',
  priya = 'a00000000000000000000003';
const names: Record<string, string> = {
  [you]: 'Alex Rivera',
  [sam]: 'Sam Chen',
  [priya]: 'Priya Shah',
};
const person = (id: string) => ({ id, name: names[id], image: null });
const groupId = 'b00000000000000000000001';
// Wednesday 30 September 2026, midday on this device.
const now = new Date(2026, 8, 30, 12).getTime();
const at = new Date(2026, 8, 30, 10, 42).getTime();
const group = (category: MobileGroup['category'] = 'home'): MobileGroup => ({
  id: groupId,
  name: category === 'home' ? 'Maple House' : 'Goa Friends Trip',
  description: '',
  category,
  defaultCurrency: 'INR',
  alternateCurrencies: [],
  latestExpenseCurrency: null,
  members: [you, sam, priya].map((id) => ({
    user: { ...person(id), email: `${id}@example.test` },
    role: 'member' as const,
    joinedAt: new Date(at),
  })),
  startDate: null,
  endDate: null,
  createdAt: new Date(at),
  updatedAt: new Date(at),
});
const expense = (
  id: string,
  description: string,
  day: number,
  paidBy: [string, number][],
  splitBetween: [string, number][],
  tag = 'Groceries',
): MobileExpense => {
  const amountMinor = paidBy.reduce((total, [, minor]) => total + minor, 0);
  const rows = (allocations: [string, number][]) =>
    allocations.map(([user, minor]) => ({
      user: person(user),
      amountMinor: minor,
      amount: minor / 100,
    }));
  return {
    id,
    groupId,
    description,
    currency: 'INR',
    amount: amountMinor / 100,
    amountMinor,
    // Dated by calendar day, stored at midnight UTC (#437).
    date: new Date(Date.UTC(2026, 8, day)),
    createdAt: new Date(at),
    updatedAt: new Date(at),
    category: 'food',
    tag,
    tagId: 'c00000000000000000000001',
    paidBy: rows(paidBy),
    splitBetween: rows(splitBetween),
    splitMethod: 'equal',
  };
};
/** Alex, Sam and Priya's shares, in paise. */
const thirds = (paise: [number, number, number]): [string, number][] => [
  [you, paise[0]],
  [sam, paise[1]],
  [priya, paise[2]],
];
const groceries = expense(
  'e00000000000000000000001',
  'Weekly groceries',
  30,
  [[you, 124950]],
  thirds([41650, 41650, 41650]),
);
const electricity = expense(
  'e00000000000000000000002',
  'Electricity bill',
  29,
  [[sam, 286000]],
  thirds([95333, 95334, 95333]),
  'Utilities',
);
const lunch = expense(
  'e00000000000000000000003',
  'Beach shack lunch',
  29,
  [[priya, 186000]],
  [
    [sam, 93000],
    [priya, 93000],
  ],
  'Dining',
);
const villa = expense(
  'e00000000000000000000004',
  'Villa stay',
  27,
  [
    [you, 200000],
    [sam, 100000],
  ],
  thirds([100000, 100000, 100000]),
  'Stay',
);
const summary = (overrides: Partial<ExpenseWindowSummary> = {}): ExpenseWindowSummary => ({
  currency: 'INR',
  count: 14,
  totalsByCurrency: [{ currency: 'INR', totalAmount: 18420 }],
  userOwes: 0,
  userGetsBack: 0,
  byMember: [
    { user: person(you), paid: 5210, share: 6140, net: 930 },
    { user: person(sam), paid: 8000, share: 6140, net: -1860 },
  ],
  ...overrides,
});
const financial = (
  expenses: Partial<GroupFinancialState['expenses']> = {},
  month: string | null = '2026-09',
): GroupFinancialState => ({
  groupId,
  month,
  expenses: {
    status: 'ready',
    data: [groceries, electricity, lunch, villa],
    summary: summary(),
    pagination: { page: 1, limit: 20, total: 4, totalPages: 1 },
    message: null,
    moreStatus: 'idle',
    moreMessage: null,
    month,
    refreshedAt: at,
    ...expenses,
  },
  balances: { status: 'ready', data: [], message: null, refreshedAt: at, stale: false },
});
const kept = (overrides: Partial<KeptDraft> = {}): KeptDraft => ({
  groupId,
  draft: { description: 'Weekly groceries', amount: 1249.5, currency: 'INR', edit: false },
  unconfirmed: false,
  ...overrides,
});

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const labelled = (root: ReactTestInstance, label: string) =>
  root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLabel === label);
const buttons = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Pressable'))
    .map((node) => node.props.accessibilityLabel as string);
const headings = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text') && node.props.accessibilityRole === 'header')
    .map((node) => node.children.join(''));
const press = (root: ReactTestInstance, label: string) =>
  act(() => labelled(root, label)[0].props.onPress());

function view(props: Partial<Parameters<typeof GroupExpensesView>[0]> = {}) {
  const calls = {
    onSelectMonth: vi.fn(),
    onRefreshExpenses: vi.fn(),
    onLoadMore: vi.fn(),
    onLoadNewer: vi.fn(),
    onOpenExpense: vi.fn(),
    onResumeDraft: vi.fn(),
    onDiscardDraft: vi.fn(),
  };
  act(() => {
    screen = create(
      <GroupExpensesView
        group={group()}
        currentUserId={you}
        state={financial()}
        kept={null}
        savedExpenseId={null}
        now={now}
        {...calls}
        {...props}
      />,
    );
  });
  return { root: screen!.root, ...calls };
}
const remount = () => act(() => screen?.unmount());

describe('Expenses summary', () => {
  it('a Household shows its Month bar and what the Month cost, never as Balances', () => {
    const { root, onSelectMonth } = view({ state: financial({ data: [] }) });
    expect(headings(root)).toContain('September 2026');
    expect(labelled(root, 'Previous month')[0].props.accessibilityState).toEqual({
      disabled: false,
    });
    // The current Month is the last one.
    expect(labelled(root, 'Next month')[0].props.accessibilityState).toEqual({ disabled: true });
    for (const stat of ['Spent: ₹18,420.00', 'Your share: ₹6,140.00', 'You paid: ₹5,210.00'])
      expect(labelled(root, stat)).toHaveLength(1);
    const shown = text(root);
    expect(shown).toContain('14 expenses this month');
    expect(shown).toContain(`Updated ${refreshedLabel(at)}`);
    expect(shown).not.toMatch(/owe|balance/i);
    press(root, 'Previous month');
    press(root, 'All time');
    expect(onSelectMonth.mock.calls).toEqual([['2026-08'], [null]]);
  });

  it('an earlier Month moves forward, and All time offers This month', () => {
    const august = view({ state: financial({}, '2026-08') });
    expect(text(august.root)).toContain('14 expenses in August');
    press(august.root, 'Next month');
    expect(august.onSelectMonth).toHaveBeenCalledWith('2026-09');
    remount();
    const all = view({ state: financial({}, null) });
    expect(headings(all.root)).toContain('All time');
    expect(text(all.root)).toContain('14 expenses');
    expect(labelled(all.root, 'Next month')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    press(all.root, 'This month');
    expect(all.onSelectMonth).toHaveBeenCalledWith('2026-09');
  });

  it('other Themes show an all-time summary without a Month bar', () => {
    const { root } = view({ group: group('trip'), state: financial({}, null) });
    expect(labelled(root, 'Previous month')).toHaveLength(0);
    expect(labelled(root, 'All time')).toHaveLength(0);
    expect(headings(root)).toContain('All time');
    expect(labelled(root, 'Your share: ₹6,140.00')).toHaveLength(1);
    const shown = text(root);
    expect(shown).toContain('14 expenses');
    expect(shown).not.toContain('this month');
    expect(shown).toContain(`Updated ${refreshedLabel(at)}`);
  });

  it('keeps other currencies out of the member’s figures, and says so', () => {
    const { root } = view({
      state: financial({
        summary: summary({
          totalsByCurrency: [
            { currency: 'INR', totalAmount: 18420 },
            { currency: 'EUR', totalAmount: 42.5 },
          ],
        }),
      }),
    });
    expect(labelled(root, 'Spent: ₹18,420.00')).toHaveLength(1);
    expect(text(root)).toContain('Also €42.50 in other currencies');
  });
});

// #730, board "Trip strip and summary by currency": a Trip in more than one currency shows its
// All time card one currency at a time, from its Trip summary (#729), as the web does: a
// "Spending in" tab per currency with what was spent in it, opening on the most Expenses, and
// the member's figures in that currency only, never converted.
describe('A Trip’s spending, one currency at a time (#730)', () => {
  const lisbon = (): MobileGroup => ({
    ...group('trip'),
    name: 'Lisbon & Tokyo',
    alternateCurrencies: ['EUR', 'JPY'],
  });
  const figures: Record<string, [count: number, spent: number, share: number, paid: number]> = {
    INR: [3, 4_860_000, 1_620_000, 2_000_000],
    EUR: [11, 124_000, 40_000, 60_000],
    JPY: [24, 186_000, 62_000, 70_400],
  };
  /** The Trip summary in `currency`, as the read answers it (#729). */
  const read = (currency: string) => {
    const [count, spent, share, paid] = figures[currency]!;
    return {
      timeZone: 'UTC',
      currency,
      tripDates: { start: null, end: null },
      window: null,
      dayCount: 0,
      tooManyDays: false,
      spentMinor: spent,
      expenseCount: count,
      yourShareMinor: share,
      youPaidMinor: paid,
      yourExpenseCount: 1,
      peopleCount: 3,
      perPersonPerDayMinor: null,
      days: [],
      dailyAverageMinor: null,
      beforeTrip: null,
      afterTrip: null,
      byTag: [],
      suggestedPayments: [],
      otherCurrencies: [],
      hasExpenses: true,
      currencies: ['INR', 'EUR', 'JPY'].map((code) => ({
        currency: code,
        expenseCount: figures[code]![0],
        spentMinor: figures[code]![1],
      })),
    };
  };
  const trip = (
    overrides: Partial<NonNullable<GroupFinancialState['trip']>> = {},
  ): NonNullable<GroupFinancialState['trip']> => ({
    status: 'ready',
    data: read('JPY'),
    message: null,
    refreshedAt: at,
    stale: false,
    restored: false,
    chosen: null,
    ...overrides,
  });
  const shown = (state: NonNullable<GroupFinancialState['trip']> = trip()) => ({
    ...financial(
      {
        summary: summary({
          count: 38,
          totalsByCurrency: [
            { currency: 'INR', totalAmount: 48600 },
            { currency: 'EUR', totalAmount: 1240 },
            { currency: 'JPY', totalAmount: 186000 },
          ],
        }),
      },
      null,
    ),
    trip: state,
  });
  /** Each tab's spoken name, and whether it is the currency shown. */
  const tabs = (root: ReactTestInstance) =>
    root
      .findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.accessibilityRole === 'tablist' &&
          node.props.accessibilityLabel === 'Spending in',
      )
      .flatMap((list) =>
        list.findAll(
          (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'tab',
        ),
      )
      .map((tab) => [tab.props.accessibilityLabel, tab.props.accessibilityState?.selected]);

  it('opens on the currency with the most Expenses, with what was spent in each, and says why', () => {
    const { root } = view({ group: lisbon(), state: shown(), onChooseTripCurrency: vi.fn() });
    expect(tabs(root)).toEqual([
      ['INR, main currency, ₹48,600.00 spent in 3 Expenses', false],
      ['EUR, €1,240.00 spent in 11 Expenses', false],
      ['JPY, ¥186,000 spent in 24 Expenses', true],
    ]);
    for (const stat of ['Spent: ¥186,000', 'Your share: ¥62,000', 'You paid: ¥70,400'])
      expect(labelled(root, stat)).toHaveLength(1);
    const words = text(root).replaceAll(hairSpace, '');
    expect(words).toContain('INR · main₹48,600.00EUR€1,240.00JPY¥186,000');
    expect(words).toContain(
      'Opened on JPY, the currency with the most Expenses (24). Each currency is shown on its own.',
    );
    expect(words).toContain('38 expenses');
    expect(words).toContain(`Updated ${refreshedLabel(at)}`);
    // The switch takes the place of the note on other currencies.
    expect(words).not.toContain('in other currencies');
  });

  it('asks for the currency chosen, and shows its figures only once they are read in it', () => {
    const onChooseTripCurrency = vi.fn();
    const { root } = view({ group: lisbon(), state: shown(), onChooseTripCurrency });
    press(root, 'EUR, €1,240.00 spent in 11 Expenses');
    expect(onChooseTripCurrency).toHaveBeenCalledWith('EUR');
    act(() =>
      screen!.update(
        <GroupExpensesView
          group={lisbon()}
          currentUserId={you}
          state={shown(trip({ chosen: 'EUR', status: 'loading' }))}
          kept={null}
          savedExpenseId={null}
          now={now}
          onSelectMonth={vi.fn()}
          onRefreshExpenses={vi.fn()}
          onLoadMore={vi.fn()}
          onLoadNewer={vi.fn()}
          onOpenExpense={vi.fn()}
          onResumeDraft={vi.fn()}
          onDiscardDraft={vi.fn()}
          onChooseTripCurrency={onChooseTripCurrency}
        />,
      ),
    );
    expect(tabs(root).find(([, selected]) => selected)?.[0]).toBe(
      'EUR, €1,240.00 spent in 11 Expenses',
    );
    // The yen figures never show under euros, in yen or formatted as euros ("Spent: €1,860.00",
    // mutant T3): no figure shows at all until the euro read lands.
    expect(labelled(root, 'Spent: ¥186,000')).toHaveLength(0);
    expect(
      root
        .findAll((node) => typeof node.type === 'string')
        .map((node) => String(node.props.accessibilityLabel ?? ''))
        .filter((label) => /^(Spent|Your share|You paid): /.test(label)),
    ).toEqual([]);
    act(() =>
      screen!.update(
        <GroupExpensesView
          group={lisbon()}
          currentUserId={you}
          state={shown(trip({ chosen: 'EUR', data: read('EUR') }))}
          kept={null}
          savedExpenseId={null}
          now={now}
          onSelectMonth={vi.fn()}
          onRefreshExpenses={vi.fn()}
          onLoadMore={vi.fn()}
          onLoadNewer={vi.fn()}
          onOpenExpense={vi.fn()}
          onResumeDraft={vi.fn()}
          onDiscardDraft={vi.fn()}
          onChooseTripCurrency={onChooseTripCurrency}
        />,
      ),
    );
    for (const stat of ['Spent: €1,240.00', 'Your share: €400.00', 'You paid: €600.00'])
      expect(labelled(root, stat)).toHaveLength(1);
    const words = text(root);
    expect(words).toContain('Each currency is shown on its own.');
    expect(words).not.toContain('Opened on');
  });

  it('says it is this phone’s copy, with the time it was read, offline', () => {
    const { root } = view({
      group: lisbon(),
      state: shown(trip({ restored: true })),
      offline: true,
      onChooseTripCurrency: vi.fn(),
    });
    expect(text(root)).toContain(`Saved ${refreshedLabel(at)}`);
    expect(labelled(root, 'Spent: ¥186,000')).toHaveLength(1);
  });

  it('marks the Group’s own main currency, before its Expenses summary lands too', () => {
    // A Trip in euros, with yen: its main currency is EUR, never the default INR.
    const euros = { ...lisbon(), defaultCurrency: 'EUR', alternateCurrencies: ['JPY'] };
    const summary = {
      ...read('JPY'),
      currencies: [
        { currency: 'EUR', expenseCount: 11, spentMinor: 124_000 },
        { currency: 'JPY', expenseCount: 24, spentMinor: 186_000 },
      ],
    };
    const state = shown(trip({ data: summary }));
    const { root } = view({
      group: euros,
      state: { ...state, expenses: { ...state.expenses, status: 'loading', summary: null } },
      onChooseTripCurrency: vi.fn(),
    });
    expect(tabs(root)).toEqual([
      ['EUR, main currency, €1,240.00 spent in 11 Expenses', false],
      ['JPY, ¥186,000 spent in 24 Expenses', true],
    ]);
  });

  it('keeps the card as it was for a Trip in one currency', () => {
    const { root } = view({ group: group('trip'), state: financial({}, null) });
    expect(tabs(root)).toEqual([]);
    expect(labelled(root, 'Spent: ₹18,420.00')).toHaveLength(1);
  });

  it.each(largeTextWindows)(
    'reads in full, the tabs wrapping, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      // The card alone: the rows under it keep their own large-text rules (#639).
      const state = shown();
      view({
        group: lisbon(),
        state: { ...state, expenses: { ...state.expenses, data: [] } },
        onChooseTripCurrency: vi.fn(),
      });
      const tree = screen!.toJSON() as ReactTestRendererJSON;
      const [list] = findHosts(
        tree,
        (props) =>
          props.accessibilityRole === 'tablist' && props.accessibilityLabel === 'Spending in',
      );
      expect(flatten(list!.props.style).flexWrap).toBe('wrap');
      // The screen's content is inset 16dp on each side.
      expect(unreadText(tree, size.fontScale, size.width - 32)).toEqual([]);
    },
  );
});

describe('Expense rows', () => {
  it('sit under day headings and say what the member lent or owes', () => {
    // A US phone too: day first, and Yesterday named like Today (#640).
    mockDeviceLocale('en-US');
    const { root, onOpenExpense } = view();
    expect(headings(root)).toEqual(
      expect.arrayContaining(['Today · Wed 30 Sep', 'Yesterday · Tue 29 Sep', 'Sun 27 Sep']),
    );
    expect(buttons(root)).toEqual(
      expect.arrayContaining([
        'Weekly groceries, ₹1,249.50, You paid, Groceries, you lent ₹833.00',
        'Electricity bill, ₹2,860.00, Sam Chen paid, Utilities, you owe ₹953.33',
        // Not involved: nothing either way.
        'Beach shack lunch, ₹1,860.00, Priya Shah paid, Dining',
        'Villa stay, ₹3,000.00, 2 people paid, Stay, you lent ₹1,000.00',
      ]),
    );
    const shown = text(root);
    expect(shown).toContain('You paid · Groceries');
    expect(shown).toContain('you lent ₹833.00');
    expect(shown).toContain('you owe ₹953.33');
    press(root, 'Electricity bill, ₹2,860.00, Sam Chen paid, Utilities, you owe ₹953.33');
    expect(onOpenExpense).toHaveBeenCalledWith(electricity.id);
  });

  // #810: an Expense in a currency Splitbook no longer supports shows its stored amount with
  // its code, as Activity does (#779), and no position: there is nothing exact to say.
  it('show an Expense in a currency Splitbook no longer supports with its code, and no position', () => {
    const marks: MobileExpense = {
      ...expense(
        'e00000000000000000000009',
        'Old Berlin rent',
        30,
        [[you, 4000]],
        [
          [you, 2000],
          [sam, 2000],
        ],
        'Household',
      ),
      currency: 'DEM',
    };
    const { root } = view({
      state: financial({
        data: [marks],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
    });
    // Intl writes a code-prefixed amount with a no-break space.
    expect(buttons(root)).toContain('Old Berlin rent, DEM\u00a040.00, You paid, Household');
  });

  it('open on a tap or a screen reader’s activate, never on a drag, in a Month too short to scroll (#665)', () => {
    // Three rows in one Month, as on the device: the list can't scroll, so nothing takes a drag.
    const { root, onOpenExpense } = view({
      state: financial({
        data: [groceries, electricity, lunch],
        pagination: { page: 1, limit: 20, total: 3, totalPages: 1 },
      }),
    });
    const row = labelled(
      root,
      'Electricity bill, ₹2,860.00, Sam Chen paid, Utilities, you owe ₹953.33',
    )[0];
    const landed = { pageX: 200, pageY: 620 };
    // An upward drag of 250dp that starts on the row.
    act(() =>
      touchAlong(row, [
        landed,
        { pageX: 201, pageY: 560 },
        { pageX: 202, pageY: 450 },
        { pageX: 202, pageY: 370 },
      ]),
    );
    expect(onOpenExpense).not.toHaveBeenCalled();
    act(() => touchAlong(row, [landed, { pageX: 202, pageY: 616 }]));
    expect(onOpenExpense).toHaveBeenCalledExactlyOnceWith(electricity.id);
    act(() => activateWithScreenReader(row));
    expect(onOpenExpense).toHaveBeenCalledTimes(2);
    expect(onOpenExpense).toHaveBeenLastCalledWith(electricity.id);
  });

  it('sit under the day they are dated, in a zone behind UTC (#437)', () =>
    inTimeZone('Pacific/Pago_Pago', () => {
      mockDeviceLocale('en-US');
      const stored = { ...groceries, date: new Date('2026-09-28T00:00:00.000Z') };
      // Midday on the 30th there, so the 28th is neither today nor yesterday.
      const [day] = expenseDays([stored], new Date(2026, 8, 30, 12).getTime());
      expect(day.key).toBe('2026-09-28');
      expect(day.label).toBe('Mon 28 Sep');
    }));

  it('replaces an empty list with loading after a save, then highlights its first Expense', () => {
    const { root } = view({
      state: financial({ data: [], status: 'loading', changed: true }),
    });
    expect(text(root)).not.toContain('No expenses');
    expect(labelled(root, 'Loading September 2026 expenses')).toHaveLength(1);
    remount();
    const loaded = view({
      state: financial({ data: [groceries] }),
      savedExpenseId: groceries.id,
    });
    expect(text(loaded.root)).not.toContain('No expenses');
    expect(buttons(loaded.root).filter((label) => label?.endsWith('just saved'))).toEqual([
      'Weekly groceries, ₹1,249.50, You paid, Groceries, you lent ₹833.00, just saved',
    ]);
  });

  it('says to pull to retry when the list read after a save fails, not that it is waiting', () => {
    const { root } = view({
      state: financial({ data: [], status: 'error', changed: true }),
    });
    expect(text(root)).toContain('Expenses need an update');
    expect(text(root)).toContain('Pull down to try again.');
    expect(text(root)).not.toContain('Waiting for the updated list.');
  });

  it('marks the Expense just saved', () => {
    const { root } = view({ savedExpenseId: groceries.id });
    const marked = buttons(root).filter((label) => label?.endsWith('just saved'));
    expect(marked).toEqual([
      'Weekly groceries, ₹1,249.50, You paid, Groceries, you lent ₹833.00, just saved',
    ]);
  });

  it('loads more at the end with its own progress, and recovers from a failure', () => {
    const paged = { pagination: { page: 1, limit: 20, total: 25, totalPages: 2 } };
    const { root, onLoadMore } = view({ state: financial(paged) });
    press(root, 'Load more expenses');
    expect(onLoadMore).toHaveBeenCalledOnce();
    remount();

    const loading = view({ state: financial({ ...paged, moreStatus: 'loading' }) }).root;
    expect(text(loading)).toContain('Loading more expenses…');
    expect(loading.findAll((node) => isHost(node, 'ActivityIndicator'))).toHaveLength(1);
    expect(buttons(loading)).not.toContain('Load more expenses');
    expect(text(loading)).toContain('Weekly groceries');
    remount();

    const failed = view({
      state: financial({
        ...paged,
        moreStatus: 'error',
        moreMessage: 'Could not load more expenses. Please try again.',
      }),
    });
    const alert = failed.root.find(
      (node) => isHost(node, 'Text') && node.props.accessibilityRole === 'alert',
    );
    expect(alert.children.join('')).toContain('The ones shown are still here.');
    press(failed.root, 'Try loading more expenses');
    expect(failed.onLoadMore).toHaveBeenCalledOnce();
  });

  it('renders a row again when its Expense changes, and when it stops being just saved (#219)', () => {
    const props = {
      group: group(),
      currentUserId: you,
      kept: null,
      now,
      onSelectMonth: vi.fn(),
      onRefreshExpenses: vi.fn(),
      onLoadMore: vi.fn(),
      onLoadNewer: vi.fn(),
      onOpenExpense: vi.fn(),
      onResumeDraft: vi.fn(),
      onDiscardDraft: vi.fn(),
    };
    act(() => {
      screen = create(
        <GroupExpensesView {...props} state={financial()} savedExpenseId={groceries.id} />,
      );
    });
    const rows = () => buttons(screen!.root).filter((label) => label?.includes('₹'));
    expect(rows()).toContain(
      'Weekly groceries, ₹1,249.50, You paid, Groceries, you lent ₹833.00, just saved',
    );
    // A read changed one row, and the save is no longer just made; the other rows are as they were.
    const corrected = {
      ...electricity,
      description: 'Electricity bill, corrected',
    };
    act(() =>
      screen!.update(
        <GroupExpensesView
          {...props}
          state={financial({ data: [groceries, corrected, lunch, villa] })}
          savedExpenseId={null}
        />,
      ),
    );
    expect(rows()).toContain('Weekly groceries, ₹1,249.50, You paid, Groceries, you lent ₹833.00');
    expect(rows().filter((label) => label?.endsWith('just saved'))).toEqual([]);
    expect(
      rows().filter((label) => label?.startsWith('Electricity bill, corrected, ')),
    ).toHaveLength(1);
    expect(rows().filter((label) => label?.startsWith('Electricity bill, ₹'))).toEqual([]);
  });
  it('has no Load more on the last page', () => {
    expect(buttons(view().root)).not.toContain('Load more expenses');
  });

  it('loads newer above a list that has slid past its newest page, as Load more does (#219)', () => {
    const slid = { firstPage: 2, pagination: { page: 6, limit: 20, total: 130, totalPages: 7 } };
    expect(buttons(view().root)).not.toContain('Load newer expenses');
    remount();

    const { root, onLoadNewer } = view({ state: financial(slid) });
    const order = buttons(root);
    // Above the rows, and TalkBack names the list.
    expect(order.indexOf('Load newer expenses')).toBeLessThan(
      order.findIndex((label) => label?.startsWith('Weekly groceries')),
    );
    press(root, 'Load newer expenses');
    expect(onLoadNewer).toHaveBeenCalledOnce();
    remount();

    const loading = view({ state: financial({ ...slid, newerStatus: 'loading' }) }).root;
    expect(text(loading)).toContain('Loading newer expenses…');
    expect(loading.findAll((node) => isHost(node, 'ActivityIndicator'))).toHaveLength(1);
    expect(buttons(loading)).not.toContain('Load newer expenses');
    expect(text(loading)).toContain('Weekly groceries');
    remount();

    const failed = view({
      state: financial({
        ...slid,
        newerStatus: 'error',
        newerMessage: 'Could not load newer expenses. Please try again.',
      }),
    });
    const alert = failed.root.find(
      (node) => isHost(node, 'Text') && node.props.accessibilityRole === 'alert',
    );
    expect(alert.children.join('')).toContain('The ones shown are still here.');
    press(failed.root, 'Try loading newer expenses');
    expect(failed.onLoadNewer).toHaveBeenCalledOnce();
  });
  describe('when the newest page drops (#219)', () => {
    // 120 fictional rows of one day, 20 a page; each row is 60 high under a 30-high day heading.
    const rows = Array.from({ length: 120 }, (_, index) =>
      expense(
        `e${String(index + 1).padStart(23, '0')}`,
        `Fictional row ${index + 1}`,
        20,
        [[you, 1000]],
        [[you, 1000]],
      ),
    );
    const window = (first: number) =>
      financial({
        data: rows.slice((first - 1) * 20, (first + 4) * 20),
        firstPage: first,
        pagination: { page: first + 4, limit: 20, total: 120, totalPages: 6 },
      });
    const layout = (node: ReactTestInstance, y: number) =>
      act(() =>
        node.props.onLayout({
          nativeEvent: { layout: { x: 0, y, width: 390, height: 60 } },
        }),
      );
    /** The host Views that report the layout of a row, its day and the list, by row number. */
    const places = (root: ReactTestInstance, number: number) => {
      const found: ReactTestInstance[] = [];
      let node: ReactTestInstance | null = root.find(
        (candidate) =>
          isHost(candidate, 'Pressable') &&
          String(candidate.props.accessibilityLabel).startsWith(`Fictional row ${number},`),
      );
      while (node && found.length < 3) {
        if (isHost(node, 'View') && node.props.onLayout) found.push(node);
        node = node.parent;
      }
      const [row, day, list] = found;
      return { row, day, list };
    };
    /** Lays the window out as a phone would: the list at `listY`, rows from `first`. */
    const lay = (root: ReactTestInstance, first: number, listY: number) => {
      const { day, list } = places(root, first * 20 - 19);
      layout(list, listY);
      layout(day, 0);
      for (let number = first * 20 - 19; number <= (first + 4) * 20; number += 1)
        layout(places(root, number).row, 30 + (number - (first * 20 - 19)) * 60);
    };
    const render = (first: number, onShift: (dy: number) => void) => {
      const props = {
        group: group(),
        currentUserId: you,
        kept: null,
        savedExpenseId: null,
        now,
        onSelectMonth: vi.fn(),
        onRefreshExpenses: vi.fn(),
        onLoadMore: vi.fn(),
        onLoadNewer: vi.fn(),
        onShift,
        onOpenExpense: vi.fn(),
        onResumeDraft: vi.fn(),
        onDiscardDraft: vi.fn(),
      };
      act(() => {
        screen = create(<GroupExpensesView {...props} state={window(first)} />);
      });
      return (next: number) =>
        act(() => screen!.update(<GroupExpensesView {...props} state={window(next)} />));
    };
    const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    it('keeps the row on screen in its place: the view moves up by the rows that went', async () => {
      const onShift = vi.fn();
      const slide = render(1, onShift);
      lay(screen!.root, 1, 200);
      await tick();
      expect(onShift).not.toHaveBeenCalled();
      // Load more read page 6: pages 2 to 6 show, below Load newer, 60 high, above the list.
      slide(2);
      lay(screen!.root, 2, 260);
      await tick();
      // Row 21 was at 200 + 30 + 20 × 60 = 1430; it is now at 260 + 30 = 290.
      expect(onShift).toHaveBeenCalledExactlyOnceWith(290 - 1430);
      // Only the slide's own layout moves the view.
      layout(places(screen!.root, 21).list, 300);
      await tick();
      expect(onShift).toHaveBeenCalledOnce();
    });

    it('shows Load newer, above the rows, once Load more slides the list past its newest page', () => {
      const slide = render(1, vi.fn());
      expect(buttons(screen!.root)).not.toContain('Load newer expenses');
      slide(2);
      const order = buttons(screen!.root);
      expect(order.indexOf('Load newer expenses')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('Load newer expenses')).toBeLessThan(
        order.findIndex((label) => label?.startsWith('Fictional row 21,')),
      );
    });

    it('keeps Load newer in place, disabled, while the slid window is read again', () => {
      const slide = render(2, vi.fn());
      const refreshing = window(2);
      refreshing.expenses = { ...refreshing.expenses, status: 'loading' };
      act(() =>
        screen!.update(
          <GroupExpensesView
            group={group()}
            currentUserId={you}
            kept={null}
            savedExpenseId={null}
            now={now}
            state={refreshing}
            onSelectMonth={vi.fn()}
            onRefreshExpenses={vi.fn()}
            onLoadMore={vi.fn()}
            onLoadNewer={vi.fn()}
            onOpenExpense={vi.fn()}
            onResumeDraft={vi.fn()}
            onDiscardDraft={vi.fn()}
          />,
        ),
      );
      const newer = labelled(screen!.root, 'Load newer expenses');
      expect(newer).toHaveLength(1);
      expect(newer[0].props.accessibilityState).toEqual({ disabled: true, busy: false });
      slide(2);
      expect(labelled(screen!.root, 'Load newer expenses')[0].props.accessibilityState).toEqual({
        disabled: false,
        busy: false,
      });
    });

    // The device recheck of a31f3e8: a return to the list's end came back one row short, as the
    // list dropped Load more while its rows were read again.
    it('keeps Load more in place, disabled, while the rows shown are read again', () => {
      const slide = render(1, vi.fn());
      const more = () => labelled(screen!.root, 'Load more expenses');
      expect(more()[0].props.accessibilityState).toEqual({ disabled: false, busy: false });
      const refreshing = window(1);
      refreshing.expenses = { ...refreshing.expenses, status: 'loading' };
      act(() =>
        screen!.update(
          <GroupExpensesView
            group={group()}
            currentUserId={you}
            kept={null}
            savedExpenseId={null}
            now={now}
            state={refreshing}
            onSelectMonth={vi.fn()}
            onRefreshExpenses={vi.fn()}
            onLoadMore={vi.fn()}
            onLoadNewer={vi.fn()}
            onOpenExpense={vi.fn()}
            onResumeDraft={vi.fn()}
            onDiscardDraft={vi.fn()}
          />,
        ),
      );
      expect(more()).toHaveLength(1);
      expect(more()[0].props.accessibilityState).toEqual({ disabled: true, busy: false });
      slide(1);
      expect(more()[0].props.accessibilityState).toEqual({ disabled: false, busy: false });
    });
    it('keeps the row on screen when Load newer brings the newest page back: the view moves down by the rows that came', async () => {
      const onShift = vi.fn();
      const slide = render(2, onShift);
      lay(screen!.root, 2, 260);
      await tick();
      expect(onShift).not.toHaveBeenCalled();
      // Row 21, first under Load newer at 260 + 30 = 290, now has page 1's 20 rows above it, and
      // Load newer has gone: 200 + 30 + 20 × 60 = 1430.
      slide(1);
      lay(screen!.root, 1, 200);
      await tick();
      expect(onShift).toHaveBeenCalledExactlyOnceWith(1430 - 290);
    });

    it('moves the view up for the slide, and back down by as much when Load newer undoes it', async () => {
      const onShift = vi.fn();
      const slide = render(1, onShift);
      lay(screen!.root, 1, 200);
      slide(2);
      lay(screen!.root, 2, 260);
      await tick();
      expect(onShift).toHaveBeenCalledExactlyOnceWith(290 - 1430);
      slide(1);
      lay(screen!.root, 1, 200);
      await tick();
      expect(onShift).toHaveBeenCalledTimes(2);
      expect(onShift).toHaveBeenLastCalledWith(1430 - 290);
    });

    it('moves nothing when the list is read anew from its first page, with none of its rows', async () => {
      const onShift = vi.fn();
      render(2, onShift);
      lay(screen!.root, 2, 260);
      // Another list from its first page, such as a Month's: no row it showed is listed.
      const others = rows.map((row) => ({ ...row, id: `f${row.id.slice(1)}` }));
      act(() =>
        screen!.update(
          <GroupExpensesView
            group={group()}
            currentUserId={you}
            kept={null}
            savedExpenseId={null}
            now={now}
            state={financial({
              data: others.slice(0, 20),
              firstPage: 1,
              pagination: { page: 1, limit: 20, total: 120, totalPages: 6 },
            })}
            onSelectMonth={vi.fn()}
            onRefreshExpenses={vi.fn()}
            onLoadMore={vi.fn()}
            onLoadNewer={vi.fn()}
            onShift={onShift}
            onOpenExpense={vi.fn()}
            onResumeDraft={vi.fn()}
            onDiscardDraft={vi.fn()}
          />,
        ),
      );
      // Without Load newer, the list now starts 60 higher.
      const { row, day, list } = places(screen!.root, 1);
      layout(list, 200);
      layout(day, 0);
      layout(row, 30);
      await tick();
      expect(onShift).not.toHaveBeenCalled();
    });
  });

  it('shows placeholders on a first load, and a retry when it fails', () => {
    const loading = view({ state: financial({ status: 'loading', data: [], summary: null }) });
    const placeholder = labelled(loading.root, 'Loading September 2026 expenses');
    expect(placeholder).toHaveLength(1);
    expect(placeholder[0].props.accessibilityState).toEqual({ busy: true });
    expect(loading.root.findAll((node) => isHost(node, 'ActivityIndicator'))).toHaveLength(0);
    expect(text(loading.root)).not.toContain('Spent');
    remount();

    const failed = view({
      state: financial({
        status: 'error',
        data: [],
        summary: null,
        message: 'Could not load expenses. Please try again.',
      }),
    });
    expect(text(failed.root)).toContain('Could not load expenses. Please try again.');
    press(failed.root, 'Retry expenses');
    expect(failed.onRefreshExpenses).toHaveBeenCalledOnce();
  });

  it('never lists one Month’s Expenses under another Month', () => {
    const { root } = view({ state: { ...financial({}, '2026-09'), month: '2026-08' } });
    expect(headings(root)).toContain('August 2026');
    expect(text(root)).not.toContain('Weekly groceries');
    expect(labelled(root, 'Loading August 2026 expenses')).toHaveLength(1);
  });
});

describe('A kept draft', () => {
  it('is offered in an info notice with Resume and Discard', () => {
    const { root, onResumeDraft, onDiscardDraft } = view({ kept: kept() });
    const notice = root.find(
      (node) => isHost(node, 'View') && node.props.accessibilityRole === 'summary',
    );
    expect(notice.props.accessibilityLiveRegion).toBe('polite');
    const shown = text(notice);
    expect(shown).toContain('Draft: Weekly groceries');
    expect(shown).toContain('₹1,249.50');
    expect(shown).toContain('Kept on this device. It hasn’t been sent to the Group.');
    press(root, 'Resume draft');
    press(root, 'Discard draft');
    expect(onResumeDraft).toHaveBeenCalledOnce();
    expect(onDiscardDraft).toHaveBeenCalledOnce();
  });

  it('says when it holds changes to a saved Expense', () => {
    const { root } = view({
      kept: kept({
        draft: { description: 'Wi-Fi', amount: null, currency: 'INR', edit: true },
      }),
    });
    expect(text(root)).toContain('Draft: Wi-Fi');
    expect(text(root)).toContain('Your changes are kept on this device.');
  });

  it('a save that may already be recorded is a warning that offers only to finish it', () => {
    const { root, onResumeDraft } = view({ kept: kept({ unconfirmed: true }) });
    const shown = text(root);
    expect(shown).toContain('Save not confirmed');
    expect(shown).toContain(
      'Weekly groceries may already be saved. Check it before adding another.',
    );
    expect(shown).not.toContain('Draft:');
    expect(buttons(root)).not.toContain('Discard draft');
    expect(buttons(root)).not.toContain('Resume draft');
    press(root, 'Open to check');
    expect(onResumeDraft).toHaveBeenCalledOnce();
  });

  it('can be resumed but not discarded when it can’t be read', () => {
    const { root } = view({ kept: kept({ draft: null }) });
    expect(text(root)).toContain('Unfinished draft');
    expect(buttons(root)).toContain('Resume draft');
    expect(buttons(root)).not.toContain('Discard draft');
  });

  it('shows only this Group’s draft', () => {
    const { root } = view({ kept: kept({ groupId: 'b00000000000000000000009' }) });
    expect(text(root)).not.toContain('Draft:');
    expect(buttons(root)).not.toContain('Resume draft');
  });
});

// #639: on the emulator at density 160 and 130% text, the Month bar's "All time" drew "All": the
// button is as wide as its words, and Android, laying them out again to draw them, wrapped
// "time" out of sight. Its words keep room to spare, as every button's have since #656.
describe.each(['light', 'dark'] as const)('the Month bar at large text in %s (#639)', (mode) => {
  it.each(largeTextWindows)(
    'keeps All time and This month whole, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      for (const [month, label] of [
        ['2026-09', 'All time'],
        [null, 'This month'],
      ] as const) {
        act(() => {
          screen = create(
            <ThemeContext.Provider value={getSemanticTokens(mode)}>
              <GroupExpensesView
                group={group()}
                currentUserId={you}
                state={financial({}, month)}
                kept={null}
                savedExpenseId={null}
                now={now}
                onSelectMonth={vi.fn()}
                onRefreshExpenses={vi.fn()}
                onLoadMore={vi.fn()}
                onLoadNewer={vi.fn()}
                onOpenExpense={vi.fn()}
                onResumeDraft={vi.fn()}
                onDiscardDraft={vi.fn()}
              />
            </ThemeContext.Provider>,
          );
        });
        expect(labelRuns(screen!.root, label), label).toEqual([[label, hairSpace]]);
        remount();
      }
    },
  );
});

// #639: at 200% an Expense's row read "QA cylinde.." and "You paid · Uti.." beside its amount. Its
// description and details take the lines they need from 150%, and the amount goes under them
// where it would leave them too narrow a column. At 130% a long description is still cut once
// (#332), but no word breaks in two.
describe.each(['light', 'dark'] as const)('Expense rows at large text in %s (#639)', (mode) => {
  it.each(largeTextWindows)('read in full, $width dp at $fontScale× text', (size) => {
    setWindow(size);
    act(() => {
      screen = create(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <GroupExpensesView
            group={group()}
            currentUserId={you}
            state={financial()}
            kept={null}
            savedExpenseId={null}
            now={now}
            onSelectMonth={vi.fn()}
            onRefreshExpenses={vi.fn()}
            onLoadMore={vi.fn()}
            onLoadNewer={vi.fn()}
            onOpenExpense={vi.fn()}
            onResumeDraft={vi.fn()}
            onDiscardDraft={vi.fn()}
          />
        </ThemeContext.Provider>,
      );
    });
    const rows = findHosts(
      screen!.toJSON(),
      (props, type) => type === 'Pressable' && flatten(props.style).minHeight === 60,
    );
    expect(rows.length).toBeGreaterThan(0);
    // Each row lies in a Card inset 16dp from the screen's edges, inside its 1dp border.
    for (const row of rows)
      expect(
        unreadText(row as ReactTestRendererJSON, size.fontScale, size.width - 34, {
          cutOnce: size.fontScale < 1.5,
        }),
      ).toEqual([]);
  });
});

// #751: an assistant's credit names its host in full, and a long host was cut at its end in the
// row's one-line caption, hiding the domain that tells members who the assistant really is.
describe('an assistant’s credit on an Expense row (#751)', () => {
  const host = 'chatgpt.com.secure-assistant-connector.evil.example.test';
  const prepared: MobileExpense = { ...groceries, preparedBy: { kind: 'assistant', name: host } };
  const credit = (root: ReactTestInstance) =>
    root.find(
      (node) =>
        isHost(node, 'Text') &&
        node.children
          .filter((child) => typeof child === 'string')
          .join('')
          .trimEnd() === `prepared by ${host}`,
    );
  /** The issue's second host, 120 characters, ending in the same domain. */
  const long =
    'claude.ai.household-ledger-reconciliation-assistant-for-shared-expenses.connectorgateway.region-euwest.evil.example.test';
  const preparedView = (name = host) =>
    view({
      state: financial({
        data: [{ ...prepared, preparedBy: { kind: 'assistant', name } }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
    });

  it('takes a line of its own, cut in the middle so the domain stays, with the whole name read aloud', () => {
    const { root } = preparedView();
    expect(credit(root).props).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'middle' });
    expect(text(root)).toContain('You paid · Groceries');
    expect(text(root)).not.toContain('You paid · prepared by');
    expect(buttons(root)).toContain(
      `Weekly groceries, ₹1,249.50, You paid, prepared by ${host}, Groceries, you lent ₹833.00`,
    );
  });

  it('wraps in full at the largest text', () => {
    setWindow({ fontScale: 2 });
    const { root } = preparedView();
    expect(credit(root).props.numberOfLines).toBe(0);
  });

  // On the emulator, beside the amount it read "prepared by …xample.test" on a 360dp phone.
  // Its end shows the domain to its last letter: "…evil.example.test" at 100% on the emulator and
  // "…vil.example.test" at 130%, where the line keeps room for the ellipsis Android draws wider
  // than it measured (#766).
  it.each([
    [1, host, /evil\.example\.test\s*$/],
    [1.3, host, /example\.test\s*$/],
    [1, long, /evil\.example\.test\s*$/],
    [1.3, long, /example\.test\s*$/],
  ])('keeps the domain readable on a 360dp phone at %s× text: %s', (fontScale, name, end) => {
    setWindow({ width: 360, height: 640, fontScale });
    preparedView(name);
    const [row] = findHosts(
      screen!.toJSON(),
      (props, type) => type === 'Pressable' && flatten(props.style).minHeight === 60,
    );
    // The row lies in a Card inset 16dp from the screen's edges, inside its 1dp border.
    expect(middleCutEnd(row!, fontScale, 360 - 34, `prepared by ${name}`)).toMatch(end);
  });

  // The rest of the row reads in full, as every Expense row does (#639). The host is one word as
  // wide as a line or more, cut in the middle or broken as it wraps.
  it.each(largeTextWindows)(
    'leaves the rest of its row in full, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      preparedView();
      const [row] = findHosts(
        screen!.toJSON(),
        (props, type) => type === 'Pressable' && flatten(props.style).minHeight === 60,
      );
      expect(
        unreadText(row!, size.fontScale, size.width - 34, { cutOnce: size.fontScale < 1.5 }).filter(
          (finding) => !finding.startsWith('"prepared by '),
        ),
      ).toEqual([]);
    },
  );
});

// #770, from the Designer's #751 check: at 200% an Expense row with a credit grew to about 11
// lines, and its centred icon sat beside "prepared by…", away from the title. At large text the
// icon keeps to the title, at the top of the row; below it, and in a row without a note, it stays
// centred.
describe.each(['light', 'dark'] as const)(
  'an Expense row’s icon at large text in %s (#770)',
  (mode) => {
    const credited: MobileExpense = {
      ...groceries,
      preparedBy: {
        kind: 'assistant',
        name: 'chatgpt.com.secure-assistant-connector.evil.example.test',
      },
    };
    const rowOf = (expense: MobileExpense) => {
      act(() => {
        screen = create(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <GroupExpensesView
              group={group()}
              currentUserId={you}
              state={financial({
                data: [expense],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
              })}
              kept={null}
              savedExpenseId={null}
              now={now}
              onSelectMonth={vi.fn()}
              onRefreshExpenses={vi.fn()}
              onLoadMore={vi.fn()}
              onLoadNewer={vi.fn()}
              onOpenExpense={vi.fn()}
              onResumeDraft={vi.fn()}
              onDiscardDraft={vi.fn()}
            />
          </ThemeContext.Provider>,
        );
      });
      const [row] = findHosts(
        screen!.toJSON() as ReactTestRendererJSON,
        (props, type) => type === 'Pressable' && flatten(props.style).minHeight === 60,
      );
      return flatten(row!.props.style);
    };
    it.each([
      { fontScale: 1, credited: 'center' },
      { fontScale: 1.3, credited: 'flex-start' },
      { fontScale: 2, credited: 'flex-start' },
    ])('aligns it with the title at $fontScale× text, 360dp: $credited', (size) => {
      setWindow({ width: 360, height: 640, fontScale: size.fontScale });
      expect(rowOf(credited).alignItems).toBe(size.credited);
      remount();
      expect(rowOf(groceries).alignItems).toBe('center');
    });
  },
);

// #770, from the Designer's #751 check: a credit cut beside a dot read "chat….evil". Once the
// credit's line knows its width, the app cuts it, with no dot beside the "…"; at the largest
// text it reads in full.
describe.each(['light', 'dark'] as const)(
  'an Expense row’s credit cut by the app in %s (#770)',
  (mode) => {
    const host = 'chatgpt.com.secure-assistant-connector.evil.example.test';
    const credit = () =>
      screen!.root.find(
        (node) =>
          isHost(node, 'Text') &&
          node.children
            .filter((child) => typeof child === 'string')
            .join('')
            .startsWith('prepared by'),
      );
    it.each([1.3, 2])('at %s× text, 360dp', (fontScale) => {
      setWindow({ width: 360, height: 640, fontScale });
      act(() => {
        screen = create(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <GroupExpensesView
              group={group()}
              currentUserId={you}
              state={financial({
                data: [{ ...groceries, preparedBy: { kind: 'assistant', name: host } }],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
              })}
              kept={null}
              savedExpenseId={null}
              now={now}
              onSelectMonth={vi.fn()}
              onRefreshExpenses={vi.fn()}
              onLoadMore={vi.fn()}
              onLoadNewer={vi.fn()}
              onOpenExpense={vi.fn()}
              onResumeDraft={vi.fn()}
              onDiscardDraft={vi.fn()}
            />
          </ThemeContext.Provider>,
        );
      });
      // The row lies in a Card 16dp in, inside its 1dp border; the row's 14dp padding, a 40dp
      // icon and a 12dp gap leave its note's line 246dp.
      act(() => {
        credit().props.onLayout?.({
          nativeEvent: { layout: { x: 0, y: 0, width: 246, height: 16 } },
        });
      });
      const shown = credit()
        .children.filter((child) => typeof child === 'string')
        .join('')
        .trimEnd();
      if (fontScale < 1.5) {
        expect(shown).toMatch(/^prepared by [^…]*[^.]…[^.][^…]*example\.test$/);
      } else {
        expect(credit().props.numberOfLines).toBe(0);
        expect(shown).toBe(`prepared by ${host}`);
      }
    });
  },
);

// #785, seen on the emulator at 360dp: an Expense row's title cut at its tail lost its "…"'s last
// dot, "and the .." at 130%. It draws its "…" inside the row at large text, light and dark.
describe.each(['light', 'dark'] as const)('an Expense row’s cut title in %s (#785)', (mode) => {
  const long = 'Parasailing, jet ski and the banana boat ride at Calangute beach';
  const render = (expense: MobileExpense) =>
    act(() => {
      screen = create(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <GroupExpensesView
            group={group()}
            currentUserId={you}
            state={financial({
              data: [expense],
              pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
            })}
            kept={null}
            savedExpenseId={null}
            now={now}
            onSelectMonth={vi.fn()}
            onRefreshExpenses={vi.fn()}
            onLoadMore={vi.fn()}
            onLoadNewer={vi.fn()}
            onOpenExpense={vi.fn()}
            onResumeDraft={vi.fn()}
            onDiscardDraft={vi.fn()}
          />
        </ThemeContext.Provider>,
      );
    });
  it.each([1.3, 1.45])('draws its "…" inside the row at %s× text, 360dp', (fontScale) => {
    setWindow({ width: 360, height: 640, fontScale });
    render({ ...groceries, description: long });
    const [row] = findHosts(
      screen!.toJSON() as ReactTestRendererJSON,
      (props, type) => type === 'Pressable' && flatten(props.style).minHeight === 60,
    );
    // The row lies in a Card inset 16dp from the screen's edges, inside its 1dp border.
    expect(tailCutOverrun(row!, fontScale, 360 - 34, long)).toBeLessThanOrEqual(0);
    // As tall as a row whose title fits: the cut changes no line's height.
    const cutRow = layoutHeight(row!, fontScale, 360 - 34);
    act(() => screen?.unmount());
    render(groceries);
    const [short] = findHosts(
      screen!.toJSON() as ReactTestRendererJSON,
      (props, type) => type === 'Pressable' && flatten(props.style).minHeight === 60,
    );
    expect(cutRow).toBe(layoutHeight(short!, fontScale, 360 - 34));
  });
});
