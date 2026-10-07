/**
 * What one listed Expense shows in a row (#310): the member's position, who paid and how it is
 * split. It reads an Expense as the Expense page read returns it, legacy rows included, and
 * works in exact minor units, so a position always matches Balances to the paisa.
 */
import { moneyParticipantId, readStoredAmountMinor } from './exact-money';
import type { ExpenseAllocationRead, ExpenseRead } from './expense-page-read';
import { expensePosition, type ExpensePosition } from './expense-position';

/** A payer or share row in exact minor units, or null when its stored money can't be read. */
function minorRows(expense: ExpenseRead, rows: ExpenseAllocationRead[]) {
  return rows.map((row) => {
    const id = moneyParticipantId(row.user);
    return {
      userId: id === '' ? null : id,
      amountMinor: readStoredAmountMinor({
        currency: expense.currency,
        moneyVersion: expense.moneyVersion,
        amount: row.amount,
        amountMinor: row.amountMinor,
      }),
    };
  });
}

/**
 * What the Expense means for the member, "lent" or "owe" with the exact amount, from the
 * shared `expensePosition`. Null when they paid exactly their share, aren't part of it, or
 * the stored money can't be read exactly (the row then shows no position rather than a
 * wrong one).
 */
export function listedExpensePosition(
  expense: ExpenseRead,
  userId: string,
): ExpensePosition | null {
  try {
    return expensePosition(
      {
        currency: expense.currency,
        paidBy: minorRows(expense, expense.paidBy),
        splitBetween: minorRows(expense, expense.splitBetween),
      },
      userId,
    );
  } catch {
    return null;
  }
}

/** How each split method reads, as Android's form names it. */
const SPLIT_LABELS: Record<ExpenseRead['splitMethod'], string> = {
  equal: 'Equally',
  unequal: 'By amounts',
  exact: 'By amounts',
  percentage: 'By percentage',
  shares: 'By shares',
};

/** "Equally · 3": the split method and how many people have a share of it. */
export function expenseSplitSummary(expense: {
  splitMethod: ExpenseRead['splitMethod'];
  splitBetween: ReadonlyArray<{ amount: number }>;
}) {
  const people = expense.splitBetween.filter((row) => row.amount > 0).length;
  return `${SPLIT_LABELS[expense.splitMethod]} · ${people}`;
}

/** Who paid, as a row names them. */
export interface ExpensePayerSummary {
  /** "You", a member's name, "Former member", or "2 people". */
  label: string;
  /** The one payer's id, for their avatar; null for a former member or several payers. */
  personId: string | null;
  /** The name to take initials from; null when several people paid. */
  name: string | null;
}

/** Who paid an Expense: the member as "You", someone else by name, or how many people. */
export function expensePayerSummary(
  expense: Pick<ExpenseRead, 'paidBy'>,
  userId: string,
): ExpensePayerSummary {
  const payers = expense.paidBy.filter((row) => row.amount > 0);
  if (payers.length > 1) return { label: `${payers.length} people`, personId: null, name: null };
  const [payer] = payers.length ? payers : expense.paidBy;
  const person = payer?.user;
  const id = moneyParticipantId(person);
  if (!person || id === '') return { label: 'Former member', personId: null, name: null };
  const name = typeof person === 'object' && person.name ? person.name : 'Former member';
  return { label: id === userId ? 'You' : name, personId: id, name };
}
