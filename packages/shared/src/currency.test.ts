import { describe, expect, it } from 'vitest';
import { formatCurrencyAsEntered, inSupportedCurrencies } from './currency';

describe('money as entered (#537)', () => {
  it('shows more decimals than its currency has as they are, never rounded', () => {
    expect(formatCurrencyAsEntered(10.555, 'INR')).toBe('₹10.555');
    expect(formatCurrencyAsEntered(1060.5, 'JPY')).toBe('¥1,060.5');
    expect(formatCurrencyAsEntered(-0.125, 'USD')).toBe('-$0.125');
  });
  it('shows any other amount in its currency’s places, as money always shows', () => {
    expect(formatCurrencyAsEntered(12.5, 'INR')).toBe('₹12.50');
    expect(formatCurrencyAsEntered(1060, 'JPY')).toBe('¥1,060');
    expect(formatCurrencyAsEntered(10_000_000, 'INR')).toBe('₹10,000,000.00');
  });
});

// #820: rows in a currency Splitbook no longer supports have no position, so the reads that
// figure positions leave them out.
describe('inSupportedCurrencies (#820)', () => {
  it('keeps the rows in a currency Splitbook supports, in their order', () => {
    const rows = [
      { currency: 'INR' },
      { currency: 'DEM' },
      { currency: 'JPY' },
      { currency: 'FRF' },
    ];
    expect(inSupportedCurrencies(rows)).toEqual([{ currency: 'INR' }, { currency: 'JPY' }]);
  });
});
