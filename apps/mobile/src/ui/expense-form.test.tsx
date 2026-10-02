import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { expenseMoney, type ExpenseDraft } from '../data/expense-draft';
import { ThemeContext } from './theme';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 915, scale: 2, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AmountDescriptionCard, WhoOwesWhat, expenseDateLabel } = await import('./expense-form');

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
        (node) => isHost(node, 'TextInput') && node.props.accessibilityLabel === 'Amount, required',
      );
    return {
      onLeave,
      // The row holding the currency and the input.
      ring: () => input().parent!.props.style,
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
