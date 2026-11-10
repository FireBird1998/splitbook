import { formatCurrency } from './currency';
import { toMajorAmount } from './exact-money';
import { extraCurrenciesProblem } from './group-currencies';
import type { ExtraCurrencyUse } from './group-currency-settings';
import type { TagSnapshot } from './tag-management';
import { unsupportedCurrencyEditRefusal } from './expense-money-edit';

interface Balance {
  currency: string;
  amountMinor: number;
}
interface BrokenRecurringExpense {
  id: string;
  description: string;
}

/** Inputs to the vocabulary's words. Status and words are never supplied by a service. */
interface RefusalContext {
  variant?: string;
  field?: ReadonlyArray<string | number>;
  snapshot?: TagSnapshot;
  existingTagId?: string;
  currency?: string;
  groupName?: string;
  use?: ExtraCurrencyUse;
  rows?: number;
  limit?: number;
  balances?: Balance[];
  recurringExpenses?: BrokenRecurringExpense[];
  admin?: boolean;
  memberName?: string;
  digits?: number;
  mainCurrency?: string;
  extraCurrencies?: string[];
}
interface Answer {
  status: number;
  words: string | ((data: RefusalContext) => string);
  includeCode: boolean;
}

/**
 * Answers recorded before migration (#1079). A 500 entry records an unhandled code, including
 * codes confined to maintenance operations. Naming it here does not approve a new HTTP answer.
 * Variants name the caller whose existing answer differs from the default.
 */
export const refusalVocabulary = {
  ACCOUNT_CHANGED: {
    status: 419,
    words: 'The signed-in account changed in another tab. Reload this page to continue.',
    includeCode: true,
    variants: {},
  },
  ACTIVITY_BACKLOG_FULL: {
    status: 503,
    words: 'The audit feed is temporarily unavailable. Please retry later.',
    includeCode: true,
    variants: {},
  },
  ALREADY_INVITED: {
    status: 409,
    words: 'This person has already been invited',
    includeCode: false,
    variants: {},
  },
  AMBIGUOUS_TAG: {
    status: 409,
    words: 'This Tag has ambiguous historical references and cannot be renamed.',
    includeCode: true,
    variants: {},
  },
  BACKUP_ALL_TIME: {
    status: 500,
    words: 'Internal server error',
    includeCode: false,
    variants: {},
  },
  CURRENCY_IN_USE: {
    status: 409,
    words: (data: RefusalContext) =>
      `${data.currency} can’t be removed while ${data.groupName} uses it.`,
    includeCode: true,
    variants: {},
  },
  CURRENCY_IS_MAIN: {
    status: 409,
    words: (data: RefusalContext) =>
      `${data.currency} is the main currency, so it can’t be removed.`,
    includeCode: true,
    variants: {},
  },
  CURRENCY_LOCKED: {
    status: 409,
    words: 'Currency cannot change after this Group has financial records.',
    includeCode: true,
    variants: {},
  },
  CURRENCY_MISMATCH: {
    status: 422,
    words: 'Currency is not one of this Group’s currencies',
    includeCode: true,
    variants: {
      debt_simplifier_ts_Different_currencies_cannot_be_added: {
        status: 422,
        words: 'Different currencies cannot be added',
        includeCode: true,
      },
      debts_before_simplifying_ts_Different_currencies_cannot_be_added: {
        status: 422,
        words: 'Different currencies cannot be added',
        includeCode: true,
      },
      expense_summary_ts_Different_currencies_cannot_be_added: {
        status: 422,
        words: 'Different currencies cannot be added',
        includeCode: true,
      },
      ledger_currency_ts_Add_EUR_to_the_Group_s_currencies_to_restore_it: {
        status: 422,
        words: 'Add EUR to the Group’s currencies to restore it.',
        includeCode: true,
      },
    },
  },
  CURRENCY_NOT_LISTED: {
    status: 404,
    words: (data: RefusalContext) => `${data.currency} isn’t one of this Group’s extra currencies.`,
    includeCode: true,
    variants: {},
  },
  DATABASE_UNAVAILABLE: {
    status: 503,
    words: 'Couldn’t reach Splitbook. Try again.',
    includeCode: true,
    variants: {},
  },
  DRAFTS_DISABLED: {
    status: 404,
    words: 'Drafts are not enabled',
    includeCode: true,
    variants: {},
  },
  DRAFT_GROUP_LIMIT: {
    status: 409,
    words: 'You have 100 items waiting in this Group. Save or delete some before keeping more.',
    includeCode: true,
    variants: {},
  },
  DRAFT_NOT_FOUND: { status: 404, words: 'Draft not found', includeCode: true, variants: {} },
  DRAFT_TRANSACTIONS_REQUIRED: {
    status: 503,
    words: 'Draft changes are temporarily unavailable.',
    includeCode: true,
    variants: {},
  },
  DUPLICATE_PARTICIPANTS: {
    status: 422,
    words: 'Each participant may appear only once',
    includeCode: true,
    variants: {
      exact_money_ts_Each_person_can_appear_only_once: {
        status: 422,
        words: 'Each person can appear only once',
        includeCode: true,
      },
    },
  },
  EMPTY_PARTICIPANTS: {
    status: 422,
    words: 'Stored participants are missing',
    includeCode: true,
    variants: {
      exact_money_ts_At_least_one_payer_and_participant_are_required: {
        status: 422,
        words: 'At least one payer and participant are required',
        includeCode: true,
      },
    },
  },
  EXPORT_TOO_LARGE: {
    status: 413,
    words: (data: RefusalContext) =>
      `This export would have ${data.rows!.toLocaleString('en-US')} rows, more than the ${data.limit!.toLocaleString('en-US')} one download can hold. Pick fewer Groups or a shorter period.`,
    includeCode: true,
    variants: {},
  },
  FORBIDDEN: {
    status: 403,
    words: 'Forbidden',
    includeCode: true,
    variants: {
      legacyRoute: { status: 403, words: 'Forbidden', includeCode: false },
    },
  },
  FORBIDDEN_SETTLEMENT: {
    status: 422,
    words: 'Only the payer or recipient can record this settlement',
    includeCode: true,
    variants: {
      settlementBatch: {
        status: 422,
        words: 'Only the payer or recipient can record this payment',
        includeCode: true,
      },
    },
  },
  GROUP_ARCHIVED: {
    status: 409,
    words: 'This Group was archived, so nothing more can be saved in it.',
    includeCode: true,
    variants: {},
  },
  GROUP_DELETION_CHANGED: {
    status: 500,
    words: 'Internal server error',
    includeCode: false,
    variants: {},
  },
  GROUP_DELETION_CONFIRMATION_REQUIRED: {
    status: 409,
    words:
      'You are the last member. Leaving will permanently delete this Group and its history. Confirm deletion to continue.',
    includeCode: true,
    variants: {},
  },
  GROUP_DELETION_NOT_REQUESTED: {
    status: 500,
    words: 'Internal server error',
    includeCode: false,
    variants: {},
  },
  GROUP_DELETION_UNAVAILABLE: {
    status: 409,
    words:
      'Permanent Group deletion is unavailable here. You are still a member; no history was deleted.',
    includeCode: true,
    variants: {},
  },
  GROUP_NOT_FOUND: {
    status: 500,
    words: 'Internal server error',
    includeCode: false,
    variants: {},
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    words: 'This submission key was already used for different data. Start a new submission.',
    includeCode: true,
    variants: {},
  },
  INVALID_AMOUNT_RANGE: {
    status: 422,
    words: 'The lowest amount must not be more than the highest',
    includeCode: true,
    variants: {},
  },
  INVALID_CROSS_CURRENCY_SETTLEMENT: {
    status: 422,
    words: 'Enter a positive rate with at most 18 decimal places',
    includeCode: true,
    variants: {
      cross_currency_settlement_ts_The_rate_must_be_positive: {
        status: 422,
        words: 'The rate must be positive',
        includeCode: true,
      },
      cross_currency_settlement_ts_Both_amounts_must_be_at_least_one_minor_unit: {
        status: 422,
        words: 'Both amounts must be at least one minor unit',
        includeCode: true,
      },
      cross_currency_settlement_ts_The_rate_is_too_small_to_represent: {
        status: 422,
        words: 'The rate is too small to represent',
        includeCode: true,
      },
      cross_currency_settlement_ts_Choose_two_different_currencies: {
        status: 422,
        words: 'Choose two different currencies',
        includeCode: true,
      },
      cross_currency_settlement_ts_Enter_exactly_two_of_the_cleared_amount_paid_amount_and_rate: {
        status: 422,
        words: 'Enter exactly two of the cleared amount, paid amount and rate',
        includeCode: true,
      },
    },
  },
  INVALID_CURRENCY: {
    status: 500,
    words: 'Internal server error',
    includeCode: false,
    variants: {
      insightsQuery: {
        status: 400,
        words: 'Send a currency code, such as INR.',
        includeCode: true,
      },
    },
  },
  INVALID_GROUP_CURRENCIES: {
    status: 422,
    words: (data: RefusalContext) =>
      extraCurrenciesProblem(data.mainCurrency!, data.extraCurrencies!)!,
    includeCode: true,
    variants: {
      group_currencies_ts_INR_is_the_main_currency_so_it_can_t_also_be_an_extra_currency: {
        status: 422,
        words: 'INR is the main currency, so it can’t also be an extra currency.',
        includeCode: true,
      },
      group_currencies_ts_EUR_is_listed_twice: {
        status: 422,
        words: 'EUR is listed twice.',
        includeCode: true,
      },
      group_currencies_ts_A_Group_can_have_at_most_4_extra_currencies: {
        status: 422,
        words: 'A Group can have at most 4 extra currencies.',
        includeCode: true,
      },
    },
  },
  INVALID_ID: { status: 400, words: 'Invalid id', includeCode: true, variants: {} },
  INVALID_IDEMPOTENCY_KEY: {
    status: 422,
    words: 'Invalid submission key',
    includeCode: true,
    variants: {},
  },
  INVALID_JSON: { status: 400, words: 'Invalid JSON body', includeCode: true, variants: {} },
  INVALID_MEMBERS: {
    status: 422,
    words: 'Both payer and recipient must be group members',
    includeCode: true,
    variants: {
      expenses: {
        status: 422,
        words: 'All payers and split participants must be group members',
        includeCode: true,
      },
      expenseEdit: {
        status: 422,
        words: 'All payers and split participants must be group members',
        includeCode: true,
      },
      recurring: {
        status: 422,
        words: 'All payers and split participants must be group members',
        includeCode: true,
      },
      recurringEdit: {
        status: 422,
        words: 'All payers and split participants must be group members',
        includeCode: true,
      },
    },
  },
  INVALID_MONEY: {
    status: 422,
    words: 'Enter a positive amount with the currency’s supported precision.',
    includeCode: true,
    variants: {
      exact_money_ts_Enter_a_valid_decimal_amount: {
        status: 422,
        words: 'Enter a valid decimal amount',
        includeCode: true,
      },
      exact_money_ts_Stored_amount_is_missing: {
        status: 422,
        words: 'Stored amount is missing',
        includeCode: true,
      },
    },
  },
  INVALID_MONEY_PRECISION: {
    status: 422,
    words: (data: RefusalContext) => `Amount supports at most ${data.digits} decimal places`,
    includeCode: true,
    variants: {},
  },
  INVALID_MONEY_RANGE: {
    status: 422,
    words: 'Stored amount must be positive',
    includeCode: true,
    variants: {
      exact_money_ts_Amount_must_be_positive_and_at_most_10_000_000: {
        status: 422,
        words: 'Amount must be positive and at most 10,000,000',
        includeCode: true,
      },
    },
  },
  INVALID_MONEY_VERSION: {
    status: 422,
    words: 'Stored money version is invalid',
    includeCode: true,
    variants: {},
  },
  INVALID_PARTY: { status: 422, words: 'Choose both people', includeCode: true, variants: {} },
  INVALID_PAYER_AMOUNT: {
    status: 422,
    words: 'Payer amounts cannot be negative',
    includeCode: true,
    variants: {},
  },
  INVALID_PERCENTAGE: {
    status: 422,
    words: 'Percentages must be between 0 and 100',
    includeCode: true,
    variants: {},
  },
  INVALID_REQUEST_FINGERPRINT: {
    status: 500,
    words: 'Internal server error',
    includeCode: false,
    variants: {},
  },
  INVALID_SETTLEMENT_BATCH: {
    status: 422,
    words: 'Choose between 1 and 32 Debts',
    includeCode: true,
    variants: {
      settlement_batch_ts_Choose_each_cleared_currency_once: {
        status: 422,
        words: 'Choose each cleared currency once',
        includeCode: true,
      },
      settlement_batch_ts_Enter_a_rate_for_EUR: {
        status: 422,
        words: 'Enter a rate for EUR',
        includeCode: true,
      },
    },
  },
  INVALID_SHARES: {
    status: 422,
    words: 'Shares must be whole numbers within the supported range',
    includeCode: true,
    variants: {
      exact_money_ts_Shares_cannot_be_negative: {
        status: 422,
        words: 'Shares cannot be negative',
        includeCode: true,
      },
      exact_money_ts_Total_split_weight_must_be_positive: {
        status: 422,
        words: 'Total split weight must be positive',
        includeCode: true,
      },
    },
  },
  INVALID_SPLIT: {
    status: 422,
    words: 'Stored allocations cannot be negative',
    includeCode: true,
    variants: {
      exact_money_ts_A_nonnegative_amount_and_participants_are_required: {
        status: 422,
        words: 'A nonnegative amount and participants are required',
        includeCode: true,
      },
      exact_money_ts_Split_amounts_cannot_be_negative: {
        status: 422,
        words: 'Split amounts cannot be negative',
        includeCode: true,
      },
      exact_money_ts_Choose_a_valid_split_method: {
        status: 422,
        words: 'Choose a valid split method',
        includeCode: true,
      },
    },
  },
  INVALID_TAG: {
    status: 422,
    words: 'Tag must be an active group tag',
    includeCode: true,
    variants: {},
  },
  INVALID_TAG_COMMAND: {
    status: 400,
    words: 'Check the Tag name and submitted action, then try again.',
    includeCode: true,
    variants: {
      invalidIdentity: {
        status: 400,
        words: 'Invalid Group, Tag or request identity.',
        includeCode: true,
      },
    },
  },
  INVALID_WINDOW: {
    status: 422,
    words: 'End date must be on or after the start date',
    includeCode: true,
    variants: {},
  },
  INVITATION_EXPIRED: {
    status: 410,
    words: 'Invitation has expired',
    includeCode: false,
    variants: {},
  },
  INVITATION_NOT_PENDING: {
    status: 400,
    words: 'Invitation is no longer pending',
    includeCode: false,
    variants: {},
  },
  LAST_ACTIVE_TAG: {
    status: 409,
    words: 'Create or restore another Tag before removing the last active Tag.',
    includeCode: true,
    variants: {},
  },
  LAST_ADMIN: {
    status: 409,
    words: 'Make someone else an admin before you leave.',
    includeCode: true,
    variants: {
      membersDemote: {
        status: 409,
        words: 'Cannot demote the last admin. Promote another member first.',
        includeCode: false,
      },
      membersRemove: { status: 409, words: 'Cannot remove the last admin.', includeCode: false },
    },
  },
  LEAVE_CONFLICT: {
    status: 409,
    words: 'This Group changed while you were leaving. Try again.',
    includeCode: true,
    variants: {},
  },
  MISSING_SPLIT_AMOUNT: {
    status: 422,
    words: 'Enter an amount for each person in the split',
    includeCode: true,
    variants: {},
  },
  MONEY_REPRESENTATION_MISMATCH: {
    status: 422,
    words: 'Stored amounts disagree',
    includeCode: true,
    variants: {},
  },
  NOT_HOUSEHOLD: {
    status: 422,
    words: 'Recurring expenses are only available in Household groups',
    includeCode: true,
    variants: {},
  },
  NO_SETTLEMENT_DEBT: {
    status: 422,
    words:
      'This pair no longer has a Debt or Suggested payment in one of these currencies. Reload before recording the payment.',
    includeCode: true,
    variants: {},
  },
  OPEN_BALANCE: {
    status: 409,
    words: (data: RefusalContext) =>
      `Settle up before you leave: you ${owing(data.balances!, false)} in this Group.`,
    includeCode: true,
    variants: {
      membersRemove: {
        status: 409,
        words: (data: RefusalContext) =>
          `${data.memberName} ${owing(data.balances!, true)} in this Group. Settle up before removing them.`,
        includeCode: true,
      },
    },
  },
  PAYER_TOTAL_MISMATCH: {
    status: 422,
    words: 'Payer amounts must add up to the expense amount',
    includeCode: true,
    variants: {},
  },
  PERCENTAGE_TOTAL_MISMATCH: {
    status: 422,
    words: 'Percentages must add up to 100',
    includeCode: true,
    variants: {},
  },
  RECURRING_EXPENSES_OFF: {
    status: 409,
    words: 'Recurring Expenses are turned off.',
    includeCode: true,
    variants: {},
  },
  RECURRING_EXPENSE_PROBLEM: {
    status: 409,
    words: (data: RefusalContext) => leaveRecurringWords(data),
    includeCode: true,
    variants: {
      membersRemove: {
        status: 409,
        words: (data: RefusalContext) => removalRecurringWords(data),
        includeCode: true,
      },
    },
  },
  REMOVAL_CONFLICT: {
    status: 409,
    words: 'This Group changed while you were removing this member. Try again.',
    includeCode: true,
    variants: {},
  },
  REQUEST_KEY_REUSED: {
    status: 409,
    words: 'This request was already used for another action.',
    includeCode: true,
    variants: {},
  },
  REQUEST_TOO_LARGE: { status: 413, words: 'Request too large', includeCode: true, variants: {} },
  REVISION_REQUIRED: {
    status: 428,
    words: 'Reload this record before changing it.',
    includeCode: true,
    variants: {},
  },
  SAME_PARTY: {
    status: 422,
    words: 'Payer and recipient must be different people',
    includeCode: true,
    variants: {
      settlement_preview_ts_A_payment_needs_two_different_people: {
        status: 422,
        words: 'A payment needs two different people',
        includeCode: true,
      },
    },
  },
  SELF_REMOVE: {
    status: 400,
    words: 'You cannot remove yourself. Use leave group instead.',
    includeCode: false,
    variants: {},
  },
  SETTLEMENT_TRANSACTIONS_REQUIRED: {
    status: 503,
    words:
      'Payments across several currencies need a transactional database. Nothing was recorded.',
    includeCode: true,
    variants: {},
  },
  SPLIT_TOTAL_MISMATCH: {
    status: 422,
    words: 'Split amounts must add up to the expense amount',
    includeCode: true,
    variants: {},
  },
  STALE_REVISION: {
    status: 409,
    words: 'This record changed while you were editing. Reload the latest version before saving.',
    includeCode: true,
    variants: {},
  },
  TAG_ADMIN_REQUIRED: {
    status: 403,
    words: 'Only Group admins can manage Tags.',
    includeCode: true,
    variants: {},
  },
  TAG_CHANGED: {
    status: 409,
    words: 'This Tag changed. Review its current state before applying your change.',
    includeCode: true,
    variants: {},
  },
  TAG_EXISTS: {
    status: 409,
    words: 'A Tag with this name already exists. Archived Tags can be restored.',
    includeCode: true,
    variants: {},
  },
  TAG_IN_USE: {
    status: 409,
    words: 'This Tag is used by Expenses or recurring templates and cannot be deleted.',
    includeCode: true,
    variants: {},
  },
  TAG_PRECONDITION_REQUIRED: {
    status: 428,
    words: 'Reload Tag management before making this change.',
    includeCode: true,
    variants: {},
  },
  TAG_TRANSACTIONS_REQUIRED: {
    status: 503,
    words: 'Tag changes are temporarily unavailable. Try again later.',
    includeCode: true,
    variants: {},
  },
  UNBALANCED_LEDGER: {
    status: 422,
    words: 'Ledger contributions do not balance',
    includeCode: true,
    variants: {
      debts_before_simplifying_ts_Unable_to_allocate_exact_Debts: {
        status: 422,
        words: 'Unable to allocate exact Debts',
        includeCode: true,
      },
      exact_money_ts_Stored_allocations_do_not_equal_the_Expense_amount: {
        status: 422,
        words: 'Stored allocations do not equal the Expense amount',
        includeCode: true,
      },
    },
  },
  UNBALANCED_TEMPLATE: {
    status: 422,
    words: 'Recurring allocations must equal the amount',
    includeCode: true,
    variants: {},
  },
  UNSAFE_MONEY: {
    status: 422,
    words: 'Amount is outside the supported exact range',
    includeCode: true,
    variants: {
      exact_money_ts_Amount_cannot_be_represented_by_this_client: {
        status: 422,
        words: 'Amount cannot be represented by this client',
        includeCode: true,
      },
    },
  },
  UNSUPPORTED_CURRENCY: {
    status: 422,
    words: (data: RefusalContext) => unsupportedCurrencyEditRefusal(data.currency!),
    includeCode: true,
    variants: {},
  },
} as const satisfies Record<string, Answer & { variants: Record<string, Answer> }>;

export type RefusalCode = keyof typeof refusalVocabulary;

type RequiredData = {
  CURRENCY_IN_USE: { currency: string; groupName: string; use: ExtraCurrencyUse };
  CURRENCY_NOT_LISTED: { currency: string };
  CURRENCY_IS_MAIN: { currency: string };
  EXPORT_TOO_LARGE: { rows: number; limit: number };
  OPEN_BALANCE: { balances: Balance[] };
  RECURRING_EXPENSE_PROBLEM: { recurringExpenses: BrokenRecurringExpense[]; admin?: boolean };
  UNSUPPORTED_CURRENCY: { currency: string };
  INVALID_GROUP_CURRENCIES: { mainCurrency: string; extraCurrencies: string[] };
  INVALID_MONEY_PRECISION: { digits: number };
};
export type RefusalData<C extends RefusalCode> = (C extends keyof RequiredData
  ? RequiredData[C]
  : {}) & {
  variant?: Extract<keyof (typeof refusalVocabulary)[C]['variants'], string>;
  field?: ReadonlyArray<string | number>;
  snapshot?: TagSnapshot;
  existingTagId?: string;
  memberName?: string;
};

/** One service call. The Error message remains its code during the incremental migration. */
export class Refusal<C extends RefusalCode = RefusalCode> extends Error {
  readonly data: RefusalContext;
  constructor(
    readonly code: C,
    ...payload: {} extends RefusalData<C> ? [data?: RefusalData<C>] : [data: RefusalData<C>]
  ) {
    super(code);
    this.name = 'Refusal';
    this.data = payload[0] ?? {};
  }
}

/** Framework-free answer body, serialized by the web's serverError. */
export function refusalAnswer(refusal: Refusal) {
  const entry = refusalVocabulary[refusal.code];
  const variants: Readonly<Record<string, Answer>> = entry.variants;
  const { data, code } = refusal;
  const answer = data.variant ? variants[data.variant] : entry;
  const words = typeof answer.words === 'function' ? answer.words(data) : answer.words;
  return {
    error: words,
    status: answer.status,
    ...(answer.includeCode ? { code } : {}),
    ...(data.field ? { field: data.field } : {}),
    ...(data.use ? { use: data.use } : {}),
    ...(data.snapshot ? { snapshot: data.snapshot } : {}),
    ...(data.existingTagId ? { existingTagId: data.existingTagId } : {}),
    ...(data.balances
      ? {
          balances: data.balances.map(({ currency, amountMinor }) => ({
            currency,
            amount: toMajorAmount(amountMinor, currency),
          })),
        }
      : {}),
    ...(data.recurringExpenses
      ? {
          recurringExpenses: data.recurringExpenses.map(({ id, description }) => ({
            id,
            description,
          })),
        }
      : {}),
  };
}

function owing(balances: Balance[], member: boolean) {
  const figure = ({ currency, amountMinor }: Balance) =>
    formatCurrency(toMajorAmount(Math.abs(amountMinor), currency), currency);
  const owe = balances.filter(({ amountMinor }) => amountMinor < 0).map(figure);
  const owed = balances.filter(({ amountMinor }) => amountMinor > 0).map(figure);
  return [
    owe.length ? `${member ? 'owes' : 'owe'} ${owe.join(' and ')}` : '',
    owed.length ? `${member ? 'is owed' : 'are owed'} ${owed.join(' and ')}` : '',
  ]
    .filter(Boolean)
    .join(' and ');
}
function recurringNames(expenses: BrokenRecurringExpense[]) {
  const names = expenses.map(
    ({ description }) => `${description.trim() || 'A recurring Expense'} (recurring)`,
  );
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}
function leaveRecurringWords(data: RefusalContext) {
  const expenses = data.recurringExpenses!;
  const many = expenses.length > 1;
  const them = many ? 'them' : 'it';
  return (
    `${recurringNames(expenses)} still ${many ? 'include' : 'includes'} you. ` +
    (data.admin
      ? `Remove yourself from ${them}, then leave.`
      : `Ask an admin to remove you from ${them}, then leave.`)
  );
}
function removalRecurringWords(data: RefusalContext) {
  const expenses = data.recurringExpenses!;
  const many = expenses.length > 1;
  return `${recurringNames(expenses)} still ${many ? 'include' : 'includes'} ${data.memberName}. Remove them from ${many ? 'each' : 'it'} before removing them from the Group.`;
}
