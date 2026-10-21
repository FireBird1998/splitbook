import { describe, expect, it } from 'vitest';
import {
  balanceCurrencies,
  hasMixedCurrencies,
  openingBalanceCurrency,
} from './balance-currencies';

const LISBON_AND_TOKYO = { defaultCurrency: 'INR', alternateCurrencies: ['EUR', 'JPY'] };

describe('mixed currencies (#724)', () => {
  it('means more than one currency present, whatever the main currency is', () => {
    expect(hasMixedCurrencies([])).toBe(false);
    expect(hasMixedCurrencies(['INR'])).toBe(false);
    // Euros alone in a rupee Group: one currency present, so not mixed.
    expect(hasMixedCurrencies(['EUR'])).toBe(false);
    expect(hasMixedCurrencies(['INR', 'INR'])).toBe(false);
    expect(hasMixedCurrencies(['INR', 'EUR'])).toBe(true);
  });
});

describe('the currencies Balances switches between (#724)', () => {
  it('lists the main currency, then the Group’s extra currencies in order, then any other its money is in', () => {
    expect(
      balanceCurrencies({ defaultCurrency: 'INR', alternateCurrencies: ['JPY', 'EUR'] }, [
        'EUR',
        'USD',
        'INR',
        'JPY',
        'AUD',
      ]),
    ).toEqual(['INR', 'JPY', 'EUR', 'AUD', 'USD']);
  });

  it('always offers the main currency, and an extra currency only once money is in it', () => {
    expect(balanceCurrencies(LISBON_AND_TOKYO, ['EUR'])).toEqual(['INR', 'EUR']);
    expect(balanceCurrencies(LISBON_AND_TOKYO, ['INR'])).toEqual(['INR']);
    expect(balanceCurrencies(LISBON_AND_TOKYO, [])).toEqual(['INR']);
  });
});

describe('the currency Balances opens on (#724)', () => {
  const tabs = ['INR', 'EUR', 'JPY'];

  it('opens on the main currency while the member owes or is owed in it', () => {
    expect(openingBalanceCurrency(tabs, { INR: -1480, EUR: -20, JPY: 8400 })).toBe('INR');
    expect(openingBalanceCurrency(tabs, { INR: 0.5, EUR: -20 })).toBe('INR');
  });

  it('opens on the first currency the member isn’t settled in, once settled in the main one', () => {
    expect(openingBalanceCurrency(tabs, { INR: 0, EUR: 0, JPY: 8400 })).toBe('JPY');
    expect(openingBalanceCurrency(tabs, { INR: 0, EUR: -20, JPY: 8400 })).toBe('EUR');
    // A currency with no position for the member counts as settled.
    expect(openingBalanceCurrency(tabs, { JPY: -1 })).toBe('JPY');
  });

  it('opens on the main currency when the member is settled up in every one', () => {
    expect(openingBalanceCurrency(tabs, { INR: 0, EUR: 0, JPY: 0 })).toBe('INR');
    expect(openingBalanceCurrency(tabs, {})).toBe('INR');
  });
});
