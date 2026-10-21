/**
 * A Group's Balances by currency (#710, #724): which currencies it switches between, and which
 * one it opens on. Each currency keeps its own balances, Debts and Suggested payments, and
 * nothing is converted. Framework-free, so the server, the web and Android (#725) share one rule.
 */
import { normaliseExtraCurrencies, type GroupCurrencyList } from './group-currencies';

/**
 * Whether money is in mixed currencies. It has one meaning (#710): more than one currency
 * present, whatever the main currency is, so euros alone in a rupee Group are not mixed.
 */
export function hasMixedCurrencies(currencies: Iterable<string>): boolean {
  return new Set(currencies).size > 1;
}

/**
 * The currencies Balances switches between, in its order: the main currency, then the Group's
 * extra currencies in their listed order, then any other currency its money is in (an older
 * Group's), alphabetically. An extra currency joins once money is in it.
 */
export function balanceCurrencies(group: GroupCurrencyList, present: Iterable<string>): string[] {
  const used = new Set(present);
  const listed = normaliseExtraCurrencies(group.defaultCurrency, group.alternateCurrencies).filter(
    (code) => used.has(code),
  );
  const others = [...used]
    .filter((code) => code !== group.defaultCurrency && !listed.includes(code))
    .sort();
  return [group.defaultCurrency, ...listed, ...others];
}

/**
 * The currency Balances opens on (#710): the first, in the switch's order, that the member isn't
 * settled up in. So the main currency while they owe or are owed in it, and when they're settled
 * up in every one. `positions` holds the member's balance in each currency; one missing is 0.
 */
export function openingBalanceCurrency(
  currencies: readonly string[],
  positions: Readonly<Record<string, number>>,
): string {
  return currencies.find((currency) => (positions[currency] ?? 0) !== 0) ?? currencies[0];
}
