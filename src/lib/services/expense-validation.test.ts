import { describe, expect, it } from 'vitest';
import {
  assertActiveTag,
  assertExpenseParticipants,
  assertGroupCurrency,
} from './expense-validation';

describe('expense validation', () => {
  describe('assertExpenseParticipants', () => {
    it('accepts payers and split participants who are group members', () => {
      const memberIds = new Set(['user-1', 'user-2']);

      expect(() =>
        assertExpenseParticipants(
          memberIds,
          [{ user: 'user-1', amount: 30 }],
          [{ user: 'user-2', amount: 30 }],
        ),
      ).not.toThrow();
    });

    it('throws INVALID_MEMBERS when any payer is not a group member', () => {
      const memberIds = new Set(['user-1']);

      expect(() =>
        assertExpenseParticipants(
          memberIds,
          [{ user: 'user-2', amount: 30 }],
          [{ user: 'user-1', amount: 30 }],
        ),
      ).toThrow('INVALID_MEMBERS');
    });

    it('throws INVALID_MEMBERS when any split participant is not a group member', () => {
      const memberIds = new Set(['user-1']);

      expect(() =>
        assertExpenseParticipants(
          memberIds,
          [{ user: 'user-1', amount: 30 }],
          [{ user: 'user-2', amount: 30 }],
        ),
      ).toThrow('INVALID_MEMBERS');
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

  describe('assertGroupCurrency', () => {
    it('accepts the group default currency', () => {
      expect(() => assertGroupCurrency('USD', 'USD')).not.toThrow();
    });

    it('throws CURRENCY_MISMATCH when currency differs from the group default', () => {
      expect(() => assertGroupCurrency('USD', 'EUR')).toThrow('CURRENCY_MISMATCH');
    });
  });
});
