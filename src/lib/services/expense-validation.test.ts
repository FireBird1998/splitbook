import { describe, expect, it } from 'vitest';
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
  describe('assertExpenseParticipants', () => {
    it('accepts payers and split participants who are group members', () => {
      const memberIds = new Set(['user-1', 'user-2']);

      expect(() =>
        assertExpenseParticipants(
          memberIds,
          [{ user: 'user-1' }],
          [{ user: 'user-2' }],
        ),
      ).not.toThrow();
    });

    it('throws INVALID_MEMBERS when any payer is not a group member', () => {
      const memberIds = new Set(['user-1']);

      expect(() =>
        assertExpenseParticipants(
          memberIds,
          [{ user: 'user-2' }],
          [{ user: 'user-1' }],
        ),
      ).toThrow('INVALID_MEMBERS');
    });

    it('throws INVALID_MEMBERS when any split participant is not a group member', () => {
      const memberIds = new Set(['user-1']);

      expect(() =>
        assertExpenseParticipants(
          memberIds,
          [{ user: 'user-1' }],
          [{ user: 'user-2' }],
        ),
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
      expect(() => assertGroupCurrency('USD', 'USD')).not.toThrow();
    });

    it('throws CURRENCY_MISMATCH when currency differs from the group default', () => {
      expect(() => assertGroupCurrency('USD', 'EUR')).toThrow('CURRENCY_MISMATCH');
    });
  });
});
