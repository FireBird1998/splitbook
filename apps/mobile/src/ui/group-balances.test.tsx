import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptySettlement, type SettlementState } from '../data/settlement';
import type { GroupCurrencyBalance, GroupFinancialState, MobileGroup } from '../data/types';
import { GroupBalancesView, recordNeedsConnection } from './group-balances';
import { RecordPaymentSheet, recordPaymentFootnote } from './record-payment-sheet';

// #118: the Balances destination and the Record payment sheet's states, rendered.
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
  TextInput: 'TextInput',
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 915, scale: 2, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const you = 'a00000000000000000000001',
  sam = 'a00000000000000000000002',
  priya = 'a00000000000000000000003';
const at = new Date('2026-10-01T10:42:00');
const person = (id: string, name: string) => ({ id, name, image: null });
const group = (category: MobileGroup['category'] = 'home'): MobileGroup => ({
  id: 'b00000000000000000000001',
  name: 'Maple House',
  description: '',
  category,
  defaultCurrency: 'INR',
  members: [
    [you, 'Alex Rivera'],
    [sam, 'Sam Chen'],
    [priya, 'Priya Shah'],
  ].map(([id, name]) => ({
    user: { id, name, email: `${id}@example.test`, image: null },
    role: 'member' as const,
    joinedAt: at,
  })),
  startDate: null,
  endDate: null,
  createdAt: at,
  updatedAt: at,
});
const inr: GroupCurrencyBalance = {
  currency: 'INR',
  balances: [
    { user: person(sam, 'Sam Chen'), balance: 1060 },
    { user: person(priya, 'Priya Shah'), balance: 420 },
    { user: person(you, 'Alex Rivera'), balance: -1480 },
  ],
  debts: [
    { from: person(you, 'Alex Rivera'), to: person(sam, 'Sam Chen'), amount: 1060 },
    { from: person(you, 'Alex Rivera'), to: person(priya, 'Priya Shah'), amount: 420 },
  ],
};
const financial = (
  balances: Partial<GroupFinancialState['balances']> = {},
): GroupFinancialState => ({
  groupId: 'b00000000000000000000001',
  month: '2026-10',
  expenses: {
    status: 'ready',
    data: [],
    summary: null,
    pagination: null,
    message: null,
    moreStatus: 'idle',
    moreMessage: null,
    month: '2026-10',
    refreshedAt: at.getTime(),
    stale: false,
  } as GroupFinancialState['expenses'],
  balances: {
    status: 'ready',
    data: [inr],
    message: null,
    refreshedAt: at.getTime(),
    stale: false,
    ...balances,
  },
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
const render = (element: React.ReactElement) => {
  act(() => {
    screen = create(element);
  });
  return screen!.root;
};

describe('Balances destination', () => {
  const view = (props: Partial<Parameters<typeof GroupBalancesView>[0]> = {}) => {
    const onRecord = vi.fn();
    const root = render(
      <GroupBalancesView
        group={group()}
        currentUserId={you}
        state={financial()}
        offline={false}
        onRecord={onRecord}
        onRefreshBalances={() => undefined}
        {...props}
      />,
    );
    return { root, onRecord };
  };

  it('shows the all-time balance, the payments the member can record and everyone’s position', () => {
    const { root, onRecord } = view();
    const shown = text(root);
    expect(shown).toContain('All-time balance · INR');
    expect(labelled(root, 'You owe ₹1,480.00')).toHaveLength(2);
    expect(shown).toContain('Includes every month. Picking a month on Expenses doesn’t change it.');
    expect(shown).toContain('Record one once it’s paid');
    expect(labelled(root, 'You pay Sam Chen, ₹1,060.00')).toHaveLength(1);
    expect(labelled(root, 'Sam Chen gets back ₹1,060.00')).toHaveLength(1);
    expect(labelled(root, 'Priya Shah gets back ₹420.00')).toHaveLength(1);
    const record = labelled(root, 'Record your payment to Sam Chen')[0];
    expect(record.props.accessibilityRole).toBe('button');
    act(() => record.props.onPress());
    expect(onRecord).toHaveBeenCalledWith(you, sam, 'INR');
  });

  it('lists only payments the member pays or receives', () => {
    const others: GroupCurrencyBalance = {
      ...inr,
      debts: [
        { from: person(sam, 'Sam Chen'), to: person(priya, 'Priya Shah'), amount: 50 },
        { from: person(priya, 'Priya Shah'), to: person(you, 'Alex Rivera'), amount: 20 },
      ],
    };
    const { root } = view({ state: financial({ data: [others] }) });
    expect(labelled(root, 'Priya Shah pays you, ₹20.00')).toHaveLength(1);
    expect(labelled(root, 'Record Priya Shah’s payment to you')).toHaveLength(1);
    expect(text(root)).not.toContain('Sam Chen pays');
  });

  it('disables Record offline and says why', () => {
    const { root, onRecord } = view({ offline: true });
    const record = labelled(root, 'Record your payment to Sam Chen')[0];
    expect(record.props.accessibilityState).toEqual({ disabled: true });
    expect(record.props.accessibilityHint).toBe(recordNeedsConnection);
    expect(text(root)).toContain(recordNeedsConnection);
    expect(onRecord).not.toHaveBeenCalled();
  });

  it('leaves out the Month note for a Group without Months', () => {
    expect(text(view({ group: group('trip') }).root)).not.toContain('Picking a month');
  });

  it('shows placeholders on a first load and a retry when it fails', () => {
    const loading = view({ state: financial({ status: 'loading', data: null }) }).root;
    expect(labelled(loading, 'Loading balances')).toHaveLength(1);
    act(() => screen?.unmount());
    const failed = view({
      state: financial({ status: 'error', data: null, message: 'Could not load balances.' }),
    }).root;
    expect(text(failed)).toContain('Could not load balances.');
    expect(labelled(failed, 'Retry balances')).toHaveLength(1);
  });
});

describe('Record payment sheet states', () => {
  const base = (overrides: Partial<SettlementState>): SettlementState => ({
    ...emptySettlement(),
    groupId: 'b00000000000000000000001',
    group: group(),
    balances: [inr],
    suggested: 1060,
    draft: { paidBy: you, paidTo: sam, currency: 'INR', amount: '1060', note: '' },
    status: 'editing',
    ...overrides,
  });
  const sheet = (state: SettlementState) => {
    const calls = { record: vi.fn(), close: vi.fn(), change: vi.fn() };
    const root = render(
      <RecordPaymentSheet
        visible
        state={state}
        currentUserId={you}
        today="Today, Oct 1"
        onChange={calls.change}
        onLeaveField={() => undefined}
        onAcknowledge={() => undefined}
        onRecord={calls.record}
        onClose={calls.close}
      />,
    );
    return { root, calls };
  };

  it('is pre-filled from the suggestion, dated today, and says no money moves', () => {
    const { root } = sheet(base({}));
    expect(labelled(root, 'You pay Sam Chen. Suggested ₹1,060.00.')).toHaveLength(1);
    expect(labelled(root, 'Amount paid, required')[0].props).toMatchObject({
      value: '1060',
      keyboardType: 'decimal-pad',
      editable: true,
    });
    expect(labelled(root, 'Date: Today, Oct 1')).toHaveLength(1);
    expect(labelled(root, 'Note, optional: Add a note')).toHaveLength(1);
    expect(labelled(root, 'Record payment ₹1,060.00')[0].props.disabled).toBe(false);
    expect(labelled(root, 'Close without recording')).toHaveLength(1);
    expect(text(root)).toContain(recordPaymentFootnote);
    expect(text(root)).not.toContain('more than suggested');
  });

  it('names the recipient as “you” when someone else pays the member', () => {
    const { root } = sheet(
      base({ draft: { paidBy: sam, paidTo: you, currency: 'INR', amount: '1060', note: '' } }),
    );
    expect(labelled(root, 'Sam Chen pays you. Suggested ₹1,060.00.')).toHaveLength(1);
  });

  it('refuses letters and symbols in the amount, keeping a sign for its correction', () => {
    // A hardware keyboard or a paste bypasses the decimal keypad.
    const { root, calls } = sheet(base({}));
    const amount = () => labelled(root, 'Amount paid, required')[0];
    for (const edit of ['1060a', '₹1060', '1060 ']) act(() => amount().props.onChangeText(edit));
    expect(calls.change).not.toHaveBeenCalled();
    act(() => amount().props.onChangeText('-1060'));
    expect(calls.change).toHaveBeenCalledWith({ amount: '-1060' });
  });

  it('shows one progress bar while checking the latest balances', () => {
    const { root } = sheet(base({ status: 'loading', draft: null, suggested: null }));
    const bars = root.findAll(
      (node) => isHost(node, 'View') && node.props.accessibilityRole === 'progressbar',
    );
    expect(bars.map((bar) => bar.props.accessibilityLabel)).toEqual([
      'Checking the latest balances',
    ]);
  });

  it('locks an unconfirmed payment and offers only an explicit retry', () => {
    const { root, calls } = sheet(
      base({
        status: 'uncertain',
        attempt: { key: 'settlement-key-1', body: '{}' },
        message: 'This payment may already be recorded.',
      }),
    );
    expect(text(root)).toContain('Payment not confirmed');
    expect(labelled(root, 'Amount paid, required')[0].props.editable).toBe(false);
    expect(labelled(root, 'Record payment ₹1,060.00')).toHaveLength(0);
    act(() => labelled(root, 'Retry payment')[0].props.onPress());
    expect(calls.record).toHaveBeenCalledOnce();
  });

  it('says so, without a Record button, when the suggestion is gone', () => {
    const message = 'This suggested payment has changed. Close this to see the latest balances.';
    const { root } = sheet(base({ status: 'ready', draft: null, message }));
    expect(text(root)).toContain(message);
    const buttons = root
      .findAll((node) => isHost(node, 'Pressable'))
      .map((node) => node.props.accessibilityLabel);
    expect(buttons).toEqual(['Close without recording', 'Close']);
  });

  it('explains paying more than suggested in terms of where the payer stands afterwards', () => {
    const { root } = sheet(
      base({ draft: { paidBy: you, paidTo: sam, currency: 'INR', amount: '1200', note: '' } }),
    );
    expect(text(root)).toContain(
      'That’s ₹140.00 more than suggested. Afterwards you’d still owe ₹280.00 in this Group.',
    );
    const record = labelled(root, 'Record payment ₹1,200.00')[0];
    expect(record.props.disabled).toBe(true);
    expect(
      labelled(root, 'I meant to pay more than suggested')[0].props.accessibilityState,
    ).toEqual({ checked: false });
  });
});
