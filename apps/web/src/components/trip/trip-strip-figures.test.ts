import { describe, expect, it } from 'vitest';
import { tripStripFigures } from './trip-strip-figures';

/* The Trip strip's figures for a Trip in several currencies (#729). */

const ALEX = 'a00000000000000000000001';
const LISBON_AND_TOKYO = { defaultCurrency: 'INR', alternateCurrencies: ['EUR', 'JPY'] };
/** All of it spent in yen, as the #729 note's Trip was: one Expense of ¥2,500. */
const ALL_YEN = {
  currency: 'JPY',
  currencies: [
    { currency: 'INR', expenseCount: 0, spentMinor: 0 },
    { currency: 'JPY', expenseCount: 1, spentMinor: 2500 },
  ],
};
const balances = {
  balances: [{ user: { _id: ALEX }, balance: 0 }],
  byCurrency: [
    { currency: 'INR', balances: [{ user: { _id: ALEX }, balance: 0 }] },
    { currency: 'JPY', balances: [{ user: { _id: ALEX }, balance: -1250 }] },
  ],
};

describe('the Trip strip by currency (#729)', () => {
  it('lists the Group’s currencies, main first', () => {
    expect(
      tripStripFigures({ group: LISBON_AND_TOKYO, userId: ALEX, summary: ALL_YEN }).currencies,
    ).toEqual(['INR', 'EUR', 'JPY']);
  });

  it('shows the total and balance in the currency the trip opened on, never ₹0.00 for a trip spent in yen', () => {
    expect(
      tripStripFigures({ group: LISBON_AND_TOKYO, userId: ALEX, summary: ALL_YEN, balances }),
    ).toMatchObject({ currency: 'JPY', total: 2500, balance: -1250 });
  });

  it('follows the currency chosen on the switch', () => {
    expect(
      tripStripFigures({
        group: LISBON_AND_TOKYO,
        userId: ALEX,
        summary: ALL_YEN,
        balances,
        chosen: 'INR',
      }),
    ).toMatchObject({ currency: 'INR', total: 0, balance: 0 });
  });

  it('keeps to the main currency, with no total yet, while the trip summary loads', () => {
    expect(tripStripFigures({ group: LISBON_AND_TOKYO, userId: ALEX })).toMatchObject({
      currency: 'INR',
      total: null,
      balance: null,
    });
  });
});
