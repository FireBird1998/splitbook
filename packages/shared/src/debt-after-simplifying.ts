/**
 * What each Debt becomes once Suggested payments simplify it (#646): Balances' Before
 * simplifying rows say "Becomes ₹X after simplifying" or "Settled by the other payments".
 *
 * A Debt becomes the Suggested payment between the same two people, the same way round and in
 * the same currency. A Suggested payment the other way round, between other people or in
 * another currency never stands for it: amounts are never compared or converted across
 * currencies (#710). Display only: both lists come from the same Balances read.
 */
import { assertSafeMinorAmount, sumMinorAmounts } from './exact-money';

/** A Debt or a Suggested payment, in exact minor units of its own currency. */
export interface CurrencyPayment {
  from: string;
  to: string;
  currency: string;
  amountMinor: number;
}

export type AfterSimplifying = { kind: 'becomes'; amountMinor: number } | { kind: 'settled' };

const pairKey = ({ currency, from, to }: CurrencyPayment) => JSON.stringify([currency, from, to]);

/** Each Debt's outcome, in the Debts' order. */
export function debtsAfterSimplifying(
  debts: readonly CurrencyPayment[],
  suggested: readonly CurrencyPayment[],
): AfterSimplifying[] {
  const byPair = new Map<string, number>();
  for (const payment of suggested) {
    const key = pairKey(payment);
    byPair.set(
      key,
      sumMinorAmounts([byPair.get(key) ?? 0, assertSafeMinorAmount(payment.amountMinor)]),
    );
  }
  return debts.map((debt) => {
    const amountMinor = byPair.get(pairKey(debt));
    return amountMinor === undefined ? { kind: 'settled' } : { kind: 'becomes', amountMinor };
  });
}
