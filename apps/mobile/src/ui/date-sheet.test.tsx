import { useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Host stand-ins: the sheet renders through these names, so the tree keeps the props
// (labels, states, handlers) that Android receives.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    View: 'AnimatedView',
    Value: class {
      setValue() {}
    },
    spring: () => ({ start: () => undefined }),
  },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  PanResponder: { create: (config: object) => ({ panHandlers: config }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 915, scale: 2, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DateSheet } = await import('./date-sheet');

const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
/** The device locale the sheet reads its week and spelling from. */
const deviceLocale = (locale: string) =>
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolvedOptions.call(this), locale };
  });

const changes: string[] = [];
function Sheet({
  visible = true,
  initial,
  locked = false,
}: {
  visible?: boolean;
  initial: string;
  locked?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateSheet
      visible={visible}
      value={value}
      locked={locked}
      onChange={(date) => {
        changes.push(date);
        setValue(date);
      }}
      onDone={() => undefined}
    />
  );
}

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 12));
  deviceLocale('en-IN');
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  changes.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(initial: string, options: { locked?: boolean } = {}) {
  act(() => {
    renderer = create(<Sheet initial={initial} {...options} />);
  });
  const root = () => renderer!.root;
  const pressable = (label: string) =>
    root().find((node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === label);
  return {
    root,
    pressable,
    press: (label: string) => act(() => pressable(label).props.onPress()),
    /** Every day button, each named with its full date. */
    days: () =>
      root().findAll(
        (node) => isHost(node, 'Pressable') && /\d{4}/.test(String(node.props.accessibilityLabel)),
      ),
    selected: () =>
      root()
        .findAll(
          (node) =>
            isHost(node, 'Pressable') &&
            /\d{4}/.test(String(node.props.accessibilityLabel)) &&
            node.props.accessibilityState.selected === true,
        )
        .map((node) => node.props.accessibilityLabel as string),
    month: () =>
      text(
        root().find(
          (node) =>
            isHost(node, 'Text') &&
            node.props.accessibilityRole === 'header' &&
            node.props.accessibilityLiveRegion === 'polite',
        ),
      ),
    footer: () =>
      text(
        root().find(
          (node) =>
            isHost(node, 'Text') &&
            node.props.accessibilityLiveRegion === 'polite' &&
            !node.props.accessibilityRole,
        ),
      ),
    weekdays: () =>
      root().find(
        (node) =>
          isHost(node, 'View') && node.props.importantForAccessibility === 'no-hide-descendants',
      ),
    reopen: () => {
      act(() => renderer!.update(<Sheet initial={initial} visible={false} {...options} />));
      act(() => renderer!.update(<Sheet initial={initial} {...options} />));
    },
  };
}

const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (scope: ReactTestInstance) =>
  scope
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');

describe('Date sheet calendar', () => {
  it('announces each day with its full date, and today and the selection', () => {
    const sheet = render('2026-09-15');
    expect(sheet.month()).toBe('September 2026');
    expect(sheet.days()).toHaveLength(30);
    for (const day of sheet.days()) expect(day.props.accessibilityRole).toBe('button');
    expect(sheet.pressable('Tuesday, 15 September 2026').props.accessibilityState).toEqual({
      selected: true,
      disabled: false,
    });
    expect(sheet.pressable('Wednesday, 30 September 2026, today').props.accessibilityState).toEqual(
      { selected: false, disabled: false },
    );
    expect(sheet.selected()).toEqual(['Tuesday, 15 September 2026']);
    expect(sheet.footer()).toBe('Tuesday, 15 September 2026');
    expect(sheet.pressable('Today').props.accessibilityState).toEqual({ selected: false });

    sheet.press('Wednesday, 30 September 2026, today');
    expect(changes).toEqual(['2026-09-30']);
    expect(sheet.selected()).toEqual(['Wednesday, 30 September 2026, today']);
    expect(sheet.pressable('Today').props.accessibilityState).toEqual({ selected: true });
    expect(sheet.pressable('Yesterday').props.accessibilityState).toEqual({ selected: false });
    expect(sheet.footer()).toBe('Wednesday, 30 September 2026');
  });

  it('keeps each week its own row, with the days in reading order from Month to Month', () => {
    const sheet = render('2026-09-15');
    /** Day numbers as the rows hold them, row by row. */
    const reading = () => {
      const rows = sheet
        .root()
        .findAll((node) => isHost(node, 'View') && node.props.collapsable === false);
      expect(rows).toHaveLength(6);
      return rows.flatMap((row) => {
        expect(row.children).toHaveLength(7);
        return row.children.flatMap((cell) =>
          typeof cell !== 'string' && isHost(cell, 'Pressable')
            ? [Number(/, (\d+) /.exec(cell.props.accessibilityLabel)![1])]
            : [],
        );
      });
    };
    const days = (length: number) => Array.from({ length }, (_, day) => day + 1);
    expect(reading()).toEqual(days(30));
    sheet.press('Next month');
    expect(reading()).toEqual(days(31));
    sheet.press('Next month');
    expect(reading()).toEqual(days(30));
    sheet.press('Previous month');
    sheet.press('Previous month');
    expect(reading()).toEqual(days(30));
    expect(sheet.days().map((day) => day.props.accessibilityLabel)[0]).toBe(
      'Tuesday, 1 September 2026',
    );
  });

  it.each([
    ['en-IN', 'SMTWTFS'],
    ['en-US', 'SMTWTFS'],
    ['en-GB', 'MTWTFSS'],
    ['en-GB-u-fw-sat', 'SSMTWTF'],
  ])('starts the week on the first day for %s, with silent column letters', (locale, letters) => {
    deviceLocale(locale);
    const weekdays = render('2026-09-15').weekdays();
    expect(text(weekdays)).toBe(letters);
    expect(weekdays.props.accessibilityElementsHidden).toBe(true);
  });

  it('pages through Months and allows future dates', () => {
    const sheet = render('2026-09-30');
    sheet.press('Next month');
    expect(sheet.month()).toBe('October 2026');
    expect(sheet.days()).toHaveLength(31);
    expect(sheet.selected()).toEqual([]);
    expect(sheet.days().some((day) => /today/.test(day.props.accessibilityLabel))).toBe(false);
    sheet.press('Next month');
    sheet.press('Next month');
    expect(sheet.month()).toBe('December 2026');
    sheet.press('Thursday, 31 December 2026');
    expect(changes).toEqual(['2026-12-31']);
    expect(sheet.footer()).toBe('Thursday, 31 December 2026');

    for (let month = 0; month < 4; month++) sheet.press('Previous month');
    expect(sheet.month()).toBe('August 2026');
    expect(sheet.pressable('Previous month').props.accessibilityState).toEqual({
      disabled: false,
    });
  });

  it.each([
    ['2026-02-10', 'February 2026', 28],
    ['2028-02-10', 'February 2028', 29],
    ['2026-04-10', 'April 2026', 30],
  ])('offers only the days %s’s Month has', (date, month, length) => {
    const sheet = render(date);
    expect(sheet.month()).toBe(month);
    expect(sheet.days()).toHaveLength(length);
    expect(sheet.days().at(-1)!.props.accessibilityLabel).toContain(`${length} `);
  });

  it('chooses Today or Yesterday in one tap and shows its Month', () => {
    vi.setSystemTime(new Date(2026, 9, 1, 9));
    const sheet = render('2026-09-20');
    sheet.press('Today');
    expect(sheet.month()).toBe('October 2026');
    expect(sheet.selected()).toEqual(['Thursday, 1 October 2026, today']);
    sheet.press('Yesterday');
    expect(sheet.month()).toBe('September 2026');
    expect(sheet.selected()).toEqual(['Wednesday, 30 September 2026']);
    expect(changes).toEqual(['2026-10-01', '2026-09-30']);
  });

  it('opens on the chosen date’s Month each time', () => {
    const sheet = render('2026-09-15');
    sheet.press('Previous month');
    sheet.press('Previous month');
    expect(sheet.month()).toBe('July 2026');
    sheet.reopen();
    expect(sheet.month()).toBe('September 2026');
  });

  it.each([
    ['2026-02-30', 'February 2026'],
    ['2026-9-5', 'September 2026'],
    ['', 'September 2026'],
  ])('selects nothing for %j and asks for a date', (date, month) => {
    const sheet = render(date);
    expect(sheet.month()).toBe(month);
    expect(sheet.selected()).toEqual([]);
    expect(sheet.footer()).toBe('Choose a date');
  });

  it('stops paging at the first year a date can hold', () => {
    const sheet = render('1000-01-15');
    expect(sheet.pressable('Previous month').props.accessibilityState).toEqual({ disabled: true });
    expect(sheet.pressable('Next month').props.accessibilityState).toEqual({ disabled: false });
  });

  it('changes nothing while the Expense is locked', () => {
    const sheet = render('2026-09-15', { locked: true });
    sheet.press('Today');
    sheet.press('Monday, 14 September 2026');
    expect(changes).toEqual([]);
    expect(sheet.pressable('Monday, 14 September 2026').props.accessibilityState).toEqual({
      selected: false,
      disabled: true,
    });
    expect(sheet.footer()).toBe('Tuesday, 15 September 2026');
  });
});
