import { describe, expect, it } from 'vitest';
import { calculateSettlementBatch } from './settlement-batch';

describe('calculateSettlementBatch', () => {
  it('combines two currencies without converting the cleared Debts', () => {
    expect(calculateSettlementBatch({
      debts: [{ currency: 'EUR', amountMinor: 2000 }, { currency: 'INR', amountMinor: 50000 }],
      paidCurrency: 'INR',
      rates: { EUR: { rate: '92.5', rateKind: 'entered' } },
    })).toEqual({
      paidCurrency: 'INR', totalPaidMinor: 235000,
      settlements: [
        { currency: 'EUR', amount: 20, amountPaidMinor: 185000, paidCurrency: 'INR', appliedRate: '92.5', rateKind: 'entered' },
        { currency: 'INR', amount: 500 },
      ],
    });
  });
});
