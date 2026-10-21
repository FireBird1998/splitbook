import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { emptySettlement, type SettlementState } from '../data/settlement';
import type { GroupCurrencyBalance, GroupFinancialState, MobileGroup } from '../data/types';
import {
  GroupBalancesView,
  recordNeedsConnection,
  recordWaitsForBalances,
  recordWaitsForDetails,
} from './group-balances';
import type { PendingPayment } from '../data/settlement';
import { findHosts, flatten, largeTextWindows, unreadText } from '../test-utils/layout';
import { activateWithScreenReader, setWindow, touchAlong } from '../test-utils/native';
import { hairSpace } from './compact';
import { ThemeContext } from './theme';
import {
  RecordPaymentSheet,
  recordPaymentFootnote,
  retryWaitsForCheck,
} from './record-payment-sheet';

// #118: the Balances destination and the Record payment sheet's states, rendered.
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
  alternateCurrencies: [],
  latestExpenseCurrency: null,
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
    const onRecord = vi.fn(),
      onCheckPayment = vi.fn();
    const root = render(
      <GroupBalancesView
        group={group()}
        currentUserId={you}
        state={financial()}
        pending={null}
        offline={false}
        onRecord={onRecord}
        onCheckPayment={onCheckPayment}
        onRefreshBalances={() => undefined}
        {...props}
      />,
    );
    return { root, onRecord, onCheckPayment };
  };
  const unconfirmed = (draft: PendingPayment['draft'] = null): PendingPayment => ({
    groupId: 'b00000000000000000000001',
    draft,
  });
  const paid = { paidBy: you, paidTo: sam, currency: 'INR', amount: '1060', note: '' };

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

  it('opens Record payment on a tap or a screen reader’s activate, never on a drag (#684)', () => {
    const { root, onRecord } = view();
    const record = () => labelled(root, 'Record your payment to Sam Chen')[0];
    const landed = { pageX: 300, pageY: 400 };
    act(() =>
      touchAlong(record(), [landed, { pageX: 300, pageY: 300 }, { pageX: 301, pageY: 150 }]),
    );
    expect(onRecord).not.toHaveBeenCalled();
    act(() => touchAlong(record(), [landed, { pageX: 302, pageY: 403 }]));
    expect(onRecord).toHaveBeenCalledExactlyOnceWith(you, sam, 'INR');
    act(() => activateWithScreenReader(record()));
    expect(onRecord).toHaveBeenCalledTimes(2);
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
    expect(record.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(record.props.accessibilityHint).toBe(recordNeedsConnection);
    expect(text(root)).toContain(recordNeedsConnection);
    expect(onRecord).not.toHaveBeenCalled();
  });

  it('disables Record while Balances are read again after a change, and says why (#219)', () => {
    const { root } = view({
      state: financial({ status: 'loading', stale: true, changed: true }),
    });
    // The figures say they're updating where their time was, and Record says why it waits where
    // its caption was: both in place (#219).
    expect(text(root)).toContain('Updating…');
    expect(text(root)).toContain('Record once updated');
    const record = labelled(root, 'Record your payment to Sam Chen')[0];
    expect(record.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(record.props.accessibilityHint).toBe(recordWaitsForBalances);
  });

  it('disables Record while the Group’s details can’t be read, and says why (2A, #219)', () => {
    const { root } = view({ recordUnavailable: recordWaitsForDetails('Maple House') });
    const record = labelled(root, 'Record your payment to Sam Chen')[0];
    expect(record.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(record.props.accessibilityHint).toBe(
      'Record is available once Maple House’s details load.',
    );
    expect(text(root)).toContain('Record is available once Maple House’s details load.');
    // Offline says so first.
    const offline = view({
      offline: true,
      recordUnavailable: recordWaitsForDetails('Maple House'),
    });
    expect(
      labelled(offline.root, 'Record your payment to Sam Chen')[0].props.accessibilityHint,
    ).toBe(recordNeedsConnection);
  });

  it('offers an unconfirmed payment even once nothing is suggested', () => {
    // The last debt cleared when the lost payment committed: no Record button is left.
    const { root, onCheckPayment, onRecord } = view({
      state: financial({ data: [] }),
      pending: unconfirmed(paid),
    });
    const shown = text(root);
    expect(shown).toContain('Settled up');
    expect(shown).toContain('Payment not confirmed');
    expect(shown).toContain(
      'Your payment of ₹1,060.00 to Sam Chen may already be recorded. Check it before recording another.',
    );
    expect(labelled(root, 'Record your payment to Sam Chen')).toHaveLength(0);
    // It stays on screen, so it's announced politely rather than as an alert each change.
    const row = root.find(
      (node) => isHost(node, 'View') && node.props.accessibilityLiveRegion !== undefined,
    );
    expect(row.props.accessibilityLiveRegion).toBe('polite');
    act(() => labelled(root, 'Check payment')[0].props.onPress());
    expect(onCheckPayment).toHaveBeenCalledOnce();
    expect(onRecord).not.toHaveBeenCalled();
  });

  it('names the payer of an unconfirmed payment to the member, and one it can’t read', () => {
    const received = view({
      pending: unconfirmed({ ...paid, paidBy: priya, paidTo: you, amount: '20.5' }),
    }).root;
    expect(text(received)).toContain(
      'Priya Shah’s payment of ₹20.50 to you may already be recorded.',
    );
    act(() => screen?.unmount());
    const former = view({
      pending: unconfirmed({ ...paid, paidBy: 'a00000000000000000000009', paidTo: you }),
    }).root;
    expect(text(former)).toContain('A former member’s payment of ₹1,060.00 to you');
    act(() => screen?.unmount());
    const unreadable = view({ pending: unconfirmed() }).root;
    expect(text(unreadable)).toContain('A payment stored on this device couldn’t be read.');
    expect(labelled(unreadable, 'Check payment')).toHaveLength(1);
  });

  it('keeps an unconfirmed payment in view while Balances can’t load, and offline', () => {
    const failed = view({
      state: financial({ status: 'error', data: null, message: 'Could not load balances.' }),
      pending: unconfirmed(paid),
      offline: true,
    }).root;
    expect(text(failed)).toContain('Payment not confirmed');
    const check = labelled(failed, 'Check payment')[0];
    expect(check.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(check.props.accessibilityHint).toBe(recordNeedsConnection);
    act(() => screen?.unmount());
    const loading = view({
      state: financial({ status: 'loading', data: null }),
      pending: unconfirmed(paid),
    }).root;
    expect(text(loading)).toContain('Payment not confirmed');
  });

  it('shows only this Group’s unconfirmed payment', () => {
    const elsewhere = { ...unconfirmed(paid), groupId: 'b00000000000000000000009' };
    expect(text(view({ pending: elsewhere }).root)).not.toContain('Payment not confirmed');
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
    const calls = {
      record: vi.fn(),
      retry: vi.fn(),
      close: vi.fn(),
      change: vi.fn(),
      leave: vi.fn(),
    };
    const root = render(
      <RecordPaymentSheet
        visible
        state={state}
        currentUserId={you}
        today="Today, 1 Oct"
        onChange={calls.change}
        onLeaveField={calls.leave}
        onAcknowledge={() => undefined}
        onRecord={calls.record}
        onRetry={calls.retry}
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
    expect(labelled(root, 'Date: Today, 1 Oct')).toHaveLength(1);
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

  it('outlines the amount while it has focus, without moving it, and checks it on blur', () => {
    const { root, calls } = sheet(base({}));
    const amount = () => labelled(root, 'Amount paid, required')[0];
    const ring = () => amount().parent!.props.style;
    const unfocused = ring();
    expect(unfocused).toMatchObject({ borderWidth: 2, borderColor: 'transparent' });
    act(() => amount().props.onFocus());
    expect(ring()).toEqual({ ...unfocused, borderColor: getSemanticTokens('light').focus });
    act(() => amount().props.onBlur());
    expect(ring()).toEqual(unfocused);
    expect(calls.leave).toHaveBeenCalledExactlyOnceWith('amount');
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

  it('shows the suggested amount in the money font', () => {
    const { root } = sheet(base({}));
    const suggested = root.find(
      (node) => isHost(node, 'Text') && node.children.includes('Suggested'),
    );
    const amount = suggested.find(
      (node) => isHost(node, 'Text') && node.children.includes('₹1,060.00'),
    );
    expect(JSON.stringify(amount.props.style)).toContain('IBMPlexMono');
  });

  // #331: Record says what it's doing while it records, beside a spinner, at the same size.
  it('is busy, labelled “Recording payment…” and announced busy while recording', () => {
    const recording = sheet(base({ status: 'saving' }));
    expect(labelled(recording.root, 'Record payment ₹1,060.00')).toHaveLength(0);
    const [record] = labelled(recording.root, 'Recording payment…');
    expect(record.props.accessibilityRole).toBe('button');
    expect(record.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(record.props.disabled).toBe(true);
    expect(record.findAll((node) => isHost(node, 'ActivityIndicator'))).toHaveLength(1);
    expect(text(record)).toContain('Recording payment…');
  });

  it('can’t be closed while the payment is being recorded', () => {
    const saving = sheet(base({ status: 'saving' }));
    expect(labelled(saving.root, 'Close')[0].props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
    act(() => labelled(saving.root, 'Close without recording')[0].props.onPress());
    expect(saving.calls.close).not.toHaveBeenCalled();
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

  // #334: an unconfirmed payment found on this phone waits for the check too, as Retry.
  it('keeps Retry waiting while it checks an unconfirmed payment, saying why', () => {
    const { root } = sheet(
      base({
        status: 'loading',
        group: null,
        balances: [],
        suggested: null,
        attempt: { key: 'settlement-key-1', body: '{}' },
      }),
    );
    expect(labelled(root, 'Record payment ₹1,060.00')).toHaveLength(0);
    const [retry] = labelled(root, 'Retry payment');
    expect(retry.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(retry.props.accessibilityHint).toBe(retryWaitsForCheck);
    expect(retry.props.disabled).toBe(true);
    expect(text(root)).toContain('Checking the latest balances…');
  });

  // #334, device check: Check payment named both people "Former member" while it checked.
  it('names people as this phone knows them while it checks, and “Former member” only for someone the checked Group lacks', () => {
    const known = { [you]: 'Alex Rivera', [sam]: 'Sam Chen' };
    const attempt = { key: 'settlement-key-1', body: '{}' };
    const checking = sheet(
      base({ status: 'loading', group: null, balances: [], suggested: null, known, attempt }),
    );
    expect(labelled(checking.root, 'You pay Sam Chen.')).toHaveLength(1);
    expect(text(checking.root)).toContain('ARYou');
    expect(text(checking.root)).toContain('SCSam Chen');
    expect(text(checking.root)).not.toContain('Former member');
    act(() => screen?.unmount());
    // Checked: Sam has left, so the Group it read names him a former member, whatever this
    // phone knew before.
    const left = { ...group(), members: group().members.filter(({ user }) => user.id !== sam) };
    const checked = sheet(base({ status: 'uncertain', group: left, known, attempt }));
    expect(labelled(checked.root, 'You pay Former member. Suggested ₹1,060.00.')).toHaveLength(1);
    expect(text(checked.root)).toContain('FMFormer member');
  });

  // #334, review: Try again is only for a check that couldn't run.
  it.each([
    ['checking', { status: 'loading', draft: null, suggested: null }],
    ['editing', {}],
    ['under review', { status: 'review', message: 'The suggested amount changed.' }],
    ['recording', { status: 'saving' }],
    ['unconfirmed', { status: 'uncertain', attempt: { key: 'settlement-key-1', body: '{}' } }],
    ['refused', { status: 'blocked', draft: null, message: 'You no longer have access.' }],
    ['gone', { status: 'ready', draft: null, message: 'This suggested payment has changed.' }],
  ] as [string, Partial<SettlementState>][])(
    'offers no Try again while %s',
    (_state, overrides) => {
      const { root } = sheet(
        base({
          chosen: { paidBy: you, paidTo: sam, currency: 'INR', shown: 1060 },
          known: { [you]: 'Alex Rivera', [sam]: 'Sam Chen' },
          ...overrides,
        }),
      );
      expect(labelled(root, 'Try again')).toHaveLength(0);
    },
  );

  it('offers Try again when the check couldn’t run, and nothing once access is refused', () => {
    const chosen = { paidBy: you, paidTo: sam, currency: 'INR', shown: 1060 };
    const known = { [you]: 'Alex Rivera', [sam]: 'Sam Chen' };
    const unreachable = 'Could not reach Splitbook. Check your connection and try again.';
    const failed = sheet(
      base({
        status: 'error',
        group: null,
        balances: [],
        draft: null,
        suggested: null,
        chosen,
        known,
        message: unreachable,
      }),
    );
    expect(text(failed.root)).toContain(unreachable);
    expect(labelled(failed.root, 'You pay Sam Chen. Suggested ₹1,060.00.')).toHaveLength(1);
    expect(labelled(failed.root, 'Record payment ₹1,060.00')).toHaveLength(0);
    act(() => labelled(failed.root, 'Try again')[0].props.onPress());
    expect(failed.calls.retry).toHaveBeenCalledOnce();
    expect(failed.calls.record).not.toHaveBeenCalled();
    act(() => screen?.unmount());
    const refused = sheet(
      base({
        status: 'blocked',
        group: null,
        balances: [],
        draft: null,
        suggested: null,
        chosen,
        known,
        message: 'You no longer have access to this Group.',
      }),
    );
    expect(labelled(refused.root, 'Try again')).toHaveLength(0);
    expect(labelled(refused.root, 'You pay Sam Chen. Suggested ₹1,060.00.')).toHaveLength(0);
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

  it('asks the member being paid to confirm what the payer paid, not what they meant (#640)', () => {
    const { root } = sheet(
      base({ draft: { paidBy: sam, paidTo: you, currency: 'INR', amount: '1200', note: '' } }),
    );
    expect(text(root)).toContain('That’s ₹140.00 more than suggested.');
    expect(labelled(root, 'I meant to pay more than suggested')).toHaveLength(0);
    expect(labelled(root, 'Sam Chen paid more than suggested')[0].props.accessibilityState).toEqual(
      { checked: false },
    );
    const record = labelled(root, 'Record payment ₹1,200.00')[0];
    expect(record.props.disabled).toBe(true);
    expect(record.props.accessibilityHint).toBe('Tick “Sam Chen paid more than suggested” first.');
  });
});

// #639: at 200% on a 360dp phone, the balance card's title broke mid-word beside its time ("ALL-T
// / IME BAL / ANCE"), "Suggested payments" sat out of sight in the middle of a row its caption
// made tall, the caption "Record one once it’s paid" was a column a letter wide, and the Record
// payment sheet cut its title and ran its button's words and amount past both edges. As the
// layout estimate lays them out, each reads in full at 130% and 200% on 360 and 412dp phones.
describe.each(['light', 'dark'] as const)('Balances at large text in %s (#639)', (mode) => {
  const themed = (element: React.ReactElement) => (
    <ThemeContext.Provider value={getSemanticTokens(mode)}>{element}</ThemeContext.Provider>
  );
  it.each(largeTextWindows)(
    'read in full, with the payments and everyone’s position, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      render(
        themed(
          <GroupBalancesView
            group={group()}
            currentUserId={you}
            state={financial()}
            pending={null}
            offline={false}
            onRecord={vi.fn()}
            onCheckPayment={vi.fn()}
            onRefreshBalances={() => undefined}
          />,
        ),
      );
      // The screen's content is inset 16dp on each side.
      const tree = screen!.toJSON() as ReactTestRendererJSON;
      expect(unreadText(tree, size.fontScale, size.width - 32)).toEqual([]);
    },
  );
  it.each(largeTextWindows)(
    'the Record payment sheet’s title and button read in full, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      render(
        themed(
          <RecordPaymentSheet
            visible
            state={{
              ...emptySettlement(),
              groupId: 'b00000000000000000000001',
              group: group(),
              balances: [inr],
              suggested: 1000,
              draft: { paidBy: you, paidTo: sam, currency: 'INR', amount: '1000', note: '' },
              status: 'editing',
            }}
            currentUserId={you}
            today="Today, 1 Oct"
            onChange={vi.fn()}
            onLeaveField={vi.fn()}
            onAcknowledge={() => undefined}
            onRecord={vi.fn()}
            onRetry={vi.fn()}
            onClose={vi.fn()}
          />,
        ),
      );
      const tree = screen!.toJSON() as ReactTestRendererJSON;
      const [frame] = findHosts(tree, (_props, type) => type === 'SafeAreaView');
      const [top, , footer] = frame!.children as ReactTestRendererJSON[];
      // The sheet's header, edge to edge, and its footer with Record payment.
      expect(unreadText(top!, size.fontScale, size.width)).toEqual([]);
      expect(unreadText(footer!, size.fontScale, size.width)).toEqual([]);
    },
  );
});

// #639 review: the room the balance card's title and the payments' caption keep beside what
// follows them is a large-text rule, as every other one is: at 100% they lay out as they did,
// with no minimum width, and their skeleton too.
describe('Balances at 100% text keep their shape (#639)', () => {
  /** The minimum width of the innermost flexible view or text that holds `words`. */
  const least = (tree: ReactTestRendererJSON, words: string) => {
    const holders = findHosts(tree, (props) => flatten(props.style).flex === 1).filter((node) =>
      [node, ...findHosts(node, (_props, type) => type === 'Text')].some(
        (text) => text.type === 'Text' && (text.children ?? []).join('').startsWith(words),
      ),
    );
    return flatten(holders.at(-1)!.props.style).minWidth ?? 0;
  };
  it.each([
    [360, 1, 0],
    [412, 1, 0],
    [360, 1.3, 'some'],
  ] as const)(
    '%sdp at %s× text: the title and caption keep %s minimum',
    (width, fontScale, kept) => {
      setWindow({ width, height: 640, fontScale });
      const view = (state: GroupFinancialState) => (
        <GroupBalancesView
          group={group()}
          currentUserId={you}
          state={state}
          pending={null}
          offline={false}
          onRecord={vi.fn()}
          onCheckPayment={vi.fn()}
          onRefreshBalances={() => undefined}
        />
      );
      render(view(financial()));
      const shown = screen!.toJSON() as ReactTestRendererJSON;
      const minimums = [least(shown, 'All-time balance'), least(shown, 'Record one once')];
      act(() => screen!.update(view(financial({ status: 'loading', data: null }))));
      minimums.push(least(screen!.toJSON() as ReactTestRendererJSON, 'All-time balance'));
      if (kept === 0) expect(minimums).toEqual([0, 0, 0]);
      else for (const minimum of minimums) expect(minimum).toBeGreaterThan(0);
    },
  );
});

// #639 device check: a button keeps its parts on one line, so Record payment puts its amount
// under its words from 150% text, by design, rather than wrapping it there by a fraction of a
// pixel. At 130% it stays beside them.
describe('Record payment’s amount at large text (#639)', () => {
  it.each([
    [1.3, 'beside'],
    [2, 'under'],
  ] as const)('at %s× text, the amount sits %s the words', (fontScale, place) => {
    setWindow({ width: 360, height: 640, fontScale });
    render(
      <RecordPaymentSheet
        visible
        state={{
          ...emptySettlement(),
          groupId: 'b00000000000000000000001',
          group: group(),
          balances: [inr],
          suggested: 1000,
          draft: { paidBy: you, paidTo: sam, currency: 'INR', amount: '1000', note: '' },
          status: 'editing',
        }}
        currentUserId={you}
        today="Today, 1 Oct"
        onChange={vi.fn()}
        onLeaveField={vi.fn()}
        onAcknowledge={() => undefined}
        onRecord={vi.fn()}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const [button] = findHosts(
      screen!.toJSON() as ReactTestRendererJSON,
      (props, type) =>
        type === 'Pressable' && props.accessibilityLabel === 'Record payment ₹1,000.00',
    );
    const parts = (button!.children ?? []) as ReactTestRendererJSON[];
    expect(flatten(button!.props.style).flexWrap).not.toBe('wrap');
    if (place === 'beside') expect(parts.map((part) => part.type)).toEqual(['Text', 'Text']);
    else {
      // One column, centred in the button: the words, then the amount.
      expect(parts).toHaveLength(1);
      expect(flatten(parts[0]!.props.style).alignItems).toBe('center');
      expect(findHosts(parts[0]!, (_props, type) => type === 'Text')).toHaveLength(2);
    }
  });
});

// #725: Balances one currency at a time, as on the web (#724). Boards "Balances" and its 130%
// version: a "Balances in" switch with the member's position on each tab, opening on the first
// currency they aren't settled up in; each tab's balance, Suggested payments and Everyone are in
// that currency only, and nothing is converted.
describe('Balances, one currency at a time (#725)', () => {
  const trip = (): MobileGroup => ({
    ...group('trip'),
    name: 'Lisbon & Tokyo',
    alternateCurrencies: ['EUR', 'JPY'],
  });
  const tripInr = (owe = -1480): GroupCurrencyBalance => ({
    currency: 'INR',
    balances: [
      { user: person(you, 'Alex Rivera'), balance: owe },
      { user: person(sam, 'Sam Chen'), balance: 730 - owe },
      { user: person(priya, 'Priya Shah'), balance: -730 },
    ],
    debts: [
      ...(owe
        ? [{ from: person(you, 'Alex Rivera'), to: person(sam, 'Sam Chen'), amount: -owe }]
        : []),
      { from: person(priya, 'Priya Shah'), to: person(sam, 'Sam Chen'), amount: 730 },
    ],
  });
  const eur: GroupCurrencyBalance = {
    currency: 'EUR',
    balances: [
      { user: person(you, 'Alex Rivera'), balance: -20 },
      { user: person(sam, 'Sam Chen'), balance: 20 },
    ],
    debts: [{ from: person(you, 'Alex Rivera'), to: person(sam, 'Sam Chen'), amount: 20 }],
  };
  const jpy: GroupCurrencyBalance = {
    currency: 'JPY',
    balances: [
      { user: person(you, 'Alex Rivera'), balance: 8400 },
      { user: person(sam, 'Sam Chen'), balance: -8400 },
    ],
    debts: [{ from: person(sam, 'Sam Chen'), to: person(you, 'Alex Rivera'), amount: 8400 }],
  };
  /** As the server sends them: alphabetically, not in the Group's order. */
  const buckets = (inrBucket = tripInr()) => [eur, inrBucket, jpy];
  const element = (data: GroupCurrencyBalance[], onRecord = vi.fn()) => (
    <GroupBalancesView
      group={trip()}
      currentUserId={you}
      state={financial({ data })}
      pending={null}
      offline={false}
      onRecord={onRecord}
      onCheckPayment={vi.fn()}
      onRefreshBalances={() => undefined}
    />
  );
  const tablists = (root: ReactTestInstance) =>
    root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'tablist',
    );
  /** Each tab's spoken name, and whether it is the currency shown. */
  const tabs = (root: ReactTestInstance) =>
    tablists(root)
      .flatMap((list) =>
        list.findAll(
          (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'tab',
        ),
      )
      .map((tab) => [tab.props.accessibilityLabel, tab.props.accessibilityState?.selected]);
  const choose = (root: ReactTestInstance, name: string) => {
    const [tab] = labelled(root, name);
    act(() => tab!.props.onPress());
  };

  it('shows a tab per currency in the Group’s order, each with the member’s position, the main currency marked', () => {
    const root = render(element(buckets()));
    expect(tablists(root).map((list) => list.props.accessibilityLabel)).toEqual(['Balances in']);
    expect(tabs(root)).toEqual([
      ['INR, main currency, you owe ₹1,480.00', true],
      ['EUR, you owe €20.00', false],
      ['JPY, you’re owed ¥8,400', false],
    ]);
    // Each tab's words keep a hair space to spare (#639).
    expect(text(root).replaceAll(hairSpace, '')).toContain(
      'INR · main−₹1,480.00EUR−€20.00JPY+¥8,400',
    );
  });

  it('shows the main currency’s balance, payments and everyone while the member owes in it, and says nothing is converted', () => {
    const onRecord = vi.fn();
    const root = render(element(buckets(), onRecord));
    const shown = text(root);
    expect(shown).toContain('All-time balance · INR');
    expect(labelled(root, 'You owe ₹1,480.00')).toHaveLength(2);
    expect(shown).toContain('Suggested payments · INR');
    expect(shown).toContain('Everyone · INR');
    expect(labelled(root, 'Sam Chen gets back ₹2,210.00')).toHaveLength(1);
    expect(shown).toContain('Each currency keeps its own balances. Nothing is converted.');
    for (const other of ['EUR', 'JPY']) {
      expect(shown).not.toContain(`All-time balance · ${other}`);
      expect(shown).not.toContain(`Everyone · ${other}`);
    }
    act(() => labelled(root, 'Record your payment to Sam Chen')[0]!.props.onPress());
    expect(onRecord).toHaveBeenCalledWith(you, sam, 'INR');
  });

  it('opens on the first currency the member isn’t settled up in, and on the main one when settled in all', () => {
    const root = render(element(buckets(tripInr(0))));
    expect(tabs(root).find(([, selected]) => selected)?.[0]).toBe('EUR, you owe €20.00');
    expect(tabs(root)[0]).toEqual(['INR, main currency, you’re settled up', false]);
    expect(text(root)).toContain('All-time balance · EUR');
    act(() => screen?.unmount());

    const settled = (bucket: GroupCurrencyBalance): GroupCurrencyBalance => ({
      ...bucket,
      balances: bucket.balances.map((row) => ({ ...row, balance: 0 })),
      debts: [],
    });
    const again = render(element([settled(eur), settled(tripInr(0)), settled(jpy)]));
    expect(tabs(again).find(([, selected]) => selected)?.[0]).toBe(
      'INR, main currency, you’re settled up',
    );
  });

  it('shows another currency on its own, its payments listed and recorded in the main currency', () => {
    const root = render(element(buckets()));
    choose(root, 'JPY, you’re owed ¥8,400');
    expect(tabs(root).find(([, selected]) => selected)?.[0]).toBe('JPY, you’re owed ¥8,400');
    const shown = text(root);
    expect(shown).toContain('All-time balance · JPY');
    expect(labelled(root, 'You’re owed ¥8,400')).toHaveLength(1);
    expect(labelled(root, 'You get back ¥8,400')).toHaveLength(1);
    expect(shown).toContain('Suggested payments · JPY');
    expect(labelled(root, 'Sam Chen pays you, ¥8,400')).toHaveLength(1);
    // Payments are recorded in the main currency until #727.
    expect(labelled(root, 'Record Sam Chen’s payment to you')).toHaveLength(0);
    expect(shown).toContain('Payments are recorded in INR, the main currency.');
    expect(shown).not.toContain('Record one once it’s paid');
    expect(shown).toContain('Everyone · JPY');
    expect(labelled(root, 'Sam Chen owes ¥8,400')).toHaveLength(1);
    expect(shown).not.toContain('All-time balance · INR');
    expect(shown).not.toContain('₹2,210.00');
  });

  it('keeps the currency shown when the balances are read again, even once the member is settled up in it', () => {
    const root = render(element(buckets()));
    act(() => screen!.update(element(buckets(tripInr(0)))));
    expect(tabs(root).find(([, selected]) => selected)?.[0]).toBe(
      'INR, main currency, you’re settled up',
    );
    expect(text(root)).toContain('All-time balance · INR');
    expect(text(root)).toContain('Settled up');

    choose(root, 'JPY, you’re owed ¥8,400');
    act(() => screen!.update(element(buckets())));
    expect(tabs(root).find(([, selected]) => selected)?.[0]).toBe('JPY, you’re owed ¥8,400');
  });

  it('shows no switch and no note for a Group in one currency', () => {
    const root = render(element([inr]));
    expect(tablists(root)).toHaveLength(0);
    const shown = text(root);
    expect(shown).toContain('All-time balance · INR');
    expect(shown).toContain('Everyone');
    expect(shown).not.toContain('Everyone · INR');
    expect(shown).not.toContain('Nothing is converted.');
  });
});

// #725, board "Balances" at 130%: the tabs wrap onto more lines rather than clipping, and each
// tab, its card and its rows read in full, up to a Group's five currencies.
describe.each(['light', 'dark'] as const)(
  'Balances’ currency switch at large text in %s (#725)',
  (mode) => {
    const person2 = (id: string, name: string) => ({ id, name, image: null });
    const bucket = (currency: string, balance: number): GroupCurrencyBalance => ({
      currency,
      balances: [
        { user: person2(you, 'Alex Rivera'), balance },
        { user: person2(sam, 'Sam Chen'), balance: -balance },
      ],
      debts: [
        balance < 0
          ? { from: person2(you, 'Alex Rivera'), to: person2(sam, 'Sam Chen'), amount: -balance }
          : { from: person2(sam, 'Sam Chen'), to: person2(you, 'Alex Rivera'), amount: balance },
      ],
    });
    it.each(largeTextWindows.flatMap((size) => [3, 5].map((count) => ({ ...size, count }))))(
      '$count currencies read in full, $width dp at $fontScale× text',
      ({ count, ...size }) => {
        setWindow(size);
        const all = [
          bucket('INR', -148_000.5),
          bucket('EUR', -1_240.75),
          bucket('JPY', 186_000),
          bucket('USD', 2_000.25),
          bucket('GBP', -310.4),
        ].slice(0, count);
        render(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <GroupBalancesView
              group={{
                ...group('trip'),
                alternateCurrencies: ['EUR', 'JPY', 'USD', 'GBP'].slice(0, count - 1),
              }}
              currentUserId={you}
              state={financial({ data: all })}
              pending={null}
              offline={false}
              onRecord={vi.fn()}
              onCheckPayment={vi.fn()}
              onRefreshBalances={() => undefined}
            />
          </ThemeContext.Provider>,
        );
        const tree = screen!.toJSON() as ReactTestRendererJSON;
        const [list] = findHosts(tree, (props) => props.accessibilityRole === 'tablist');
        expect(list).toBeDefined();
        expect(flatten(list!.props.style).flexWrap).toBe('wrap');
        // The screen's content is inset 16dp on each side.
        expect(unreadText(tree, size.fontScale, size.width - 32)).toEqual([]);
      },
    );
  },
);
