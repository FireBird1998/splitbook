import { describe, expect, it } from 'vitest';
import { parseAmountMinor, sumMinorAmounts } from './exact-money';
import { calculateSplitAmounts, type SplitParticipantInput } from './split-calculation';

const participants = (...input: SplitParticipantInput[]): SplitParticipantInput[] => input;

/** The split's total in minor units (paise), so a total is exact, never "close enough" (#471). */
const sumMinor = (input: SplitParticipantInput[]) =>
  sumMinorAmounts(input.map((participant) => parseAmountMinor(participant.amount ?? 0, 'INR')));

describe('calculateSplitAmounts', () => {
  describe('equal split', () => {
    it('divides evenly when the amount splits exactly', () => {
      const result = calculateSplitAmounts(
        'equal',
        90,
        participants({ user: 'a' }, { user: 'b' }, { user: 'c' }),
      );

      expect(result.map((p) => p.amount)).toEqual([30, 30, 30]);
      expect(sumMinor(result)).toBe(9000);
    });

    it('assigns leftover pennies to the first participant', () => {
      const result = calculateSplitAmounts(
        'equal',
        100,
        participants({ user: 'a' }, { user: 'b' }, { user: 'c' }),
      );

      // ₹100 is 10,000 paise: 3,334 + 3,333 + 3,333.
      expect(result.map((p) => p.amount)).toEqual([33.34, 33.33, 33.33]);
      expect(sumMinor(result)).toBe(10000);
    });

    it('handles sub-cent remainders without losing the total', () => {
      const result = calculateSplitAmounts(
        'equal',
        10,
        participants({ user: 'a' }, { user: 'b' }, { user: 'c' }),
      );

      // ₹10 is 1,000 paise: 334 + 333 + 333.
      expect(result.map((p) => p.amount)).toEqual([3.34, 3.33, 3.33]);
      expect(sumMinor(result)).toBe(1000);
    });

    it('gives the full amount to a single participant', () => {
      const result = calculateSplitAmounts('equal', 42.5, participants({ user: 'a' }));
      expect(result.map((p) => p.amount)).toEqual([42.5]);
    });

    it('handles tiny amounts smaller than the participant count in cents', () => {
      const result = calculateSplitAmounts(
        'equal',
        0.01,
        participants({ user: 'a' }, { user: 'b' }),
      );

      expect(result.map((p) => p.amount)).toEqual([0.01, 0]);
      expect(sumMinor(result)).toBe(1);
    });

    it('preserves other participant fields', () => {
      const result = calculateSplitAmounts(
        'equal',
        60,
        participants({ user: 'a', shares: 2 }, { user: 'b', percentage: 50 }),
      );

      expect(result[0]).toMatchObject({ user: 'a', shares: 2, amount: 30 });
      expect(result[1]).toMatchObject({ user: 'b', percentage: 50, amount: 30 });
    });
  });

  describe('shares split', () => {
    it('splits proportionally to shares', () => {
      const result = calculateSplitAmounts(
        'shares',
        100,
        participants({ user: 'a', shares: 1 }, { user: 'b', shares: 1 }, { user: 'c', shares: 2 }),
      );

      expect(result.map((p) => p.amount)).toEqual([25, 25, 50]);
      expect(sumMinor(result)).toBe(10000);
    });

    it('distributes remaining minor units so the shares preserve the total', () => {
      const result = calculateSplitAmounts(
        'shares',
        100,
        participants({ user: 'a', shares: 1 }, { user: 'b', shares: 1 }, { user: 'c', shares: 1 }),
      );

      expect(result.map((p) => p.amount)).toEqual([33.34, 33.33, 33.33]);
      expect(sumMinor(result)).toBe(10000);
    });

    it('rejects a zero total share weight', () => {
      const input = participants(
        { user: 'a', shares: 0, amount: 70 },
        { user: 'b', shares: 0, amount: 30 },
      );

      expect(() => calculateSplitAmounts('shares', 100, input)).toThrow('positive');
    });

    it('treats missing shares as zero', () => {
      const result = calculateSplitAmounts(
        'shares',
        100,
        participants({ user: 'a', shares: 3 }, { user: 'b' }),
      );

      expect(result.map((p) => p.amount)).toEqual([100, 0]);
    });
  });

  describe('percentage split', () => {
    it('splits by percentage with cent rounding', () => {
      const result = calculateSplitAmounts(
        'percentage',
        3600,
        participants(
          { user: 'a', percentage: 40 },
          { user: 'b', percentage: 30 },
          { user: 'c', percentage: 30 },
        ),
      );

      expect(result.map((p) => p.amount)).toEqual([1440, 1080, 1080]);
      expect(sumMinor(result)).toBe(360000);
    });

    it('handles fractional percentages', () => {
      const result = calculateSplitAmounts(
        'percentage',
        100,
        participants(
          { user: 'a', percentage: 33.33 },
          { user: 'b', percentage: 33.33 },
          { user: 'c', percentage: 33.34 },
        ),
      );

      expect(result.map((p) => p.amount)).toEqual([33.33, 33.33, 33.34]);
      expect(sumMinor(result)).toBe(10000);
    });

    it('treats missing percentage as zero', () => {
      const result = calculateSplitAmounts(
        'percentage',
        100,
        participants({ user: 'a', percentage: 100 }, { user: 'b' }),
      );

      expect(result.map((p) => p.amount)).toEqual([100, 0]);
    });
  });

  describe('unequal and exact splits', () => {
    it('passes caller-provided amounts through unchanged for unequal', () => {
      const input = participants(
        { user: 'a', amount: 2000 },
        { user: 'b', amount: 1500 },
        { user: 'c', amount: 1000 },
      );

      expect(calculateSplitAmounts('unequal', 4500, input)).toEqual(input);
    });

    it('passes caller-provided amounts through unchanged for exact', () => {
      const input = participants({ user: 'a', amount: 300 }, { user: 'b', amount: 300 });

      expect(calculateSplitAmounts('exact', 600, input)).toEqual(input);
    });
  });
});
