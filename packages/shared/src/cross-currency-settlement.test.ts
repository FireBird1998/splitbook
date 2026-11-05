import { describe, expect, it } from 'vitest';
import {
  calculateCrossCurrencySettlement,
  decimalMoney,
  minorMoney,
  formatCrossCurrencySettlement,
} from './cross-currency-settlement';

const currencies = { currency: 'EUR', paidCurrency: 'INR' };
describe('cross-currency Settlement maths (#727)', () => {
  it('gives the third value from each pair, using the two amounts for the applied rate', () => {
    const expected = { amountClearedMinor: 2000, amountPaidMinor: 185000, appliedRate: '92.5' };
    expect(
      calculateCrossCurrencySettlement({ ...currencies, amountClearedMinor: 2000, rate: '92.50' }),
    ).toEqual(expected);
    expect(
      calculateCrossCurrencySettlement({ ...currencies, amountPaidMinor: 185000, rate: '92.5' }),
    ).toEqual(expected);
    expect(
      calculateCrossCurrencySettlement({
        ...currencies,
        amountClearedMinor: 2000,
        amountPaidMinor: 185000,
      }),
    ).toEqual(expected);
  });
  it('rounds half up in the paid currency and derives the displayed rate from the rounded amounts', () => {
    expect(
      calculateCrossCurrencySettlement({ ...currencies, amountClearedMinor: 1, rate: '1.5' }),
    ).toEqual({ amountClearedMinor: 1, amountPaidMinor: 2, appliedRate: '2' });
    expect(
      calculateCrossCurrencySettlement({
        ...currencies,
        amountClearedMinor: 1,
        rate: '1.499999999999999999',
      }),
    ).toEqual({ amountClearedMinor: 1, amountPaidMinor: 1, appliedRate: '1' });
    expect(
      calculateCrossCurrencySettlement({ ...currencies, amountClearedMinor: 6, amountPaidMinor: 1 })
        .appliedRate,
    ).toBe('0.166666666666666667');
  });
  it.each(['JPY', 'KRW'])(
    'pays whole %s units, with half-up rounding and differing currency scales',
    (paidCurrency) => {
      expect(
        calculateCrossCurrencySettlement({
          currency: 'EUR',
          paidCurrency,
          amountClearedMinor: 150,
          rate: '101',
        }),
      ).toEqual({
        amountClearedMinor: 150,
        amountPaidMinor: 152,
        appliedRate: '101.333333333333333333',
      });
      expect(
        calculateCrossCurrencySettlement({
          currency: paidCurrency,
          paidCurrency: 'EUR',
          amountClearedMinor: 152,
          amountPaidMinor: 150,
        }).appliedRate,
      ).toBe('0.009868421052631579');
    },
  );
  it('clears a partial amount, rounding an inferred cleared amount half up to its own minor unit', () => {
    expect(
      calculateCrossCurrencySettlement({ ...currencies, amountClearedMinor: 750, rate: '92.5' }),
    ).toEqual({ amountClearedMinor: 750, amountPaidMinor: 69375, appliedRate: '92.5' });
    expect(
      calculateCrossCurrencySettlement({ ...currencies, amountPaidMinor: 3, rate: '2' }),
    ).toEqual({ amountClearedMinor: 2, amountPaidMinor: 3, appliedRate: '1.5' });
  });
  it('keeps integer arithmetic exact above the floating multiplication range', () => {
    expect(
      calculateCrossCurrencySettlement({
        ...currencies,
        amountClearedMinor: 9007199254740991,
        rate: '0.5',
      }).amountPaidMinor,
    ).toBe(4503599627370496);
  });
  it('refuses nonpositive amounts, unrepresentable results, invalid rates and the same currency', () => {
    for (const rate of ['0', '-1', 'NaN', '1e2', '0.0000000000000000001'])
      expect(() =>
        calculateCrossCurrencySettlement({ ...currencies, amountClearedMinor: 100, rate }),
      ).toThrow();
    for (const amountClearedMinor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        calculateCrossCurrencySettlement({ ...currencies, amountClearedMinor, rate: '1' }),
      ).toThrow();
    expect(() =>
      calculateCrossCurrencySettlement({ ...currencies, amountClearedMinor: 1, rate: '0.001' }),
    ).toThrow();
    expect(() =>
      calculateCrossCurrencySettlement({
        ...currencies,
        amountClearedMinor: Number.MAX_SAFE_INTEGER,
        rate: '2',
      }),
    ).toThrow();
    expect(() =>
      calculateCrossCurrencySettlement({
        currency: 'EUR',
        paidCurrency: 'EUR',
        amountClearedMinor: 100,
        rate: '1',
      }),
    ).toThrow();
  });
});

describe('cross-currency Settlement wording (#727)', () => {
  const record = {
    paidBy: 'sam',
    paidByName: 'Sam',
    paidTo: 'alex',
    paidToName: 'Alex',
    currency: 'EUR',
    amountMinor: 2000,
    paidCurrency: 'INR',
    amountPaidMinor: 185000,
    appliedRate: '92.5',
    rateKind: 'custom' as const,
    suggestedRate: '92.1',
    rateSource: 'frankfurter' as const,
    rateAsOf: '2026-10-21',
    rateFetchedAt: '2026-10-21T00:15:00Z',
  };
  // #870, the Designer's wording: the suggested rate is said once when it's the one used.
  it('says the suggestion once when the rate used is the suggested one (#870)', () => {
    const atSuggestion = {
      ...record,
      amountPaidMinor: 184200,
      appliedRate: '92.1',
      rateKind: 'suggested' as const,
    };
    expect(formatCrossCurrencySettlement(atSuggestion)).toBe(
      'Sam paid Alex ₹1,842.00 to clear €20.00 at the suggested ₹92.10 per\u00a0€ (21\u00a0Oct)',
    );
    expect(
      formatCrossCurrencySettlement({ ...atSuggestion, rateSource: 'exchange-rate-api' }),
    ).toBe(
      'Sam paid Alex ₹1,842.00 to clear €20.00 at the suggested ₹92.10 per\u00a0€ (21\u00a0Oct)\u00a0· Rates By Exchange Rate API',
    );
    // An older record keeps a rate worked back from ₹5,049.84: rounding explains it.
    expect(
      formatCrossCurrencySettlement({
        ...atSuggestion,
        amountMinor: 5483,
        amountPaidMinor: 504984,
        appliedRate: '92.099945285427685574',
      }),
    ).toBe(
      'Sam paid Alex ₹5,049.84 to clear €54.83 at the suggested ₹92.10 per\u00a0€ (21\u00a0Oct)',
    );
  });

  it('formats both stored amounts, the applied rate and the dated suggestion', () => {
    expect(formatCrossCurrencySettlement(record)).toBe(
      'Sam paid Alex ₹1,850.00 to clear €20.00 at ₹92.50 per\u00a0€, suggested ₹92.10 (21\u00a0Oct)',
    );
  });
  it.each([
    ['sam', 'You paid Alex'],
    ['alex', 'Sam paid you'],
    ['someone-else', 'Sam paid Alex'],
  ])('names both people with viewer %s as You', (viewerId, people) => {
    expect(formatCrossCurrencySettlement(record, viewerId)).toBe(
      `${people} ₹1,850.00 to clear €20.00 at ₹92.50 per\u00a0€, suggested ₹92.10 (21\u00a0Oct)`,
    );
  });
  it('falls back to Paid to when the payer name is missing, as Activity detail does', () => {
    expect(formatCrossCurrencySettlement({ ...record, paidByName: '  ' })).toMatch(
      /^Paid to Alex ₹/,
    );
    expect(formatCrossCurrencySettlement({ ...record, paidByName: undefined }, 'alex')).toMatch(
      /^Paid to you ₹/,
    );
    expect(formatCrossCurrencySettlement({ ...record, paidToName: undefined })).toMatch(
      /^Sam paid ₹/,
    );
  });
  it('dates the suggestion by rateAsOf even when it was fetched the next day', () => {
    expect(formatCrossCurrencySettlement({ ...record, rateAsOf: '2026-10-20' })).toContain(
      'suggested ₹92.10 (20\u00a0Oct)',
    );
  });
  it('names an entered rate and retains required fallback attribution', () => {
    expect(
      formatCrossCurrencySettlement({
        paidBy: 'sam',
        paidByName: 'Sam',
        paidTo: 'alex',
        paidToName: 'Alex',
        currency: 'EUR',
        amountMinor: 2000,
        paidCurrency: 'JPY',
        amountPaidMinor: 3150,
        appliedRate: '157.5',
        rateKind: 'entered',
      }),
    ).toBe('Sam paid Alex ¥3,150 to clear €20.00 at ¥157.50 per\u00a0€; no rate suggested');
    expect(formatCrossCurrencySettlement({ ...record, rateSource: 'exchange-rate-api' })).toBe(
      'Sam paid Alex ₹1,850.00 to clear €20.00 at ₹92.50 per\u00a0€, suggested ₹92.10 (21\u00a0Oct)\u00a0· Rates By Exchange Rate API',
    );
    expect(formatCrossCurrencySettlement({ ...record, rateSource: 'mixed' })).toContain(
      'Rates By Exchange Rate API',
    );
  });
  // #884: a currency with no symbol of its own in English is named by its code, as its amounts.
  it('names a currency without a symbol by its code, as its amounts are (#884)', () => {
    const zloty = {
      paidBy: 'sam',
      paidByName: 'Sam',
      paidTo: 'alex',
      paidToName: 'Alex',
      currency: 'PLN',
      amountMinor: 6000,
      paidCurrency: 'INR',
      amountPaidMinor: 124958,
      appliedRate: '20.826267',
      rateKind: 'entered' as const,
    };
    expect(formatCrossCurrencySettlement(zloty)).toBe(
      'Sam paid Alex ₹1,249.58 to clear PLN\u00a060.00 at ₹20.826267 per\u00a0PLN; no rate suggested',
    );
    expect(
      formatCrossCurrencySettlement({
        ...zloty,
        currency: 'EUR',
        amountMinor: 2000,
        paidCurrency: 'CZK',
        amountPaidMinor: 50000,
        appliedRate: '25',
      }),
    ).toBe(
      'Sam paid Alex CZK\u00a0500.00 to clear €20.00 at CZK\u00a025.00 per\u00a0€; no rate suggested',
    );
  });
  it('formats stored decimal rates and large minor amounts without floating-point rounding', () => {
    expect(
      formatCrossCurrencySettlement({
        paidBy: 'sam',
        paidByName: 'Sam',
        paidTo: 'alex',
        paidToName: 'Alex',
        currency: 'EUR',
        amountMinor: 600,
        paidCurrency: 'INR',
        amountPaidMinor: 100,
        appliedRate: '0.166666666666666667',
        rateKind: 'entered',
      }),
    ).toContain('at ₹0.166667 per\u00a0€');
    expect(
      formatCrossCurrencySettlement({ ...record, amountPaidMinor: 9007199254740991 }),
    ).toContain('₹90,071,992,547,409.91');
  });
});

describe('shared cross-currency money text', () => {
  it('exports exact decimal and minor-unit formatting for the web sheet', () => {
    expect(decimalMoney('92.5', 'INR')).toBe('₹92.50');
    expect(decimalMoney('0.166666666666666667', 'INR')).toBe('₹0.166666666666666667');
    expect(decimalMoney('0', 'EUR')).toBe('€0.00');
    expect(minorMoney(185000, 'INR')).toBe('₹1,850.00');
    expect(minorMoney(3150, 'JPY')).toBe('¥3,150');
    expect(minorMoney(9007199254740991, 'INR')).toBe('₹90,071,992,547,409.91');
  });

  // Hermes's Intl refuses a BigInt (#863): the same text, from a number or by hand.
  it('formats a large amount and a long rate as before, on Hermes too', () => {
    expect(minorMoney(9007199254740991, 'JPY')).toBe('¥9,007,199,254,740,991');
    expect(minorMoney(123456789, 'KRW')).toBe('₩123,456,789');
    expect(decimalMoney('1234567.89', 'INR')).toBe('₹1,234,567.89');
    expect(decimalMoney('92.1', 'USD')).toBe('$92.10');
    // Whole parts past Number.MAX_SAFE_INTEGER, such as an 18-digit rate.
    expect(decimalMoney('123456789012345678.123456789012345678', 'INR')).toBe(
      '₹123,456,789,012,345,678.123456789012345678',
    );
    expect(decimalMoney('9007199254740993.5', 'EUR')).toBe('€9,007,199,254,740,993.50');
    expect(decimalMoney('012345678901234567.5', 'INR')).toBe('₹12,345,678,901,234,567.50');
    expect(decimalMoney('123456789012345678', 'JPY')).toBe('¥123,456,789,012,345,678');
    // A code Splitbook doesn't list keeps Intl's own form.
    expect(decimalMoney('5', 'XTS')).toBe('XTS\u00a05.00');
    expect(decimalMoney('12345678901234567.25', 'XTS')).toBe('XTS\u00a012,345,678,901,234,567.25');
  });
});
