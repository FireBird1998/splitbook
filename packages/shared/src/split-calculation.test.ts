import { describe, expect, it } from 'vitest';
import { calculateSplitAmounts, type SplitParticipantInput } from './split-calculation';

const participants = (...input: SplitParticipantInput[]): SplitParticipantInput[] => input;

const sumAmounts = (input: SplitParticipantInput[]) =>
  input.reduce((sum, participant) => sum + (participant.amount ?? 0), 0);

describe('calculateSplitAmounts', () => {
  describe('equal split', () => {
    it('divides evenly when the amount splits exactly', () => {
      const result = calculateSplitAmounts(
        'equal',
        90,
        participants({ user: 'a' }, { user: 'b' }, { user: 'c' }),
      );

      expect(result.map((p) => p.amount)).toEqual([30, 30, 30]);
      expect(sumAmounts(result)).toBe(90);
    });

    it('assigns leftover pennies to the first participant', () => {
      const result = calculateSplitAmounts(
        'equal',
        100,
        participants({ user: 'a' }, { user: 'b' }, { user: 'c' }),
      );

      // perPerson + remainder is a float addition; assert cent-level values
      expect(result[0].amount).toBeCloseTo(33.34, 10);
      expect(result[1].amount).toBe(33.33);
      expect(result[2].amount).toBe(33.33);
      expect(sumAmounts(result)).toBeCloseTo(100, 10);
    });

    it('handles sub-cent remainders without losing the total', () => {
      const result = calculateSplitAmounts(
        'equal',
        10,
        participants({ user: 'a' }, { user: 'b' }, { user: 'c' }),
      );

      expect(result[0].amount).toBeCloseTo(3.34, 10);
      expect(result[1].amount).toBe(3.33);
      expect(result[2].amount).toBe(3.33);
      expect(sumAmounts(result)).toBeCloseTo(10, 10);
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
      expect(sumAmounts(result)).toBeCloseTo(0.01, 10);
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
      expect(sumAmounts(result)).toBe(100);
    });

    it('distributes remaining minor units so the shares preserve the total', () => {
      const result = calculateSplitAmounts(
        'shares',
        100,
        participants({ user: 'a', shares: 1 }, { user: 'b', shares: 1 }, { user: 'c', shares: 1 }),
      );

      expect(result.map((p) => p.amount)).toEqual([33.34, 33.33, 33.33]);
      expect(sumAmounts(result)).toBe(100);
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
      expect(sumAmounts(result)).toBe(3600);
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
      expect(sumAmounts(result)).toBeCloseTo(100, 10);
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
