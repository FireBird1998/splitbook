import { describe, expect, it, vi } from 'vitest';
import { decimalMoney } from './cross-currency-settlement';
import {
  amountReadAloud,
  currencyPrefix,
  formatCurrency,
  formatCurrencyAsEntered,
  inSupportedCurrencies,
  prefixBesideChip,
} from './currency';

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

// #868: a payment sheet's field said "zł" where its summary said "PLN 60.00".
describe('currencyPrefix (#868)', () => {
  it('is what formatCurrency prints before an amount: the code where it has no symbol', () => {
    expect(['PLN', 'CZK', 'CHF', 'EUR', 'JPY', 'INR'].map(currencyPrefix)).toEqual([
      'PLN',
      'CZK',
      'CHF',
      '€',
      '¥',
      '₹',
    ]);
    for (const code of ['PLN', 'CZK', 'EUR'])
      expect(formatCurrency(60, code).startsWith(currencyPrefix(code)), code).toBe(true);
  });
});

// #884: beside a chip that already says the code, the code isn't said twice.
describe('prefixBesideChip (#884)', () => {
  it('is formatCurrency’s prefix, or nothing where that is the code the chip shows', () => {
    expect(['PLN', 'CZK', 'CHF', 'EUR', 'JPY', 'INR', 'USD'].map(prefixBesideChip)).toEqual([
      '',
      '',
      '',
      '€',
      '¥',
      '₹',
      '$',
    ]);
  });
});

// #373: Android builds every amount's formatter on Hermes, where each `new Intl.NumberFormat`
// costs milliseconds. Returning to a Group after Save built 53 of them (100-235 ms of the
// render, measured on the emulator), so one formatter serves each currency and precision.
describe('one formatter per currency and precision (#373)', () => {
  const constructions = () => {
    const Original = Intl.NumberFormat;
    const made: unknown[][] = [];
    const counting = vi.spyOn(Intl, 'NumberFormat').mockImplementation(function (
      ...args: ConstructorParameters<typeof Intl.NumberFormat>
    ) {
      made.push(args);
      return new Original(...args);
    } as unknown as typeof Intl.NumberFormat);
    return { made, restore: () => counting.mockRestore() };
  };

  it('formats a list of amounts with one formatter per currency, as before', () => {
    const counted = constructions();
    try {
      const rows = Array.from({ length: 20 }, (_, i) => formatCurrency(i * 10.5, 'INR'));
      rows.push(formatCurrency(1060, 'JPY'), formatCurrency(5, 'JPY'));
      rows.push(currencyPrefix('PLN'), currencyPrefix('PLN'), prefixBesideChip('EUR'));
      rows.push(formatCurrencyAsEntered(10.555, 'INR'), formatCurrencyAsEntered(1.555, 'INR'));
      rows.push(amountReadAloud('2500', 'JPY'), amountReadAloud('12', 'JPY'));
      rows.push(decimalMoney('12.5', 'EUR'), decimalMoney('3.25', 'EUR'));
      expect(rows.slice(0, 3)).toEqual(['₹0.00', '₹10.50', '₹21.00']);
      expect(rows.slice(20)).toEqual([
        '¥1,060',
        '¥5',
        'PLN',
        'PLN',
        '€',
        '₹10.555',
        '₹1.555',
        '2,500 Japanese yen',
        '12 Japanese yen',
        '€12.50',
        '€3.25',
      ]);
      // INR, JPY, PLN, EUR's prefix, INR with 3 places, yen's name and EUR with 2 places.
      expect(counted.made.length).toBeLessThanOrEqual(7);
    } finally {
      counted.restore();
    }
  });

  it('still writes an unknown currency by its code', () => {
    expect(formatCurrency(12, 'XYZ1')).toBe('XYZ1 12.00');
    expect(formatCurrency(12, 'XYZ1')).toBe('XYZ1 12.00');
    expect(currencyPrefix('XYZ1')).toBe('XYZ1');
  });
});
