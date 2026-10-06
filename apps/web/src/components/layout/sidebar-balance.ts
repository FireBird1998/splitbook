import { formatCurrency } from '@splitbook/shared/currency';
import { readLegacyAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';

/** One currency of the member's balance in a Group, as the balances read sends it. */
export interface GroupBalanceAmount {
  currency: string;
  /** Major units, signed: below zero the member owes, above zero they are owed. */
  balance: number;
}

export type SidebarBalanceLine =
  | {
      tone: 'negative' | 'positive';
      /** "you owe ₹1,480.00" or "owed ₹620.00". */
      text: string;
      /** How many other currencies the member has a balance in ("· +1"). */
      more: number;
    }
  | { tone: 'settled'; text: 'Settled up'; more: 0 };

/**
 * The member's balance line for one Group in the sidebar.
 *
 * Each amount is read in exact minor units with the shared money helpers and stays in its own
 * currency; nothing is converted or added across currencies. A legacy Group with balances in
 * several currencies shows one of them, the Group's own currency when it has one, then the
 * read's order, with how many more there are. Returns null when an amount can't be read
 * exactly (an unknown currency, say), so the sidebar claims nothing rather than a wrong figure.
 */
export function sidebarBalanceLine(
  balances: readonly GroupBalanceAmount[],
  groupCurrency?: string,
): SidebarBalanceLine | null {
  try {
    const open = balances
      .map(({ currency, balance }) => ({
        currency,
        minor: readLegacyAmountMinor(balance, currency),
      }))
      .filter(({ minor }) => minor !== 0);
    if (open.length === 0) return { tone: 'settled', text: 'Settled up', more: 0 };
    const shown = open.find(({ currency }) => currency === groupCurrency) ?? open[0];
    const amount = formatCurrency(
      toMajorAmount(Math.abs(shown.minor), shown.currency),
      shown.currency,
    );
    return shown.minor < 0
      ? { tone: 'negative', text: `you owe ${amount}`, more: open.length - 1 }
      : { tone: 'positive', text: `owed ${amount}`, more: open.length - 1 };
  } catch {
    return null;
  }
}

/** What "· +N" means, for screen readers. */
export function moreCurrenciesLabel(more: number): string {
  return `and ${more} more ${more === 1 ? 'currency' : 'currencies'}`;
}
