import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { expenseMoney, type ExpenseDraft } from '../data/expense-draft';
import { ThemeContext } from './theme';
import { setWindow } from '../test-utils/native';
import { findHosts, flatten, layoutHeight, unreadText, wordsOf } from '../test-utils/layout';
import { mockDeviceLocale } from '../test-utils/device-locale';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AmountDescriptionCard, SaveBar, WhoOwesWhat, expenseDateLabel } =
  await import('./expense-form');

const people = ['Alex Rao', 'Sam Chen', 'Priya Shah', 'Jo Park', 'Kim Lee'];
const ids = people.map((_, index) => `a0000000000000000000000${index + 1}`);
const draft = (amount: string, participants = ids): ExpenseDraft => ({
  amount,
  currency: 'INR',
  description: 'Dinner',
  date: '2026-09-30',
  payerId: ids[0],
  multiPayer: false,
  payers: [],
  splitMethod: 'equal',
  splitValues: {},
  participantIds: participants,
  category: 'food',
  tagId: '',
  notes: '',
});

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
});
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const rows = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'View') && node.props.accessible === true)
    .map((node) => node.props.accessibilityLabel as string);
const text = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');

function table(value: ExpenseDraft) {
  act(() => {
    renderer = create(
      <WhoOwesWhat
        draft={value}
        allocation={expenseMoney(value)}
        problem=""
        name={(id) => people[ids.indexOf(id)]}
        currentUserId={ids[0]}
        money={(minor) => `₹${(minor / 100).toFixed(2)}`}
      />,
    );
  });
  return renderer!.root;
}

describe('Who owes what', () => {
  it('shows three people and "Show all" when more than four share', () => {
    const root = table(draft('500.00'));
    expect(rows(root)).toEqual([
      'You: paid ₹500.00, share ₹100.00',
      'Sam Chen: paid nothing, share ₹100.00',
      'Priya Shah: paid nothing, share ₹100.00',
    ]);
    const showAll = root.find(
      (node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === 'Show all 5',
    );
    act(() => {
      showAll.props.onPress();
    });
    expect(rows(root)).toHaveLength(5);
    expect(text(root)).toContain('₹500.00 paid = ₹500.00 shared.');
    expect(text(root)).not.toContain('smallest unit');
  });

  it('lists everyone when four or fewer share, and notes rounding only when it happened', () => {
    const root = table(draft('100.00', ids.slice(0, 3)));
    expect(rows(root)).toEqual([
      'You: paid ₹100.00, share ₹33.34',
      'Sam Chen: paid nothing, share ₹33.33',
      'Priya Shah: paid nothing, share ₹33.33',
    ]);
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Show all 3')).toHaveLength(0);
    expect(text(root)).toContain(
      'Shares differ by the smallest unit so the whole amount is shared.',
    );
  });

  /** Every amount in the table, with the line limit Android would apply to it. */
  const amounts = (root: ReactTestInstance) =>
    root
      .findAll((node) => isHost(node, 'Text') && /^₹/.test(String(node.children[0])))
      .map((node) => ({ text: node.children[0], lines: node.props.numberOfLines }));

  it('never cuts an amount short, however long it is', () => {
    const root = table(draft('1000000.00', ids.slice(0, 3)));
    expect(amounts(root).length).toBeGreaterThan(0);
    // No line limit, so Android never ellipsizes "₹1,000,000.00" as "₹1,000.…".
    for (const amount of amounts(root)) expect(amount.lines || 0).toBe(0);
  });

  it.each([
    ['at 130% text', { fontScale: 1.3 }],
    ['on a narrow screen', { width: 340 }],
  ])('puts Paid and Share under each name %s', (_case, size) => {
    setWindow(size);
    const root = table(draft('100.00', ids.slice(0, 3)));
    const rows = root.findAll((node) => isHost(node, 'View') && node.props.accessible === true);
    expect(rows.map(text)).toEqual([
      'ARYouPaid₹100.00Share₹33.34',
      'SCSam ChenPaid–Share₹33.33',
      'PSPriya ShahPaid–Share₹33.33',
    ]);
    // The column headings go: each amount is labelled where it is.
    expect(text(root).match(/Paid/g)).toHaveLength(3);
    for (const amount of amounts(root)) expect(amount.lines || 0).toBe(0);
  });
});

describe('Expense date label', () => {
  const now = new Date(2026, 8, 30, 12).getTime();
  it('stays on the Gregorian calendar in a Persian-calendar locale', () => {
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    const locale = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...resolvedOptions.call(this), locale: 'fa-IR' };
      });
    onTestFinished(() => locale.mockRestore());
    expect(expenseDateLabel('2026-09-30', now)).toEqual({
      shown: 'Today, ۳۰ سپتامبر',
      spoken: 'Today, چهارشنبه ۳۰ سپتامبر ۲۰۲۶',
    });
    expect(expenseDateLabel('2026-09-29', now)).toEqual({
      shown: 'سه‌شنبه ۲۹ سپتامبر',
      spoken: 'Yesterday, سه‌شنبه ۲۹ سپتامبر ۲۰۲۶',
    });
    expect(expenseDateLabel('2025-09-24', now)).toEqual({
      shown: '۲۴ سپتامبر ۲۰۲۵',
      spoken: 'چهارشنبه ۲۴ سپتامبر ۲۰۲۵',
    });
  });

  it('puts the day first on a US phone, as the rest of the app does (#640)', () => {
    mockDeviceLocale('en-US');
    expect(expenseDateLabel('2026-09-30', now)).toEqual({
      shown: 'Today, 30 Sep',
      spoken: 'Today, Wednesday 30 September 2026',
    });
    expect(expenseDateLabel('2026-09-29', now)).toEqual({
      shown: 'Tue 29 Sep',
      spoken: 'Yesterday, Tuesday 29 September 2026',
    });
    expect(expenseDateLabel('2025-09-24', now)).toEqual({
      shown: '24 Sep 2025',
      spoken: 'Wednesday 24 September 2025',
    });
  });

  it('says Today and Yesterday, and dates other days', () => {
    expect(expenseDateLabel('2026-09-30', now).shown).toMatch(/^Today, /);
    expect(expenseDateLabel('2026-09-30', now).spoken).toMatch(/^Today, .*2026/);
    expect(expenseDateLabel('2026-09-29', now).spoken).toMatch(/^Yesterday, .*29.*2026/);
    expect(expenseDateLabel('2026-09-24', now).shown).toMatch(/24/);
    expect(expenseDateLabel('2025-09-24', now).shown).toMatch(/2025/);
    expect(expenseDateLabel('2026-02-30', now)).toEqual({
      shown: '2026-02-30',
      spoken: '2026-02-30',
    });
    expect(expenseDateLabel('', now)).toEqual({ shown: 'Choose a date', spoken: 'Choose a date' });
  });

  // A half-width tile on a 360dp phone fits about 14 characters ("Today, 30 Sept").
  it.each(['2026-09-30', '2026-09-29', '2026-09-24', '2026-01-31', '2025-12-31', '2027-05-17'])(
    'keeps %s short enough for a half-width tile and speaks it in full',
    (date) => {
      // English's longest short months, as on an Indian phone: "Sept".
      mockDeviceLocale('en-IN');
      const { shown, spoken } = expenseDateLabel(date, now);
      expect(shown.length).toBeLessThanOrEqual(14);
      expect(shown).not.toContain('Yesterday');
      expect(spoken).toMatch(/\d{4}$/);
    },
  );
});

describe('Amount focus ring', () => {
  function card(mode: 'light' | 'dark', locked = false) {
    const onLeave = vi.fn();
    act(() => {
      renderer = create(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <AmountDescriptionCard
            draft={draft('1249.50')}
            locked={locked}
            errors={{}}
            amountRef={() => undefined}
            descriptionRef={() => undefined}
            section={() => () => undefined}
            onChange={() => undefined}
            onLeave={onLeave}
            onAmountDone={() => undefined}
          />
        </ThemeContext.Provider>,
      );
    });
    const root = renderer!.root;
    const input = () =>
      root.find(
        (node) =>
          isHost(node, 'TextInput') &&
          node.props.accessibilityLabel === 'Amount, Indian Rupee, required',
      );
    return {
      onLeave,
      // The row holding the currency and the amount, which keeps the input with its symbol.
      ring: () => input().parent!.parent!.props.style,
      focus: () => act(() => input().props.onFocus()),
      blur: () => act(() => input().props.onBlur()),
    };
  }

  it.each(['light', 'dark'] as const)(
    'outlines Amount in the %s focus colour while it has focus, without moving it',
    (mode) => {
      const amount = card(mode);
      const unfocused = amount.ring();
      expect(unfocused).toMatchObject({ borderWidth: 2, borderColor: 'transparent' });
      amount.focus();
      expect(amount.ring()).toEqual({ ...unfocused, borderColor: getSemanticTokens(mode).focus });
      amount.blur();
      expect(amount.ring()).toEqual(unfocused);
      expect(amount.onLeave).toHaveBeenCalledExactlyOnceWith('amount');
    },
  );

  it('shows no ring on a locked Amount', () => {
    const amount = card('light', true);
    amount.focus();
    expect(amount.ring()).toMatchObject({ borderColor: 'transparent' });
  });
});

// #876: at 200% on a 360 dp phone, "WHO OWES WHAT · EUR" and its "✓ Adds up" badge stayed on one
// line and the badge was cut at the card's edge. Where they can't share a line, the badge goes onto
// a line of its own at the row's end, as a section's action does (#639).
describe.each(['light', 'dark'] as const)('the Who owes what heading in %s (#876)', (mode) => {
  const euros = { ...draft('2500.50', ids.slice(0, 3)), currency: 'EUR' };
  function heading(fontScale: number) {
    setWindow({ width: 360, height: 640, fontScale });
    act(() => {
      renderer = create(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <WhoOwesWhat
            draft={euros}
            allocation={expenseMoney(euros)}
            problem=""
            name={(id) => people[ids.indexOf(id)]}
            currentUserId={ids[0]}
            money={(minor) => `€${(minor / 100).toFixed(2)}`}
          />
        </ThemeContext.Provider>,
      );
    });
    const tree = renderer!.toJSON() as ReactTestRendererJSON;
    // The heading's row: the view that holds the heading and the badge.
    const [row] = findHosts(
      tree,
      (props, type) =>
        type === 'View' &&
        flatten(props.style).paddingTop === 12 &&
        flatten(props.style).paddingHorizontal === 14,
    );
    expect(wordsOf(row!)).toContain('Who owes what · EUR');
    expect(wordsOf(row!)).toContain('Adds up');
    return row!;
  }
  // The Card sits 16 dp in from the screen's edges, inside its 1 dp border.
  const card = 360 - 32 - 2;

  it.each([1.3, 2])('reads in full at %s× text, the badge wrapping', (fontScale) => {
    const row = heading(fontScale);
    expect(unreadText(row, fontScale, card)).toEqual([]);
    expect(flatten(row.props.style)).toMatchObject({ flexWrap: 'wrap' });
  });

  it('keeps the badge beside the heading where they fit, at 100%', () => {
    const row = heading(1);
    expect(unreadText(row, 1, card)).toEqual([]);
    // One line: as tall as the taller of the heading and the badge, under the row's 12 dp.
    const [title, badge] = (row.children ?? []) as ReactTestRendererJSON[];
    const one = Math.max(layoutHeight(title!, 1, card), layoutHeight(badge!, 1, card));
    expect(layoutHeight(row, 1, card)).toBe(one + 12);
  });
});

// #867, from the Tester's #710 device pass: at 200% on a 360 dp phone, 2500.50 in Swiss francs
// showed only "CHF 00.50": the chip and the "CHF" before the amount left the field too little
// room. The amount, with its symbol, moves under the chip where it doesn't fit beside it.
describe.each(['light', 'dark'] as const)('the Amount field at large text in %s (#867)', (mode) => {
  function card(currency: string, fontScale: number, amount = '2500.50') {
    setWindow({ width: 360, height: 640, fontScale });
    act(() => {
      renderer = create(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <AmountDescriptionCard
            draft={{ ...draft(amount), currency }}
            locked={false}
            errors={{}}
            amountRef={() => undefined}
            descriptionRef={() => undefined}
            section={() => () => undefined}
            onChange={() => undefined}
            onLeave={() => undefined}
            onAmountDone={() => undefined}
            onCurrency={() => undefined}
          />
        </ThemeContext.Provider>,
      );
    });
    return renderer!.toJSON() as ReactTestRendererJSON;
  }
  /** The row that holds the currency and the amount, inside its focus ring. */
  const field = (tree: ReactTestRendererJSON) =>
    findHosts(
      tree,
      (props, type) => type === 'View' && flatten(props.style).marginHorizontal === -10,
    )[0]!;
  // The Card sits 16 dp in from the screen's edges.
  const screenWidth = 360 - 32;

  it.each([
    { currency: 'CHF', fontScale: 2 },
    { currency: 'CHF', fontScale: 1.3 },
    { currency: 'INR', fontScale: 2 },
    { currency: 'EUR', fontScale: 2 },
  ])('shows the whole of 2500.50 in $currency at $fontScale× text, 360 dp', (size) => {
    const tree = card(size.currency, size.fontScale);
    expect(unreadText(tree, size.fontScale, screenWidth)).toEqual([]);
  });

  // Since #884 a franc's amount has no "CHF" beside its chip, which already says CHF; Canadian
  // dollars keep a prefix as wide ("CA$"), so the move under the chip is checked with them.
  it('keeps the amount beside the chip where it fits, and moves it under where it doesn’t', () => {
    const height = (fontScale: number, amount: string) =>
      layoutHeight(field(card('CAD', fontScale, amount)), fontScale, screenWidth);
    // At 100% 2500.50 fits beside the chip, on the one line a short amount takes.
    expect(height(1, '2500.50')).toBe(height(1, '5'));
    // At 200% it doesn't: the amount takes a line of its own, under the chip.
    expect(height(2, '2500.50')).toBeGreaterThan(height(2, '5'));
  });
});

// #867: at 200% on a 360 dp phone, the sticky Save read "Save ex / pense" beside "CHF 2,500.50".
// From 150% the amount goes under the words, as Record payment's does (#639).
describe.each(['light', 'dark'] as const)('the Save bar at large text in %s (#867)', (mode) => {
  function bar(fontScale: number, amount: string) {
    setWindow({ width: 360, height: 640, fontScale });
    act(() => {
      renderer = create(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <SaveBar label="Save expense" amount={amount} blocked={null} onSave={() => undefined} />
        </ThemeContext.Provider>,
      );
    });
    return renderer!.toJSON() as ReactTestRendererJSON;
  }

  it.each([
    { fontScale: 1, amount: 'CHF 2,500.50' },
    { fontScale: 1.3, amount: 'CHF 2,500.50' },
    { fontScale: 1.5, amount: 'CHF 2,500.50' },
    { fontScale: 2, amount: 'CHF 2,500.50' },
    { fontScale: 2, amount: '₹1,24,999.50' },
  ])('never breaks "Save expense" inside a word, $fontScale× text, $amount', (size) => {
    expect(unreadText(bar(size.fontScale, size.amount), size.fontScale, 360)).toEqual([]);
  });
});
