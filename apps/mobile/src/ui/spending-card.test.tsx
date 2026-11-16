import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import type { SpendingMonthState } from '../data/types';
import { SEPARATOR } from '@splitbook/shared/separator';
import { setWindow } from '../test-utils/native';
import { SpendingCard } from './spending-card';
import { ThemeContext } from './theme';

// #1275: the Spending card on Home, board SpendAndHome (and SpendAndSettings 4 and 6). Fictional
// Groups only. The phone's clock is 16 November 2026; its locale starts the week on Sunday.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});

const today = '2026-11-16';
const read = Date.parse('2026-11-16T04:08:00.000Z');
/** The board's November: rupees on twelve days, the 1st the largest. */
const rupeeDays: [string, number][] = [
  ['2026-11-01', 1_200_000],
  ['2026-11-02', 64_000],
  ['2026-11-04', 85_000],
  ['2026-11-05', 42_000],
  ['2026-11-07', 118_000],
  ['2026-11-08', 35_000],
  ['2026-11-10', 40_000],
  ['2026-11-11', 26_000],
  ['2026-11-13', 420_000],
  ['2026-11-14', 222_000],
  ['2026-11-15', 56_000],
  ['2026-11-16', 42_000],
];
const currency = (code: string, days: [string, number][]) => ({
  currency: code,
  totalMinor: days.reduce((sum, [, share]) => sum + share, 0),
  dayCount: days.length,
  days: days.map(([day, shareMinor]) => ({ day, shareMinor })),
  expenses: [],
});
const month = (
  currencies: ReturnType<typeof currency>[],
  over: Partial<SpendingMonthState> = {},
): SpendingMonthState => ({
  month: '2026-11',
  status: 'ready',
  data: { month: '2026-11', timeZone: 'Asia/Kolkata', currencies },
  refreshedAt: read,
  restored: false,
  unsaved: false,
  message: null,
  ...over,
});
const usual = () => month([currency('INR', rupeeDays)]);

function render(
  state: SpendingMonthState,
  { mode = 'light', offline = false }: { mode?: 'light' | 'dark'; offline?: boolean } = {},
) {
  const onOpen = vi.fn(),
    onRetry = vi.fn();
  act(() => {
    screen = create(
      <ThemeContext.Provider value={getSemanticTokens(mode)}>
        <SpendingCard
          state={state}
          today={today}
          currency="INR"
          offline={offline}
          onOpen={onOpen}
          onRetry={onRetry}
        />
      </ThemeContext.Provider>,
    );
  });
  return { onOpen, onRetry };
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
const buttons = () =>
  screen!.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'button',
  );
const card = () =>
  buttons().find((node) => String(node.props.accessibilityLabel).startsWith('Spending, '));
const cell = (day: string) =>
  screen!.root.find((node) => node.props.testID === `spending-day-${day}`);
const cellStyle = (day: string) => StyleSheet.flatten(cell(day).props.style);
const grids = () =>
  screen!.root.findAll(
    (node) => (node.type as unknown) === 'View' && node.props.testID === 'spending-month',
  );

describe('the Spending card (#1275)', () => {
  it('shows this Month’s share in full beside the month’s grid, and opens Spending as one button', () => {
    const { onOpen } = render(usual());
    expect(texts()).toContain(`Spending${SEPARATOR}November`);
    expect(texts().some((text) => text.startsWith('Updated '))).toBe(true);
    expect(texts()).toContain('₹23,500.00');
    expect(texts()).toContain(`Your share${SEPARATOR}12 days with spending`);
    expect(texts()).toContain('See each day');
    expect(buttons()).toHaveLength(1);
    expect(card()!.props.accessibilityLabel).toBe(
      'Spending, November. Your share ₹23,500.00. 12 days with spending. See each day',
    );
    act(() => card()!.props.onPress());
    expect(onOpen).toHaveBeenCalledOnce();
    // The grid sits beside the figure.
    const row = screen!.root.find((node) => node.props.testID === 'spending-figures');
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row' });
  });

  it('tints each day so far by its share in five fixed steps, rings today, and outlines the days to come', () => {
    render(usual());
    const theme = getSemanticTokens('light');
    // Hidden from TalkBack: the label says the figures.
    expect(grids()[0]!.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(cellStyle('2026-11-01').backgroundColor).toBe(theme.brand.main);
    expect(cellStyle('2026-11-14').backgroundColor).toBe('#7f8ce6');
    expect(cellStyle('2026-11-02').backgroundColor).toBe('#b9c1f6');
    expect(cellStyle('2026-11-05').backgroundColor).toBe('#dfe3ff');
    expect(cellStyle('2026-11-03').backgroundColor).toBe(theme.surfaceMuted);
    expect(cellStyle('2026-11-17')).toMatchObject({
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.border,
    });
    const ring = cell('2026-11-16').find((node) => node.props.testID === 'spending-today');
    expect(StyleSheet.flatten(ring.props.style)).toMatchObject({ borderColor: theme.text });
    // November 2026 starts on a Sunday: five weeks of seven.
    expect(
      grids()[0]!.findAll(
        (node) =>
          typeof node.props.testID === 'string' && node.props.testID.startsWith('spending-day-'),
      ),
    ).toHaveLength(30);
  });

  it('gives each currency its own line and grid, never added together', () => {
    const euros: [string, number][] = [
      ['2026-11-12', 1_400],
      ['2026-11-13', 4_200],
      ['2026-11-14', 3_000],
    ];
    render(month([currency('INR', rupeeDays), currency('EUR', euros)]));
    expect(texts()).toEqual(
      expect.arrayContaining([
        'INR',
        '₹23,500.00',
        '12 days with spending',
        'EUR',
        '€86.00',
        '3 days with spending',
      ]),
    );
    expect(shown()).not.toContain(`Your share${SEPARATOR}`);
    expect(grids()).toHaveLength(2);
    expect(card()!.props.accessibilityLabel).toBe(
      'Spending, November. Your share ₹23,500.00 over 12 days and €86.00 over 3 days. See each day',
    );
  });

  it('holds its place while it loads, with no figure and no button', () => {
    render(month([], { status: 'loading', data: null, refreshedAt: null }));
    expect(texts()).toContain(`Spending${SEPARATOR}November`);
    expect(shown()).not.toContain('₹');
    expect(buttons()).toHaveLength(0);
    expect(
      screen!.root.findAll((node) => node.props.accessibilityLabel === 'Loading your spending'),
    ).not.toHaveLength(0);
    // The grid's frame is drawn, so the card is as tall as it will be.
    expect(grids()).toHaveLength(1);
  });

  it('says Saved and its time offline, from the copy on this phone, and still opens Spending', () => {
    const { onOpen } = render({ ...usual(), restored: true }, { offline: true });
    expect(texts().some((text) => text.startsWith('Saved '))).toBe(true);
    expect(texts()).toContain('₹23,500.00');
    act(() => card()!.props.onPress());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('with nothing yet this Month, says zero in full and keeps the grid', () => {
    render(month([]));
    expect(texts()).toContain('₹0.00');
    expect(texts()).toContain(`Your share${SEPARATOR}nothing yet in November`);
    expect(cellStyle('2026-11-01').backgroundColor).toBe(getSemanticTokens('light').surfaceMuted);
    expect(card()!.props.accessibilityLabel).toBe(
      'Spending, November. Your share ₹0.00. Nothing yet in November. See each day',
    );
  });

  it.each([1.3, 1.2999999523, 2])(
    'moves the grid under the figure at large text (%s)',
    (fontScale) => {
      setWindow({ fontScale });
      render(usual());
      const row = screen!.root.find((node) => node.props.testID === 'spending-figures');
      expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'column' });
      expect(texts()).toContain('₹23,500.00');
    },
  );

  it('runs its tint from the surface to the bright brand blue in dark', () => {
    render(usual(), { mode: 'dark' });
    const theme = getSemanticTokens('dark');
    expect(cellStyle('2026-11-01').backgroundColor).toBe(theme.focus);
    expect(cellStyle('2026-11-14').backgroundColor).toBe('#5462c8');
    expect(cellStyle('2026-11-02').backgroundColor).toBe('#353f86');
    expect(cellStyle('2026-11-05').backgroundColor).toBe('#262c55');
    expect(cellStyle('2026-11-03').backgroundColor).toBe(theme.surfaceMuted);
  });

  it('turned on offline with nothing on this phone, says so with Try again, never ₹0.00', () => {
    const { onRetry, onOpen } = render(
      month([], {
        status: 'error',
        data: null,
        refreshedAt: null,
        unsaved: true,
        message: 'Your spending isn’t on this phone yet. Connect to load it.',
      }),
      { offline: true },
    );
    expect(texts()).toContain(`Spending${SEPARATOR}November`);
    expect(texts()).toContain('Your spending isn’t on this phone yet. Connect to load it.');
    expect(shown()).not.toContain('₹');
    expect(card()).toBeUndefined();
    const retry = buttons().find((node) => node.props.accessibilityLabel === 'Try again')!;
    act(() => retry.props.onPress());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shortens a large Month that doesn’t fit beside the grid, and says it in full to TalkBack', () => {
    setWindow({ width: 360 });
    const large = month([currency('INR', [['2026-11-13', 142_178_000]])]);
    render(large);
    expect(texts()).toContain('₹14.2L');
    expect(shown()).not.toContain('₹1,421,780.00');
    expect(card()!.props.accessibilityLabel).toBe(
      'Spending, November. Your share ₹1,421,780.00. 1 day with spending. See each day',
    );
    act(() => screen!.unmount());
    // Where it fits, it is written in full.
    setWindow({ width: 412 });
    render(large);
    expect(texts()).toContain('₹1,421,780.00');
  });

  it('without Spending to open, reads as one block with no button and no See each day', () => {
    act(() => {
      screen = create(
        <SpendingCard state={usual()} today={today} currency="INR" onRetry={vi.fn()} />,
      );
    });
    expect(buttons()).toHaveLength(0);
    expect(shown()).not.toContain('See each day');
    const block = screen!.root.find(
      (node) =>
        (node.type as unknown) === 'View' &&
        node.props.accessible === true &&
        String(node.props.accessibilityLabel).startsWith('Spending, '),
    );
    expect(block.props.accessibilityLabel).toBe(
      'Spending, November. Your share ₹23,500.00. 12 days with spending',
    );
  });

  it('keeps figures already shown beside a failed read, and says so with a retry', () => {
    const { onRetry } = render({
      ...usual(),
      status: 'error',
      message: 'Couldn’t load your spending. Please try again.',
    });
    expect(texts()).toContain('₹23,500.00');
    const retry = buttons().find((node) =>
      String(node.props.accessibilityLabel).startsWith('Retry'),
    );
    act(() => retry!.props.onPress());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says a failed read with nothing to show, with Try again', () => {
    const { onRetry } = render(
      month([], {
        status: 'error',
        data: null,
        refreshedAt: null,
        message: 'Couldn’t load your spending. Please try again.',
      }),
    );
    expect(texts()).toContain('Couldn’t load your spending. Please try again.');
    expect(shown()).not.toContain('₹');
    act(() =>
      buttons()
        .find((node) => node.props.accessibilityLabel === 'Try again')!
        .props.onPress(),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
