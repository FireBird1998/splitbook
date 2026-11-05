import { describe, expect, it } from 'vitest';
import { createSettlementSchema } from './settlement';

/*
 * #870: a Cross-currency Settlement keeps the rate the member applied, as they chose it, beside
 * the two amounts. Alex pays Sam's €54.83 Debt in rupees at the suggested ₹92.10: ₹5,049.843,
 * rounded to the paisa, ₹5,049.84. Fictional figures.
 */
const payment = {
  paidTo: 'sam',
  amount: 54.83,
  currency: 'EUR',
  amountPaidMinor: 504984,
  paidCurrency: 'INR',
  rateKind: 'suggested' as const,
  suggestedRate: '92.1',
  rateSource: 'frankfurter' as const,
  rateAsOf: '2026-10-22',
  rateFetchedAt: '2026-10-22T00:30:00.000Z',
};
const accepts = (fields: Record<string, unknown>) =>
  createSettlementSchema.safeParse({ ...payment, ...fields }).success;

describe('the rate a Cross-currency Settlement keeps (#870)', () => {
  it('takes the rate as applied, when it gives the amount paid', () => {
    expect(accepts({ appliedRate: '92.1' })).toBe(true);
    expect(accepts({ appliedRate: '92.10' })).toBe(true);
    // A typed rate: 54.83 × 91.5 = 5016.945, ₹5,016.95.
    expect(accepts({ appliedRate: '91.5', amountPaidMinor: 501695, rateKind: 'custom' })).toBe(
      true,
    );
  });

  it('still takes the rate worked out from the two amounts, as older apps send it', () => {
    expect(accepts({ appliedRate: '92.099945285427685574' })).toBe(true);
  });

  it('refuses a rate that doesn’t give the amount paid', () => {
    expect(accepts({ appliedRate: '92.2' })).toBe(false);
    expect(accepts({ appliedRate: '92.09' })).toBe(false);
  });
});
