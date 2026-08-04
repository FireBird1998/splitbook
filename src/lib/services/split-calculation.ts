/**
 * Pure split-amount calculation for expenses.
 * Shared by the expense create/update paths — no DB access, unit-testable.
 */

export type ExpenseSplitMethod = 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';

export interface SplitParticipantInput {
  user: unknown;
  amount?: number;
  percentage?: number;
  shares?: number;
}

/**
 * Resolve per-person split amounts for a split method.
 *
 * - `equal`: divides evenly in cents; leftover pennies go to the first participant.
 * - `shares`: proportional to each participant's shares (no-op when total shares is 0).
 * - `percentage`: proportional to each participant's percentage.
 * - `unequal` / `exact`: caller-provided amounts are authoritative and pass through.
 */
export function calculateSplitAmounts<T extends SplitParticipantInput>(
  splitMethod: ExpenseSplitMethod,
  amount: number,
  splitBetween: T[],
): T[] {
  if (splitMethod === 'equal') {
    const perPerson = Math.floor((amount * 100) / splitBetween.length) / 100;
    const remainder = Math.round((amount - perPerson * splitBetween.length) * 100) / 100;

    return splitBetween.map((participant, index) => ({
      ...participant,
      amount: index === 0 ? perPerson + remainder : perPerson,
    }));
  }

  if (splitMethod === 'shares') {
    const totalShares = splitBetween.reduce((sum, s) => sum + (s.shares || 0), 0);
    if (totalShares > 0) {
      return splitBetween.map((participant) => ({
        ...participant,
        amount: Math.round(((participant.shares || 0) / totalShares) * amount * 100) / 100,
      }));
    }
    return splitBetween;
  }

  if (splitMethod === 'percentage') {
    return splitBetween.map((participant) => ({
      ...participant,
      amount: Math.round(((participant.percentage || 0) / 100) * amount * 100) / 100,
    }));
  }

  return splitBetween;
}
