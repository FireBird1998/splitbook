import { describe, expect, expectTypeOf, it } from 'vitest';
import { Refusal, refusalVocabulary, type RefusalCode } from './refusals';

describe('the server refusal vocabulary', () => {
  it('exports precisely its codes as a type and gives every code status and words', () => {
    expectTypeOf<RefusalCode>().toEqualTypeOf<keyof typeof refusalVocabulary>();
    for (const entry of Object.values(refusalVocabulary)) {
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
      if ('words' in entry) expect(entry.words).toBeDefined();
      else expect(entry.moneyWords).toBe('from-rule');
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
  it('uses the payment words for authorization refusals', () => {
    expect(refusalVocabulary.FORBIDDEN_SETTLEMENT.words).toBe(
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
    new Refusal('FORBIDDEN', { variant: 'payment' });
    // @ts-expect-error The refused Tag change carries its current snapshot.
    new Refusal('TAG_CHANGED');
    // @ts-expect-error A removal's words name the member.
    new Refusal('OPEN_BALANCE', { balances: [], variant: 'removal' });
    // @ts-expect-error Money-only refusals come from the rule's MoneyValidationError.
    new Refusal('UNSAFE_MONEY');
    // @ts-expect-error A per-Expense refusal identifies the Expense and destination Tag.
    new Refusal('FORBIDDEN', { variant: 'expenseTagChange' });
  };
  expect(invalidCalls).toBeTypeOf('function');
});

it('catalogs request refusals and delegates money words to their rules', () => {
  for (const entry of Object.values(refusalVocabulary)) {
    expect(entry.status).toBeGreaterThanOrEqual(400);
    expect(entry.status).toBeLessThan(600);
    expect(entry.status).not.toBe(500);
    expect(entry).not.toHaveProperty('delivery');
    expect(entry).not.toHaveProperty('includeStatus');
    for (const variant of Object.values(entry.variants)) {
      expect(variant.status).toBeGreaterThanOrEqual(400);
      expect(variant).not.toHaveProperty('delivery');
      expect(variant).not.toHaveProperty('includeStatus');
    }
  }
  expect(refusalVocabulary.UNSAFE_MONEY).toMatchObject({ status: 422, moneyWords: 'from-rule' });
  expect(refusalVocabulary.UNSAFE_MONEY).not.toHaveProperty('words');
  expect(refusalVocabulary).not.toHaveProperty('BACKUP_ALL_TIME');
  expect(refusalVocabulary).not.toHaveProperty('GROUP_NOT_FOUND');
  expect(refusalVocabulary.INVALID_CURRENCY.status).toBe(400);
});

it('includes the direct helper codes and requires the missing resource', () => {
  expect(refusalVocabulary.UNAUTHORIZED.status).toBe(401);
  expect(refusalVocabulary.NOT_FOUND.status).toBe(404);
  const invalid = () => {
    // @ts-expect-error A missing resource is supplied by the answering helper.
    new Refusal('NOT_FOUND');
  };
  expect(invalid).toBeTypeOf('function');
});
