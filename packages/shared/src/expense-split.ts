import { moneyParticipantId, parseDecimalUnits } from './exact-money';
import type { ExpenseSplitMethod } from './split-calculation';

/**
 * How an Expense is split, as a member chooses it (#123): Equal, Amounts, Percentage or Shares,
 * each person's resulting share, entries that need correcting, and whether the split adds up.
 * The shared exact-money rules decide every allocation; this only explains them. The app words
 * each reason for its own screen.
 */
export type SplitChoice = 'equal' | 'amounts' | 'percentage' | 'shares';

/** "Amounts" covers both stored methods that calculate identically: `unequal` and `exact`. */
export function splitChoiceOf(method: ExpenseSplitMethod): SplitChoice {
  return method === 'unequal' || method === 'exact' ? 'amounts' : method;
}

/**
 * The stored method for a choice, from the entry's current method and, when editing, the saved
 * Expense's. New Expenses send Amounts as `unequal`, like the web form; an `exact` Expense keeps
 * `exact` while Amounts is its method. Choosing the current method changes nothing, so its
 * values are kept.
 */
export function splitMethodFor(
  choice: SplitChoice,
  method: ExpenseSplitMethod,
  savedMethod?: ExpenseSplitMethod,
): ExpenseSplitMethod {
  if (splitChoiceOf(method) === choice) return method;
  if (choice !== 'amounts') return choice;
  return savedMethod === 'exact' ? 'exact' : 'unequal';
}

/** An Expense's split rows as the shared money rules allocate them, in exact minor units. */
export interface SplitAllocation {
  amountMinor: number;
  splitBetween: { user: unknown; amountMinor: number; percentage?: number; shares?: number }[];
}

export interface SplitLeftover {
  amountMinor: number;
  /** Everyone given a smallest unit beyond their exact share, in split order. */
  users: string[];
}

/**
 * Who got the leftover when Equal, Percentage or Shares don't divide the total exactly. Null
 * when nothing was rounded; Amounts never are.
 */
export function splitLeftover(
  method: ExpenseSplitMethod,
  allocation: SplitAllocation,
): SplitLeftover | null {
  if (method === 'unequal' || method === 'exact') return null;
  const rows = allocation.splitBetween;
  try {
    const weights = rows.map((row) =>
      BigInt(
        method === 'equal'
          ? 1
          : method === 'percentage'
            ? parseDecimalUnits(row.percentage ?? 0, 2)
            : (row.shares ?? 0),
      ),
    );
    const total = weights.reduce((sum, weight) => sum + weight, BigInt(0));
    if (total <= BigInt(0)) return null;
    const leftover: SplitLeftover = { amountMinor: 0, users: [] };
    rows.forEach((row, index) => {
      const exact = Number((BigInt(allocation.amountMinor) * weights[index]) / total);
      if (row.amountMinor <= exact) return;
      leftover.amountMinor += row.amountMinor - exact;
      leftover.users.push(moneyParticipantId(row.user));
    });
    return leftover.users.length ? leftover : null;
  } catch {
    // Historical weights that can't be read: there is nothing reliable to explain.
    return null;
  }
}
