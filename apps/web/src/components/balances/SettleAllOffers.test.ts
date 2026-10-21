import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import type { SettleAllOffer } from '@/components/settlements/settle-all';
import SettleAllOffers from './SettleAllOffers';

/*
 * #734: on Balances, the board "Web · Settle both currencies at once" offers one payment to each
 * person the member owes, or who owes them, in two currencies or more.
 */

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const owe: SettleAllOffer = {
  paidBy: ALEX,
  paidTo: SAM,
  other: 'Sam Chen',
  youPay: true,
  debts: [
    { currency: 'INR', amountMinor: 148000 },
    { currency: 'EUR', amountMinor: 2000 },
  ],
};
const owed: SettleAllOffer = {
  paidBy: PRIYA,
  paidTo: ALEX,
  other: 'Priya Shah',
  youPay: false,
  debts: [
    { currency: 'INR', amountMinor: 50000 },
    { currency: 'EUR', amountMinor: 1250 },
    { currency: 'JPY', amountMinor: 900 },
  ],
};

function render(offers: SettleAllOffer[], mode: 'light' | 'dark' = 'light') {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme(mode) },
      createElement(SettleAllOffers, { offers, disabled: false, onSettle: vi.fn() }),
    ),
  );
}

describe('Settle up offers on Balances (#734)', () => {
  it('says whom the member owes in which currencies, and offers one payment for both', () => {
    const html = render([owe, owed]);
    // The markup helper sets elements apart; on the page the full stop follows the amounts.
    expect(text(html)).toMatch(
      /You owe Sam Chen in 2 currencies ₹1,480\.00 and €20\.00 ?\. One payment can clear both\./,
    );
    expect(text(html)).toMatch(
      /Priya Shah owes you in 3 currencies ₹500\.00, €12\.50 and ¥900 ?\. One payment can clear them all\./,
    );
    expect(html).toMatch(
      /<button[^>]*aria-label="Settle both with Sam Chen"[^>]*>[\s\S]*?Settle both/,
    );
    expect(html).toMatch(/<button[^>]*aria-label="Settle all with Priya Shah"/);
  });

  it('shows nothing when no one is owed in more than one currency', () => {
    expect(render([])).toBe('');
  });

  it('renders in dark mode too', () => {
    expect(text(render([owe], 'dark'))).toContain('Settle both');
  });
});
