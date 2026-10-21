import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { anchors, text } from '@/lib/test-utils/markup';
import type { CrossCurrencyRecord } from '@splitbook/shared/cross-currency-payment';
import PaymentRecordCard from './PaymentRecordCard';

/*
 * #727: a payment that cleared a Debt in another currency, as its card beside Activity shows it
 * (the board "Activity and a cross-currency Settlement"). Fictional people and figures.
 */

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
/** Local time, so the card reads the same in every zone the suite runs in. */
const at = new Date(2026, 9, 21, 10, 20).toISOString();

const record: CrossCurrencyRecord = {
  paidBy: ALEX,
  paidByName: 'Alex Rivera',
  paidTo: SAM,
  paidToName: 'Sam Chen',
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
};

function render(changes: Partial<CrossCurrencyRecord> = {}, viewerId = ALEX) {
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(PaymentRecordCard, {
        record: { ...record, ...changes },
        recordedBy: { _id: ALEX, name: 'Alex Rivera' },
        recordedAt: at,
        viewerId,
        onClose: () => {},
      }),
    ),
  );
  return { html, text: text(html) };
}

describe('a payment in another currency, on its card (#727)', () => {
  it('shows who paid whom, both amounts, the rate and the suggestion, and what moved', () => {
    const { html, text: shown } = render();

    expect(shown).toContain('Payment Recorded by you · Wed 21 Oct, 10:20');
    expect(html).toContain('aria-label="Close Payment"');
    expect(shown).toContain('You Sam Chen');
    expect(shown).toContain('Paid ₹1,850.00 to clear €20.00, a Debt in EUR');
    expect(shown).toContain('Rate used ₹92.50 per € Your rate');
    expect(shown).toContain(
      'Suggested ₹92.10 per € Frankfurter · rates of 20 Oct · fetched 21 Oct 06:00',
    );
    expect(shown).toContain('Amount cleared €20.00');
    expect(shown).toContain('Amount paid ₹1,850.00');
    expect(shown).toContain('You and Sam in EUR: −€20.00 → €0.00');
    expect(shown).toContain('INR balances didn’t change. Only the Debt’s own currency moves.');
    expect(shown).toContain(
      'The rate is kept as recorded. It never changes, even when rates move later.',
    );
  });

  it('links the second source, and leaves out what an older record didn’t keep', () => {
    const fallback = render({
      rateKind: 'suggested',
      suggestedRate: '92.5',
      rateSource: 'exchange-rate-api',
    });
    expect(anchors(fallback.html)).toContainEqual(
      expect.objectContaining({
        href: 'https://www.exchangerate-api.com',
        text: 'Rates By Exchange Rate API',
      }),
    );
    const older = render({ pairDebtBeforeMinor: undefined, pairDebtAfterMinor: undefined }, SAM);
    expect(older.text).toContain('Payment Recorded by Alex Rivera');
    expect(older.text).not.toContain('in EUR:');
  });
});
