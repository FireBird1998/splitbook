import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import type { RateSuggestion } from '@splitbook/shared/cross-currency-payment';
import {
  emptySettlement,
  recordNeedsConnection,
  recordWaitsForRate,
  type BatchPayment,
  type SettlementState,
} from '../data/settlement';
import type { GroupCurrencyBalance, MobileGroup } from '../data/types';
import { findHosts, largeTextWindows, unreadText } from '../test-utils/layout';
import { setWindow } from '../test-utils/native';
import { ThemeContext } from './theme';
import { RecordPaymentSheet, recordPaymentFootnote } from './record-payment-sheet';

/*
 * #734, board "Android · Settle both currencies at once": Settle up with Sam, one payment that
 * clears Alex's Debts to Sam in rupees and euros, each at its own rate. Lisbon & Tokyo, in INR
 * with EUR and JPY; fictional figures.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const you = 'a00000000000000000000001',
  sam = 'a00000000000000000000002';
const at = new Date(2026, 9, 1, 10, 42);
const now = new Date(2026, 9, 21, 10, 42);
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
const debt = (currency: string, amount: number): GroupCurrencyBalance => ({
  currency,
  balances: [],
  debts: [
    {
      from: { id: you, name: 'Alex Rivera', image: null },
      to: { id: sam, name: 'Sam Chen', image: null },
      amount,
    },
  ],
});
const frankfurter: RateSuggestion = {
  rate: '92.1',
  source: 'frankfurter',
  asOf: '2026-10-20',
  fetchedAt: new Date(2026, 9, 21, 6, 0).toISOString(),
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
};
const paying = (patch: Partial<BatchPayment> = {}): BatchPayment => ({
  paidBy: you,
  paidTo: sam,
  paidCurrency: 'INR',
  debts: [
    { currency: 'INR', amount: 1480 },
    { currency: 'EUR', amount: 20 },
  ],
  rates: { EUR: { rate: { status: 'ready', suggestion: frankfurter }, custom: null } },
  ...patch,
});
const state = (
  batch: BatchPayment | null,
  patch: Partial<SettlementState> = {},
): SettlementState => ({
  ...emptySettlement(),
  groupId: group.id,
  group,
  balances: [debt('EUR', 20), debt('INR', 1480)],
  status: 'editing',
  draft: { paidBy: you, paidTo: sam, currency: 'INR', amount: '', note: '' },
  batch,
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
const record = (root: ReactTestInstance) =>
  root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      node.props.accessibilityRole === 'button' &&
      String(node.props.accessibilityLabel ?? '').startsWith('Record'),
  )[0]!;
const handlers = () => ({
  onChange: vi.fn(),
  onLeaveField: vi.fn(),
  onAcknowledge: vi.fn(),
  onRecord: vi.fn(),
  onRetry: vi.fn(),
  onClose: vi.fn(),
  onChoosePaidCurrency: vi.fn(),
  onEditBatchRate: vi.fn(),
  onRestoreBatchRate: vi.fn(),
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

describe('Settle up with Sam (#734)', () => {
  it('pays both Debts in one currency, each at its own rate, and says what it records', () => {
    const { root, on } = render(state(paying()));
    const shown = text(root);
    expect(
      root
        .findAll((node) => isHost(node, 'Text') && node.props.accessibilityRole === 'header')
        .map((node) => node.children.join('')),
    ).toContain('Settle up with Sam Chen');
    expect(shown).toContain(
      'You owe Sam Chen in 2 currencies. One payment can clear both; each Debt keeps its own rate.',
    );
    const radios = one(root, 'Pay in')
      .findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'radio')
      .map((radio) => [radio.props.accessibilityLabel, radio.props.accessibilityState?.checked]);
    expect(radios).toEqual([
      ['INR', true],
      ['EUR', false],
    ]);
    // Each Debt on its own line: what it clears, at what rate, and what it pays.
    expect(one(root, 'INR Debt ₹1,480.00, same currency, no rate. Pays ₹1,480.00')).toBeDefined();
    expect(
      one(root, 'EUR Debt €20.00 at ₹92.10 per €, suggested, Frankfurter, 20 Oct. Pays ₹1,842.00'),
    ).toBeDefined();
    expect(shown).toContain('Same currency, no rate');
    expect(shown).toContain('Suggested · Frankfurter, 20 Oct');
    expect(shown).toContain('You pay Sam Chen');
    expect(shown).toContain('₹3,322.00');
    expect(shown).toContain(
      'Records 2 Settlements, one for each Debt, each with its own rate. Activity shows them as one payment. To pay part of a Debt, record it on its own.',
    );
    expect(shown).toContain(recordPaymentFootnote);
    expect(record(root).props.accessibilityLabel).toBe('Record ₹3,322.00');
    expect(record(root).props.accessibilityState?.disabled).toBeFalsy();
    act(() => one(root, 'EUR').props.onPress());
    expect(on.onChoosePaidCurrency).toHaveBeenCalledWith('EUR');
    act(() => record(root).props.onPress());
    expect(on.onRecord).toHaveBeenCalled();
  });

  it('changes one Debt’s rate to the member’s own, with the suggestion beside it', () => {
    const { root, on } = render(state(paying()));
    act(() => one(root, 'Change the rate for the EUR Debt').props.onPress());
    const input = one(root, 'Rate for the EUR Debt, INR for each EUR');
    expect(input.props.value).toBe('92.10');
    act(() => input.props.onChangeText('92.50'));
    expect(on.onEditBatchRate).toHaveBeenCalledWith('EUR', '92.50');

    const custom = render(
      state(
        paying({
          rates: { EUR: { rate: { status: 'ready', suggestion: frankfurter }, custom: '92.50' } },
        }),
      ),
    );
    const shown = text(custom.root);
    expect(shown).toContain('Your rate · suggested ₹92.10, Frankfurter, 20 Oct');
    expect(shown).toContain('₹1,850.00');
    expect(shown).toContain('₹3,330.00');
    act(() => one(custom.root, 'Use ₹92.10 for the EUR Debt').props.onPress());
    expect(custom.on.onRestoreBatchRate).toHaveBeenCalledWith('EUR');
  });

  it('with no suggested rate, asks for the rate agreed, and Record waits for it', () => {
    const { root } = render(
      state(
        paying({
          rates: { EUR: { rate: { status: 'none', reason: 'unavailable' }, custom: null } },
        }),
      ),
    );
    const shown = text(root);
    expect(shown).toContain('No rate suggested · Enter the rate you agreed');
    expect(one(root, 'Rate for the EUR Debt, INR for each EUR').props.value).toBe('');
    expect(record(root).props.accessibilityState?.disabled).toBe(true);
    expect(record(root).props.accessibilityHint).toBe(
      'Enter the rate for the EUR Debt to record it.',
    );
    expect(shown).toContain('Enter the rate for the EUR Debt to record it.');
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
    const { root, on } = render(
      state(
        paying({ rates: { EUR: { rate: { status: 'ready', suggestion: mixed }, custom: null } } }),
      ),
    );
    expect(text(root)).toContain('Suggested · rates of 21 Oct');
    const link = one(root, 'Rates By Exchange Rate API');
    expect(link.props.accessibilityRole).toBe('link');
    act(() => link.props.onPress());
    expect(on.onOpenLink).toHaveBeenCalledWith('https://www.exchangerate-api.com');
  });

  it.each([
    [
      'being looked up',
      { status: 'loading' } as const,
      'Looking up a suggested rate…',
      recordWaitsForRate,
    ],
    [
      'out of reach offline',
      { status: 'unreachable' } as const,
      'A suggested rate needs a connection.',
      recordNeedsConnection,
    ],
  ])('while the rate is %s, says so, and Record waits', (_, rate, words, hint) => {
    const { root } = render(state(paying({ rates: { EUR: { rate, custom: null } } })));
    expect(text(root)).toContain(words);
    expect(text(root)).not.toContain('No rate suggested');
    expect(record(root).props.accessibilityState?.disabled).toBe(true);
    expect(record(root).props.accessibilityHint).toBe(hint);
  });

  it('shows an unconfirmed one as it was sent, locked, for Retry', () => {
    const { root } = render(
      state(null, {
        status: 'uncertain',
        attempt: { key: 'settlement-key-1', body: '{}' },
        draft: {
          paidBy: you,
          paidTo: sam,
          currency: 'INR',
          amount: '3322',
          note: '',
          batch: [
            { amount: 1480, currency: 'INR' },
            {
              amount: 20,
              currency: 'EUR',
              amountPaidMinor: 184200,
              appliedRate: '92.1',
              rateKind: 'suggested',
              suggestedRate: '92.1',
              rateSource: 'frankfurter',
              rateAsOf: '2026-10-20',
              rateFetchedAt: frankfurter.fetchedAt,
            },
          ],
        },
      }),
    );
    expect(labelled(root, 'Pay in')).toHaveLength(0);
    expect(one(root, 'INR Debt ₹1,480.00, same currency, no rate. Pays ₹1,480.00')).toBeDefined();
    expect(one(root, 'EUR Debt €20.00 at ₹92.10 per €, suggested. Pays ₹1,842.00')).toBeDefined();
    expect(text(root)).toContain('₹3,322.00');
    expect(labelled(root, 'Retry payment')).toHaveLength(1);
    expect(labelled(root, 'Change the rate for the EUR Debt')).toHaveLength(0);
  });
});

// The board at 130% and in dark: every word reads in full, at 130% and 200% on 360 and 412dp.
describe.each(['light', 'dark'] as const)('Settle up at large text in %s (#734)', (mode) => {
  it.each(largeTextWindows)('reads in full, $width dp at $fontScale× text', (size) => {
    setWindow(size);
    render(state(paying()), handlers(), mode);
    const tree = screen!.toJSON() as ReactTestRendererJSON;
    const [frame] = findHosts(tree, (_props, type) => type === 'SafeAreaView');
    const [top, body, footer] = frame!.children as ReactTestRendererJSON[];
    expect(unreadText(top!, size.fontScale, size.width)).toEqual([]);
    expect(unreadText(body!, size.fontScale, size.width)).toEqual([]);
    expect(unreadText(footer!, size.fontScale, size.width)).toEqual([]);
  });
});
