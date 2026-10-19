import type { BalanceExpense, BalanceSettlement } from './debt-simplifier';
import {
  MoneyValidationError,
  assertSafeMinorAmount,
  calculateSplitAmountsMinor,
  readStoredAmountMinor,
  sumMinorAmounts,
} from './exact-money';

/** A pair's Debt, in one currency's exact minor units. */
export interface Debt {
  from: string;
  to: string;
  amountMinor: number;
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Round each share with the existing largest-remainder rule, then reconcile payer totals.
 * A rounding unit may move only between a cell's floor and ceiling. Alternating paths
 * through shares preserve every row total while restoring every payer's exact column.
 * Prefer a payer's own share for tie adjustments, then stable member-ID order.
 */
function expenseAllocations(expense: BalanceExpense, currency: string) {
  const paid = expense.paidBy
    .map((payer) => ({
      user: String(payer.user),
      shares: readStoredAmountMinor({ ...payer, currency, moneyVersion: expense.moneyVersion }),
    }))
    .sort((a, b) => compareIds(a.user, b.user));
  const shares = expense.splitBetween
    .map((share) => ({
      user: String(share.user),
      amountMinor: readStoredAmountMinor({
        ...share,
        currency,
        moneyVersion: expense.moneyVersion,
      }),
    }))
    .sort((a, b) => compareIds(a.user, b.user));
  const total = sumMinorAmounts(paid.map((payer) => payer.shares));
  if (total !== sumMinorAmounts(shares.map((share) => share.amountMinor))) {
    throw new MoneyValidationError('UNBALANCED_LEDGER', 'Ledger contributions do not balance');
  }
  if (total === 0) return [];
  const rows = shares.map((share) => ({
    user: share.user,
    cells: calculateSplitAmountsMinor('shares', share.amountMinor, paid).map(
      (allocation, column) => {
        const numerator = BigInt(share.amountMinor) * BigInt(paid[column].shares);
        const floor = Number(numerator / BigInt(total));
        return {
          ...allocation,
          floor,
          ceiling: floor + (numerator % BigInt(total) === BigInt(0) ? 0 : 1),
        };
      },
    ),
  }));
  const needs = paid.map(
    (payer, column) =>
      payer.shares - sumMinorAmounts(rows.map((row) => row.cells[column].amountMinor)),
  );
  for (let start = 0; start < needs.length; start += 1) {
    while (needs[start] < 0) {
      const parents = new Map<number, { column: number; row: number }>();
      const visited = new Set([start]);
      const queue = [start];
      let end = -1;
      for (let index = 0; index < queue.length && end < 0; index += 1) {
        const column = queue[index];
        const orderedRows = rows
          .map((row, rowIndex) => ({ row, rowIndex }))
          .sort(
            (a, b) =>
              Number(b.row.user === paid[column].user) - Number(a.row.user === paid[column].user) ||
              compareIds(a.row.user, b.row.user),
          );
        for (const { row, rowIndex } of orderedRows) {
          if (end >= 0) break;
          if (row.cells[column].amountMinor <= row.cells[column].floor) continue;
          for (let next = 0; next < paid.length; next += 1) {
            if (visited.has(next) || row.cells[next].amountMinor >= row.cells[next].ceiling)
              continue;
            visited.add(next);
            parents.set(next, { column, row: rowIndex });
            queue.push(next);
            if (needs[next] > 0) {
              end = next;
              break;
            }
          }
        }
      }
      if (end < 0)
        throw new MoneyValidationError('UNBALANCED_LEDGER', 'Unable to allocate exact Debts');
      needs[start] += 1;
      needs[end] -= 1;
      while (end !== start) {
        const previous = parents.get(end)!;
        rows[previous.row].cells[previous.column].amountMinor -= 1;
        rows[previous.row].cells[end].amountMinor += 1;
        end = previous.column;
      }
    }
  }
  return rows;
}

/** One currency per call, as with calculateNetBalancesMinor. */
export function calculateDebtsMinor(
  expenses: BalanceExpense[],
  settlements: BalanceSettlement[],
  currency = 'INR',
): Debt[] {
  for (const entry of [...expenses, ...settlements]) {
    if (entry.currency !== undefined && entry.currency !== currency) {
      throw new MoneyValidationError('CURRENCY_MISMATCH', 'Different currencies cannot be added');
    }
  }
  const pairs = new Map<string, Debt>();
  const add = (from: string, to: string, amountMinor: number) => {
    if (from === to) return;
    const [low, high] = [from, to].sort();
    const key = JSON.stringify([low, high]);
    const pair = pairs.get(key) ?? { from: low, to: high, amountMinor: 0 };
    pair.amountMinor = assertSafeMinorAmount(
      pair.amountMinor + (from === low ? amountMinor : -amountMinor),
    );
    pairs.set(key, pair);
  };
  for (const expense of expenses) {
    for (const row of expenseAllocations(expense, currency)) {
      for (const allocation of row.cells) {
        add(row.user, allocation.user, allocation.amountMinor);
      }
    }
  }
  for (const settlement of settlements) {
    add(
      String(settlement.paidTo),
      String(settlement.paidBy),
      readStoredAmountMinor({ ...settlement, currency }),
    );
  }
  return [...pairs.values()]
    .filter((pair) => pair.amountMinor !== 0)
    .map((pair) =>
      pair.amountMinor > 0
        ? pair
        : {
            from: pair.to,
            to: pair.from,
            amountMinor: -pair.amountMinor,
          },
    )
    .sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to));
}
