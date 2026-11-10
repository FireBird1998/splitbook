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
