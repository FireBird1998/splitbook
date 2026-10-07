/**
 * Everyone's position in one currency of a Group (#313): each person's all-time net and who
 * settles with them, the figures behind Balances' "Everyone" chart and its table. Pure and
 * exact: every amount is in minor units of that one currency.
 *
 * "Settled by" comes from the suggested payments (the Balances read's debts), never from debts
 * worked out between two people: balances are simplified across the Group, so the suggested
 * payments are the ones that settle everyone. Someone who owes is settled by whom they pay;
 * someone who is owed, by who pays them.
 */
import { sumMinorAmounts } from './exact-money';
import type { SettlementLedger } from './settlement-preview';

/** Owed to them (above zero), they owe (below zero), or neither. */
export type PositionStanding = 'owed' | 'owes' | 'settled';

/** The other person in one suggested payment, and its amount. */
export interface SettledByPart {
  userId: string;
  amountMinor: number;
}

export interface MemberPosition {
  userId: string;
  /** All-time net: positive is owed to them, negative they owe, 0 settled up. */
  netMinor: number;
  standing: PositionStanding;
  /**
   * Whom they pay when they owe, or who pays them when they're owed, from the suggested
   * payments: one part per other person, largest first. Empty when they're settled up.
   */
  settledBy: SettledByPart[];
}

export function positionStanding(netMinor: number): PositionStanding {
  return netMinor > 0 ? 'owed' : netMinor < 0 ? 'owes' : 'settled';
}

/**
 * Each person's position, largest amount owed to them first and largest amount they owe last,
 * so the chart reads from owed to owes. `members` are listed even when the ledger doesn't name
 * them (they're settled up); anyone else the ledger names, such as a former member with an
 * open balance, follows them. People with the same net keep that order: `members` first, then
 * the ledger's.
 */
export function memberPositions(
  ledger: SettlementLedger,
  members: readonly string[] = [],
): MemberPosition[] {
  const people = [
    ...new Set([
      ...members,
      ...ledger.balances.map((balance) => balance.userId),
      ...ledger.suggestions.flatMap((suggestion) => [suggestion.from, suggestion.to]),
    ]),
  ].filter(Boolean);
  const order = new Map(people.map((userId, index) => [userId, index]));

  return people
    .map((userId): MemberPosition => {
      const netMinor = sumMinorAmounts(
        ledger.balances
          .filter((balance) => balance.userId === userId)
          .map((balance) => balance.amountMinor),
      );
      const standing = positionStanding(netMinor);
      const parts = new Map<string, number>();
      for (const suggestion of ledger.suggestions) {
        const other =
          standing === 'owes' && suggestion.from === userId
            ? suggestion.to
            : standing === 'owed' && suggestion.to === userId
              ? suggestion.from
              : null;
        if (other)
          parts.set(other, sumMinorAmounts([parts.get(other) ?? 0, suggestion.amountMinor]));
      }
      return {
        userId,
        netMinor,
        standing,
        settledBy: [...parts]
          .map(([other, amountMinor]) => ({ userId: other, amountMinor }))
          .sort(
            (a, b) => b.amountMinor - a.amountMinor || order.get(a.userId)! - order.get(b.userId)!,
          ),
      };
    })
    .sort((a, b) => b.netMinor - a.netMinor || order.get(a.userId)! - order.get(b.userId)!);
}

/** Whether nobody owes anybody: every position is zero, or there are none. */
export function everyoneSettled(positions: readonly MemberPosition[]): boolean {
  return positions.every((position) => position.netMinor === 0);
}
