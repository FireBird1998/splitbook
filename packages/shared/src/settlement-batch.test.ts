import { describe, expect, it } from 'vitest';
import { calculateSettlementBatch } from './settlement-batch';

describe('calculateSettlementBatch', () => {
  it('combines two currencies without converting the cleared Debts', () => {
    expect(
      calculateSettlementBatch({
        debts: [
          { currency: 'EUR', amountMinor: 2000 },
          { currency: 'INR', amountMinor: 50000 },
        ],
        paidCurrency: 'INR',
        rates: { EUR: { rate: '92.5', rateKind: 'entered' } },
      }),
    ).toEqual({
      paidCurrency: 'INR',
      totalPaidMinor: 235000,
      settlements: [
        {
          currency: 'EUR',
          amount: 20,
          amountPaidMinor: 185000,
          paidCurrency: 'INR',
          appliedRate: '92.5',
          rateKind: 'entered',
        },
        { currency: 'INR', amount: 500 },
      ],
    });
  });
  it('rounds each of three cleared currencies before adding the paid total, including JPY', () => {
    const result = calculateSettlementBatch({
      debts: [
        { currency: 'EUR', amountMinor: 1 },
        { currency: 'USD', amountMinor: 1 },
        { currency: 'JPY', amountMinor: 1 },
      ],
      paidCurrency: 'INR',
      rates: {
        EUR: { rate: '1.5', rateKind: 'entered' },
        USD: { rate: '1.5', rateKind: 'entered' },
        JPY: { rate: '0.015', rateKind: 'entered' },
      },
    });
    expect(result.totalPaidMinor).toBe(6);
    expect(result.settlements).toMatchObject([
      { amount: 0.01, amountPaidMinor: 2, appliedRate: '2' },
      { amount: 0.01, amountPaidMinor: 2, appliedRate: '2' },
      { amount: 1, amountPaidMinor: 2, appliedRate: '0.02' },
    ]);
  });
  it('rounds payments in JPY to whole units and retains each suggested or custom rate', () => {
    const provenance = {
      suggestedRate: '150',
      rateSource: 'frankfurter' as const,
      rateAsOf: '2026-10-20',
      rateFetchedAt: '2026-10-21T00:15:00.000Z',
    };
    const result = calculateSettlementBatch({
      debts: [
        { currency: 'EUR', amountMinor: 1 },
        { currency: 'USD', amountMinor: 1 },
      ],
      paidCurrency: 'JPY',
      rates: {
        EUR: { ...provenance, rateKind: 'suggested' },
        USD: { ...provenance, rateKind: 'custom', rate: '249.5' },
      },
    });
    expect(result.totalPaidMinor).toBe(4);
    expect(result.settlements).toMatchObject([
      { ...provenance, amountPaidMinor: 2, appliedRate: '200', rateKind: 'suggested' },
      { ...provenance, amountPaidMinor: 2, appliedRate: '200', rateKind: 'custom' },
    ]);
  });
  it('refuses a missing rate, repeated currency, nonpositive Debt and unsafe total', () => {
    const calculate = (debts: { currency: string; amountMinor: number }[], rates = {}) =>
      calculateSettlementBatch({ debts, rates, paidCurrency: 'INR' });
    expect(() => calculate([{ currency: 'EUR', amountMinor: 1 }])).toThrow();
    expect(() =>
      calculate([
        { currency: 'INR', amountMinor: 1 },
        { currency: 'INR', amountMinor: 1 },
      ]),
    ).toThrow();
    expect(() => calculate([{ currency: 'INR', amountMinor: 0 }])).toThrow();
    expect(() =>
      calculate(
        [
          { currency: 'USD', amountMinor: 100 },
          { currency: 'EUR', amountMinor: 100 },
        ],
        {
          EUR: { rate: '90000000000000', rateKind: 'entered' },
          USD: { rate: '90000000000000', rateKind: 'entered' },
        },
      ),
    ).toThrow();
  });
});
