import { describe, expect, expectTypeOf, it } from 'vitest';
import { Refusal, refusalVocabulary, type RefusalCode } from './refusals';

describe('the server refusal vocabulary', () => {
  it('exports precisely its codes as a type and gives every code status and words', () => {
    expectTypeOf<RefusalCode>().toEqualTypeOf<keyof typeof refusalVocabulary>();
    for (const entry of Object.values(refusalVocabulary)) {
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
      expect(entry.words).toBeDefined();
    }
  });
  it('keeps the Error message equal to the code for callers still comparing it', () => {
    const cause = new Refusal('FORBIDDEN');
    expect(cause).toBeInstanceOf(Error);
    expect(cause.message).toBe('FORBIDDEN');
    expect(cause.code).toBe('FORBIDDEN');
  });
  it('carries data without making the service choose status or words', () => {
    const data = {
      currency: 'EUR',
      groupName: 'Maple House',
      use: { expenses: { count: 2, items: [] }, settlements: 1, toReview: { yours: 1, others: 0 } },
    };
    const cause = new Refusal('CURRENCY_IN_USE', data);
    expect(cause.data).toEqual(data);
    expect(cause.message).toBe('CURRENCY_IN_USE');
  });
  it('keeps caller-specific payment wordings in the vocabulary', () => {
    expect(refusalVocabulary.FORBIDDEN_SETTLEMENT.words).toBe(
      'Only the payer or recipient can record this settlement',
    );
    expect(refusalVocabulary.FORBIDDEN_SETTLEMENT.variants.settlementBatch.words).toBe(
      'Only the payer or recipient can record this payment',
    );
  });
});

it('rejects unknown codes, caller-supplied words and missing required data at compile time', () => {
  const invalidCalls = () => {
    // @ts-expect-error A code that nothing refuses with is outside the vocabulary.
    new Refusal('FORBIDEN');
    // @ts-expect-error Currency refusals carry the currency, Group and usage.
    new Refusal('CURRENCY_IN_USE');
    // @ts-expect-error The vocabulary owns the status and words.
    new Refusal('FORBIDDEN', { status: 403, words: 'Forbidden' });
    // @ts-expect-error The batch wording belongs to the payment refusal.
    new Refusal('FORBIDDEN', { variant: 'settlementBatch' });
    // @ts-expect-error The refused Tag change carries its current snapshot.
    new Refusal('TAG_CHANGED');
    // @ts-expect-error A removal's words name the member.
    new Refusal('OPEN_BALANCE', { balances: [], variant: 'membersRemove' });
    // @ts-expect-error Restoring an unlisted currency names that currency.
    new Refusal('CURRENCY_MISMATCH', { variant: 'restoredCurrency' });
    // @ts-expect-error A per-Expense refusal identifies the Expense and destination Tag.
    new Refusal('FORBIDDEN', { variant: 'expenseTagChange' });
  };
  expect(invalidCalls).toBeTypeOf('function');
});
