import { moneyParticipantId, sumMinorAmounts, toMajorAmount } from './exact-money';

/** One payer or share row of a stored Expense, in exact minor units. */
export interface ExpensePositionRow {
  /** Null when the row's member can't be identified; it then counts for no one. */
  userId: string | null;
  amountMinor: number;
}

export interface ExpensePositionInput {
  currency: string;
  paidBy: ExpensePositionRow[];
  splitBetween: ExpensePositionRow[];
}

/** What one Expense means for a member: they lent the others money, or owe it. */
export interface ExpensePosition {
  kind: 'lent' | 'owe';
  amountMinor: number;
  amount: number;
}

/**
 * The member's paid amount minus their share of one Expense, by `expenseRecordPosition`, in
 * the Expense's currency. Null when they neither paid nor share it, or when the two are equal.
 */
export function expensePosition(
  expense: ExpensePositionInput,
  userId: string,
): ExpensePosition | null {
  const rows = (list: ExpensePositionRow[]) =>
    list.map((row) => ({ user: row.userId, amountMinor: row.amountMinor }));
  const { kind, amountMinor } = expenseRecordPosition(
    { paidBy: rows(expense.paidBy), splitBetween: rows(expense.splitBetween) },
    userId,
  );
  if (kind !== 'lent' && kind !== 'owe') return null;
  return { kind, amountMinor, amount: toMajorAmount(amountMinor, expense.currency) };
}

/** A stored payer or share row: `user` is an id or a person the API populated. */
interface MinorRow {
  user: unknown;
  amountMinor: number;
}

/**
 * What one saved Expense means for a member: they lent the others money, owe it, paid
 * exactly their share, or aren't part of it. `counterpartyId` names the one person on the
 * other side when there is exactly one, as in "You owe Sam ₹953.33".
 */
export interface ExpenseRecordPosition {
  kind: 'lent' | 'owe' | 'even' | 'none';
  amountMinor: number;
  counterpartyId: string | null;
}

/**
 * The member's paid amount minus their share, in exact minor units from the stored
 * allocation, so the split's rounding is never recalculated.
 */
export function expenseRecordPosition(
  money: { paidBy: MinorRow[]; splitBetween: MinorRow[] },
  memberId: string,
): ExpenseRecordPosition {
  const net = new Map<string, number>();
  const add = (rows: MinorRow[], sign: 1 | -1) => {
    for (const row of rows) {
      const id = moneyParticipantId(row.user);
      net.set(id, sumMinorAmounts([net.get(id) ?? 0, sign * row.amountMinor]));
    }
  };
  add(money.paidBy, 1);
  add(money.splitBetween, -1);
  const own = net.get(memberId);
  const involved = [...money.paidBy, ...money.splitBetween].some(
    (row) => moneyParticipantId(row.user) === memberId && row.amountMinor > 0,
  );
  if (!own) return { kind: involved ? 'even' : 'none', amountMinor: 0, counterpartyId: null };
  // Those on the other side: who is owed when the member owes, who owes when they lent.
  const others = [...net].filter(
    ([id, value]) => id !== memberId && Math.sign(value) === -Math.sign(own),
  );
  return {
    kind: own > 0 ? 'lent' : 'owe',
    amountMinor: Math.abs(own),
    counterpartyId: others.length === 1 ? others[0][0] : null,
  };
}
