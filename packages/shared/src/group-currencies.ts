/**
 * A Group's currencies (#710, #719): its main currency, and a short list of extra currencies.
 * An Expense, a Settlement's currency, a recurring Expense or a Draft may use any of them, and
 * amounts are never converted. Framework-free, so the server and both clients share one rule.
 */
import { CURRENCY_CODES, formatAmountAsEntered, getCurrency } from './currency';

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

/**
 * Currencies in the Group's order (#759): the main currency, then its extra currencies as listed,
 * then any other one the records are still in (a currency since removed), alphabetically.
 */
export function inGroupCurrencyOrder(group: GroupCurrencyList, currencies: Iterable<string>) {
  const given = new Set(currencies);
  const listed = groupCurrencies(group);
  return [
    ...listed.filter((code) => given.has(code)),
    ...[...given].filter((code) => !listed.includes(code)).sort(),
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

const ORDINALS = ['1st', '2nd', '3rd', '4th'];

/** What a member can do about an Expense in a currency the Group doesn't list (#732). */
export interface UnlistedCurrencyFix {
  /** The currency the Group doesn't list. */
  currency: string;
  /** "CHF isn’t one of Lisbon & Tokyo’s currencies." */
  notListed: string;
  /** What to do about it: add it or change the currency, or only change it once the list is full. */
  ask: string;
  /** "Add CHF to Lisbon & Tokyo", or null when the Group already has 4 extra currencies. */
  add: string | null;
  /** The Group's currencies to change to, main currency first. */
  choices: string[];
  /** What adding does, or why it can't. */
  adding: string;
  /** What changing does: it keeps the amount and never converts it. */
  changing: string;
}

/**
 * The fix for an Expense or Draft in a currency its Group doesn't list: add the currency to the
 * Group, or change the record's currency and keep its amount as entered. Nothing is converted.
 */
export function unlistedCurrencyFix(
  group: GroupCurrencyList & { name: string },
  currency: string,
  amount: number | undefined,
): UnlistedCurrencyFix {
  const choices = groupCurrencies(group);
  const extras = choices.length - 1;
  const full = extras >= MAX_EXTRA_CURRENCIES;
  const kept = amount === undefined ? null : formatAmountAsEntered(amount, currency);
  return {
    currency,
    notListed: `${currency} isn’t one of ${group.name}’s currencies.`,
    ask: full ? 'Change this Expense’s currency.' : 'Add it, or change this Expense’s currency.',
    add: full ? null : `Add ${currency} to ${group.name}`,
    choices,
    adding: full
      ? `${group.name} already has ${MAX_EXTRA_CURRENCIES} extra currencies, the most a Group can have. An admin can remove one nothing uses in Group settings.`
      : `Adding lets everyone use ${currency}, the ${ORDINALS[extras]} of ${MAX_EXTRA_CURRENCIES} extra currencies.`,
    changing: kept
      ? `Changing keeps ${kept} and changes only the currency; nothing is converted.`
      : 'Changing changes only the currency; nothing is converted.',
  };
}
