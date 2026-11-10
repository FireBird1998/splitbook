import { describe, expect, it } from 'vitest';
import { Refusal, refusalAnswer } from './refusals';
import {
  assertActiveTag,
  assertExpenseParticipants,
  assertGroupCurrency,
  assertSettlementAuthorization,
  assertSettlementMembers,
  canRecordSettlement,
  shouldValidateExpenseTag,
} from './expense-validation';

describe('expense validation', () => {
  it('refuses an Expense participant with its code and Expense wording', () => {
    let cause: unknown;
    try {
      assertExpenseParticipants(new Set(['member']), [{ user: 'outsider' }], []);
    } catch (error) {
      cause = error;
    }
    expect(cause).toBeInstanceOf(Refusal);
    expect(cause).toMatchObject({ message: 'INVALID_MEMBERS', code: 'INVALID_MEMBERS' });
    expect(refusalAnswer(cause as Refusal)).toEqual({
      error: 'All payers and split participants must be group members',
      status: 422,
      code: 'INVALID_MEMBERS',
    });
  });
  describe('assertExpenseParticipants', () => {
    it('accepts payers and split participants who are group members', () => {
      const memberIds = new Set(['user-1', 'user-2']);

      expect(() =>
        assertExpenseParticipants(memberIds, [{ user: 'user-1' }], [{ user: 'user-2' }]),
      ).not.toThrow();
    });

    it('throws INVALID_MEMBERS when any payer is not a group member', () => {
      const memberIds = new Set(['user-1']);

      expect(() =>
        assertExpenseParticipants(memberIds, [{ user: 'user-2' }], [{ user: 'user-1' }]),
      ).toThrow('INVALID_MEMBERS');
    });

    it('throws INVALID_MEMBERS when any split participant is not a group member', () => {
      const memberIds = new Set(['user-1']);

      expect(() =>
        assertExpenseParticipants(memberIds, [{ user: 'user-1' }], [{ user: 'user-2' }]),
      ).toThrow('INVALID_MEMBERS');
    });
  });

  describe('shouldValidateExpenseTag', () => {
    it('returns false when tag is omitted from the update payload', () => {
      expect(shouldValidateExpenseTag(undefined, 'Dinner')).toBe(false);
    });

    it('returns false when tag is unchanged (e.g. archived tag kept as-is)', () => {
      expect(shouldValidateExpenseTag('Dinner', 'Dinner')).toBe(false);
    });

    it('returns true when tag is being changed to a new value', () => {
      expect(shouldValidateExpenseTag('Hotel', 'Dinner')).toBe(true);
    });
  });

  describe('assertActiveTag', () => {
    it('accepts an active group tag', () => {
      expect(() => assertActiveTag(new Set(['Dinner', 'Hotel']), 'Dinner')).not.toThrow();
    });

    it('throws INVALID_TAG when the tag is not active for the group', () => {
      expect(() => assertActiveTag(new Set(['Dinner']), 'Archived')).toThrow('INVALID_TAG');
    });
  });

  describe('assertSettlementMembers', () => {
    it('accepts payer and recipient who are group members', () => {
      const memberIds = new Set(['user-1', 'user-2']);

      expect(() => assertSettlementMembers(memberIds, 'user-1', 'user-2')).not.toThrow();
    });

    it('throws INVALID_MEMBERS when payer is not a group member', () => {
      const memberIds = new Set(['user-2']);

      expect(() => assertSettlementMembers(memberIds, 'user-1', 'user-2')).toThrow(
        'INVALID_MEMBERS',
      );
    });

    it('throws INVALID_MEMBERS when recipient is not a group member', () => {
      const memberIds = new Set(['user-1']);

      expect(() => assertSettlementMembers(memberIds, 'user-1', 'user-2')).toThrow(
        'INVALID_MEMBERS',
      );
    });

    it('throws SAME_PARTY when payer and recipient are identical', () => {
      const memberIds = new Set(['user-1']);
      expect(() => assertSettlementMembers(memberIds, 'user-1', 'user-1')).toThrow('SAME_PARTY');
    });
  });

  describe('settlement authorization', () => {
    it('allows either authorized party to record a settlement', () => {
      expect(canRecordSettlement('payer', 'payer', 'payee')).toBe(true);
      expect(canRecordSettlement('payee', 'payer', 'payee')).toBe(true);
      expect(canRecordSettlement('other', 'payer', 'payee')).toBe(false);
      expect(() => assertSettlementAuthorization('payee', 'payer', 'payee')).not.toThrow();
      expect(() => assertSettlementAuthorization('other', 'payer', 'payee')).toThrow(
        'FORBIDDEN_SETTLEMENT',
      );
    });
  });

  describe('assertGroupCurrency', () => {
    it('accepts the group default currency', () => {
      expect(() => assertGroupCurrency({ defaultCurrency: 'USD' }, 'USD')).not.toThrow();
    });

    it('throws CURRENCY_MISMATCH when currency differs from the group default', () => {
      expect(() => assertGroupCurrency({ defaultCurrency: 'USD' }, 'EUR')).toThrow(
        'CURRENCY_MISMATCH',
      );
    });
  });
});

it.each([
  ['INVALID_TAG', () => assertActiveTag(new Set(), 'Food')],
  ['INVALID_MEMBERS', () => assertSettlementMembers(new Set(), 'payer', 'payee')],
  ['SAME_PARTY', () => assertSettlementMembers(new Set(['payer']), 'payer', 'payer')],
  ['FORBIDDEN_SETTLEMENT', () => assertSettlementAuthorization('other', 'payer', 'payee')],
  ['CURRENCY_MISMATCH', () => assertGroupCurrency({ defaultCurrency: 'INR' }, 'EUR')],
] as const)('keeps %s as the Error message of a typed shared refusal', (code, refuse) => {
  expect(refuse).toThrow(Refusal);
  expect(refuse).toThrow(code);
});

it('keeps the payment caller’s authorization wording on its refusal', () => {
  let cause: unknown;
  try {
    assertSettlementAuthorization('other', 'payer', 'payee');
  } catch (error) {
    cause = error;
  }
  expect(cause).toBeInstanceOf(Refusal);
  expect(refusalAnswer(cause as Refusal)).toEqual({
    error: 'Only the payer or recipient can record this payment',
    status: 422,
    code: 'FORBIDDEN_SETTLEMENT',
  });
});
