/**
 * Spending by currency (#710, #729): which currencies Insights and the Trip summary switch
 * between, and which one they open on. Each currency's figures are worked out on their own;
 * nothing is converted and no rate is used. Framework-free, so the server, the web and Android
 * (#730) share one rule.
 */
import { normaliseExtraCurrencies, type GroupCurrencyList } from './group-currencies';

/** What was spent in one currency in a period: how many Expenses, and their total. */
export interface CurrencySpending {
  currency: string;
  expenseCount: number;
  /** Exact, in the currency's minor units. */
  spentMinor: number;
}

/**
 * The currencies to switch between, in order: the main currency, always, then the Group's extra
 * currencies in their listed order once something is spent in them, then any other currency an
 * Expense is in (an older Group's), alphabetically.
 */
export function spendingCurrencies(
  group: GroupCurrencyList,
  spent: readonly CurrencySpending[],
): CurrencySpending[] {
  const byCurrency = new Map(spent.map((row) => [row.currency, row]));
  const main = byCurrency.get(group.defaultCurrency) ?? {
    currency: group.defaultCurrency,
    expenseCount: 0,
    spentMinor: 0,
  };
  const listed = normaliseExtraCurrencies(group.defaultCurrency, group.alternateCurrencies);
  const extras = listed.flatMap((code) => byCurrency.get(code) ?? []);
  const others = spent
    .filter((row) => row.currency !== group.defaultCurrency && !listed.includes(row.currency))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return [main, ...extras, ...others];
}

/**
 * The currency to open on (#710, owner's decision 3): the one with the most Expenses in the
 * period, never the largest amount. A tie goes to the main currency, else to the first in the
 * switch's order; with nothing spent, it's the main currency.
 */
export function openingSpendingCurrency(
  group: GroupCurrencyList,
  spent: readonly CurrencySpending[],
): string {
  const ordered = spendingCurrencies(group, spent);
  const most = Math.max(...ordered.map((row) => row.expenseCount));
  return ordered.find((row) => row.expenseCount === most)!.currency;
}
