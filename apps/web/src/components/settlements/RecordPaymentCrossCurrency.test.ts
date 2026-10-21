import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateSuggestion } from '@splitbook/shared/cross-currency-payment';
import { EXCHANGE_RATE_API_ATTRIBUTION } from '@splitbook/shared/cross-currency-settlement';
import type { SettlementLedger } from '@splitbook/shared/settlement-preview';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import type { RateSuggestionState } from '@/lib/hooks/use-rate-suggestion';
import type { NamedSettlementPayment } from '@/lib/settlement-attempts';
import RecordPaymentForm from './RecordPaymentForm';

/*
 * #727: Record payment for a Debt paid in another currency, in each state the boards "Pay a
 * euro Debt in rupees" and "Record payment · every state" show: the suggested rate, your rate,
 * part of the Debt, no suggestion, the second source, an older suggestion and clearing more
 * than the Debt. The rate read and the save are stand-ins; the sheet and its maths are real.
 */

const GROUP = 'b00000000000000000000010';
const YOU = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';

vi.mock('@/lib/hooks/use-settlement-attempts', () => ({ useSettlementAttempts: () => [] }));
const rate = vi.hoisted(() => ({ state: { status: 'loading' } as RateSuggestionState }));
vi.mock('@/lib/hooks/use-rate-suggestion', () => ({ useRateSuggestion: () => rate.state }));
const saved = vi.hoisted(() => ({ payments: [] as NamedSettlementPayment[] }));
vi.mock('@/lib/settlement-attempts', async (original) => ({
  ...(await original<typeof import('@/lib/settlement-attempts')>()),
  browserAttemptStorage: () => null,
  browserPairLock: () => async (_name: string, task: () => unknown) => task(),
  recordSettlement: async ({ payment }: { payment: NamedSettlementPayment }) => {
    saved.payments.push(payment);
    return { status: 'recorded' };
  },
}));
vi.mock('@/lib/utils/api-fetch', () => ({
  apiFetch: vi.fn(),
  pinExpectedAccount: () => true,
  reloadForAccountChange: () => {},
}));

/** You owe Sam €20.00 in Lisbon & Tokyo. */
const euros: SettlementLedger = {
  balances: [
    { userId: YOU, amountMinor: -2000 },
    { userId: SAM, amountMinor: 2000 },
  ],
  suggestions: [{ from: YOU, to: SAM, amountMinor: 2000 }],
};

/** Local times, so the words read the same in every zone the suite runs in. */
const local = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0);
const frankfurter: RateSuggestion = {
  rate: '92.1',
  source: 'frankfurter',
  asOf: '2026-10-20',
  fetchedAt: local(21, 6).toISOString(),
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
};

let renderer: ReactTestRenderer;
const done = vi.fn();

/** Record payment for Alex and Sam's euros, as Balances shows it. */
const sheet = (ledger: SettlementLedger, amount: string) =>
  createElement(
    ThemeProvider,
    { theme: createAppTheme('light') },
    createElement(RecordPaymentForm, {
      groupId: GROUP,
      groupName: 'Lisbon & Tokyo',
      accountId: YOU,
      currency: 'EUR',
      payCurrencies: ['EUR', 'INR', 'JPY'],
      mainCurrency: 'INR',
      members: [
        { id: YOU, name: 'Alex Rivera' },
        { id: SAM, name: 'Sam Chen' },
      ],
      ledger: { status: 'ready', ledger },
      start: { from: YOU, to: SAM, amount },
      onDone: done,
      onRefresh: () => {},
    }),
  );

async function open(state: RateSuggestionState, ledger = euros, amount = '20.00') {
  rate.state = state;
  await act(async () => {
    renderer = create(sheet(ledger, amount), {
      createNodeMock: () => ({ focus() {}, addEventListener() {}, removeEventListener() {} }),
    });
  });
  // Pay in rupees.
  await press(radio('INR'));
}

/** The rate read answers again, while the sheet is open. */
async function reread(state: RateSuggestionState) {
  rate.state = state;
  await act(async () => renderer.update(sheet(euros, '20.00')));
}

/** The node's text as read: the pieces of one run together, elements apart. */
const textOf = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : ` ${textOf(child)} `))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
const page = () => textOf(renderer.root);
const hosts = (type: string) => renderer.root.findAll((node) => node.type === type);
const radio = (code: string) =>
  hosts('button').find((node) => node.props.role === 'radio' && textOf(node) === code)!;
const button = (name: string) =>
  hosts('button').find((node) => textOf(node) === name || node.props['aria-label'] === name);
const value = (id: string) => hosts('input').find((node) => node.props.id === id)!.props.value;
const fields = () => [
  value('record-payment-cleared'),
  value('record-payment-rate'),
  value('record-payment-paid'),
];
async function press(node: ReactTestInstance | undefined) {
  if (!node) throw new Error('Nothing to press');
  await act(async () => {
    node.props.onClick({ preventDefault() {} });
  });
}
async function type(id: string, text: string) {
  await act(async () => {
    hosts('input')
      .find((node) => node.props.id === id)!
      .props.onChange({ target: { value: text } });
  });
}
/** Whether Record payment can send now. */
const canRecord = () =>
  !hosts('button').find((node) => node.props.type === 'submit')!.props.disabled;
async function submit() {
  await act(async () => {
    hosts('form')[0].props.onSubmit({ preventDefault() {} });
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(local(21, 10));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // MUI's theme looks for the page's head to order its styles; there is none here.
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('crypto', { randomUUID: () => 'synthetic-key-0001' });
  saved.payments = [];
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('paying a euro Debt in rupees (#727)', () => {
  it('opens on the whole Debt at the suggested rate, and records both sides', async () => {
    await open({ status: 'ready', suggestion: frankfurter });

    expect(page()).toContain('Lisbon & Tokyo · Debt in EUR');
    expect(page()).toContain('EUR is the Debt’s own currency; INR is the main currency.');
    expect(radio('INR').props['aria-checked']).toBe(true);
    expect(fields()).toEqual(['20.00', '92.10', '1842.00']);
    expect(page()).toContain('Change any one; the other two follow.');
    expect(page()).toContain('Amount cleared the whole Debt');
    expect(page()).toContain('Suggested');
    expect(page()).toContain('Frankfurter · rates of 20 Oct · fetched today 06:00');
    expect(page()).toContain('Amount paid rounded to the paisa');
    expect(page()).toContain('Clears your €20.00 Debt to Sam. Sam gets ₹1,842.00.');
    expect(canRecord()).toBe(true);

    await submit();

    expect(saved.payments).toEqual([
      expect.objectContaining({
        paidBy: YOU,
        paidTo: SAM,
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 184200,
        paidCurrency: 'INR',
        appliedRate: '92.1',
        rateKind: 'suggested',
        suggestedRate: '92.1',
        rateSource: 'frankfurter',
        rateAsOf: '2026-10-20',
        rateFetchedAt: frankfurter.fetchedAt,
      }),
    ]);
  });

  it('takes the payer’s own rate, keeps the suggestion one click away, and records it as theirs', async () => {
    await open({ status: 'ready', suggestion: frankfurter });

    await type('record-payment-rate', '92.50');

    expect(fields()).toEqual(['20.00', '92.50', '1850.00']);
    expect(page()).toContain('Your rate');
    expect(page()).toContain('Your rate. Suggested ₹92.10 from Frankfurter, rates of 20 Oct.');
    expect(page()).toContain('Clears your €20.00 Debt to Sam. Sam gets ₹1,850.00.');
    await submit();
    expect(saved.payments[0]).toMatchObject({
      amountPaidMinor: 185000,
      appliedRate: '92.5',
      rateKind: 'custom',
      suggestedRate: '92.1',
    });

    await press(button('Use ₹92.10'));
    expect(fields()).toEqual(['20.00', '92.10', '1842.00']);
  });

  it('works the rate out from the amount paid', async () => {
    await open({ status: 'ready', suggestion: frankfurter });
    await type('record-payment-paid', '1850');
    expect(fields()).toEqual(['20.00', '92.50', '1850']);
  });

  it('clears part of the Debt, and says what stays to pay', async () => {
    await open({ status: 'ready', suggestion: frankfurter });

    await type('record-payment-cleared', '10.00');

    expect(fields()).toEqual(['10.00', '92.10', '921.00']);
    expect(page()).toContain('Amount cleared part of €20.00');
    expect(page()).toContain('Clears €10.00 of your €20.00 Debt to Sam. €10.00 stays to pay.');
    await submit();
    expect(saved.payments[0]).toMatchObject({
      amount: 10,
      amountPaidMinor: 92100,
      rateKind: 'suggested',
    });
  });

  it('records with the payer’s rate when none is suggested, and says so', async () => {
    await open({ status: 'none', reason: 'unavailable' });

    expect(page()).toContain('No rate suggested right now.');
    expect(page()).toContain(
      'Splitbook couldn’t get today’s rates. You can still record it with the rate you agreed.',
    );
    expect(fields()).toEqual(['20.00', '', '']);
    expect(page()).toContain('No suggestion');
    expect(page()).toContain(
      'Type the rate you agreed, or both amounts. The rate is kept as yours.',
    );
    expect(page()).toContain(
      'Clears your €20.00 Debt to Sam once you enter the rate or the amount paid.',
    );
    expect(canRecord()).toBe(false);
    expect(page()).toContain('Enter the rate or the amount paid to record it');

    await type('record-payment-paid', '1850.00');

    expect(fields()).toEqual(['20.00', '92.50', '1850.00']);
    await submit();
    expect(saved.payments[0]).toEqual(
      expect.objectContaining({
        amountPaidMinor: 185000,
        appliedRate: '92.5',
        rateKind: 'entered',
      }),
    );
    expect(saved.payments[0]).not.toHaveProperty('suggestedRate');
  });

  it('carries the second source’s attribution and link', async () => {
    await open({
      status: 'ready',
      suggestion: {
        ...frankfurter,
        rate: '92.06',
        source: 'exchange-rate-api',
        asOf: '2026-10-21',
        attributionRequired: true,
        attribution: { ...EXCHANGE_RATE_API_ATTRIBUTION },
      },
    });

    expect(fields()).toEqual(['20.00', '92.06', '1841.20']);
    expect(page()).toContain('Rates of 21 Oct · fetched today 06:00');
    const link = hosts('a').find((node) => textOf(node) === 'Rates By Exchange Rate API');
    expect(link?.props.href).toBe('https://www.exchangerate-api.com');
  });

  it('shows how old an older suggestion is', async () => {
    await open({
      status: 'ready',
      suggestion: { ...frankfurter, rate: '91.4', asOf: '2026-10-16', ageDays: 5 },
    });

    expect(fields()).toEqual(['20.00', '91.40', '1828.00']);
    expect(page()).toContain('5 days old');
    expect(page()).toContain(
      'Frankfurter · rates of 16 Oct, 5 days old. Today’s rates aren’t in yet.',
    );
  });

  it('clears more than the Debt only once the payer says they meant to', async () => {
    await open({ status: 'ready', suggestion: frankfurter });

    await type('record-payment-cleared', '25.00');

    expect(fields()).toEqual(['25.00', '92.10', '2302.50']);
    expect(page()).toContain('Amount cleared more than the €20.00 Debt');
    expect(page()).toContain(
      'That’s €5.00 more than you owe Sam in EUR, so Sam would owe you €5.00.',
    );
    expect(page()).toContain('Clears your €20.00 Debt to Sam and €5.00 more. Sam gets ₹2,302.50.');
    expect(canRecord()).toBe(false);
    const tick = hosts('input').find((node) => node.props.type === 'checkbox')!;
    await act(async () =>
      tick.props.onChange({ target: { checked: true }, nativeEvent: { defaultPrevented: false } }),
    );
    expect(canRecord()).toBe(true);
  });

  it('goes back to the Debt’s own currency as today’s form', async () => {
    await open({ status: 'ready', suggestion: frankfurter });
    await type('record-payment-cleared', '15.00');

    await press(radio('EUR'));

    expect(value('record-payment-amount')).toBe('15.00');
    expect(hosts('input').some((node) => node.props.id === 'record-payment-rate')).toBe(false);
  });

  it('names no rate kind while the suggestion is read', async () => {
    await open({ status: 'loading' });
    expect(page()).toContain('Looking up a suggested rate…');
    expect(page()).not.toContain('No suggestion');
    expect(page()).not.toContain('No rate suggested right now.');
  });

  it('says when no rate is known for the pair, rather than that rates couldn’t be read', async () => {
    await open({ status: 'none', reason: 'currency_unavailable' });
    expect(page()).toContain('No rate suggested right now.');
    expect(page()).toContain(
      'Splitbook has no rate between EUR and INR right now. You can still record it with the rate you agreed.',
    );
  });

  it('keeps the suggestion it opened with if the rate is read again meanwhile', async () => {
    await open({ status: 'ready', suggestion: frankfurter });
    await type('record-payment-rate', '92.50');

    await reread({
      status: 'ready',
      suggestion: { ...frankfurter, rate: '92.3', asOf: '2026-10-21' },
    });
    await submit();

    expect(saved.payments[0]).toMatchObject({
      rateKind: 'custom',
      suggestedRate: '92.1',
      rateAsOf: '2026-10-20',
    });
  });

  it('keeps today’s overpayment words and positions when no Debt runs this way', async () => {
    // Sam owes Alex €20.00, so nothing is suggested from Alex to Sam.
    const samOwes: SettlementLedger = {
      balances: [
        { userId: YOU, amountMinor: 2000 },
        { userId: SAM, amountMinor: -2000 },
      ],
      suggestions: [{ from: SAM, to: YOU, amountMinor: 2000 }],
    };
    await open({ status: 'ready', suggestion: frankfurter }, samOwes, '5.00');

    expect(fields()).toEqual(['5.00', '92.10', '460.50']);
    expect(page()).toContain('No payment from you to Sam Chen is suggested.');
    expect(page()).toContain('After this payment');
    expect(page()).not.toContain('€0.00 Debt');
    expect(canRecord()).toBe(false);
  });

  it('puts the exact suggestion back beside the payer’s own rate', async () => {
    await open({ status: 'ready', suggestion: { ...frankfurter, rate: '92.123456789' } });
    await type('record-payment-rate', '92.50');
    await press(button('Use ₹92.123457'));
    expect(fields()).toEqual(['20.00', '92.123456789', '1842.47']);
    await submit();
    expect(saved.payments[0]).toMatchObject({
      rateKind: 'suggested',
      suggestedRate: '92.123456789',
    });
  });
});
