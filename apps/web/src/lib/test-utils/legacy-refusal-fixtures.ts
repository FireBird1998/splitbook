/** Frozen legacy input values for the immutable main census. Production uses Refusal. */
import { Refusal } from '@splitbook/shared/refusals';
import type { ExtraCurrencyUse } from '@splitbook/shared/group-currency-settings';
/** A member's non-zero balance in each currency, in minor units: negative owes, positive is owed. */
type OpenBalances = { currency: string; amountMinor: number }[];

/** A recurring Expense in its problem state, by name (#257). */
type BrokenRecurringExpenses = { id: string; description: string }[];

/** What keeps a member in the Group, whether they leave or an admin removes them. */
type DepartureBlock =
  | { code: 'OPEN_BALANCE'; balances: OpenBalances }
  | { code: 'RECURRING_EXPENSE_PROBLEM'; recurringExpenses: BrokenRecurringExpenses };

/**
 * Why a member can't leave yet: an open balance, a recurring Expense in its problem state that
 * still includes them (#257), or they are the last admin.
 */
export class LeaveBlockedError extends Error {
  constructor(
    readonly code: DepartureBlock['code'] | 'LAST_ADMIN',
    /** For OPEN_BALANCE: the member's non-zero balance in each currency, in minor units. */
    readonly balances: OpenBalances = [],
    /** For RECURRING_EXPENSE_PROBLEM: the recurring Expenses that still include them. */
    readonly recurringExpenses: BrokenRecurringExpenses = [],
    /** Whether the member is an admin, who can remove themselves from those. */
    readonly admin = false,
  ) {
    super(code);
    this.name = 'LeaveBlockedError';
  }
}

/**
 * Why an admin can't remove this member yet: what would stop the member leaving. They still owe
 * or are owed in some currency, so their Debts would stay in Balances with nobody able to record
 * them (#875), or a recurring Expense in its problem state still includes them, so its missed
 * months would fall on the others once it is repaired (#257).
 */
export class RemovalBlockedError extends Error {
  readonly code: DepartureBlock['code'];
  readonly balances: OpenBalances;
  readonly recurringExpenses: BrokenRecurringExpenses;

  constructor(
    block: DepartureBlock,
    /** The member, as the refusal names them. */
    readonly memberName: string,
  ) {
    super(block.code);
    this.name = 'RemovalBlockedError';
    this.code = block.code;
    this.balances = block.code === 'OPEN_BALANCE' ? block.balances : [];
    this.recurringExpenses =
      block.code === 'RECURRING_EXPENSE_PROBLEM' ? block.recurringExpenses : [];
  }
}

/**
 * An extra currency that can't be removed yet (#721): an Expense, a Settlement or a To review
 * item still uses it. It carries what uses it, as the viewer may see it, for the settings to list.
 */
class CurrencyInUseError extends Error {
  readonly code = 'CURRENCY_IN_USE';

  constructor(
    currency: string,
    groupName: string,
    readonly use: ExtraCurrencyUse,
  ) {
    super(`${currency} can’t be removed while ${groupName} uses it.`);
    this.name = 'CurrencyInUseError';
  }
}

/** A currency to remove that isn't one of the Group's extra currencies. */
class CurrencyNotListedError extends Error {
  readonly code = 'CURRENCY_NOT_LISTED';

  constructor(currency: string) {
    super(`${currency} isn’t one of this Group’s extra currencies.`);
    this.name = 'CurrencyNotListedError';
  }
}

/** The Group's main currency, which can't be removed: a conflict with its state, like its lock. */
class CurrencyIsMainError extends Error {
  readonly code = 'CURRENCY_IS_MAIN';

  constructor(currency: string) {
    super(`${currency} is the main currency, so it can’t be removed.`);
    this.name = 'CurrencyIsMainError';
  }
}

const currentCurrencies = new WeakMap<Error, Refusal>();

export function currencyInUseCase(currency: string, groupName: string, use: ExtraCurrencyUse) {
  const baseline = new CurrencyInUseError(currency, groupName, use);
  currentCurrencies.set(baseline, new Refusal('CURRENCY_IN_USE', { currency, groupName, use }));
  return baseline;
}
export function currencyNotListedCase(currency: string) {
  const baseline = new CurrencyNotListedError(currency);
  currentCurrencies.set(baseline, new Refusal('CURRENCY_NOT_LISTED', { currency }));
  return baseline;
}
export function currencyIsMainCase(currency: string) {
  const baseline = new CurrencyIsMainError(currency);
  currentCurrencies.set(baseline, new Refusal('CURRENCY_IS_MAIN', { currency }));
  return baseline;
}

/** Keep the baseline descriptions while injecting the type the migrated producer now throws. */
export function currentCause(
  cause: Error,
  caller?:
    | 'leave'
    | 'demotion'
    | 'removal'
    | 'expense'
    | 'recurring'
    | 'recurring-create'
    | 'tag-change'
    | 'payment',
): Error {
  const currency = currentCurrencies.get(cause);
  if (currency) return currency;
  if (caller === 'leave' && cause instanceof LeaveBlockedError) {
    if (cause.code === 'LAST_ADMIN') return new Refusal(cause.code);
    if (cause.code === 'OPEN_BALANCE') return new Refusal(cause.code, { balances: cause.balances });
    return new Refusal(cause.code, {
      recurringExpenses: cause.recurringExpenses,
      admin: cause.admin,
    });
  }
  if (caller === 'removal' && cause instanceof RemovalBlockedError) {
    if (cause.code === 'OPEN_BALANCE')
      return new Refusal(cause.code, {
        balances: cause.balances,
        memberName: cause.memberName,
        variant: 'removal',
      });
    return new Refusal(cause.code, {
      recurringExpenses: cause.recurringExpenses,
      memberName: cause.memberName,
      variant: 'removal',
    });
  }
  if (cause.constructor === Error) {
    const code = cause.message;
    if (caller === 'expense' || caller === 'recurring' || caller === 'recurring-create') {
      if (code === 'INVALID_MEMBERS') return new Refusal(code, { variant: 'expense' });
      if (code === 'INVALID_TAG' || code === 'CURRENCY_MISMATCH') return new Refusal(code);
      if (caller !== 'expense' && code === 'INVALID_WINDOW') return new Refusal(code);
      if (caller === 'recurring-create' && code === 'NOT_HOUSEHOLD') return new Refusal(code);
    }
    if (caller === 'tag-change' && code === 'INVALID_TAG') return new Refusal(code);
    if (caller === 'payment') {
      if (code === 'FORBIDDEN_SETTLEMENT') return new Refusal(code, { variant: 'payment' });
      if (
        code === 'INVALID_MEMBERS' ||
        code === 'SAME_PARTY' ||
        code === 'CURRENCY_MISMATCH' ||
        code === 'NO_SETTLEMENT_DEBT' ||
        code === 'SETTLEMENT_TRANSACTIONS_REQUIRED'
      )
        return new Refusal(code);
    }

    if (code === 'LAST_ADMIN' && (caller === 'demotion' || caller === 'removal'))
      return new Refusal(code, { variant: caller });
    if (caller === 'removal' && (code === 'SELF_REMOVE' || code === 'REMOVAL_CONFLICT'))
      return new Refusal(code);
    if (
      caller === 'leave' &&
      (code === 'GROUP_DELETION_CONFIRMATION_REQUIRED' ||
        code === 'GROUP_DELETION_UNAVAILABLE' ||
        code === 'LEAVE_CONFLICT')
    )
      return new Refusal(code);
  }
  return cause;
}
