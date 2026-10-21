import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import {
  editCrossCurrencyEntry,
  startCrossCurrencyEntry,
  type RateSuggestion,
} from '@splitbook/shared/cross-currency-payment';
import {
  emptySettlement,
  type CrossCurrencyPayment,
  type SettlementState,
} from '../data/settlement';
import type { GroupCurrencyBalance, MobileGroup } from '../data/types';
import { findHosts, largeTextWindows, unreadText } from '../test-utils/layout';
import { setWindow } from '../test-utils/native';
import { ThemeContext } from './theme';
import { RecordPaymentSheet, recordPaymentFootnote } from './record-payment-sheet';

/*
 * #728: Android's Record payment sheet for a Debt paid in another currency, as the #710 boards
 * draw it: "Pay in rupees", "Your own rate", "Clear part of the Debt", "No rate suggested" and
 * "Second source". Alex pays Sam's €20.00 Debt in Lisbon & Tokyo, in INR with EUR and JPY.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const you = 'a00000000000000000000001',
  sam = 'a00000000000000000000002';
const at = new Date(2026, 9, 1, 10, 42);
/** The sheet is open at 10:42 on 21 Oct; the rates were fetched at 06:00 that morning. */
const now = new Date(2026, 9, 21, 10, 42);
const fetchedAt = new Date(2026, 9, 21, 6, 0).toISOString();
const group: MobileGroup = {
  id: 'b00000000000000000000001',
  name: 'Lisbon & Tokyo',
  description: '',
  category: 'trip',
  defaultCurrency: 'INR',
  alternateCurrencies: ['EUR', 'JPY'],
  latestExpenseCurrency: null,
  members: [
    [you, 'Alex Rivera'],
    [sam, 'Sam Chen'],
  ].map(([id, name]) => ({
    user: { id, name, email: `${id}@example.test`, image: null },
    role: 'member' as const,
    joinedAt: at,
  })),
  startDate: null,
  endDate: null,
  createdAt: at,
  updatedAt: at,
};
const eur: GroupCurrencyBalance = {
  currency: 'EUR',
  balances: [
    { user: { id: you, name: 'Alex Rivera', image: null }, balance: -20 },
    { user: { id: sam, name: 'Sam Chen', image: null }, balance: 20 },
  ],
  debts: [
    {
      from: { id: you, name: 'Alex Rivera', image: null },
      to: { id: sam, name: 'Sam Chen', image: null },
      amount: 20,
    },
  ],
};
const frankfurter: RateSuggestion = {
  rate: '92.1',
  source: 'frankfurter',
  asOf: '2026-10-20',
  fetchedAt,
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
};
const pair = { currency: 'EUR', paidCurrency: 'INR' };
/** The sheet paying in rupees: as it opens at the suggestion, or as `edits` leave it. */
const inRupees = (
  rate: CrossCurrencyPayment['rate'] = { status: 'ready', suggestion: frankfurter },
  ...edits: [field: 'cleared' | 'rate' | 'paid', text: string][]
): CrossCurrencyPayment => ({
  paidCurrency: 'INR',
  rate,
  entry: edits.reduce(
    (entry, [field, text]) => editCrossCurrencyEntry(entry, pair, field, text),
    startCrossCurrencyEntry(pair, '20.00', rate.status === 'ready' ? rate.suggestion : null),
  ),
});
const state = (
  crossCurrency: CrossCurrencyPayment | null,
  patch: Partial<SettlementState> = {},
): SettlementState => ({
  ...emptySettlement(),
  groupId: group.id,
  group,
  balances: [eur],
  status: 'editing',
  suggested: 20,
  draft: {
    paidBy: you,
    paidTo: sam,
    currency: 'EUR',
    amount: crossCurrency?.entry.cleared ?? '20.00',
    note: '',
  },
  crossCurrency,
  ...patch,
});

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
  setWindow({ width: 360, height: 640, fontScale: 1 });
});
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const labelled = (root: ReactTestInstance, label: string) =>
  root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLabel === label);
const one = (root: ReactTestInstance, label: string) => {
  const found = labelled(root, label);
  expect(found, label).toHaveLength(1);
  return found[0]!;
};
const handlers = () => ({
  onChange: vi.fn(),
  onLeaveField: vi.fn(),
  onAcknowledge: vi.fn(),
  onRecord: vi.fn(),
  onRetry: vi.fn(),
  onClose: vi.fn(),
  onChoosePaidCurrency: vi.fn(),
  onEditCrossCurrency: vi.fn(),
  onUseSuggestedRate: vi.fn(),
  onOpenLink: vi.fn(),
});
const render = (settlement: SettlementState, on = handlers(), mode: 'light' | 'dark' = 'light') => {
  act(() => {
    screen = create(
      <ThemeContext.Provider value={getSemanticTokens(mode)}>
        <RecordPaymentSheet
          visible
          state={settlement}
          currentUserId={you}
          today="Today, 21 Oct"
          now={now}
          {...on}
        />
      </ThemeContext.Provider>,
    );
  });
  return { root: screen!.root, on };
};
/** The sheet's Record button. */
const record = (root: ReactTestInstance) =>
  root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      node.props.accessibilityRole === 'button' &&
      String(node.props.accessibilityLabel ?? '').startsWith('Record payment'),
  )[0]!;

describe('Pay in: the currency a Debt is paid in (#728)', () => {
  it('offers the Debt’s own currency first, then the Group’s others, and says which is which', () => {
    const { root, on } = render(state(inRupees()));
    const group = one(root, 'Pay in');
    expect(group.props.accessibilityRole).toBe('radiogroup');
    const radios = group
      .findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'radio')
      .map((radio) => [radio.props.accessibilityLabel, radio.props.accessibilityState?.checked]);
    expect(radios).toEqual([
      ['EUR', false],
      ['INR', true],
      ['JPY', false],
    ]);
    expect(text(root)).toContain('EUR is the Debt’s own currency; INR is the main currency.');
    act(() => one(root, 'JPY').props.onPress());
    expect(on.onChoosePaidCurrency).toHaveBeenCalledWith('JPY');
  });

  it('names the Debt beside the people, and pays it in its own currency as before', () => {
    const { root } = render(state(null));
    expect(one(root, 'You pay Sam Chen. Debt €20.00.')).toBeDefined();
    expect(text(root)).toContain('Debt');
    expect(one(root, 'Amount paid, required').props.value).toBe('20.00');
    expect(text(root)).not.toContain('Change any one; the other two follow.');
    expect(one(root, 'EUR').props.accessibilityState?.checked).toBe(true);
  });

  it('in a Group with one currency, shows no Pay in and the suggestion as before', () => {
    const single = { ...group, alternateCurrencies: [] };
    const { root } = render({
      ...state(null),
      group: single,
      balances: [{ ...eur, currency: 'INR' }],
      draft: { paidBy: you, paidTo: sam, currency: 'INR', amount: '20', note: '' },
    });
    expect(labelled(root, 'Pay in')).toHaveLength(0);
    expect(one(root, 'You pay Sam Chen. Suggested ₹20.00.')).toBeDefined();
  });
});

describe('a Debt paid in rupees (#728, board "Pay in rupees")', () => {
  it('shows the three linked fields at the suggested rate, with its source and age', () => {
    const { root, on } = render(state(inRupees()));
    const shown = text(root);
    expect(shown).toContain('Change any one; the other two follow.');
    expect(shown).toContain('Amount cleared');
    expect(shown).toContain('the whole Debt');
    expect(shown).toContain('Rate · ₹ for each €');
    expect(shown).toContain('Suggested');
    expect(shown).toContain('1 € =');
    expect(shown).toContain('Frankfurter · rates of 20 Oct · fetched today 06:00');
    expect(shown).toContain('rounded to the paisa');
    expect(shown).toContain('Clears your €20.00 Debt to Sam. Sam gets ₹1,842.00.');
    expect(shown).toContain(recordPaymentFootnote);
    expect(one(root, 'Amount cleared, EUR').props.value).toBe('20.00');
    expect(one(root, 'Rate, INR for each EUR').props.value).toBe('92.10');
    expect(one(root, 'Amount paid, INR').props.value).toBe('1842.00');
    // Record says nothing more: the summary says what it records.
    expect(record(root).props.accessibilityLabel).toBe('Record payment');
    expect(record(root).props.accessibilityState?.disabled).toBeFalsy();

    act(() => one(root, 'Rate, INR for each EUR').props.onChangeText('92.50'));
    expect(on.onEditCrossCurrency).toHaveBeenCalledWith('rate', '92.50');
    act(() => one(root, 'Amount paid, INR').props.onChangeText('1,850'));
    expect(on.onEditCrossCurrency).toHaveBeenCalledWith('paid', '1,850');
    act(() => one(root, 'Amount cleared, EUR').props.onChangeText('10.00'));
    expect(on.onEditCrossCurrency).toHaveBeenCalledWith('cleared', '10.00');
    // A letter isn't an amount: the field keeps what it had.
    act(() => one(root, 'Amount cleared, EUR').props.onChangeText('10.0x'));
    expect(on.onEditCrossCurrency).toHaveBeenCalledTimes(3);
  });

  it('keeps the member’s own rate beside the suggestion, with a way back to it (board "Your own rate")', () => {
    const { root, on } = render(state(inRupees(undefined, ['rate', '92.50'])));
    const shown = text(root);
    expect(shown).toContain('Your rate');
    expect(shown).toContain('Your rate. Suggested ₹92.10 from Frankfurter, rates of 20 Oct.');
    expect(shown).toContain('Clears your €20.00 Debt to Sam. Sam gets ₹1,850.00.');
    expect(one(root, 'Amount paid, INR').props.value).toBe('1850.00');
    act(() => one(root, 'Use ₹92.10').props.onPress());
    expect(on.onUseSuggestedRate).toHaveBeenCalled();
  });

  it('clears part of the Debt and says what stays to pay (board "Clear part of the Debt")', () => {
    const { root } = render(state(inRupees(undefined, ['cleared', '10.00'])));
    const shown = text(root);
    expect(shown).toContain('part of €20.00');
    expect(one(root, 'Amount paid, INR').props.value).toBe('921.00');
    expect(shown).toContain('Clears €10.00 of your €20.00 Debt to Sam. €10.00 stays to pay.');
  });

  it('asks for a tick to clear more than the Debt, saying what that leaves', () => {
    const { root, on } = render(state(inRupees(undefined, ['cleared', '25.00'])));
    const shown = text(root);
    expect(shown).toContain(
      'That’s €5.00 more than you owe Sam in EUR, so Sam would owe you €5.00.',
    );
    expect(shown).toContain('Clears your €20.00 Debt to Sam and €5.00 more. Sam gets ₹2,302.50.');
    expect(record(root).props.accessibilityState?.disabled).toBe(true);
    act(() => one(root, 'I meant to pay more than suggested').props.onPress());
    expect(on.onAcknowledge).toHaveBeenCalledWith(true);
  });

  it('says why a field can’t be read, under it', () => {
    const { root } = render(state(inRupees(undefined, ['rate', '0'])));
    expect(text(root)).toContain('Enter a rate above 0.');
    expect(one(root, 'Rate, INR for each EUR').props.accessibilityHint).toBe(
      'Enter a rate above 0.',
    );
    expect(record(root).props.accessibilityState?.disabled).toBe(true);
  });
});

describe('the rate when there is no suggestion (#728, boards "No rate suggested" and "Second source")', () => {
  it.each([
    ['unavailable', 'Splitbook couldn’t get today’s rates.'],
    [null, 'Splitbook couldn’t get today’s rates.'],
    ['currency_unavailable', 'Splitbook has no rate between EUR and INR right now.'],
  ] as const)('with none (%s), waits for the rate the member agreed', (reason, why) => {
    const { root } = render(state(inRupees({ status: 'none', reason })));
    const shown = text(root);
    expect(shown).toContain('No rate suggested right now.');
    expect(shown).toContain(`${why} You can still record it with the rate you agreed.`);
    expect(shown).toContain('No suggestion');
    expect(shown).toContain(
      'Type the rate you agreed, or both amounts. The rate is kept as yours.',
    );
    expect(shown).toContain(
      'Clears your €20.00 Debt to Sam once you enter the rate or the amount paid.',
    );
    expect(one(root, 'Rate, INR for each EUR').props.value).toBe('');
    expect(one(root, 'Amount paid, INR').props.value).toBe('');
    // Record waits, and says what for where the footnote was.
    expect(record(root).props.accessibilityState?.disabled).toBe(true);
    expect(record(root).props.accessibilityHint).toBe(
      'Enter the rate or the amount paid to record it.',
    );
    expect(shown).toContain('Enter the rate or the amount paid to record it.');
    expect(shown).not.toContain(recordPaymentFootnote);
  });

  it('names a second source and links its attribution', () => {
    const mixed: RateSuggestion = {
      ...frankfurter,
      rate: '92.06',
      source: 'mixed',
      asOf: '2026-10-21',
      attributionRequired: true,
      attribution: { text: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' },
    };
    const { root, on } = render(state(inRupees({ status: 'ready', suggestion: mixed })));
    const shown = text(root);
    expect(shown).toContain('Rates of 21 Oct · fetched today 06:00');
    expect(shown).toContain('Clears your €20.00 Debt to Sam. Sam gets ₹1,841.20.');
    const link = one(root, 'Rates By Exchange Rate API');
    expect(link.props.accessibilityRole).toBe('link');
    act(() => link.props.onPress());
    expect(on.onOpenLink).toHaveBeenCalledWith('https://www.exchangerate-api.com');
  });

  it('while the rate is looked up, says so, and Record waits', () => {
    const { root } = render(state(inRupees({ status: 'loading' })));
    expect(text(root)).toContain('Looking up a suggested rate…');
    expect(text(root)).not.toContain('No suggestion');
    expect(record(root).props.accessibilityState?.disabled).toBe(true);
    expect(record(root).props.accessibilityHint).toBe(
      'Record is available once a suggested rate is looked up.',
    );
  });

  it('offline, waits for a connection, and never says no rate is suggested', () => {
    const { root } = render(state(inRupees({ status: 'unreachable' }, ['rate', '92.40'])));
    const shown = text(root);
    expect(shown).not.toContain('No rate suggested');
    expect(shown).toContain('A suggested rate needs a connection.');
    expect(record(root).props.accessibilityState?.disabled).toBe(true);
    expect(record(root).props.accessibilityHint).toBe('Recording a payment needs a connection.');
  });
});

describe('an unconfirmed payment in another currency (#728)', () => {
  it('shows what it paid, at what rate, locked, for Retry', () => {
    const { root } = render(
      state(null, {
        status: 'uncertain',
        attempt: { key: 'settlement-key-1', body: '{}' },
        draft: {
          paidBy: you,
          paidTo: sam,
          currency: 'EUR',
          amount: '20',
          note: '',
          paid: {
            amountPaidMinor: 185000,
            paidCurrency: 'INR',
            appliedRate: '92.5',
            rateKind: 'custom',
          },
        },
      }),
    );
    const shown = text(root);
    expect(labelled(root, 'Pay in')).toHaveLength(0);
    expect(shown).toContain('Amount cleared');
    expect(shown).toContain('Paid as ₹1,850.00 at ₹92.50 per €');
    expect(one(root, 'Amount cleared, required').props.editable).toBe(false);
    expect(labelled(root, 'Retry payment')).toHaveLength(1);
  });
});

// The boards draw "Pay in rupees" at 130% and in dark: at 130% and 200% on 360 and 412dp phones,
// in both, every word of the sheet reads in full.
describe.each(['light', 'dark'] as const)('paying in rupees at large text in %s (#728)', (mode) => {
  it.each(largeTextWindows)('reads in full, $width dp at $fontScale× text', (size) => {
    setWindow(size);
    render(state(inRupees(undefined, ['rate', '92.50'])), handlers(), mode);
    const tree = screen!.toJSON() as ReactTestRendererJSON;
    const [frame] = findHosts(tree, (_props, type) => type === 'SafeAreaView');
    const [top, body, footer] = frame!.children as ReactTestRendererJSON[];
    // The sheet's header, its body and its footer, edge to edge.
    expect(unreadText(top!, size.fontScale, size.width)).toEqual([]);
    expect(unreadText(body!, size.fontScale, size.width)).toEqual([]);
    expect(unreadText(footer!, size.fontScale, size.width)).toEqual([]);
  });
});
