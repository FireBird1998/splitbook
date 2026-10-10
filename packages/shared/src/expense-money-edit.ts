import {
  assertStoredExpenseMoney,
  moneyParticipantId,
  normalizeExpenseMoney,
  parseAmountMinor,
  readStoredAmountMinor,
  toMajorAmount,
  type CompatibleMoneyRecord,
  type MoneyPayerInput,
  type MoneySplitInput,
} from './exact-money';
import type { ExpenseSplitMethod } from './split-calculation';

export interface StoredExpenseMoney extends CompatibleMoneyRecord {
  splitMethod: ExpenseSplitMethod;
  paidBy: Array<{ user: unknown; amount?: number; amountMinor?: number }>;
  splitBetween: Array<{
    user: unknown;
    amount?: number;
    amountMinor?: number;
    percentage?: number;
    shares?: number;
  }>;
}

export interface ExpenseMoneyInput {
  amount: string | number;
  currency: string;
  splitMethod: ExpenseSplitMethod;
  paidBy: MoneyPayerInput[];
  splitBetween: MoneySplitInput[];
}

/** Interpret stored money once, without replacing historical remainder allocations. */
export function readExpenseMoney(stored: StoredExpenseMoney) {
  assertStoredExpenseMoney(stored);
  const major = (row: { amount?: number; amountMinor?: number }) =>
    toMajorAmount(
      readStoredAmountMinor({
        ...row,
        currency: stored.currency,
        moneyVersion: stored.moneyVersion,
      }),
      stored.currency,
    );
  return normalizeExpenseMoney({
    amount: major(stored),
    currency: stored.currency,
    splitMethod: 'exact',
    paidBy: stored.paidBy.map((row) => ({
      user: moneyParticipantId(row.user),
      amount: major(row),
    })),
    splitBetween: stored.splitBetween.map((row) => ({
      user: moneyParticipantId(row.user),
      amount: major(row),
      ...(row.percentage !== undefined ? { percentage: row.percentage } : {}),
      ...(row.shares !== undefined ? { shares: row.shares } : {}),
    })),
  });
}

function definition(input: ExpenseMoneyInput) {
  const byUser = (a: { user: string }, b: { user: string }) => a.user.localeCompare(b.user);
  return JSON.stringify({
    currency: input.currency,
    amount: parseAmountMinor(input.amount, input.currency),
    splitMethod: input.splitMethod,
    paidBy: input.paidBy
      .map((row) => ({
        user: moneyParticipantId(row.user),
        amount: parseAmountMinor(row.amount, input.currency),
      }))
      .sort(byUser),
    splitBetween: input.splitBetween
      .map((row) => ({
        user: moneyParticipantId(row.user),
        ...(input.splitMethod === 'exact' || input.splitMethod === 'unequal'
          ? {
              amount:
                row.amount === undefined ? undefined : parseAmountMinor(row.amount, input.currency),
            }
          : input.splitMethod === 'percentage'
            ? { percentage: row.percentage }
            : input.splitMethod === 'shares'
              ? { shares: row.shares }
              : {}),
      }))
      .sort(byUser),
  });
}

/** A PATCH is merged before validation. Request fingerprints remain a separate policy. */
export function decideExpenseMoneyEdit(
  stored: StoredExpenseMoney,
  change: Partial<ExpenseMoneyInput>,
) {
  const storedMoney = readExpenseMoney(stored);
  const original = { ...storedMoney, splitMethod: stored.splitMethod };
  const merged = { ...original, ...change };
  const financialEdit = definition(original) !== definition(merged);
  const money = financialEdit
    ? normalizeExpenseMoney({
        ...merged,
        paidBy: merged.paidBy.map((row) => ({ ...row, user: moneyParticipantId(row.user) })),
        splitBetween: merged.splitBetween.map((row) => ({
          ...row,
          user: moneyParticipantId(row.user),
        })),
      })
    : {
        ...storedMoney,
        // Payer presentation follows the submitted rows; each person's amount remains canonical.
        paidBy: merged.paidBy.map(
          (row) => storedMoney.paidBy.find((payer) => payer.user === moneyParticipantId(row.user))!,
        ),
      };
  return { financialEdit, money };
}

/**
 * An entered zero is not a payer, but a historical Expense may retain zero payer rows.
 * Keep those rows only when the nonzero entries and every money field are unchanged.
 * Null means use the entered payers, with normal validation of deliberate money edits.
 */
export function keepSavedPayers(
  stored: StoredExpenseMoney,
  input: ExpenseMoneyInput,
): ExpenseMoneyInput | null {
  if (input.currency !== stored.currency) return null;
  try {
    const saved = readExpenseMoney(stored).paidBy;
    const paid = new Map(
      saved.filter((row) => row.amountMinor).map((row) => [row.user, row.amountMinor]),
    );
    const entries = new Map(
      input.paidBy.map((row) => [
        moneyParticipantId(row.user),
        parseAmountMinor(row.amount, input.currency),
      ]),
    );
    const samePayers =
      entries.size === input.paidBy.length &&
      entries.size === paid.size &&
      [...entries].every(([user, minor]) => paid.get(user) === minor);
    if (!samePayers) return null;
    const kept = { ...input, paidBy: saved.map(({ user, amount }) => ({ user, amount })) };
    return decideExpenseMoneyEdit(stored, kept).financialEdit ? null : kept;
  } catch {
    // Unreadable entries stay with the caller so normal validation can explain them.
    return null;
  }
}
