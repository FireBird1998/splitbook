import { getCurrencyPrecision } from '@splitbook/shared/currency';
import {
  MAX_EXPENSE_AMOUNT,
  parseAmountMinor,
  parseExpenseAmountMinor,
} from '@splitbook/shared/exact-money';
import type { ExpenseDraft } from './expense-draft';
import { amountError } from './field-feedback';

/**
 * Who paid, with several people: what the entries add up to and what is left of the Expense
 * total. Pure: no React, storage or requests. The shared money rules still decide whether the
 * draft can be saved; this only explains the arithmetic while the member types.
 */
type Payers = ExpenseDraft['payers'];
type PayerEntries = Pick<ExpenseDraft, 'amount' | 'currency' | 'payers'>;

/** A blank entry means that person paid nothing, so they aren't a payer. */
export const enteredPayers = (payers: Payers) => payers.filter((payer) => payer.amount.trim());

/** Why one person's entry can't count yet. Blank entries are simply empty. */
export function payerEntryError(amount: string, currency: string): string | undefined {
  if (!amount.trim()) return undefined;
  let minor: number;
  try {
    minor = parseAmountMinor(amount, currency);
  } catch {
    return amountError(amount, currency);
  }
  if (minor < 0) return 'Enter an amount of 0 or more.';
  if (minor > parseAmountMinor(MAX_EXPENSE_AMOUNT, currency)) return amountError(amount, currency);
  return undefined;
}

export interface PayerRemainder {
  /** The Expense total, or null while the amount isn't valid. */
  totalMinor: number | null;
  /** What the countable entries add up to. */
  assignedMinor: number;
  /** Total minus assigned: negative when more than the total is entered. Null without a total. */
  remainingMinor: number | null;
  /** Entries that can't count yet, by person. */
  errors: Record<string, string>;
}

export function payerRemainder({ amount, currency, payers }: PayerEntries): PayerRemainder {
  let totalMinor: number | null = null;
  try {
    totalMinor = parseExpenseAmountMinor(amount, currency);
  } catch {
    // The Amount field explains this; there is nothing to divide yet.
  }
  const errors: Record<string, string> = {};
  let assignedMinor = 0;
  for (const payer of enteredPayers(payers)) {
    const error = payerEntryError(payer.amount, currency);
    if (error) errors[payer.user] = error;
    else assignedMinor += parseAmountMinor(payer.amount, currency);
  }
  return {
    totalMinor,
    assignedMinor,
    remainingMinor: totalMinor === null ? null : totalMinor - assignedMinor,
    errors,
  };
}

/** One person's entry changed. Clearing it removes them from the payers. */
export function setPayerAmount(payers: Payers, user: string, amount: string): Payers {
  if (!amount.trim()) return payers.filter((payer) => payer.user !== user);
  return payers.some((payer) => payer.user === user)
    ? payers.map((payer) => (payer.user === user ? { ...payer, amount } : payer))
    : [...payers, { user, amount }];
}

/**
 * Who "Give the rest to …" fills: the first member, in the Group's order, with nothing entered.
 * Null when nothing is left to assign or an entry still needs correcting.
 */
export function restRecipient(draft: PayerEntries, memberIds: string[]): string | null {
  const { remainingMinor, errors } = payerRemainder(draft);
  if (remainingMinor === null || remainingMinor <= 0 || Object.keys(errors).length) return null;
  const entered = new Set(enteredPayers(draft.payers).map((payer) => payer.user));
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
  draft: PayerEntries,
  memberIds: string[],
): Pick<ExpenseDraft, 'payers'> | null {
  const user = restRecipient(draft, memberIds);
  const { remainingMinor } = payerRemainder(draft);
  if (!user || !remainingMinor) return null;
  return {
    payers: setPayerAmount(draft.payers, user, minorAmountText(remainingMinor, draft.currency)),
  };
}
