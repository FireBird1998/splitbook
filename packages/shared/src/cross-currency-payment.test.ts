import { describe, expect, it } from 'vitest';
import {
  crossCurrencyPaymentFields,
  crossCurrencyRateKind,
  editCrossCurrencyEntry,
  parseRateSuggestionResponse,
  paymentRecord,
  rateBadge,
  rateNote,
  readCrossCurrencyEntry,
  startCrossCurrencyEntry,
  type RateSuggestion,
} from './cross-currency-payment';
import { EXCHANGE_RATE_API_ATTRIBUTION } from './cross-currency-settlement';

/*
 * #727: the Record payment sheet's three linked fields for a Debt paid in another currency, and
 * its words about the rate, as the boards "Pay a euro Debt in rupees" and "Record payment ·
 * every state" show them. Alex pays Sam's €20.00 Debt in rupees; fictional figures throughout.
 */

const euroInRupees = { currency: 'EUR', paidCurrency: 'INR' };
/** Built from local time so the words read the same in every time zone the suite runs in. */
const local = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0);
const now = local(21, 10);

const frankfurter: RateSuggestion = {
  rate: '92.1',
  source: 'frankfurter',
  asOf: '2026-10-20',
  fetchedAt: local(21, 6).toISOString(),
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
};
const secondSource: RateSuggestion = {
  ...frankfurter,
  rate: '92.06',
  source: 'exchange-rate-api',
  asOf: '2026-10-21',
  attributionRequired: true,
  attribution: { ...EXCHANGE_RATE_API_ATTRIBUTION },
};
const fiveDaysOld: RateSuggestion = {
  ...frankfurter,
  rate: '91.4',
  asOf: '2026-10-16',
  ageDays: 5,
};

const fields = (entry: { cleared: string; rate: string; paid: string }) => [
  entry.cleared,
  entry.rate,
  entry.paid,
];

describe('the three linked fields: change any one and the others follow (#727)', () => {
  it('starts with the whole Debt and the suggested rate, so the amount paid follows', () => {
    const entry = startCrossCurrencyEntry(euroInRupees, '20.00', frankfurter);

    expect(fields(entry)).toEqual(['20.00', '92.10', '1842.00']);
    expect(readCrossCurrencyEntry(entry, euroInRupees)).toEqual({
      status: 'valid',
      amounts: { amountClearedMinor: 2000, amountPaidMinor: 184200, appliedRate: '92.1' },
    });
  });

  it('follows a new rate, a part of the Debt, or more than it, with the amount paid', () => {
    const start = startCrossCurrencyEntry(euroInRupees, '20.00', frankfurter);
    expect(fields(editCrossCurrencyEntry(start, euroInRupees, 'rate', '92.50'))).toEqual([
      '20.00',
      '92.50',
      '1850.00',
    ]);
    expect(fields(editCrossCurrencyEntry(start, euroInRupees, 'cleared', '10.00'))).toEqual([
      '10.00',
      '92.10',
      '921.00',
    ]);
    expect(fields(editCrossCurrencyEntry(start, euroInRupees, 'cleared', '25.00'))).toEqual([
      '25.00',
      '92.10',
      '2302.50',
    ]);
  });

  it('works the rate out from both amounts, and keeps the two the member set last', () => {
    const start = startCrossCurrencyEntry(euroInRupees, '20.00', frankfurter);
    // The amount paid and the amount cleared were set last: the rate follows them.
    const paid = editCrossCurrencyEntry(start, euroInRupees, 'paid', '1,850');
    expect(fields(paid)).toEqual(['20.00', '92.50', '1,850']);
    // Then the rate: the amount paid and the rate stay, so the amount cleared follows.
    const rate = editCrossCurrencyEntry(paid, euroInRupees, 'rate', '92.5');
    expect(fields(rate)).toEqual(['20.00', '92.5', '1,850']);
    expect(fields(editCrossCurrencyEntry(rate, euroInRupees, 'rate', '100'))).toEqual([
      '18.50',
      '100',
      '1,850',
    ]);
  });

  it('shows a worked-out rate to at most six places, never a long tail', () => {
    const start = startCrossCurrencyEntry(euroInRupees, '3.00', frankfurter);
    const entry = editCrossCurrencyEntry(start, euroInRupees, 'paid', '100.00');
    expect(entry.rate).toBe('33.333333');
    expect(readCrossCurrencyEntry(entry, euroInRupees)).toMatchObject({
      amounts: { appliedRate: '33.333333333333333333' },
    });
  });

  it('rounds the amount paid half up to its currency’s minor unit, and yen to whole yen', () => {
    const euroInYen = { currency: 'EUR', paidCurrency: 'JPY' };
    const start = startCrossCurrencyEntry(euroInYen, '20.01', null);
    expect(editCrossCurrencyEntry(start, euroInYen, 'rate', '162.55').paid).toBe('3253');
    const rupeesInWon = { currency: 'INR', paidCurrency: 'KRW' };
    expect(
      editCrossCurrencyEntry(
        startCrossCurrencyEntry(rupeesInWon, '100.00', null),
        rupeesInWon,
        'rate',
        '16.235',
      ).paid,
    ).toBe('1624');
  });

  it('waits for a second value with no suggestion, and clears a worked-out field it can’t work out', () => {
    const start = startCrossCurrencyEntry(euroInRupees, '20.00', null);
    expect(fields(start)).toEqual(['20.00', '', '']);
    expect(readCrossCurrencyEntry(start, euroInRupees)).toEqual({ status: 'incomplete' });
    const typed = editCrossCurrencyEntry(start, euroInRupees, 'rate', '92.5');
    expect(typed.paid).toBe('1850.00');
    expect(editCrossCurrencyEntry(typed, euroInRupees, 'rate', '').paid).toBe('');
    expect(editCrossCurrencyEntry(typed, euroInRupees, 'rate', 'abc').paid).toBe('');
  });

  it('says which field can’t be read, in that field’s words', () => {
    const start = startCrossCurrencyEntry(euroInRupees, '20.00', frankfurter);
    expect(
      readCrossCurrencyEntry(
        editCrossCurrencyEntry(start, euroInRupees, 'rate', '9,2'),
        euroInRupees,
      ),
    ).toEqual({ status: 'invalid', field: 'rate', message: 'Enter a rate like 92.10.' });
    expect(
      readCrossCurrencyEntry(
        editCrossCurrencyEntry(start, euroInRupees, 'rate', '0'),
        euroInRupees,
      ),
    ).toEqual({ status: 'invalid', field: 'rate', message: 'Enter a rate above 0.' });
    expect(
      readCrossCurrencyEntry(
        editCrossCurrencyEntry(start, euroInRupees, 'cleared', '20.001'),
        euroInRupees,
      ),
    ).toEqual({ status: 'invalid', field: 'cleared', message: 'Use at most 2 decimal places.' });
    const euroInYen = { currency: 'EUR', paidCurrency: 'JPY' };
    expect(
      readCrossCurrencyEntry(
        editCrossCurrencyEntry(
          startCrossCurrencyEntry(euroInYen, '20.00', null),
          euroInYen,
          'paid',
          '2500.5',
        ),
        euroInYen,
      ),
    ).toEqual({
      status: 'invalid',
      field: 'paid',
      message: 'Yen has no smaller unit. Enter a whole amount, like ¥2,500.',
    });
    // Amounts too small to pay anything are refused, not recorded as zero.
    expect(
      readCrossCurrencyEntry(
        editCrossCurrencyEntry(start, euroInRupees, 'rate', '0.0001'),
        euroInRupees,
      ),
    ).toEqual({
      status: 'invalid',
      field: 'rate',
      message: 'That rate pays less than ₹0.01. Check the rate.',
    });
  });
});

describe('the rate kind a payment records (#727)', () => {
  const read = (entry: ReturnType<typeof startCrossCurrencyEntry>) => {
    const reading = readCrossCurrencyEntry(entry, euroInRupees);
    if (reading.status !== 'valid') throw new Error(reading.status);
    return reading.amounts;
  };
  const start = startCrossCurrencyEntry(euroInRupees, '20.00', frankfurter);

  it('is suggested while the suggestion gives the amount paid, custom once it doesn’t', () => {
    expect(crossCurrencyRateKind(euroInRupees, read(start), frankfurter)).toBe('suggested');
    const part = editCrossCurrencyEntry(start, euroInRupees, 'cleared', '10.00');
    expect(crossCurrencyRateKind(euroInRupees, read(part), frankfurter)).toBe('suggested');
    const own = editCrossCurrencyEntry(start, euroInRupees, 'rate', '92.50');
    expect(crossCurrencyRateKind(euroInRupees, read(own), frankfurter)).toBe('custom');
    expect(crossCurrencyRateKind(euroInRupees, read(own), null)).toBe('entered');
  });

  it('sends the suggestion beside a suggested or custom rate, and nothing beside an entered one', () => {
    const own = editCrossCurrencyEntry(start, euroInRupees, 'rate', '92.50');
    expect(crossCurrencyPaymentFields(euroInRupees, read(own), frankfurter)).toEqual({
      amountPaidMinor: 185000,
      paidCurrency: 'INR',
      appliedRate: '92.5',
      rateKind: 'custom',
      suggestedRate: '92.1',
      rateSource: 'frankfurter',
      rateAsOf: '2026-10-20',
      rateFetchedAt: frankfurter.fetchedAt,
    });
    expect(crossCurrencyPaymentFields(euroInRupees, read(own), null)).toEqual({
      amountPaidMinor: 185000,
      paidCurrency: 'INR',
      appliedRate: '92.5',
      rateKind: 'entered',
    });
  });
});

describe('what the sheet says about the rate (#727)', () => {
  it('tags it: suggested, its age once old, the member’s own, or none', () => {
    expect(rateBadge('suggested', frankfurter)).toBe('Suggested');
    expect(rateBadge('suggested', fiveDaysOld)).toBe('5 days old');
    expect(rateBadge('custom', frankfurter)).toBe('Your rate');
    expect(rateBadge('custom', fiveDaysOld)).toBe('Your rate');
    expect(rateBadge('entered', null)).toBe('No suggestion');
  });

  it('names the source and when its rates are from, with the second source’s attribution', () => {
    expect(rateNote('suggested', frankfurter, 'INR', now)).toEqual({
      text: 'Frankfurter · rates of 20 Oct · fetched today 06:00',
      attribution: null,
      useSuggestion: null,
    });
    expect(rateNote('suggested', secondSource, 'INR', now)).toEqual({
      text: 'Rates of 21 Oct · fetched today 06:00',
      attribution: EXCHANGE_RATE_API_ATTRIBUTION,
      useSuggestion: null,
    });
    expect(rateNote('suggested', fiveDaysOld, 'INR', now)).toEqual({
      text: 'Frankfurter · rates of 16 Oct, 5 days old. Today’s rates aren’t in yet.',
      attribution: null,
      useSuggestion: null,
    });
    expect(
      rateNote('suggested', { ...frankfurter, fetchedAt: local(20, 18).toISOString() }, 'INR', now)
        .text,
    ).toBe('Frankfurter · rates of 20 Oct · fetched yesterday 18:00');
    expect(
      rateNote('suggested', { ...frankfurter, fetchedAt: local(18, 18).toISOString() }, 'INR', now)
        .text,
    ).toBe('Frankfurter · rates of 20 Oct · fetched 18 Oct 18:00');
  });

  it('keeps the suggestion one click away from the member’s own rate', () => {
    expect(rateNote('custom', frankfurter, 'INR', now)).toEqual({
      text: 'Your rate. Suggested ₹92.10 from Frankfurter, rates of 20 Oct.',
      attribution: null,
      useSuggestion: '92.1',
    });
    expect(rateNote('custom', secondSource, 'INR', now)).toEqual({
      text: 'Your rate. Suggested ₹92.06, rates of 21 Oct.',
      attribution: EXCHANGE_RATE_API_ATTRIBUTION,
      useSuggestion: '92.06',
    });
  });

  it('says how to go on with no suggestion', () => {
    expect(rateNote('entered', null, 'INR', now)).toEqual({
      text: 'Type the rate you agreed, or both amounts. The rate is kept as yours.',
      attribution: null,
      useSuggestion: null,
    });
  });
});

describe('the Group’s rate read, as the sheet reads it (#726, #727)', () => {
  it('reads a suggestion, or none with its reason', () => {
    expect(parseRateSuggestionResponse({ data: { suggestion: frankfurter }, status: 200 })).toEqual(
      {
        suggestion: frankfurter,
        reason: null,
      },
    );
    expect(
      parseRateSuggestionResponse({
        data: { suggestion: null, reason: 'unavailable' },
        status: 200,
      }),
    ).toEqual({ suggestion: null, reason: 'unavailable' });
    // Extra fields the read adds later, such as its components, are left out.
    expect(
      parseRateSuggestionResponse({
        data: { suggestion: { ...secondSource, from: 'EUR', to: 'INR', components: [] } },
      }).suggestion,
    ).toEqual(secondSource);
  });

  it('refuses a read it can’t trust', () => {
    for (const payload of [
      null,
      { data: { suggestion: { ...frankfurter, rate: '1e3' } } },
      { data: { suggestion: { ...frankfurter, source: 'guess' } } },
      { data: { suggestion: { ...frankfurter, attributionRequired: true, attribution: null } } },
    ])
      expect(() => parseRateSuggestionResponse(payload), JSON.stringify(payload)).toThrow();
  });
});

describe('a payment’s record, as its card shows it (#727)', () => {
  const alex = 'a00000000000000000000001';
  const sam = 'a00000000000000000000002';
  const record = {
    paidBy: alex,
    paidByName: 'Alex Rivera',
    paidTo: sam,
    paidToName: 'Sam Chen',
    amountMinor: 2000,
    currency: 'EUR',
    amountPaidMinor: 185000,
    paidCurrency: 'INR',
    appliedRate: '92.5',
    rateKind: 'custom' as const,
    suggestedRate: '92.1',
    rateSource: 'frankfurter' as const,
    rateAsOf: '2026-10-20',
    rateFetchedAt: local(21, 6).toISOString(),
    pairDebtBeforeMinor: -2000,
    pairDebtAfterMinor: 0,
  };

  it('shows both amounts, the rate used and the suggestion, and what moved', () => {
    expect(paymentRecord(record, alex)).toEqual({
      payer: 'You',
      payee: 'Sam Chen',
      paid: '₹1,850.00',
      clears: 'to clear €20.00, a Debt in EUR',
      rateUsed: '₹92.50 per €',
      badge: 'Your rate',
      suggested: {
        rate: '₹92.10 per €',
        source: 'Frankfurter · rates of 20 Oct · fetched 21 Oct 06:00',
        attribution: null,
      },
      cleared: '€20.00',
      paidAmount: '₹1,850.00',
      pair: { label: 'You and Sam in EUR:', before: '−€20.00', after: '€0.00' },
      unchanged: 'INR balances didn’t change. Only the Debt’s own currency moves.',
      kept: 'The rate is kept as recorded. It never changes, even when rates move later.',
    });
  });

  it('names the second source, an entered rate, and leaves out what an older record didn’t keep', () => {
    const fallback = paymentRecord(
      { ...record, rateKind: 'suggested', suggestedRate: '92.5', rateSource: 'exchange-rate-api' },
      sam,
    );
    expect(fallback).toMatchObject({
      payer: 'Alex Rivera',
      payee: 'You',
      badge: 'Suggested',
      suggested: {
        source: 'Rates of 20 Oct · fetched 21 Oct 06:00',
        attribution: EXCHANGE_RATE_API_ATTRIBUTION,
      },
      pair: { label: 'Alex and you in EUR:' },
    });
    const entered = paymentRecord(
      {
        ...record,
        rateKind: 'entered',
        suggestedRate: undefined,
        rateSource: undefined,
        rateAsOf: undefined,
        rateFetchedAt: undefined,
        pairDebtBeforeMinor: undefined,
        pairDebtAfterMinor: undefined,
      },
      'a00000000000000000000003',
    );
    expect(entered).toMatchObject({
      payer: 'Alex Rivera',
      payee: 'Sam Chen',
      badge: 'No suggestion',
      suggested: null,
      pair: null,
    });
    expect(paymentRecord({ ...record, pairDebtAfterMinor: 500 }, alex).pair).toEqual({
      label: 'You and Sam in EUR:',
      before: '−€20.00',
      after: '+€5.00',
    });
  });
});
