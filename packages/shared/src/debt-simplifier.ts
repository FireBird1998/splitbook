import {
  MoneyValidationError,
  assertSafeMinorAmount,
  readStoredAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
} from './exact-money';

interface Balance {
  userId: string;
  amount: number;
}

interface Transaction {
  from: string;
  to: string;
  amount: number;
}

export interface MinorBalance {
  userId: string;
  amountMinor: number;
}

interface CompatibleParticipant {
  user: string;
  amount: number;
  amountMinor?: number;
}

export interface BalanceExpense {
  currency?: string;
  moneyVersion?: number;
  paidBy: CompatibleParticipant[];
  splitBetween: CompatibleParticipant[];
}

export interface BalanceSettlement {
  currency?: string;
  moneyVersion?: number;
  paidBy: string;
  paidTo: string;
  amount: number;
  amountMinor?: number;
}

/** Exact greedy debt simplification. A residual imbalance is an error, never hidden. */
export function simplifyDebtsMinor(balances: MinorBalance[]) {
  if (sumMinorAmounts(balances.map((balance) => balance.amountMinor)) !== 0) {
    throw new MoneyValidationError('UNBALANCED_LEDGER', 'Ledger contributions do not balance');
  }
  const order = (a: MinorBalance, b: MinorBalance) =>
    b.amountMinor - a.amountMinor || a.userId.localeCompare(b.userId);
  const debtors = balances
    .filter((balance) => balance.amountMinor < 0)
    .map((balance) => ({ ...balance, amountMinor: -balance.amountMinor }))
    .sort(order);
  const creditors = balances
    .filter((balance) => balance.amountMinor > 0)
    .map((balance) => ({ ...balance }))
    .sort(order);
  const transactions: Array<{ from: string; to: string; amountMinor: number }> = [];
  let debtor = 0;
  let creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const amountMinor = Math.min(debtors[debtor].amountMinor, creditors[creditor].amountMinor);
    transactions.push({
      from: debtors[debtor].userId,
      to: creditors[creditor].userId,
      amountMinor,
    });
    debtors[debtor].amountMinor -= amountMinor;
    creditors[creditor].amountMinor -= amountMinor;
    if (debtors[debtor].amountMinor === 0) debtor += 1;
    if (creditors[creditor].amountMinor === 0) creditor += 1;
  }
  return transactions;
}

/** Compatible major-unit output. Pass the currency explicitly in new callers. */
export function simplifyDebts(balances: Balance[], currency = 'INR'): Transaction[] {
  return simplifyDebtsMinor(
    balances.map((balance) => ({
      userId: balance.userId,
      amountMinor: readStoredAmountMinor({ amount: balance.amount, currency }),
    })),
  ).map((transaction) => ({
    from: transaction.from,
    to: transaction.to,
    amount: toMajorAmount(transaction.amountMinor, currency),
  }));
}

/** One currency per invocation. Callers must partition legacy mixed-currency records. */
export function calculateNetBalancesMinor(
  expenses: BalanceExpense[],
  settlements: BalanceSettlement[],
  currency = 'INR',
): MinorBalance[] {
  const balances = new Map<string, number>();
  const add = (user: string, amount: number) => {
    const id = String(user);
    balances.set(id, assertSafeMinorAmount((balances.get(id) ?? 0) + amount));
  };
  for (const expense of expenses) {
    if (expense.currency !== undefined && expense.currency !== currency) {
      throw new MoneyValidationError('CURRENCY_MISMATCH', 'Different currencies cannot be added');
    }
    for (const payer of expense.paidBy) {
      add(
        payer.user,
        readStoredAmountMinor({ ...payer, currency, moneyVersion: expense.moneyVersion }),
      );
    }
    for (const participant of expense.splitBetween) {
      add(
        participant.user,
        -readStoredAmountMinor({ ...participant, currency, moneyVersion: expense.moneyVersion }),
      );
    }
  }
  for (const settlement of settlements) {
    if (settlement.currency !== undefined && settlement.currency !== currency) {
      throw new MoneyValidationError('CURRENCY_MISMATCH', 'Different currencies cannot be added');
    }
    const amountMinor = readStoredAmountMinor({ ...settlement, currency });
    add(settlement.paidBy, amountMinor);
    add(settlement.paidTo, -amountMinor);
  }
  return [...balances.entries()].map(([userId, amountMinor]) => ({ userId, amountMinor }));
}

export function calculateNetBalances(
  expenses: BalanceExpense[],
  settlements: BalanceSettlement[],
  currency = 'INR',
): Balance[] {
  return calculateNetBalancesMinor(expenses, settlements, currency).map((balance) => ({
    userId: balance.userId,
    amount: toMajorAmount(balance.amountMinor, currency),
  }));
}
