import { getCurrencyPrecision } from './currency';
import {
  maxExpenseAmountMinor,
  parseAmountMinor,
  parseDecimalUnits,
  parseExpenseAmountMinor,
} from './exact-money';

/**
 * Who paid, with several people: what the entries add up to and what is left of the Expense
 * total, in exact minor units. The shared money rules still decide whether an Expense can be
 * saved; this only explains the arithmetic while a member types.
 */

/** What one person typed as their part of the Expense. */
export interface PayerEntry {
  user: string;
  amount: string;
}

/** The entered Expense total, its currency and each person's entry, as typed. */
export interface PayerEntries {
  amount: string;
  currency: string;
  payers: PayerEntry[];
}

/**
 * Why one person's entry can't count yet: it isn't an amount in the currency's precision, it
 * is below 0, or it is above the Expense limit. The app words each for its own screen.
 */
export type PayerEntryProblem = 'invalid' | 'negative' | 'too-large';

/** "0", "0.00" or "-0": nothing, in any currency's precision. Unreadable text isn't 0. */
function isZero(amount: string) {
  try {
    return parseDecimalUnits(amount, 0) === 0;
  } catch {
    return false;
  }
}

/**
 * A blank entry, or one of 0, means that person paid nothing, so they aren't a payer (#187).
 * Their entry stays as typed, so "0" can still become "0.50".
 */
export const enteredPayers = (payers: PayerEntry[]) =>
  payers.filter((payer) => payer.amount.trim() && !isZero(payer.amount));

/** Why one person's entry can't count yet. Blank entries and 0 are simply empty. */
export function payerEntryProblem(amount: string, currency: string): PayerEntryProblem | undefined {
  if (!amount.trim()) return undefined;
  let minor: number;
  try {
    minor = parseAmountMinor(amount, currency);
  } catch {
    return 'invalid';
  }
  if (minor < 0) return 'negative';
  if (minor > maxExpenseAmountMinor(currency)) return 'too-large';
  return undefined;
}

export interface PayerRemainder {
  /** The Expense total, or null while the amount isn't valid. */
  totalMinor: number | null;
  /** What the countable entries add up to. */
  assignedMinor: number;
  /** Total minus assigned: negative when more than the total is entered. Null without a total. */
  remainingMinor: number | null;
  /** Entries that can't count yet, by person, with why. */
  problems: Record<string, PayerEntryProblem>;
}

export function payerRemainder({ amount, currency, payers }: PayerEntries): PayerRemainder {
  let totalMinor: number | null = null;
  try {
    totalMinor = parseExpenseAmountMinor(amount, currency);
  } catch {
    // The Amount field explains this; there is nothing to divide yet.
  }
  const problems: Record<string, PayerEntryProblem> = {};
  let assignedMinor = 0;
  for (const payer of enteredPayers(payers)) {
    const problem = payerEntryProblem(payer.amount, currency);
    if (problem) problems[payer.user] = problem;
    else assignedMinor += parseAmountMinor(payer.amount, currency);
  }
  return {
    totalMinor,
    assignedMinor,
    remainingMinor: totalMinor === null ? null : totalMinor - assignedMinor,
    problems,
  };
}

/** One person's entry changed. Clearing it removes them from the payers. */
export function setPayerAmount(payers: PayerEntry[], user: string, amount: string): PayerEntry[] {
  if (!amount.trim()) return payers.filter((payer) => payer.user !== user);
  return payers.some((payer) => payer.user === user)
    ? payers.map((payer) => (payer.user === user ? { ...payer, amount } : payer))
    : [...payers, { user, amount }];
}

/**
 * Who "Give the rest to …" fills: the first member, in the Group's order, with nothing entered.
 * Null when nothing is left to assign or an entry still needs correcting.
 */
export function restRecipient(entries: PayerEntries, memberIds: string[]): string | null {
  const { remainingMinor, problems } = payerRemainder(entries);
  if (remainingMinor === null || remainingMinor <= 0 || Object.keys(problems).length) return null;
  const entered = new Set(enteredPayers(entries.payers).map((payer) => payer.user));
  return memberIds.find((id) => !entered.has(id)) ?? null;
}

/** Minor units as the digits a member would type, e.g. 4950 INR as "49.50". */
export function minorAmountText(minor: number, currency: string) {
  const digits = getCurrencyPrecision(currency);
  const text = String(minor).padStart(digits + 1, '0');
  return digits ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
}

/**
 * "Give the rest to …": the remaining amount, filled into the first empty member's entry, or
 * null when there is no one to give it to. It only fills the field; nothing is sent.
 */
export function giveRest(
  entries: PayerEntries,
  memberIds: string[],
): { payers: PayerEntry[] } | null {
  const user = restRecipient(entries, memberIds);
  const { remainingMinor } = payerRemainder(entries);
  if (!user || !remainingMinor) return null;
  return {
    payers: setPayerAmount(entries.payers, user, minorAmountText(remainingMinor, entries.currency)),
  };
}
