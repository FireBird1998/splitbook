import { moneyParticipantId, sumMinorAmounts } from '@splitbook/shared/exact-money';

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
