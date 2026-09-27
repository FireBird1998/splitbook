import { calculateSplitAmountsMinor, parseAmountMinor, toMajorAmount } from './exact-money';

export { calculateSplitAmountsMinor } from './exact-money';
export type ExpenseSplitMethod = 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';

export interface SplitParticipantInput {
  user: unknown;
  amount?: number;
  percentage?: number;
  shares?: number;
}

/** Compatible major-unit boundary; every allocation itself uses exact minor units. */
export function calculateSplitAmounts<T extends SplitParticipantInput>(
  splitMethod: ExpenseSplitMethod,
  amount: number,
  splitBetween: T[],
  currency = 'INR',
): T[] {
  const resolved = calculateSplitAmountsMinor(
    splitMethod,
    parseAmountMinor(amount, currency),
    splitBetween.map((participant) => ({
      ...participant,
      amountMinor:
        splitMethod === 'exact' || splitMethod === 'unequal'
          ? participant.amount === undefined
            ? undefined
            : parseAmountMinor(participant.amount, currency)
          : undefined,
    })),
  );
  return splitBetween.map((participant, index) => ({
    ...participant,
    amount: toMajorAmount(resolved[index].amountMinor, currency),
  }));
}
