import { describe, expect, it } from 'vitest';
import {
  MAX_EXTRA_CURRENCIES,
  extraCurrenciesProblem,
  groupCurrencies,
  isGroupCurrency,
  expenseCurrencyChoices,
  normaliseExtraCurrencies,
  startingExpenseCurrency,
  unlistedCurrencyFix,
} from './group-currencies';
import { amountReadAloud, wholeUnit } from './currency';
import { assertGroupCurrency } from './expense-validation';

// Lisbon & Tokyo, a fictional Trip: main currency INR, extra currencies EUR and JPY.
const trip = { defaultCurrency: 'INR', alternateCurrencies: ['EUR', 'JPY'] };

describe("a Group's extra currencies (#719)", () => {
  it('may be up to 4 supported codes, distinct and never the main currency', () => {
    expect(MAX_EXTRA_CURRENCIES).toBe(4);
    expect(extraCurrenciesProblem('INR', [])).toBeNull();
    expect(extraCurrenciesProblem('INR', ['EUR', 'JPY', 'USD', 'GBP'])).toBeNull();
    expect(extraCurrenciesProblem('INR', ['EUR', 'JPY', 'USD', 'GBP', 'AUD'])).toBe(
      'A Group can have at most 4 extra currencies.',
    );
    expect(extraCurrenciesProblem('INR', ['EUR', 'XYZ'])).toBe('XYZ isn’t a supported currency.');
    expect(extraCurrenciesProblem('INR', ['EUR', 'EUR'])).toBe('EUR is listed twice.');
    expect(extraCurrenciesProblem('INR', ['INR', 'EUR'])).toBe(
      'INR is the main currency, so it can’t also be an extra currency.',
    );
  });

  it('read from an older Group drop unsupported codes, repeats and the main currency, then keep 4', () => {
    expect(normaliseExtraCurrencies('INR', ['EUR', 'XYZ', 'EUR', 'INR', 'JPY'])).toEqual([
      'EUR',
      'JPY',
    ]);
    expect(normaliseExtraCurrencies('INR', ['EUR', 'JPY', 'USD', 'GBP', 'AUD', 'CAD'])).toEqual([
      'EUR',
      'JPY',
      'USD',
      'GBP',
    ]);
    expect(normaliseExtraCurrencies('INR', undefined)).toEqual([]);
    expect(normaliseExtraCurrencies('INR', [42, null, 'eur', 'SGD'])).toEqual(['SGD']);
  });
});

describe("the Group's currency rule (#719)", () => {
  it('lists the main currency first, then the extra currencies', () => {
    expect(groupCurrencies(trip)).toEqual(['INR', 'EUR', 'JPY']);
    expect(groupCurrencies({ defaultCurrency: 'INR' })).toEqual(['INR']);
    expect(
      groupCurrencies({ defaultCurrency: 'INR', alternateCurrencies: ['INR', 'EUR', 'EUR'] }),
    ).toEqual(['INR', 'EUR']);
  });

  it('accepts the main currency or any extra currency, and nothing else', () => {
    expect(isGroupCurrency(trip, 'INR')).toBe(true);
    expect(isGroupCurrency(trip, 'JPY')).toBe(true);
    expect(isGroupCurrency(trip, 'USD')).toBe(false);
    expect(() => assertGroupCurrency(trip, 'EUR')).not.toThrow();
    expect(() => assertGroupCurrency(trip, 'USD')).toThrow('CURRENCY_MISMATCH');
    expect(() => assertGroupCurrency({ defaultCurrency: 'INR' }, 'EUR')).toThrow(
      'CURRENCY_MISMATCH',
    );
  });
});

describe('the currency a new Expense starts in (#719)', () => {
  it('is the member’s latest Expense’s here, while the Group still lists it', () => {
    expect(startingExpenseCurrency(trip, 'JPY')).toBe('JPY');
    expect(startingExpenseCurrency(trip, 'INR')).toBe('INR');
  });

  it('is the main currency with no latest Expense, or one in a currency no longer listed', () => {
    expect(startingExpenseCurrency(trip, null)).toBe('INR');
    expect(startingExpenseCurrency(trip, undefined)).toBe('INR');
    expect(startingExpenseCurrency(trip, 'USD')).toBe('INR');
  });
});

describe('the currencies an Expense can be in, as its form offers them (#719)', () => {
  it('puts the member’s latest Expense’s first, then the main currency, then the others', () => {
    expect(expenseCurrencyChoices(trip, 'JPY', 'JPY')).toEqual([
      { code: 'JPY', name: 'Japanese Yen', symbol: '¥', note: 'Your latest Expense here' },
      { code: 'INR', name: 'Indian Rupee', symbol: '₹', note: 'Main currency' },
      { code: 'EUR', name: 'Euro', symbol: '€', note: null },
    ]);
    expect(expenseCurrencyChoices(trip, null, 'INR').map((choice) => choice.code)).toEqual([
      'INR',
      'EUR',
      'JPY',
    ]);
  });

  it('keeps an edited Expense’s own currency when the Group no longer lists it', () => {
    expect(expenseCurrencyChoices(trip, 'EUR', 'USD')).toEqual([
      { code: 'EUR', name: 'Euro', symbol: '€', note: 'Your latest Expense here' },
      { code: 'INR', name: 'Indian Rupee', symbol: '₹', note: 'Main currency' },
      { code: 'JPY', name: 'Japanese Yen', symbol: '¥', note: null },
      { code: 'USD', name: 'US Dollar', symbol: '$', note: 'This Expense’s currency' },
    ]);
  });
});

describe('an amount read aloud with its currency (#719)', () => {
  it('says the currency with the amount, or alone before one is typed', () => {
    expect(amountReadAloud('2,500', 'JPY')).toBe('2,500 Japanese yen');
    expect(amountReadAloud('42.5', 'EUR')).toBe('42.50 euros');
    expect(amountReadAloud('1', 'INR')).toBe('1.00 Indian rupees');
    expect(amountReadAloud('', 'JPY')).toBe('Japanese yen');
    expect(amountReadAloud('2,500.50', 'JPY')).toBe('2,500.50 Japanese yen');
    expect(amountReadAloud('12345678901234567890.1', 'EUR')).toBe(
      '12,345,678,901,234,567,890.10 euros',
    );
    expect(amountReadAloud('.5', 'EUR')).toBe('0.50 euros');
    expect(amountReadAloud('2,5,0', 'EUR')).toBe('250.00 euros');
    expect(amountReadAloud('abc', 'JPY')).toBe('abc Japanese yen');
  });

  it('names the whole unit of a currency without a smaller one', () => {
    expect(wholeUnit('JPY')).toBe('yen');
    expect(wholeUnit('KRW')).toBe('won');
    expect(wholeUnit('INR')).toBeNull();
  });
});

describe('unlistedCurrencyFix: an Expense in a currency the Group doesn’t list (#732)', () => {
  const lisbon = { ...trip, name: 'Lisbon & Tokyo' };

  it('says what is wrong and offers both fixes, in the boards’ words', () => {
    expect(unlistedCurrencyFix(lisbon, 'CHF', 86)).toEqual({
      currency: 'CHF',
      notListed: 'CHF isn’t one of Lisbon & Tokyo’s currencies.',
      ask: 'Add it, or change this Expense’s currency.',
      add: 'Add CHF to Lisbon & Tokyo',
      choices: ['INR', 'EUR', 'JPY'],
      adding: 'Adding lets everyone use CHF, the 3rd of 4 extra currencies.',
      changing: 'Changing keeps 86.00 and changes only the currency; nothing is converted.',
    });
  });

  it('offers only a change once the Group lists 4 extra currencies', () => {
    const full = { ...lisbon, alternateCurrencies: ['EUR', 'JPY', 'USD', 'GBP'] };
    expect(unlistedCurrencyFix(full, 'CHF', 86)).toMatchObject({
      ask: 'Change this Expense’s currency.',
      add: null,
      choices: ['INR', 'EUR', 'JPY', 'USD', 'GBP'],
      adding:
        'Lisbon & Tokyo already has 4 extra currencies, the most a Group can have. An admin can remove one nothing uses in Group settings.',
    });
  });

  it('keeps the amount as entered, with every decimal it has', () => {
    expect(unlistedCurrencyFix(lisbon, 'CHF', 1234.5).changing).toBe(
      'Changing keeps 1,234.50 and changes only the currency; nothing is converted.',
    );
    expect(unlistedCurrencyFix(lisbon, 'CHF', 10.555).changing).toBe(
      'Changing keeps 10.555 and changes only the currency; nothing is converted.',
    );
  });

  it('says nothing is converted without an amount to keep', () => {
    expect(unlistedCurrencyFix(lisbon, 'CHF', undefined).changing).toBe(
      'Changing changes only the currency; nothing is converted.',
    );
  });
});
