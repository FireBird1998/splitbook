import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateSuggestion } from '@splitbook/shared/cross-currency-payment';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import type { RateSuggestionState } from '@/lib/hooks/use-rate-suggestion';
import { listSettlementAttempts, type SettlementAttempt } from '@/lib/settlement-attempts';
import type { SettleAllOffer } from '@splitbook/shared/settle-all';
import SettleAllDialog, { type SettleAllDialogProps } from './SettleAllDialog';

/*
 * #734: the sheet "Settle up with Sam" on the board "Web · Settle both currencies at once". You
 * owe Sam ₹1,480.00 and €20.00; one payment in rupees clears both, the euro Debt at Frankfurter's
 * ₹92.10. The rate read and the network are stand-ins; the sheet, its maths and the browser's
 * copy of the payment are real.
 */

const GROUP = 'b00000000000000000000010';
const YOU = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const BATCH = `/api/groups/${GROUP}/settlements/batch`;

vi.mock('@mui/material/Dialog', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
}));
const rates = vi.hoisted(() => ({ byPair: {} as Record<string, RateSuggestionState> }));
vi.mock('@/lib/hooks/use-rate-suggestion', () => ({
  useRateSuggestion: (_group: string, currency: string, paidCurrency: string) =>
    currency === paidCurrency
      ? { status: 'loading' }
      : (rates.byPair[`${currency}>${paidCurrency}`] ?? { status: 'loading' }),
}));
const storage = vi.hoisted(() => {
  const items = new Map<string, string>();
  return {
    items,
    store: {
      get length() {
        return items.size;
      },
      key: (index: number) => [...items.keys()][index] ?? null,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    },
  };
});
vi.mock('@/lib/settlement-attempts', async (original) => ({
  ...(await original<typeof import('@/lib/settlement-attempts')>()),
  browserAttemptStorage: () => storage.store,
  browserPairLock: () => async (_name: string, task: () => unknown) => task(),
}));
const network = vi.hoisted(() => ({
  sent: [] as { path: string; key: string; body: unknown }[],
  /** Each send in turn: 'lost' drops the reply after the server records it. */
  replies: [] as Array<'ok' | 'lost'>,
}));
vi.mock('@/lib/utils/api-fetch', () => ({
  apiFetch: async (path: string, init: RequestInit) => {
    network.sent.push({
      path,
      key: String((init.headers as Record<string, string>)['Idempotency-Key']),
      body: JSON.parse(String(init.body)),
    });
    if (network.replies[network.sent.length - 1] === 'lost') throw new TypeError('Failed to fetch');
    return Response.json({ status: 201, data: {} }, { status: 201 });
  },
  pinExpectedAccount: () => true,
  reloadForAccountChange: () => {},
}));

const local = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0);
const suggestion = (rate: string): RateSuggestion => ({
  rate,
  source: 'frankfurter',
  asOf: '2026-10-20',
  fetchedAt: local(21, 6).toISOString(),
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
});
const offer: SettleAllOffer = {
  paidBy: YOU,
  paidTo: SAM,
  other: 'Sam Chen',
  youPay: true,
  debts: [
    { currency: 'INR', amountMinor: 148000 },
    { currency: 'EUR', amountMinor: 2000 },
  ],
};

let renderer: ReactTestRenderer;
const done = vi.fn();
const textOf = (node: ReactTestInstance | null): string =>
  node
    ? node.children
        .map((child) => (typeof child === 'string' ? child : ` ${textOf(child)} `))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
const sheet = () => renderer.root.find((node) => node.props.role === 'dialog');
const shown = () => textOf(sheet());
function button(name: string) {
  return sheet()
    .findAll((node) => node.type === 'button')
    .find((node) => (node.props['aria-label'] ?? textOf(node)) === name);
}
async function press(name: string) {
  const found = button(name);
  if (!found) throw new Error(`Missing button ${name}`);
  await act(async () => found.props.onClick({ currentTarget: {} }));
}
async function typeRate(currency: string, value: string) {
  const field = sheet().find(
    (node) => node.type === 'input' && node.props['aria-label'] === `Rate for the ${currency} Debt`,
  );
  await act(async () => field.props.onChange({ target: { value } }));
}
/** The rows of the sheet's table, each as it reads. */
const rows = () =>
  sheet()
    .findAll((node) => node.type === 'tr')
    .map(textOf);

function element(props: Partial<SettleAllDialogProps> = {}) {
  return createElement(
    ThemeProvider,
    { theme: createAppTheme('light') },
    createElement(SettleAllDialog, {
      open: true,
      groupId: GROUP,
      accountId: YOU,
      offer,
      names: { [YOU]: 'Alex Rivera', [SAM]: 'Sam Chen' },
      payCurrencies: ['INR', 'EUR'],
      stored: null,
      // The Balances read again at Record: unchanged unless a test says otherwise.
      recheck: async () => offer.debts,
      onClose: vi.fn(),
      onDone: done,
      onRefresh: vi.fn(),
      ...props,
    }),
  );
}
async function mount(props: Partial<SettleAllDialogProps> = {}) {
  await act(async () => {
    renderer = create(element(props), {
      createNodeMock: () => ({ focus() {}, addEventListener() {}, removeEventListener() {} }),
    });
  });
}
const storedAttempts = (): SettlementAttempt[] => listSettlementAttempts(storage.store, YOU, GROUP);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', { querySelector: () => null });
  let keys = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `synthetic-key-${String(++keys).padStart(4, '0')}` });
  rates.byPair = { 'EUR>INR': { status: 'ready', suggestion: suggestion('92.1') } };
  storage.items.clear();
  network.sent = [];
  network.replies = [];
  done.mockReset();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('Settle up with Sam (#734)', () => {
  it('shows each Debt, its rate and what it pays, and records them as one payment', async () => {
    await mount();
    expect(shown()).toContain('Settle up with Sam Chen');
    expect(shown()).toContain(
      'You owe Sam Chen in 2 currencies. One payment can clear both; each Debt keeps its own rate.',
    );
    expect(rows()).toEqual([
      'Debt Rate You pay',
      'INR ₹1,480.00 Same currency ₹1,480.00',
      expect.stringMatching(
        /^EUR €20\.00 ₹92\.10 per € Frankfurter · rates of 20 Oct · fetched [^·]+ Change ₹1,842\.00$/,
      ),
      'Total ₹3,322.00',
    ]);
    expect(shown()).toContain(
      'Records 2 Settlements, one for each Debt, each with its own rate. Activity shows them as one payment. To pay part of a Debt, record it on its own.',
    );
    // Pay in reads as Record payment's does: a choice of one.
    expect(button('INR')!.props.role).toBe('radio');
    // The source fits on its own line, and Change sits under it rather than after it.
    const source = sheet().findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.props['data-rate-part'] === 'source' &&
        textOf(node).startsWith('Frankfurter'),
    );
    expect(source).toHaveLength(1);
    expect(textOf(source[0])).not.toContain('Change');
    expect(textOf(source[0])).not.toContain('Suggested');
    expect(button('INR')!.props['aria-checked']).toBe(true);

    await press('Record ₹3,322.00');

    expect(network.sent).toEqual([
      {
        path: BATCH,
        key: 'synthetic-key-0001',
        body: {
          paidBy: YOU,
          paidTo: SAM,
          paidCurrency: 'INR',
          settlements: [
            { amount: 1480, currency: 'INR' },
            expect.objectContaining({
              amount: 20,
              currency: 'EUR',
              amountPaidMinor: 184200,
              rateKind: 'suggested',
              suggestedRate: '92.1',
            }),
          ],
        },
      },
    ]);
    expect(done).toHaveBeenCalledWith(
      'Recorded. You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00.',
    );
    expect(storedAttempts()).toEqual([]);
  });

  it('pays the euro Debt at the member’s own rate once they change it', async () => {
    await mount();
    await press('Change the rate for the EUR Debt');
    await typeRate('EUR', '92.50');
    // Back to the suggestion, named for its Debt as Change is.
    expect(button('Use the suggested rate for the EUR Debt, ₹92.10')).toBeDefined();
    expect(rows()[2]).toMatch(/^EUR €20\.00 .*Your rate.* ₹1,850\.00$/);
    expect(rows()[3]).toBe('Total ₹3,330.00');

    await press('Record ₹3,330.00');
    expect(network.sent[0].body).toMatchObject({
      settlements: [
        { amount: 1480, currency: 'INR' },
        expect.objectContaining({ rateKind: 'custom', appliedRate: '92.5', suggestedRate: '92.1' }),
      ],
    });
  });

  it('waits for a rate the member enters when there’s no suggestion', async () => {
    rates.byPair = { 'EUR>INR': { status: 'none', reason: null } };
    await mount();
    expect(shown()).toContain('Enter the rate for the EUR Debt to record it.');
    expect(button('Record')!.props.disabled).toBe(true);

    await typeRate('EUR', '92');
    expect(rows()[3]).toBe('Total ₹3,320.00');
    await press('Record ₹3,320.00');
    expect(network.sent[0].body).toMatchObject({
      settlements: [expect.anything(), expect.objectContaining({ rateKind: 'entered' })],
    });
  });

  it('pays in euros instead, the rupee Debt at its own rate', async () => {
    rates.byPair = { 'INR>EUR': { status: 'ready', suggestion: suggestion('0.010858') } };
    await mount();
    await press('EUR');
    expect(button('EUR')!.props['aria-checked']).toBe(true);
    expect(rows()).toEqual([
      'Debt Rate You pay',
      expect.stringMatching(/^INR ₹1,480\.00 €0\.010858 per ₹ Frankfurter .* Change €16\.07$/),
      'EUR €20.00 Same currency €20.00',
      'Total €36.07',
    ]);
    await press('Record €36.07');
    expect(network.sent[0].body).toMatchObject({ paidCurrency: 'EUR' });
  });

  it('never pays a Debt at another paying currency’s rate after Pay in changes', async () => {
    // Sam is owed in yen too. In rupees both rates are known; the yen-to-euro one isn't yet.
    const three: SettleAllOffer = {
      ...offer,
      debts: [...offer.debts, { currency: 'JPY', amountMinor: 2500 }],
    };
    rates.byPair = {
      'EUR>INR': { status: 'ready', suggestion: suggestion('92.1') },
      'JPY>INR': { status: 'ready', suggestion: suggestion('0.56') },
      'INR>EUR': { status: 'ready', suggestion: suggestion('0.010858') },
    };
    await mount({ offer: three, payCurrencies: ['INR', 'EUR', 'JPY'] });
    expect(rows()[3]).toMatch(/^JPY ¥2,500 ₹0\.56 per ¥/);

    await press('EUR');
    expect(rows()[3]).toBe('JPY ¥2,500 Getting the suggested rate… —');
    expect(shown()).toContain('Getting the suggested rate for JPY…');
    expect(button('Record')!.props.disabled).toBe(true);
  });

  it('keeps a payment whose reply was lost, and Record again sends the very same one', async () => {
    network.replies = ['lost'];
    await mount();
    await press('Record ₹3,322.00');
    expect(shown()).toContain('The connection failed before this payment was confirmed.');
    expect(done).not.toHaveBeenCalled();

    // Closed and opened again, the sheet has only what this browser kept.
    const [kept] = storedAttempts();
    expect(kept.batch).toHaveLength(2);
    await act(async () => renderer.update(element({ stored: kept })));
    expect(shown()).toContain(
      'This payment may already be recorded. Recording it again sends the same record, so it can’t be counted twice.',
    );
    expect(rows()).toEqual([
      'Debt Rate You pay',
      'INR ₹1,480.00 Same currency ₹1,480.00',
      expect.stringMatching(/^EUR €20\.00 ₹92\.10 per € .*₹1,842\.00$/),
      'Total ₹3,322.00',
    ]);
    // A stored payment is checked, never changed.
    expect(button('Change the rate for the EUR Debt')).toBeUndefined();

    await press('Record ₹3,322.00 again');
    expect(network.sent).toHaveLength(2);
    expect(network.sent[1]).toEqual(network.sent[0]);
    expect(done).toHaveBeenCalledWith(
      'Recorded. You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00.',
    );
  });
});

describe('Debts that change while Settle up is open (#734)', () => {
  it('shows the Debts as they are now and waits, never paying an amount that’s gone', async () => {
    // Sam recorded €15 of the euro Debt meanwhile: €5.00 is left.
    const recheck = vi.fn(async () => [
      { currency: 'INR', amountMinor: 148000 },
      { currency: 'EUR', amountMinor: 500 },
    ]);
    await mount({ recheck });
    await press('Record ₹3,322.00');

    expect(network.sent).toEqual([]);
    expect(shown()).toContain('The Debts changed. Check the payment, then record again.');
    expect(rows()).toEqual([
      'Debt Rate You pay',
      'INR ₹1,480.00 Same currency ₹1,480.00',
      expect.stringMatching(/^EUR €5\.00 .*₹460\.50$/),
      'Total ₹1,940.50',
    ]);

    await press('Record ₹1,940.50');
    expect(recheck).toHaveBeenCalledTimes(2);
    expect(network.sent).toHaveLength(1);
    expect(network.sent[0].body).toMatchObject({
      settlements: [
        { amount: 1480, currency: 'INR' },
        expect.objectContaining({ amount: 5, currency: 'EUR', amountPaidMinor: 46050 }),
      ],
    });
  });

  it('ends the payment when one of its Debts is gone', async () => {
    const recheck = vi.fn(async () => [{ currency: 'INR', amountMinor: 148000 }]);
    await mount({ recheck });
    await press('Record ₹3,322.00');

    expect(network.sent).toEqual([]);
    expect(shown()).toContain(
      'This suggested payment has changed. Close this to see the latest balances.',
    );
    expect(button('Record ₹3,322.00')).toBeUndefined();
  });

  it('sends a stored payment again as it was, without reading the Balances again', async () => {
    network.replies = ['lost'];
    const recheck = vi.fn(async () => offer.debts);
    await mount({ recheck });
    await press('Record ₹3,322.00');
    expect(recheck).toHaveBeenCalledTimes(1);

    const [kept] = storedAttempts();
    await act(async () => renderer.update(element({ stored: kept, recheck })));
    await press('Record ₹3,322.00 again');
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(network.sent).toHaveLength(2);
    expect(network.sent[1]).toEqual(network.sent[0]);
  });
});
