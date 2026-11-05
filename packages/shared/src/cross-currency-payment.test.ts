import { describe, expect, it } from 'vitest';
import {
  crossCurrencyPaymentFields,
  crossCurrencyRateKind,
  crossCurrencySummary,
  editCrossCurrencyEntry,
  parseRateSuggestionResponse,
  paymentRecord,
  suggestedRateText,
  rateBadge,
  rateNote,
  rateText,
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

  it('shows a rate under 1 to six significant digits, where six places would cut it (#873)', () => {
    expect(rateText('92.099945255334')).toBe('92.099945');
    expect(rateText('92.1')).toBe('92.10');
    expect(rateText('0.1')).toBe('0.10');
    expect(rateText('0.550764119601')).toBe('0.550764');
    expect(rateText('0.005980066445')).toBe('0.00598007');
    expect(rateText('0.000056789012')).toBe('0.000056789');
    expect(rateText('0.000000000000000001')).toBe('0.000000000000000001');
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

describe('a suggested rate the member leaves as it is (#727 review)', () => {
  it('pays exactly what the suggestion gives, however many places the rate has', () => {
    const rupiahInEuros = { currency: 'IDR', paidCurrency: 'EUR' };
    const tiny: RateSuggestion = { ...frankfurter, rate: '0.000056789012' };

    const entry = startCrossCurrencyEntry(rupiahInEuros, '1000000', tiny);

    expect(fields(entry)).toEqual(['1000000', '0.000056789012', '56.79']);
    const reading = readCrossCurrencyEntry(entry, rupiahInEuros);
    if (reading.status !== 'valid') throw new Error(reading.status);
    expect(reading.amounts.amountPaidMinor).toBe(5679);
    expect(crossCurrencyRateKind(rupiahInEuros, reading.amounts, tiny)).toBe('suggested');
    // A suggestion with fewer places shows at least two.
    expect(startCrossCurrencyEntry(euroInRupees, '20.00', frankfurter).rate).toBe('92.10');
    expect(suggestedRateText('0.000056789012')).toBe('0.000056789012');
    expect(suggestedRateText('92')).toBe('92.00');
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
    expect(crossCurrencyPaymentFields(euroInRupees, own, read(own), frankfurter)).toEqual({
      amountPaidMinor: 185000,
      paidCurrency: 'INR',
      appliedRate: '92.50',
      rateKind: 'custom',
      suggestedRate: '92.1',
      rateSource: 'frankfurter',
      rateAsOf: '2026-10-20',
      rateFetchedAt: frankfurter.fetchedAt,
    });
    expect(crossCurrencyPaymentFields(euroInRupees, own, read(own), null)).toEqual({
      amountPaidMinor: 185000,
      paidCurrency: 'INR',
      appliedRate: '92.50',
      rateKind: 'entered',
    });
  });
});

// #870: the record keeps the rate the member applied, as they saw it, never one worked back from
// the rounded amount paid. €54.83 at the suggested ₹92.10 is ₹5,049.843, so ₹5,049.84 is paid.
describe('the rate a payment records, as the member chose it (#870)', () => {
  const debt = startCrossCurrencyEntry(euroInRupees, '54.83', frankfurter);
  const sent = (entry: ReturnType<typeof startCrossCurrencyEntry>) => {
    const reading = readCrossCurrencyEntry(entry, euroInRupees);
    if (reading.status !== 'valid') throw new Error(reading.status);
    return crossCurrencyPaymentFields(euroInRupees, entry, reading.amounts, frankfurter);
  };

  it('is the suggestion itself when the member pays at it', () => {
    expect(sent(debt)).toMatchObject({
      amountPaidMinor: 504984,
      appliedRate: '92.1',
      rateKind: 'suggested',
      suggestedRate: '92.1',
    });
  });

  it('is the rate as typed, when it gives the amount paid', () => {
    // 54.83 × 91.5 = 5016.945: ₹5,016.95.
    expect(sent(editCrossCurrencyEntry(debt, euroInRupees, 'rate', '91.50'))).toMatchObject({
      amountPaidMinor: 501695,
      appliedRate: '91.50',
      rateKind: 'custom',
    });
    expect(sent(editCrossCurrencyEntry(debt, euroInRupees, 'rate', '1,092.10')).appliedRate).toBe(
      '1092.10',
    );
  });

  it('is worked out from both amounts when the member typed them, or the rate can’t give them', () => {
    expect(sent(editCrossCurrencyEntry(debt, euroInRupees, 'paid', '5,000'))).toMatchObject({
      amountPaidMinor: 500000,
      appliedRate: '91.190953857377348167',
      rateKind: 'custom',
    });
    // ₹100.00 at 92.10 clears €1.09, and €1.09 at 92.10 would pay ₹100.39: the rate follows them.
    const paidAndRate = editCrossCurrencyEntry(
      editCrossCurrencyEntry(debt, euroInRupees, 'paid', '100.00'),
      euroInRupees,
      'rate',
      '92.10',
    );
    expect(paidAndRate.cleared).toBe('1.09');
    expect(sent(paidAndRate)).toMatchObject({
      amountPaidMinor: 10000,
      appliedRate: '91.743119266055045872',
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
      text: 'Frankfurter\u00a0· rates of 20 Oct\u00a0· fetched today 06:00',
      attribution: null,
      useSuggestion: null,
    });
    expect(rateNote('suggested', secondSource, 'INR', now)).toEqual({
      text: 'Rates of 21 Oct\u00a0· fetched today 06:00',
      attribution: EXCHANGE_RATE_API_ATTRIBUTION,
      useSuggestion: null,
    });
    expect(rateNote('suggested', fiveDaysOld, 'INR', now)).toEqual({
      text: 'Frankfurter\u00a0· rates of 16 Oct, 5 days old. Today’s rates aren’t in yet.',
      attribution: null,
      useSuggestion: null,
    });
    expect(
      rateNote('suggested', { ...frankfurter, fetchedAt: local(20, 18).toISOString() }, 'INR', now)
        .text,
    ).toBe('Frankfurter\u00a0· rates of 20 Oct\u00a0· fetched yesterday 18:00');
    expect(
      rateNote('suggested', { ...frankfurter, fetchedAt: local(18, 18).toISOString() }, 'INR', now)
        .text,
    ).toBe('Frankfurter\u00a0· rates of 20 Oct\u00a0· fetched 18 Oct 18:00');
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

  // #873: a suggestion shows, and pays, as every other rate shows, whichever source it's from.
  it('rounds a suggestion as rates show, whichever source it comes from (#873)', () => {
    const read = (rate: string, from: RateSuggestion = frankfurter) =>
      parseRateSuggestionResponse({ data: { suggestion: { ...from, rate } } }).suggestion?.rate;
    expect(read('20.826633165829', secondSource)).toBe('20.826633');
    expect(read('0.550764119601')).toBe('0.550764');
    expect(read('92.1')).toBe('92.1');
    expect(read('92.10')).toBe('92.1');
    expect(read('92')).toBe('92');
    // Six places would leave a yen's rate in euros three digits: six significant ones stay.
    expect(read('0.005980066445')).toBe('0.00598007');
    expect(read('0.000056789012')).toBe('0.000056789');
  });

  it('pays what the rate shown gives, in the field and beside Use (#873)', () => {
    const zlotyInRupees = { currency: 'PLN', paidCurrency: 'INR' };
    const { suggestion } = parseRateSuggestionResponse({
      data: { suggestion: { ...secondSource, rate: '20.826633165829' } },
    });
    const entry = startCrossCurrencyEntry(zlotyInRupees, '60.00', suggestion);
    // 60 × 20.826633 = 1249.59798: ₹1,249.60, where the unrounded rate gave ₹1,249.60 too.
    expect(fields(entry)).toEqual(['60.00', '20.826633', '1249.60']);
    const reading = readCrossCurrencyEntry(entry, zlotyInRupees);
    if (reading.status !== 'valid') throw new Error(reading.status);
    expect(crossCurrencyRateKind(zlotyInRupees, reading.amounts, suggestion)).toBe('suggested');
    const own = editCrossCurrencyEntry(entry, zlotyInRupees, 'rate', '21');
    expect(rateNote('custom', suggestion, 'INR', now)).toMatchObject({
      text: 'Your rate. Suggested ₹20.826633, rates of 21 Oct.',
      useSuggestion: '20.826633',
    });
    expect(fields(own)).toEqual(['60.00', '21', '1260.00']);
    // A yen Debt paid in euros: the field shows the rate as it reads, not twelve places.
    const yenInEuros = { currency: 'JPY', paidCurrency: 'EUR' };
    const yen = parseRateSuggestionResponse({
      data: { suggestion: { ...frankfurter, rate: '0.005980066445' } },
    }).suggestion;
    expect(fields(startCrossCurrencyEntry(yenInEuros, '2200', yen))).toEqual([
      '2200',
      '0.00598007',
      '13.16',
    ]);
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

  // #884: "PLN 60.00 at ₹20.826267 per zł" named one currency two ways.
  it('names a currency without a symbol by its code in its rates (#884)', () => {
    const zloty = paymentRecord(
      {
        ...record,
        currency: 'PLN',
        amountMinor: 6000,
        amountPaidMinor: 124958,
        appliedRate: '20.826267',
        suggestedRate: '20.826267',
        rateKind: 'suggested',
        pairDebtBeforeMinor: -6000,
      },
      alex,
    );
    expect(zloty).toMatchObject({
      clears: 'to clear PLN\u00a060.00, a Debt in PLN',
      rateUsed: '₹20.826267 per\u00a0PLN',
      suggested: { rate: '₹20.826267 per\u00a0PLN' },
    });
    expect(JSON.stringify(zloty)).not.toContain('zł');
  });
  it('shows both amounts, the rate used and the suggestion, and what moved', () => {
    expect(paymentRecord(record, alex)).toEqual({
      payer: 'You',
      payee: 'Sam Chen',
      paid: '₹1,850.00',
      clears: 'to clear €20.00, a Debt in EUR',
      rateUsed: '₹92.50 per\u00a0€',
      badge: 'Your rate',
      suggested: {
        rate: '₹92.10 per\u00a0€',
        source: 'Frankfurter\u00a0· rates of 20 Oct\u00a0· fetched 21 Oct 06:00',
        attribution: null,
      },
      cleared: '€20.00',
      paidAmount: '₹1,850.00',
      pair: { label: 'You and Sam in EUR:', before: '−€20.00', after: '€0.00' },
      unchanged: 'INR balances didn’t change. Only the Debt’s own currency moves.',
      kept: 'The rate is kept as recorded. It never changes, even when rates move later.',
    });
  });

  it('shows the rate used as the member applied it: the suggestion, or theirs as typed (#870)', () => {
    const atSuggestion = {
      ...record,
      amountMinor: 5483,
      amountPaidMinor: 504984,
      appliedRate: '92.1',
      rateKind: 'suggested' as const,
    };
    expect(paymentRecord(atSuggestion, alex)).toMatchObject({
      paid: '₹5,049.84',
      rateUsed: '₹92.10 per\u00a0€',
      badge: 'Suggested',
      suggested: { rate: '₹92.10 per\u00a0€' },
    });
    expect(
      paymentRecord(
        { ...atSuggestion, amountPaidMinor: 501695, appliedRate: '91.5', rateKind: 'custom' },
        alex,
      ),
    ).toMatchObject({ rateUsed: '₹91.50 per\u00a0€', badge: 'Your rate' });
  });

  it('reads an older record’s worked-out rate as the suggestion, when rounding explains the gap (#870)', () => {
    const older = {
      ...record,
      amountMinor: 5483,
      amountPaidMinor: 504984,
      appliedRate: '92.099945285427685574',
      rateKind: 'suggested' as const,
    };
    expect(paymentRecord(older, alex)).toMatchObject({
      rateUsed: '₹92.10 per\u00a0€',
      badge: 'Suggested',
    });
    // A rate of the member's own that rounding doesn't explain stays theirs.
    expect(
      paymentRecord(
        {
          ...older,
          amountPaidMinor: 501695,
          appliedRate: '91.500091190953857377',
          rateKind: 'custom',
        },
        alex,
      ),
    ).toMatchObject({ rateUsed: '₹91.500091 per\u00a0€', badge: 'Your rate' });
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
        source: 'Rates of 20 Oct\u00a0· fetched 21 Oct 06:00',
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

describe('what a Debt paid in another currency clears, as the sheet says it (#727)', () => {
  // Alex owes Sam €20.00 and pays it in rupees.
  const you = { isViewer: true, name: 'Alex Rivera' };
  const sam = { isViewer: false, name: 'Sam Chen' };
  const sheet = (clearedMinor: number, paidMinor: number | null, viewerPays = true) =>
    crossCurrencySummary({
      clearedMinor,
      debtMinor: 2000,
      paidMinor,
      currency: 'EUR',
      paidCurrency: 'INR',
      payer: viewerPays ? you : { isViewer: false, name: 'Alex Rivera' },
      payee: viewerPays ? sam : { isViewer: true, name: 'Sam Chen' },
    });

  it('says what the payee gets for the whole Debt, part of it, or more', () => {
    expect(sheet(2000, 184200)).toEqual({
      overpaid: null,
      clears: 'Clears your €20.00 Debt to Sam. Sam gets ₹1,842.00.',
    });
    expect(sheet(1000, 92100)).toEqual({
      overpaid: null,
      clears: 'Clears €10.00 of your €20.00 Debt to Sam. €10.00 stays to pay.',
    });
    expect(sheet(2500, 230250)).toEqual({
      overpaid: 'That’s €5.00 more than you owe Sam in EUR, so Sam would owe you €5.00.',
      clears: 'Clears your €20.00 Debt to Sam and €5.00 more. Sam gets ₹2,302.50.',
    });
  });

  it('waits for the rate or the amount paid', () => {
    expect(sheet(2000, null)).toEqual({
      overpaid: null,
      clears: 'Clears your €20.00 Debt to Sam once you enter the rate or the amount paid.',
    });
  });

  it('speaks from the payee’s side when the payee records it', () => {
    expect(sheet(2000, 184200, false).clears).toBe(
      'Clears Alex’s €20.00 Debt to you. You get ₹1,842.00.',
    );
    expect(sheet(1000, 92100, false).clears).toBe(
      'Clears €10.00 of Alex’s €20.00 Debt to you. €10.00 stays to pay.',
    );
    expect(sheet(2500, 230250, false)).toEqual({
      overpaid: 'That’s €5.00 more than Alex owes you in EUR, so you would owe Alex €5.00.',
      clears: 'Clears Alex’s €20.00 Debt to you and €5.00 more. You get ₹2,302.50.',
    });
  });
});
