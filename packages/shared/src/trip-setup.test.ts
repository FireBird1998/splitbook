import { describe, expect, it } from 'vitest';
import {
  buildTripChecklist,
  isValidParticipantEmail,
  normalizeParticipantEmails,
  shouldShowTripChecklist,
  validateTripDates,
} from './trip-setup';

describe('trip setup helpers', () => {
  describe('validateTripDates', () => {
    it('allows missing dates', () => {
      expect(validateTripDates(null, null)).toBeNull();
      expect(validateTripDates('2026-03-14', null)).toBeNull();
    });

    it('rejects end before start', () => {
      expect(validateTripDates('2026-03-17', '2026-03-14')).toBe(
        'End date must be on or after start date',
      );
    });

    it('accepts equal or ordered dates', () => {
      expect(validateTripDates('2026-03-14', '2026-03-14')).toBeNull();
      expect(validateTripDates('2026-03-14', '2026-03-17')).toBeNull();
    });
  });

  describe('participant emails', () => {
    it('normalizes, dedupes, and drops invalid emails', () => {
      expect(
        normalizeParticipantEmails([
          ' Alex@Example.com ',
          'alex@example.com',
          'not-an-email',
          'sam@example.com',
        ]),
      ).toEqual(['alex@example.com', 'sam@example.com']);
    });

    it('validates a single email', () => {
      expect(isValidParticipantEmail('priya@example.com')).toBe(true);
      expect(isValidParticipantEmail('nope')).toBe(false);
    });
  });

  describe('trip checklist', () => {
    it('marks steps based on trip progress', () => {
      const fresh = buildTripChecklist({
        memberCount: 1,
        expenseCount: 0,
        outstandingDebtCount: 0,
      });
      expect(fresh.map((item) => item.done)).toEqual([false, false, false]);
      expect(shouldShowTripChecklist(fresh)).toBe(true);

      const active = buildTripChecklist({
        memberCount: 3,
        expenseCount: 2,
        outstandingDebtCount: 1,
      });
      expect(active.map((item) => item.done)).toEqual([true, true, false]);

      const settled = buildTripChecklist({
        memberCount: 3,
        expenseCount: 2,
        outstandingDebtCount: 0,
      });
      expect(settled.every((item) => item.done)).toBe(true);
      expect(shouldShowTripChecklist(settled)).toBe(false);
    });
  });
});
