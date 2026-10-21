/**
 * A Group's currencies (#710, #719): its main currency, and a short list of extra currencies.
 * An Expense, a Settlement's currency, a recurring Expense or a Draft may use any of them, and
 * amounts are never converted. Framework-free, so the server and both clients share one rule.
 */
import { CURRENCY_CODES, getCurrency } from './currency';

/** The most extra currencies a Group can have, so the Expense form's choice stays short. */
export const MAX_EXTRA_CURRENCIES = 4;

/** What a Group's currencies hold. The extra currencies are stored as `alternateCurrencies`. */
export interface GroupCurrencyList {
  defaultCurrency: string;
  alternateCurrencies?: readonly unknown[] | null;
}

/**
 * Why a list of extra currencies can't be saved, in a member's words, or null when it can:
 * each a supported code, none twice, none the main currency, and at most 4.
 */
export function extraCurrenciesProblem(
  mainCurrency: string,
  extraCurrencies: readonly string[],
): string | null {
  const seen = new Set<string>();
  for (const code of extraCurrencies) {
    if (!CURRENCY_CODES.includes(code)) return `${code} isn’t a supported currency.`;
    if (code === mainCurrency)
      return `${code} is the main currency, so it can’t also be an extra currency.`;
    if (seen.has(code)) return `${code} is listed twice.`;
    seen.add(code);
  }
  if (extraCurrencies.length > MAX_EXTRA_CURRENCIES)
    return `A Group can have at most ${MAX_EXTRA_CURRENCIES} extra currencies.`;
  return null;
}

/**
 * A stored list as the rule allows it: an older Group's unsupported codes, repeats and main
 * currency are dropped, and the first 4 kept, so reading or saving it never fails.
 */
export function normaliseExtraCurrencies(
  mainCurrency: string,
  stored: readonly unknown[] | null | undefined,
): string[] {
  const kept: string[] = [];
  for (const code of stored ?? []) {
    if (kept.length === MAX_EXTRA_CURRENCIES) break;
    if (typeof code !== 'string' || !CURRENCY_CODES.includes(code)) continue;
    if (code === mainCurrency || kept.includes(code)) continue;
    kept.push(code);
  }
  return kept;
}

/** The Group's currencies, main currency first: what an Expense may be recorded in. */
export function groupCurrencies(group: GroupCurrencyList): string[] {
  return [
    group.defaultCurrency,
    ...normaliseExtraCurrencies(group.defaultCurrency, group.alternateCurrencies),
  ];
}

/** Whether a record may use this currency in this Group. */
export function isGroupCurrency(group: GroupCurrencyList, currency: string): boolean {
  return groupCurrencies(group).includes(currency);
}

/**
 * The currency a new Expense starts in: the member's latest Expense's in this Group, while the
 * Group still lists it, else the main currency. Nothing new is stored for it (#710).
 */
export function startingExpenseCurrency(
  group: GroupCurrencyList,
  latestCurrency: string | null | undefined,
): string {
  return latestCurrency && isGroupCurrency(group, latestCurrency)
    ? latestCurrency
    : group.defaultCurrency;
}

/** A currency as the Expense form offers it: why it's offered, when that helps choose. */
export interface ExpenseCurrencyChoice {
  code: string;
  name: string;
  symbol: string;
  note: 'Your latest Expense here' | 'Main currency' | 'This Expense’s currency' | null;
}

/**
 * The currencies an Expense can be in, as its form lists them (#719): the member's latest
 * Expense's first, then the main currency, then the other extra currencies. An edited Expense
 * keeps its own currency on the list even when the Group no longer has it.
 */
export function expenseCurrencyChoices(
  group: GroupCurrencyList,
  latestCurrency: string | null | undefined,
  currentCurrency: string,
): ExpenseCurrencyChoice[] {
  const listed = groupCurrencies(group);
  const latest = latestCurrency && listed.includes(latestCurrency) ? latestCurrency : null;
  const ordered = latest ? [latest, ...listed.filter((code) => code !== latest)] : listed;
  const codes = listed.includes(currentCurrency) ? ordered : [...ordered, currentCurrency];
  return codes.map((code) => {
    const currency = getCurrency(code);
    return {
      code,
      name: currency?.name ?? code,
      symbol: currency?.symbol ?? code,
      note:
        code === group.defaultCurrency
          ? 'Main currency'
          : code === latest
            ? 'Your latest Expense here'
            : listed.includes(code)
              ? null
              : 'This Expense’s currency',
    };
  });
}
