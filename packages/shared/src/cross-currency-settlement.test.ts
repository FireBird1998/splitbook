import { describe, expect, it } from 'vitest';
import {
  calculateCrossCurrencySettlement,
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
  it('formats both stored amounts, the applied rate and the dated suggestion', () => {
    expect(formatCrossCurrencySettlement(record)).toBe(
      'Sam paid Alex ₹1,850.00 to clear €20.00 at ₹92.50 per €, suggested ₹92.10 (21 Oct)',
    );
  });
  it.each([
    ['sam', 'You paid Alex'],
    ['alex', 'Sam paid you'],
    ['someone-else', 'Sam paid Alex'],
  ])('names both people with viewer %s as You', (viewerId, people) => {
    expect(formatCrossCurrencySettlement(record, viewerId)).toBe(
      `${people} ₹1,850.00 to clear €20.00 at ₹92.50 per €, suggested ₹92.10 (21 Oct)`,
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
      'suggested ₹92.10 (20 Oct)',
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
    ).toBe('Sam paid Alex ¥3,150 to clear €20.00 at ¥157.5 per €; no rate suggested');
    expect(formatCrossCurrencySettlement({ ...record, rateSource: 'exchange-rate-api' })).toBe(
      'Sam paid Alex ₹1,850.00 to clear €20.00 at ₹92.50 per €, suggested ₹92.10 (21 Oct) · Rates By Exchange Rate API',
    );
    expect(formatCrossCurrencySettlement({ ...record, rateSource: 'mixed' })).toContain(
      'Rates By Exchange Rate API',
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
    ).toContain('at ₹0.166666666666666667 per €');
    expect(
      formatCrossCurrencySettlement({ ...record, amountPaidMinor: 9007199254740991 }),
    ).toContain('₹90,071,992,547,409.91');
  });
});
