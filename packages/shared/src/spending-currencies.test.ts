import { describe, expect, it } from 'vitest';
import { openingSpendingCurrency, spendingCurrencies } from './spending-currencies';

const LISBON_AND_TOKYO = { defaultCurrency: 'INR', alternateCurrencies: ['EUR', 'JPY'] };
const spent = (currency: string, expenseCount: number, spentMinor: number) => ({
  currency,
  expenseCount,
  spentMinor,
});

describe('the currencies Insights and the Trip summary switch between (#729)', () => {
  it('lists the main currency, then the Group’s extra currencies in order, then any other spent in', () => {
    expect(
      spendingCurrencies({ defaultCurrency: 'INR', alternateCurrencies: ['JPY', 'EUR'] }, [
        spent('EUR', 11, 124_000),
        spent('USD', 1, 2_000),
        spent('INR', 3, 4_860_000),
        spent('JPY', 24, 186_000),
      ]),
    ).toEqual([
      spent('INR', 3, 4_860_000),
      spent('JPY', 24, 186_000),
      spent('EUR', 11, 124_000),
      spent('USD', 1, 2_000),
    ]);
  });

  it('always offers the main currency, and an extra currency only once something is spent in it', () => {
    expect(spendingCurrencies(LISBON_AND_TOKYO, [spent('JPY', 2, 5_000)])).toEqual([
      spent('INR', 0, 0),
      spent('JPY', 2, 5_000),
    ]);
    expect(spendingCurrencies(LISBON_AND_TOKYO, [])).toEqual([spent('INR', 0, 0)]);
  });
});

describe('the currency they open on (#729)', () => {
  it('opens on the currency with the most Expenses, never on the largest amount', () => {
    expect(
      openingSpendingCurrency(LISBON_AND_TOKYO, [
        spent('INR', 3, 4_860_000),
        spent('EUR', 11, 124_000),
        spent('JPY', 24, 186_000),
      ]),
    ).toBe('JPY');
  });

  it('gives a tie to the main currency', () => {
    expect(
      openingSpendingCurrency(LISBON_AND_TOKYO, [spent('INR', 3, 100), spent('JPY', 3, 9_000)]),
    ).toBe('INR');
  });

  it('gives a tie without the main currency to the first in the Group’s order', () => {
    expect(
      openingSpendingCurrency({ defaultCurrency: 'INR', alternateCurrencies: ['JPY', 'EUR'] }, [
        spent('INR', 1, 100),
        spent('EUR', 5, 500),
        spent('JPY', 5, 50),
      ]),
    ).toBe('JPY');
  });

  it('opens on the main currency when nothing was spent', () => {
    expect(openingSpendingCurrency(LISBON_AND_TOKYO, [])).toBe('INR');
  });
});
