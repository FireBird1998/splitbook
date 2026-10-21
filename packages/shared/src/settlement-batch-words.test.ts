import { describe, expect, it } from 'vitest';
import { settlementBatchWords } from './settlement-batch-words';

/*
 * #734: a payment that settled several Debts at once, as one Activity row, in the words of the
 * single payment's row (#727's "You paid Sam ₹1,850.00 to clear €20.00 at …"). Alex paid Sam
 * ₹3,322.00 for a ₹1,480.00 Debt and a €20.00 one, at Frankfurter's ₹92.10 for each euro.
 */
const alex = 'a00000000000000000000001',
  sam = 'a00000000000000000000002';
const people = { paidBy: alex, paidTo: sam, paidByName: 'Alex Rivera', paidToName: 'Sam Chen' };
const rupees = {
  ...people,
  amount: 1480,
  amountMinor: 148000,
  currency: 'INR',
  batchId: 'f00000000000000000000001',
  batchSize: 2,
};
const euros = {
  ...people,
  amount: 20,
  amountMinor: 2000,
  currency: 'EUR',
  amountPaidMinor: 184200,
  paidCurrency: 'INR',
  appliedRate: '92.1',
  rateKind: 'suggested',
  suggestedRate: '92.1',
  rateSource: 'frankfurter',
  rateAsOf: '2026-10-20',
  rateFetchedAt: '2026-10-21T00:30:00.000Z',
  batchId: 'f00000000000000000000001',
  batchSize: 2,
};

describe('a payment that settled several Debts at once (#734)', () => {
  it('says what was paid in all, each Debt it cleared, and each one’s rate', () => {
    expect(settlementBatchWords([{ metadata: rupees }, { metadata: euros }], 2, alex)).toEqual({
      payer: 'You',
      payee: 'Sam Chen',
      amounts: '₹3,322.00 to clear ₹1,480.00 and €20.00',
      headline: 'You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00',
      debts: [
        '₹1,480.00, same currency, no rate',
        '€20.00 at ₹92.10 per €, suggested ₹92.10 (20 Oct)',
      ],
      rest: null,
    });
  });

  it('names the viewer "you" when they were paid, and says a rate the payer chose', () => {
    const custom = {
      ...euros,
      amountPaidMinor: 185000,
      appliedRate: '92.5',
      rateKind: 'custom',
    };
    expect(
      settlementBatchWords([{ metadata: rupees }, { metadata: custom }], 2, sam),
    ).toMatchObject({
      payer: 'Alex Rivera',
      payee: 'you',
      headline: 'Alex Rivera paid you ₹3,330.00 to clear ₹1,480.00 and €20.00',
      debts: [
        '₹1,480.00, same currency, no rate',
        '€20.00 at ₹92.50 per €, suggested ₹92.10 (20 Oct)',
      ],
    });
  });

  it('says what it cleared of a payment a page boundary split, and where the rest is', () => {
    expect(settlementBatchWords([{ metadata: rupees }], 2, alex)).toEqual({
      payer: 'You',
      payee: 'Sam Chen',
      amounts: 'to clear ₹1,480.00 and 1 more Debt',
      headline: 'You paid Sam Chen to clear ₹1,480.00 and 1 more Debt',
      debts: ['₹1,480.00, same currency, no rate'],
      rest: 'The rest of this payment is in older Activity.',
    });
  });
});
