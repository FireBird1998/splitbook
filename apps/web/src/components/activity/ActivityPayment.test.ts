import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';

/*
 * #727: on the Group's Activity tab, a payment that cleared a Debt in another currency names both
 * amounts and the rate, and opens its card beside the list (the board "Activity and a
 * cross-currency Settlement"). The page read is a stand-in.
 */

const page = vi.hoisted(() => ({ activities: [] as unknown[] }));
vi.mock('swr/infinite', async (original) => {
  const actual = await original<typeof import('swr/infinite')>();
  return {
    ...actual,
    default: () => ({
      data: [
        {
          status: 200,
          data: { activities: page.activities, pagination: { page: 1, totalPages: 1 } },
        },
      ],
      isLoading: false,
      error: undefined,
    }),
  };
});

const { default: ActivityView } = await import('./ActivityView');

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const inRupees = {
  _id: 'e00000000000000000000001',
  group: 'c00000000000000000000001',
  type: 'settlement_recorded',
  createdAt: new Date(2026, 9, 21, 10, 20).toISOString(),
  actor: { _id: ALEX, name: 'Alex Rivera' },
  metadata: {
    paidBy: ALEX,
    paidByName: 'Alex Rivera',
    paidTo: SAM,
    paidToName: 'Sam Chen',
    amount: 20,
    amountMinor: 2000,
    currency: 'EUR',
    amountPaidMinor: 185000,
    paidCurrency: 'INR',
    appliedRate: '92.5',
    rateKind: 'custom',
    suggestedRate: '92.1',
    rateSource: 'frankfurter',
    rateAsOf: '2026-10-20',
    rateFetchedAt: new Date(2026, 9, 21, 6, 0).toISOString(),
    pairDebtBeforeMinor: -2000,
    pairDebtAfterMinor: 0,
  },
};
const inRupeesOwn = {
  ...inRupees,
  _id: 'e00000000000000000000002',
  metadata: {
    paidBy: SAM,
    paidTo: ALEX,
    paidByName: 'Sam Chen',
    paidToName: 'Alex Rivera',
    amount: 500,
    currency: 'INR',
  },
};

let renderer: ReactTestRenderer;
const textOf = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : ` ${textOf(child)} `))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
const hosts = (type: string) => renderer.root.findAll((node) => node.type === type);
/** The payment's row, found again after each render. */
const paymentRow = () =>
  hosts('button').find((node) =>
    textOf(node).includes('You paid Sam Chen ₹1,850.00 to clear €20.00 at ₹92.50 per €'),
  );
const cardShown = () =>
  hosts('section').some((node) => node.props['aria-labelledby'] === 'payment-record-heading');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', { querySelector: () => null });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('a Debt paid in another currency on the Activity tab (#727)', () => {
  it('says both amounts and the rate, and opens its card', async () => {
    page.activities = [inRupees, inRupeesOwn];
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { theme: createAppTheme('light') },
          createElement(ActivityView, { groupId: inRupees.group, viewerId: ALEX }),
        ),
        { createNodeMock: () => ({ focus() {} }) },
      );
    });

    expect(paymentRow()).toBeDefined();
    expect(textOf(paymentRow()!)).toContain('Settlement · EUR Debt paid in INR');
    expect(paymentRow()!.props['aria-expanded']).toBe(false);
    // A payment in its Debt's own currency stays a plain row, as before.
    expect(hosts('button').some((node) => textOf(node).includes('₹500.00'))).toBe(false);
    expect(cardShown()).toBe(false);

    await act(async () => paymentRow()!.props.onClick());

    expect(cardShown()).toBe(true);
    expect(paymentRow()!.props['aria-expanded']).toBe(true);
    expect(textOf(renderer.root)).toContain('You and Sam in EUR: −€20.00 → €0.00');

    await act(async () =>
      hosts('button')
        .find((node) => node.props['aria-label'] === 'Close Payment')!
        .props.onClick(),
    );
    expect(cardShown()).toBe(false);
  });
});
