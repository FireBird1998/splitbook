import {
  MoneyValidationError,
  readStoredAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
} from './exact-money';

/**
 * Pure per-member accumulation maths for the expense summary's opt-in
 * `byMember` breakdown (v4 monthly views). No DB access — takes the lean
 * `{ paidBy, splitBetween }[]` shape `getGroupExpenses` already loads and the
 * group's member id list, and returns one row per member.
 *
 * Factored like `split-calculation` and `debt-simplifier`: if the in-memory
 * pass ever needs to become an `$unwind` + `$group` pipeline, this function's
 * contract is what the pipeline must reproduce.
 */

export interface ExpenseSummaryMemberInput {
  /** Group member id (string form), in stable display order. */
  memberIds: string[];
}

export interface LeanExpenseContribution {
  currency?: string;
  moneyVersion?: number;
  paidBy?: Array<{ user: unknown; amount?: number; amountMinor?: number }> | null;
  splitBetween?: Array<{ user: unknown; amount?: number; amountMinor?: number }> | null;
}

export interface MemberBreakdownRow {
  userId: string;
  /** Sum of this member's paidBy amounts in the window. */
  paid: number;
  /** Sum of this member's splitBetween amounts in the window. */
  share: number;
  /** share - paid. Positive = under-contributed this window. */
  net: number;
}

function idString(user: unknown): string | null {
  if (user == null) return null;
  if (typeof user === 'string') return user;
  if (typeof user === 'object') {
    const record = user as { _id?: unknown };
    if (record._id != null) return String(record._id);
  }
  return String(user);
}

function participantMinor(
  expense: LeanExpenseContribution,
  participant: { amount?: number; amountMinor?: number },
  currency: string,
): number {
  if (expense.currency !== undefined && expense.currency !== currency) {
    throw new MoneyValidationError('CURRENCY_MISMATCH', 'Different currencies cannot be added');
  }
  return readStoredAmountMinor({ ...participant, currency, moneyVersion: expense.moneyVersion });
}

/**
 * Accumulate per-member paid / share / net over an expense window.
 *
 * Every listed member appears exactly once — members with no activity get
 * zero rows so the UI table has a stable row set across months. Amounts are
 * attributed to listed members only; expenses cannot name non-members (the
 * service asserts membership at write time), so within a group's window the
 * invariants `sum(paid) === sum(share) === window total` and `sum(net) === 0`
 * hold within rounding tolerance.
 */
export function computeMemberBreakdown(
  expenses: LeanExpenseContribution[],
  memberIds: string[],
  currency = 'INR',
): MemberBreakdownRow[] {
  const totals = new Map<string, { paid: number; share: number }>();
  for (const id of memberIds) totals.set(id, { paid: 0, share: 0 });

  for (const expense of expenses) {
    for (const payer of expense.paidBy ?? []) {
      const id = idString(payer.user);
      if (!id) continue;
      const row = totals.get(id);
      if (row) row.paid = sumMinorAmounts([row.paid, participantMinor(expense, payer, currency)]);
    }
    for (const participant of expense.splitBetween ?? []) {
      const id = idString(participant.user);
      if (!id) continue;
      const row = totals.get(id);
      if (row)
        row.share = sumMinorAmounts([row.share, participantMinor(expense, participant, currency)]);
    }
  }

  return memberIds.map((userId) => {
    const row = totals.get(userId)!;
    return {
      userId,
      paid: toMajorAmount(row.paid, currency),
      share: toMajorAmount(row.share, currency),
      net: toMajorAmount(sumMinorAmounts([row.share, -row.paid]), currency),
    };
  });
}

/**
 * Derive the caller's owe / get-back figures from the same accumulation pass
 * as the member breakdown — one loop, no duplicated per-user branch.
 */
export function computeUserOweGetBack(
  expenses: LeanExpenseContribution[],
  userId: string,
  currency = 'INR',
): { userOwes: number; userGetsBack: number } {
  let userOwes = 0;
  let userGetsBack = 0;

  for (const expense of expenses) {
    const paidEntry = expense.paidBy?.find((p) => idString(p.user) === userId);
    const splitEntry = expense.splitBetween?.find((s) => idString(s.user) === userId);

    const net = sumMinorAmounts([
      splitEntry ? participantMinor(expense, splitEntry, currency) : 0,
      paidEntry ? -participantMinor(expense, paidEntry, currency) : 0,
    ]);
    if (net > 0) userOwes = sumMinorAmounts([userOwes, net]);
    if (net < 0) userGetsBack = sumMinorAmounts([userGetsBack, -net]);
  }

  return {
    userOwes: toMajorAmount(userOwes, currency),
    userGetsBack: toMajorAmount(userGetsBack, currency),
  };
}
