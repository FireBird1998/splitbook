import type { TagSnapshot } from '@splitbook/shared/tag-management';
/** Frozen legacy input values for the immutable main census. Production uses Refusal. */
import { Refusal, refusalVocabulary } from '@splitbook/shared/refusals';
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

export class ExportTooLargeError extends Error {
  constructor(
    readonly rows: number,
    readonly limit: number,
  ) {
    super('EXPORT_TOO_LARGE');
    this.name = 'ExportTooLargeError';
  }
}

export class TagManagementError extends Error {
  constructor(
    readonly code: ConstructorParameters<typeof Refusal>[0],
    readonly status: number,
    readonly snapshot?: TagSnapshot,
    readonly existingTagId?: string,
    message?: string,
  ) {
    super(message ?? code);
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
    | 'payment'
    | 'settlement'
    | 'tag'
    | 'export'
    | 'invitation'
    | 'draft',
): Error {
  if (caller === 'export' && cause instanceof ExportTooLargeError)
    return new Refusal('EXPORT_TOO_LARGE', { rows: cause.rows, limit: cause.limit });
  if (caller === 'tag' && cause instanceof TagManagementError)
    return new Refusal(cause.code, {
      snapshot: cause.snapshot,
      existingTagId: cause.existingTagId,
    });
  // The old census descriptions stay fixed while their migrated request producers are typed.
  if (
    caller === 'draft' &&
    cause.constructor === Error &&
    ![
      'BACKUP_ALL_TIME',
      'GROUP_DELETION_CHANGED',
      'GROUP_DELETION_NOT_REQUESTED',
      'GROUP_NOT_FOUND',
      'INVALID_CURRENCY',
      'INVALID_MONEY',
      'INVALID_REQUEST_FINGERPRINT',
    ].includes(cause.message) &&
    Object.hasOwn(refusalVocabulary, cause.message)
  )
    return new Refusal(cause.message as ConstructorParameters<typeof Refusal>[0]);
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
    // The completed migration raises these original central refusals as typed values.
    const central = [
      'FORBIDDEN',
      'INVALID_IDEMPOTENCY_KEY',
      'IDEMPOTENCY_CONFLICT',
      'STALE_REVISION',
      'REVISION_REQUIRED',
      'CURRENCY_LOCKED',
      'GROUP_ARCHIVED',
      'RECURRING_EXPENSES_OFF',
      'ACTIVITY_BACKLOG_FULL',
      'INVALID_MONEY',
      'INVALID_JSON',
      'INVALID_ID',
      'ACCOUNT_CHANGED',
    ] as const;
    const centralCode = central.find((candidate) => candidate === code);
    if (caller !== 'draft' && centralCode) return new Refusal(centralCode);

    if (
      caller === 'invitation' &&
      (code === 'ALREADY_INVITED' ||
        code === 'INVITATION_NOT_PENDING' ||
        code === 'INVITATION_EXPIRED')
    )
      return new Refusal(code);
    if (caller === 'expense' || caller === 'recurring' || caller === 'recurring-create') {
      if (code === 'INVALID_MEMBERS') return new Refusal(code, { variant: 'expense' });
      if (code === 'INVALID_TAG' || code === 'CURRENCY_MISMATCH') return new Refusal(code);
      if (caller !== 'expense' && code === 'INVALID_WINDOW') return new Refusal(code);
      if (caller === 'recurring-create' && code === 'NOT_HOUSEHOLD') return new Refusal(code);
    }
    if (caller === 'tag-change' && code === 'INVALID_TAG') return new Refusal(code);
    if (caller === 'payment' || caller === 'settlement') {
      if (code === 'FORBIDDEN_SETTLEMENT')
        return new Refusal(code);
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
