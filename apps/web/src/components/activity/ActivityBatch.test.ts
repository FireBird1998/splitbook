import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';

/*
 * #734: on the Group's Activity tab, a payment that settled several Debts at once is one row, in
 * the words Android says ("You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00", then each
 * Debt and its rate), and opens one Payment card. Alex paid Sam ₹3,322.00 for a ₹1,480.00 Debt
 * and a €20.00 one at Frankfurter's ₹92.10. The page read is a stand-in.
 */

const page = vi.hoisted(() => ({ activities: [] as unknown[] }));
vi.mock('swr', async (original) => {
  const actual = await original<typeof import('swr')>();
  return {
    ...actual,
    default: () => ({
      data: { status: 200, data: { activities: page.activities } },
      isLoading: false,
      error: undefined,
    }),
  };
});

const { default: ActivityView } = await import('./ActivityView');

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const GROUP = 'c00000000000000000000001';
const BATCH = 'f00000000000000000000001';
const at = new Date(2026, 9, 21, 10, 20).toISOString();
const people = { paidBy: ALEX, paidTo: SAM, paidByName: 'Alex Rivera', paidToName: 'Sam Chen' };
const event = (id: string, metadata: Record<string, unknown>) => ({
  _id: id,
  group: GROUP,
  type: 'settlement_recorded',
  createdAt: at,
  actor: { _id: ALEX, name: 'Alex Rivera' },
  // The feed is newest first; each Settlement's id keeps the order the payment was recorded in.
  metadata: { ...people, settlementId: id, batchId: BATCH, batchSize: 2, ...metadata },
});
const rupees = event(BATCH, { amount: 1480, amountMinor: 148000, currency: 'INR' });
const euros = event('f00000000000000000000002', {
  amount: 20,
  amountMinor: 2000,
  currency: 'EUR',
  amountPaidMinor: 184200,
  paidCurrency: 'INR',
  appliedRate: '92.1',
  rateKind: 'suggested',
  suggestedRate: '92.1',
  rateSource: 'frankfurter',
  rateAsOf: '2026-10-20',
  rateFetchedAt: new Date(2026, 9, 21, 6, 0).toISOString(),
});
const lunch = {
  _id: 'e00000000000000000000009',
  group: GROUP,
  type: 'expense_added',
  createdAt: new Date(2026, 9, 21, 9, 5).toISOString(),
  actor: { _id: SAM, name: 'Sam Chen' },
  metadata: { description: 'Matcha in Uji', amount: 3600, currency: 'JPY' },
};

let renderer: ReactTestRenderer;
const textOf = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : ` ${textOf(child)} `))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
const hosts = (type: string) => renderer.root.findAll((node) => node.type === type);
const HEADLINE = 'You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00';
const batchRows = () => hosts('button').filter((node) => textOf(node).includes(HEADLINE));
const cardShown = () =>
  hosts('section').some((node) => node.props['aria-labelledby'] === 'payment-record-heading');

async function mount() {
  await act(async () => {
    renderer = create(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(ActivityView, { groupId: GROUP, viewerId: ALEX }),
      ),
      { createNodeMock: () => ({ focus() {} }) },
    );
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', { querySelector: () => null });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('a payment that settled several Debts at once, on the Activity tab (#734)', () => {
  it('is one row in Android’s words, with each Debt and its rate', async () => {
    page.activities = [euros, rupees, lunch];
    await mount();

    expect(batchRows()).toHaveLength(1);
    const row = textOf(batchRows()[0]);
    expect(row).toContain('₹1,480.00, same currency, no rate');
    expect(row).toContain('€20.00 at ₹92.10 per €, suggested ₹92.10 (20 Oct)');
    // Neither Settlement has a row of its own.
    expect(textOf(renderer.root)).not.toContain('You paid Sam Chen ₹1,480.00');
    expect(textOf(renderer.root)).not.toContain('You paid Sam Chen ₹1,842.00');
    expect(textOf(renderer.root)).toContain('Matcha in Uji');
  });

  it('opens one Payment card for the whole payment', async () => {
    page.activities = [euros, rupees];
    await mount();
    expect(cardShown()).toBe(false);

    await act(async () => batchRows()[0].props.onClick());

    expect(cardShown()).toBe(true);
    expect(batchRows()[0].props['aria-expanded']).toBe(true);
    const card = hosts('section').find(
      (node) => node.props['aria-labelledby'] === 'payment-record-heading',
    )!;
    expect(textOf(card)).toContain('Paid ₹3,322.00');
    expect(textOf(card)).toContain('to clear ₹1,480.00 and €20.00');
    expect(textOf(card)).toContain('€20.00 at ₹92.10 per €, suggested ₹92.10 (20 Oct)');
    expect(textOf(card)).toContain(
      'Each currency’s balances moved only by its own Debt. The rates are kept as recorded.',
    );
  });

  it('says what it has of a payment the page cut short, and where the rest is', async () => {
    page.activities = [rupees];
    await mount();
    expect(textOf(renderer.root)).toContain('You paid Sam Chen to clear ₹1,480.00 and 1 more Debt');
    expect(textOf(renderer.root)).toContain('The rest of this payment is in older Activity.');
  });
});
