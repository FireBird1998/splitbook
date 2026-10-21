import { describe, expect, it } from 'vitest';
import {
  addableCurrencies,
  alreadyListedNote,
  currencyUseRows,
  extraCurrencyChange,
  extraCurrencyChangeWords,
  extraCurrencyRow,
  groupCurrencySettingsSchema,
  type ExtraCurrencySetting,
  type ExtraCurrencyUse,
} from './group-currency-settings';

// Lisbon & Tokyo, a fictional Trip: Alex is its admin, Sam and Priya added its extra currencies.
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const now = new Date('2026-10-21T12:00:00.000Z');

const unused: ExtraCurrencyUse = {
  expenses: { count: 0, items: [] },
  settlements: 0,
  toReview: { yours: 0, others: 0 },
};
const use = (change: Partial<ExtraCurrencyUse>): ExtraCurrencyUse => ({ ...unused, ...change });
const expenses = (count: number, descriptions: string[] = []) => ({
  count,
  items: descriptions.map((description, index) => ({
    _id: `${index}`.padStart(24, 'e'),
    description,
  })),
});
const addedBy = (id: string, name: string, at: string): ExtraCurrencySetting['added'] => ({
  by: { _id: id, name },
  at,
});

describe('an extra currency as its settings row shows it (#721)', () => {
  const row = (
    code: string,
    change: Partial<ExtraCurrencyUse>,
    added: ExtraCurrencySetting['added'] = null,
  ) => extraCurrencyRow({ code, use: use(change), added }, { viewerId: ALEX, now });

  it('counts what uses it and names who added it, and when', () => {
    expect(
      row(
        'EUR',
        { expenses: expenses(11), settlements: 1 },
        addedBy(SAM, 'Sam', '2026-10-01T12:00:00.000Z'),
      ),
    ).toEqual({ inUse: true, line: '11 Expenses · 1 Settlement · added by Sam, 1 Oct' });
    expect(
      row('JPY', { expenses: expenses(24) }, addedBy(SAM, 'Sam', '2026-10-05T12:00:00.000Z')),
    ).toEqual({ inUse: true, line: '24 Expenses · whole amounts only · added by Sam, 5 Oct' });
    expect(row('GBP', {}, addedBy(PRIYA, 'Priya', '2026-10-02T12:00:00.000Z'))).toEqual({
      inUse: false,
      line: 'Nothing uses it · added by Priya, 2 Oct',
    });
  });

  it('says one in the singular, and counts every To review item, yours or not', () => {
    expect(
      row('EUR', { expenses: expenses(1), settlements: 2, toReview: { yours: 1, others: 2 } }),
    ).toEqual({ inUse: true, line: '1 Expense · 2 Settlements · 3 items in To review' });
    expect(row('EUR', { toReview: { yours: 0, others: 1 } })).toEqual({
      inUse: true,
      line: '1 item in To review',
    });
    expect(row('KRW', {})).toEqual({ inUse: false, line: 'Nothing uses it · whole amounts only' });
  });

  it('calls the viewer you, and gives the year of an earlier one', () => {
    expect(row('GBP', {}, addedBy(ALEX, 'Alex', '2026-10-02T12:00:00.000Z')).line).toBe(
      'Nothing uses it · added by you, 2 Oct',
    );
    expect(row('GBP', {}, addedBy(SAM, 'Sam', '2025-12-30T12:00:00.000Z')).line).toBe(
      'Nothing uses it · added by Sam, 30 Dec 2025',
    );
  });
});

describe('what still uses a currency, as the refused removal lists it (#721)', () => {
  it('names the first Expenses and counts the rest', () => {
    expect(
      currencyUseRows(
        'JPY',
        use({
          expenses: expenses(24, ['Ramen at Ichiran', 'Taxi to Haneda', 'Shinkansen']),
          toReview: { yours: 0, others: 2 },
        }),
      ),
    ).toEqual([
      {
        kind: 'expenses',
        title: '24 Expenses',
        detail: 'Ramen at Ichiran, Taxi to Haneda and 22 more',
      },
      {
        kind: 'others',
        title: '2 items in members’ To review',
        detail: 'Only their owners can see them. They need to save, change or delete them.',
      },
    ]);
  });

  it('lists one or two Expenses whole, and says what the viewer and the Settlements need', () => {
    expect(
      currencyUseRows(
        'EUR',
        use({
          expenses: expenses(1, ['Pastéis de nata']),
          settlements: 1,
          toReview: { yours: 1, others: 1 },
        }),
      ),
    ).toEqual([
      { kind: 'expenses', title: '1 Expense', detail: 'Pastéis de nata' },
      {
        kind: 'settlements',
        title: '1 Settlement',
        detail: 'A recorded payment can’t be changed or deleted, so EUR stays on the list.',
      },
      {
        kind: 'yours',
        title: '1 item in your To review',
        detail: 'Save it, change its currency or delete it in To review.',
      },
      {
        kind: 'others',
        title: '1 item in members’ To review',
        detail: 'Only their owners can see them. They need to save, change or delete them.',
      },
    ]);
    expect(
      currencyUseRows(
        'EUR',
        use({
          expenses: expenses(2, ['Tram 28', 'Fado night']),
          toReview: { yours: 2, others: 0 },
        }),
      ),
    ).toEqual([
      { kind: 'expenses', title: '2 Expenses', detail: 'Tram 28 and Fado night' },
      {
        kind: 'yours',
        title: '2 items in your To review',
        detail: 'Save them, change their currency or delete them in To review.',
      },
    ]);
    expect(currencyUseRows('EUR', use({ settlements: 3 }))).toEqual([
      {
        kind: 'settlements',
        title: '3 Settlements',
        detail: 'A recorded payment can’t be changed or deleted, so EUR stays on the list.',
      },
    ]);
    expect(currencyUseRows('GBP', unused)).toEqual([]);
  });
});

describe('a currency a member can add (#721)', () => {
  const listed = ['INR', 'EUR', 'JPY', 'GBP'];

  it('is any supported currency not already listed, by code, found by code or name', () => {
    const all = addableCurrencies(listed, '');
    expect(all).toHaveLength(26);
    expect(all.slice(0, 5)).toEqual([
      { code: 'AED', name: 'UAE Dirham' },
      { code: 'AUD', name: 'Australian Dollar' },
      { code: 'BRL', name: 'Brazilian Real' },
      { code: 'CAD', name: 'Canadian Dollar' },
      { code: 'CHF', name: 'Swiss Franc' },
    ]);
    expect(addableCurrencies(listed, ' franc ')).toEqual([{ code: 'CHF', name: 'Swiss Franc' }]);
    expect(addableCurrencies(listed, 'sg').map(({ code }) => code)).toEqual(['SGD']);
    expect(addableCurrencies(listed, 'eur')).toEqual([]);
  });

  it('says which listed currencies the search leaves out', () => {
    expect(alreadyListedNote(listed)).toBe(
      'INR, EUR, JPY and GBP are already on the list, so they aren’t shown. Codes outside the 30 Splitbook supports can’t be added.',
    );
    expect(alreadyListedNote(['INR'])).toBe(
      'INR is already on the list, so it isn’t shown. Codes outside the 30 Splitbook supports can’t be added.',
    );
  });
});

describe('a change to the extra currencies, as Activity names it (#721)', () => {
  const change = (old: unknown, next: unknown) =>
    extraCurrencyChange({ alternateCurrencies: { old, new: next } });

  it('finds which currencies were added and removed', () => {
    expect(change(['EUR'], ['EUR', 'CHF'])).toEqual({ added: ['CHF'], removed: [] });
    expect(change(['EUR', 'GBP'], ['EUR'])).toEqual({ added: [], removed: ['GBP'] });
    expect(change(['EUR'], ['JPY', 'SGD'])).toEqual({ added: ['JPY', 'SGD'], removed: ['EUR'] });
    expect(change(['EUR'], ['EUR'])).toBeNull();
    expect(change(null, ['EUR'])).toEqual({ added: ['EUR'], removed: [] });
    expect(extraCurrencyChange({ name: { old: 'a', new: 'b' } })).toBeNull();
    expect(extraCurrencyChange(null)).toBeNull();
  });

  it('says it in words', () => {
    expect(extraCurrencyChangeWords({ added: ['CHF'], removed: [] })).toBe(
      'added the extra currency CHF',
    );
    expect(extraCurrencyChangeWords({ added: ['JPY', 'SGD', 'THB'], removed: [] })).toBe(
      'added the extra currencies JPY, SGD and THB',
    );
    expect(extraCurrencyChangeWords({ added: [], removed: ['GBP'] })).toBe(
      'removed the extra currency GBP',
    );
    expect(extraCurrencyChangeWords({ added: ['JPY'], removed: ['EUR'] })).toBe(
      'changed the extra currencies',
    );
  });
});

describe('the Group currencies read (#721)', () => {
  it('parses what the settings section shows', () => {
    const read = {
      mainCurrency: { code: 'INR', locked: true },
      extraCurrencies: [
        {
          code: 'EUR',
          use: { ...unused, expenses: expenses(1, ['Tram 28']) },
          added: addedBy(SAM, 'Sam', '2026-10-01T12:00:00.000Z'),
        },
        { code: 'GBP', use: unused, added: null },
      ],
    };
    expect(groupCurrencySettingsSchema.parse(read)).toEqual(read);
    expect(() =>
      groupCurrencySettingsSchema.parse({ ...read, mainCurrency: { code: 'XYZ', locked: false } }),
    ).toThrow();
  });
});
