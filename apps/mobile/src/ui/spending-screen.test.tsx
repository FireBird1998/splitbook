import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { SEPARATOR } from '@splitbook/shared/separator';
import type { SpendingMonthState, SpendingScreenState } from '../data/types';
import { setWindow } from '../test-utils/native';
import { payers, SpendingScreen } from './spending-screen';
import { ThemeContext } from './theme';

// #1276: Spending, board SpendAndDays (and SpendAndSettings 7, the large Month). Fictional people
// and Groups only. The phone's clock is 16 November 2026; its locale starts the week on Sunday.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});

const me = 'a00000000000000000000001';
const priya = 'a00000000000000000000003';
const maple = { _id: 'b00000000000000000000001', name: 'Maple House' };
const goa = { _id: 'b00000000000000000000002', name: 'Goa Friends Trip' };
const today = '2026-11-16';
const months = [
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
  '2026-11',
];
/** The board's November in rupees: whole rupees a day. */
const rupees: [string, number][] = [
  ['2026-11-01', 12_000],
  ['2026-11-02', 640],
  ['2026-11-04', 850],
  ['2026-11-05', 420],
  ['2026-11-07', 1_180],
  ['2026-11-08', 350],
  ['2026-11-10', 400],
  ['2026-11-11', 260],
  ['2026-11-13', 4_200],
  ['2026-11-14', 2_220],
  ['2026-11-15', 560],
  ['2026-11-16', 420],
];
const expense = (
  id: string,
  description: string,
  group: typeof maple,
  tag: string,
  payer: string,
  day: string,
  share: number,
  amount: number,
) => ({
  _id: id,
  group,
  description,
  tag,
  paidBy: [{ _id: payer, name: payer === me ? 'Alex' : 'Priya' }],
  day,
  shareMinor: share * 100,
  amountMinor: amount * 100,
});
const inr = (days: [string, number][], expenses: ReturnType<typeof expense>[] = []) => ({
  currency: 'INR',
  totalMinor: days.reduce((sum, [, share]) => sum + share * 100, 0),
  dayCount: days.length,
  days: days.map(([day, share]) => ({ day, shareMinor: share * 100 })),
  expenses,
});
const eur = {
  currency: 'EUR',
  totalMinor: 8_600,
  dayCount: 3,
  days: [
    { day: '2026-11-12', shareMinor: 1_400 },
    { day: '2026-11-13', shareMinor: 4_200 },
    { day: '2026-11-14', shareMinor: 3_000 },
  ],
  expenses: [],
};
const sixteenth = [
  expense('d00000000000000000000001', 'Milk and bread', maple, 'Groceries', me, today, 180, 900),
  expense(
    'd00000000000000000000002',
    'Cab to the station',
    goa,
    'Transport',
    priya,
    today,
    240,
    960,
  ),
];
const read = (
  currencies: unknown[],
  over: Partial<SpendingMonthState> = {},
  month = '2026-11',
): SpendingMonthState => ({
  month,
  status: 'ready',
  data: { month, timeZone: 'Asia/Kolkata', currencies } as SpendingMonthState['data'],
  refreshedAt: Date.parse('2026-11-16T04:08:00.000Z'),
  restored: false,
  unsaved: false,
  message: null,
  ...over,
});
const november = (over: Partial<SpendingScreenState> = {}): SpendingScreenState => ({
  month: '2026-11',
  day: today,
  currency: null,
  months,
  read: read([inr(rupees, sixteenth), eur]),
  ...over,
});

function render(
  state: SpendingScreenState,
  { mode = 'light', offline = false }: { mode?: 'light' | 'dark'; offline?: boolean } = {},
) {
  const calls = {
    onMonth: vi.fn(),
    onDay: vi.fn(),
    onCurrency: vi.fn(),
    onExpense: vi.fn(),
    onRetry: vi.fn(),
  };
  act(() => {
    screen = create(
      <ThemeContext.Provider value={getSemanticTokens(mode)}>
        <SpendingScreen
          screen={state}
          today={today}
          me={me}
          zeroCurrency="INR"
          offline={offline}
          {...calls}
        />
      </ThemeContext.Provider>,
    );
  });
  return calls;
}
const texts = () =>
  screen!.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) =>
      node.children
        .filter((child) => typeof child === 'string')
        .join('')
        .trim(),
    )
    .filter(Boolean);
const shown = () => texts().join(' | ');
const byRole = (role: string) =>
  screen!.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === role,
  );
const labelled = (label: string) =>
  screen!.root.find(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label,
  );
const cell = (day: string) =>
  screen!.root.find((node) => node.props.testID === `spending-cell-${day}`);
const look = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style);
const cellText = (day: string) =>
  cell(day)
    .findAll(
      (node) =>
        (node.type as unknown) === 'Text' &&
        node.children.some((child) => typeof child === 'string'),
    )
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''));

describe('Spending (#1276)', () => {
  it('opens on today: its Month, total, tinted grid and the day’s Expenses with my share of each', () => {
    const calls = render(november());
    expect(texts()).toContain('November 2026');
    expect(texts()).toContain('₹23,500.00');
    expect(texts()).toContain(`Your share so far${SEPARATOR}12\u00a0days with spending`);
    // A tab per currency, the shown one selected, never added together.
    const tabs = byRole('tab');
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      'INR, ₹23,500.00',
      'EUR, €86.00',
    ]);
    expect(tabs.map((tab) => tab.props.accessibilityState.selected)).toEqual([true, false]);
    // Paging: not past this Month.
    expect(labelled('Next month').props.accessibilityState).toMatchObject({ disabled: true });
    act(() => labelled('Previous month').props.onPress());
    expect(calls.onMonth).toHaveBeenCalledWith('2026-10');
    // Whole rupees in each day so far; today chosen and underlined; the days to come not offered.
    expect(cellText('2026-11-01')).toEqual(['1', '12,000']);
    expect(cellText('2026-11-03')).toEqual(['3']);
    expect(cell('2026-11-16').props.accessibilityState).toEqual({ selected: true });
    expect(look(cell('2026-11-16'))).toMatchObject({ borderWidth: 2 });
    expect(cell('2026-11-17').props.accessibilityRole).toBeUndefined();
    act(() => cell('2026-11-02').props.onPress());
    expect(calls.onDay).toHaveBeenCalledWith('2026-11-02');
    // The chosen day: its total, and each Expense in full.
    expect(texts()).toContain(`Mon 16 Nov${SEPARATOR}Today`);
    expect(texts()).toContain('₹420.00');
    expect(texts()).toEqual(
      expect.arrayContaining([
        'Milk and bread',
        `Maple House${SEPARATOR}Groceries${SEPARATOR}You paid`,
        '₹180.00',
        'of ₹900.00',
        'Cab to the station',
        `Goa Friends Trip${SEPARATOR}Transport${SEPARATOR}Priya paid`,
        '₹240.00',
        'of ₹960.00',
      ]),
    );
    expect(shown()).toContain(
      '2\u00a0Expenses. Payments between members are not spending, so they are left out.',
    );
    act(() => labelled('Milk and bread, Maple House, your share ₹180.00').props.onPress());
    expect(calls.onExpense).toHaveBeenCalledWith(maple._id, 'd00000000000000000000001');
    act(() => tabs[1]!.props.onPress());
    expect(calls.onCurrency).toHaveBeenCalledWith('EUR');
  });

  it('tints a large day without washing out the small ones: five fixed steps', () => {
    render(november({ day: '2026-11-01' }));
    const { dayTint } = getSemanticTokens('light');
    expect(look(cell('2026-11-01')).backgroundColor).toBe(dayTint.fill[4]);
    expect(look(cell('2026-11-07')).backgroundColor).toBe(dayTint.fill[3]);
    expect(look(cell('2026-11-02')).backgroundColor).toBe(dayTint.fill[2]);
    expect(look(cell('2026-11-11')).backgroundColor).toBe(dayTint.fill[1]);
    expect(look(cell('2026-11-03')).backgroundColor).toBe(dayTint.fill[0]);
    expect(texts()).toContain('Sun 1 Nov');
    expect(shown()).toContain('Nothing shared on this day.');
  });

  it('keeps the grid for a Month with nothing, says so, and pages on', () => {
    const calls = render(november({ month: '2026-08', day: null, read: read([], {}, '2026-08') }));
    expect(texts()).toContain('August 2026');
    expect(texts()).toContain('₹0.00');
    expect(texts()).toContain('Your share in August');
    expect(texts()).toContain('Nothing shared in August');
    expect(texts()).toContain('Expenses you have a share in show here on the day they happened.');
    expect(byRole('tab')).toHaveLength(0);
    expect(cell('2026-08-31').props.accessibilityLabel).toBe('31 August, nothing');
    act(() => labelled('Next month').props.onPress());
    expect(calls.onMonth).toHaveBeenCalledWith('2026-09');
  });

  it('draws the tints and the text on them from the dark tokens', () => {
    render(november(), { mode: 'dark' });
    const { dayTint } = getSemanticTokens('dark');
    expect(look(cell('2026-11-01')).backgroundColor).toBe('#9aa6ff');
    const [date, share] = cell('2026-11-01').findAll((node) => (node.type as unknown) === 'Text');
    expect(StyleSheet.flatten(date!.props.style).color).toBe(dayTint.text[4]);
    expect(StyleSheet.flatten(share!.props.style).color).toBe('#0e1016');
  });

  it('writes a large Month’s total in full where it fits, and shortens only the days too wide for a cell', () => {
    setWindow({ width: 360 });
    const days: [string, number][] = [
      ['2026-11-01', 125_000],
      ['2026-11-04', 8_500],
      ['2026-11-07', 45_000],
      ['2026-11-13', 1_240_000],
    ];
    render(november({ day: '2026-11-13', read: read([inr(days)]) }));
    expect(texts()).toContain('₹1,418,500.00');
    expect(cellText('2026-11-01')).toEqual(['1', '1.25L']);
    expect(cellText('2026-11-13')).toEqual(['13', '12.4L']);
    expect(cellText('2026-11-07')).toEqual(['7', '45,000']);
    expect(cellText('2026-11-04')).toEqual(['4', '8,500']);
    // TalkBack hears the whole amount and the date.
    expect(cell('2026-11-13').props.accessibilityLabel).toBe('13 November, ₹1,240,000.00');
    expect(texts()).toContain('₹1,240,000.00');
  });

  it.each([1.3, 2])('keeps seven columns at %sx text, and shortens cells sooner', (fontScale) => {
    setWindow({ fontScale });
    render(november());
    const grid = screen!.root.find((node) => node.props.testID === 'spending-grid');
    const weeks = grid.children.slice(1) as ReactTestInstance[];
    for (const week of weeks) expect(week.children).toHaveLength(7);
    expect(cellText('2026-11-01')).toEqual(['1', '12K']);
    expect(cellText('2026-11-07')).toEqual(['7', '1.2K']);
    expect(cellText('2026-11-05')).toEqual(['5', '420']);
  });

  it('while it loads, draws the grid’s frame and shows no total', () => {
    render(november({ read: read([], { status: 'loading', data: null, refreshedAt: null }) }));
    expect(shown()).not.toContain('₹');
    expect(screen!.root.findAll((node) => node.props.testID === 'spending-grid')).not.toHaveLength(
      0,
    );
    expect(byRole('button').filter((node) => node.props.testID)).toHaveLength(0);
  });

  it('offline, says a Month not on this phone isn’t, with Try again, and shows a saved one with its time', () => {
    const calls = render(
      november({
        month: '2026-10',
        day: null,
        read: read(
          [],
          {
            status: 'error',
            data: null,
            refreshedAt: null,
            unsaved: true,
            message: 'Your spending isn’t on this phone yet. Connect to load it.',
          },
          '2026-10',
        ),
      }),
      { offline: true },
    );
    expect(texts()).toContain('This month isn’t on this phone yet. Connect to load it.');
    expect(shown()).not.toContain('₹');
    act(() => labelled('Try again').props.onPress());
    expect(calls.onRetry).toHaveBeenCalledOnce();
    act(() => screen!.unmount());
    render(november({ read: { ...read([inr(rupees, sixteenth)]), restored: true } }), {
      offline: true,
    });
    expect(texts().some((text) => text.startsWith('Saved '))).toBe(true);
    expect(texts()).toContain('₹23,500.00');
  });

  it('keeps the figures beside a failed read, with the usual retry', () => {
    const calls = render(
      november({
        read: {
          ...read([inr(rupees, sixteenth)]),
          status: 'error',
          message: 'Couldn’t load your spending. Please try again.',
        },
      }),
    );
    expect(texts()).toContain('₹23,500.00');
    act(() =>
      byRole('button')
        .find((node) => String(node.props.accessibilityLabel).startsWith('Retry'))!
        .props.onPress(),
    );
    expect(calls.onRetry).toHaveBeenCalledOnce();
  });
});

describe('who paid, as a day’s row says it (#1276)', () => {
  it.each([
    [[{ _id: me, name: 'Alex' }], 'You paid'],
    [[{ _id: priya, name: 'Priya' }], 'Priya paid'],
    [[{ _id: priya }], 'A former member paid'],
    [
      [
        { _id: priya, name: 'Priya' },
        { _id: me, name: 'Alex' },
      ],
      'You and Priya paid',
    ],
    [
      [
        { _id: priya, name: 'Priya' },
        { _id: 'a00000000000000000000004', name: 'Sam' },
        { _id: 'a00000000000000000000005', name: 'Noor' },
      ],
      'Priya and 2 others paid',
    ],
  ])('%j → %s', (paidBy, said) => {
    expect(payers(paidBy, me)).toBe(said);
  });
});
