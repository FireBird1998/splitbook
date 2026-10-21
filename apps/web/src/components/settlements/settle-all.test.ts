import { describe, expect, it } from 'vitest';
import type { RateSuggestion } from '@splitbook/shared/cross-currency-payment';
import { readSettleAll, settleAllOffers, settleAllWords } from './settle-all';

/*
 * #734: Settle up, on the board "Web · Settle both currencies at once". In Lisbon & Tokyo (INR,
 * EUR, JPY) Alex owes Sam ₹1,480.00 and €20.00, Priya owes Sam ₹730.00, and Sam owes Alex
 * ¥8,400. One payment, in one currency, can clear both of Alex's Debts to Sam, each at its own
 * rate; nothing is converted on the ledger.
 */

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const person = (id: string, name: string) => ({ _id: id, name });
const alex = person(ALEX, 'Alex Rivera');
const sam = person(SAM, 'Sam Chen');
const priya = person(PRIYA, 'Priya Shah');
const buckets = [
  {
    currency: 'INR',
    debts: [
      { from: alex, to: sam, amount: 1480 },
      { from: priya, to: sam, amount: 730 },
    ],
  },
  { currency: 'JPY', debts: [{ from: sam, to: alex, amount: 8400 }] },
  { currency: 'EUR', debts: [{ from: alex, to: sam, amount: 20 }] },
];
const ORDER = ['INR', 'EUR', 'JPY'];

const frankfurter: RateSuggestion = {
  rate: '92.1',
  source: 'frankfurter',
  asOf: '2026-10-20',
  fetchedAt: '2026-10-21T00:30:00.000Z',
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
};
const twoDebts = [
  { currency: 'INR', amountMinor: 148000 },
  { currency: 'EUR', amountMinor: 2000 },
];

describe('settleAllOffers', () => {
  it('offers one payment to each person the member owes in two currencies or more, in the Group’s order', () => {
    expect(settleAllOffers(buckets, ALEX, ORDER)).toEqual([
      {
        paidBy: ALEX,
        paidTo: SAM,
        other: 'Sam Chen',
        youPay: true,
        debts: twoDebts,
      },
    ]);
  });

  it('offers it the other way round to the member they owe, and to no one else', () => {
    const owed = [
      { currency: 'INR', debts: [{ from: sam, to: alex, amount: 500 }] },
      { currency: 'EUR', debts: [{ from: sam, to: alex, amount: 12.5 }] },
    ];
    expect(settleAllOffers(owed, ALEX, ORDER)).toEqual([
      {
        paidBy: SAM,
        paidTo: ALEX,
        other: 'Sam Chen',
        youPay: false,
        debts: [
          { currency: 'INR', amountMinor: 50000 },
          { currency: 'EUR', amountMinor: 1250 },
        ],
      },
    ]);
    // Priya owes Sam in one currency only, and Alex isn't one of them.
    expect(settleAllOffers(buckets, PRIYA, ORDER)).toEqual([]);
  });

  it('words the offer and the sheet as the board does', () => {
    const [offer] = settleAllOffers(buckets, ALEX, ORDER);
    expect(settleAllWords(offer)).toEqual({
      lead: 'You owe Sam Chen in 2 currencies',
      amounts: '₹1,480.00 and €20.00',
      offer: 'One payment can clear both.',
      action: 'Settle both',
      title: 'Settle up with Sam Chen',
      intro:
        'You owe Sam Chen in 2 currencies. One payment can clear both; each Debt keeps its own rate.',
      payColumn: 'You pay',
      note: 'Records 2 Settlements, one for each Debt, each with its own rate. Activity shows them as one payment. To pay part of a Debt, record it on its own.',
    });
    const [owed] = settleAllOffers(
      [
        { currency: 'INR', debts: [{ from: sam, to: alex, amount: 500 }] },
        { currency: 'EUR', debts: [{ from: sam, to: alex, amount: 12.5 }] },
        { currency: 'JPY', debts: [{ from: sam, to: alex, amount: 900 }] },
      ],
      ALEX,
      ORDER,
    );
    expect(settleAllWords(owed)).toMatchObject({
      lead: 'Sam Chen owes you in 3 currencies',
      amounts: '₹500.00, €12.50 and ¥900',
      offer: 'One payment can clear them all.',
      action: 'Settle all',
      intro:
        'Sam Chen owes you in 3 currencies. One payment can clear them all; each Debt keeps its own rate.',
      payColumn: 'Sam Chen pays',
    });
  });
});

describe('readSettleAll', () => {
  const rates = (state: Parameters<typeof readSettleAll>[0]['rates'][string]) => ({ EUR: state });

  it('pays the Debt in the paying currency as it is, and the other at its suggested rate', () => {
    const read = readSettleAll({
      debts: twoDebts,
      paidCurrency: 'INR',
      rates: rates({ state: { status: 'ready', suggestion: frankfurter }, custom: null }),
    });
    expect(read.waiting).toBeNull();
    expect(read.lines).toEqual([
      {
        currency: 'INR',
        debtMinor: 148000,
        paidMinor: 148000,
        rate: null,
        kind: 'same',
        suggestion: null,
      },
      {
        currency: 'EUR',
        debtMinor: 2000,
        paidMinor: 184200,
        rate: '92.1',
        kind: 'suggested',
        suggestion: frankfurter,
      },
    ]);
    expect(read.amounts).toMatchObject({ paidCurrency: 'INR', totalPaidMinor: 332200 });
    expect(read.amounts!.settlements).toEqual([
      { amount: 1480, currency: 'INR' },
      expect.objectContaining({
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 184200,
        rateKind: 'suggested',
        suggestedRate: '92.1',
      }),
    ]);
  });

  it('pays at the member’s own rate, beside the suggestion', () => {
    const read = readSettleAll({
      debts: twoDebts,
      paidCurrency: 'INR',
      rates: rates({ state: { status: 'ready', suggestion: frankfurter }, custom: '92.50' }),
    });
    expect(read.lines[1]).toMatchObject({ paidMinor: 185000, rate: '92.50', kind: 'custom' });
    expect(read.amounts!.totalPaidMinor).toBe(333000);
    expect(read.amounts!.settlements[1]).toMatchObject({
      rateKind: 'custom',
      appliedRate: '92.5',
      suggestedRate: '92.1',
    });
  });

  it('waits for a rate it doesn’t have yet, and takes one the member enters', () => {
    expect(
      readSettleAll({
        debts: twoDebts,
        paidCurrency: 'INR',
        rates: rates({ state: { status: 'loading' }, custom: null }),
      }),
    ).toMatchObject({ amounts: null, waiting: 'Getting the suggested rate for EUR…' });
    expect(
      readSettleAll({
        debts: twoDebts,
        paidCurrency: 'INR',
        rates: rates({ state: { status: 'none', reason: null }, custom: null }),
      }),
    ).toMatchObject({ amounts: null, waiting: 'Enter the rate for the EUR Debt to record it.' });
    const entered = readSettleAll({
      debts: twoDebts,
      paidCurrency: 'INR',
      rates: rates({ state: { status: 'none', reason: null }, custom: '92' }),
    });
    expect(entered.lines[1]).toMatchObject({ paidMinor: 184000, kind: 'entered' });
    expect(entered.amounts!.settlements[1]).toMatchObject({ rateKind: 'entered' });
    expect(entered.amounts!.settlements[1]).not.toHaveProperty('suggestedRate');
  });

  it('pays in another of the Debts’ currencies, each at its own rate', () => {
    const read = readSettleAll({
      debts: twoDebts,
      paidCurrency: 'EUR',
      rates: {
        INR: {
          state: { status: 'ready', suggestion: { ...frankfurter, rate: '0.010858' } },
          custom: null,
        },
      },
    });
    expect(read.lines).toEqual([
      expect.objectContaining({ currency: 'INR', paidMinor: 1607, kind: 'suggested' }),
      expect.objectContaining({ currency: 'EUR', paidMinor: 2000, kind: 'same' }),
    ]);
    expect(read.amounts!.totalPaidMinor).toBe(3607);
  });
});
