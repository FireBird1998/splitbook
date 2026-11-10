import { DRAFT_SAVE_UNCONFIRMED_MESSAGE } from './draft-responses';
import { GROUP_ARCHIVED_MESSAGE } from './group-archive';
import { DATABASE_UNAVAILABLE_MESSAGE } from './database-unavailable';
import { DRAFT_GROUP_LIMIT_MESSAGE } from './validators/expense-draft';
import { formatCurrency } from './currency';
import { toMajorAmount } from './exact-money';
import type { ExtraCurrencyUse } from './group-currency-settings';
import type { TagSnapshot } from './tag-management';

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
  resource?: string;
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
}
interface Answer {
  status: number;
  words: string | ((data: RefusalContext) => string);
}
type Entry = { status: number; variants: Record<string, Answer> } & (
  | { words: Answer['words']; moneyWords?: 'from-rule' }
  | { moneyWords: 'from-rule'; words?: never }
);

/** Request answers. Money codes identify rules whose own errors carry their words and field. */
export const refusalVocabulary = {
  ACCOUNT_CHANGED: {
    status: 419,
    words: 'The signed-in account changed in another tab. Reload this page to continue.',
    variants: {},
  },
  ACTIVITY_BACKLOG_FULL: {
    status: 503,
    words: 'The audit feed is temporarily unavailable. Please retry later.',
    variants: {},
  },
  ALREADY_INVITED: {
    status: 409,
    words: 'This person has already been invited',
    variants: {},
  },
  AMBIGUOUS_TAG: {
    status: 409,
    words: 'This Tag has ambiguous historical references and cannot be renamed.',
    variants: {},
  },
  CURRENCY_IN_USE: {
    status: 409,
    words: (data: RefusalContext) =>
      `${data.currency} can’t be removed while ${data.groupName} uses it.`,
    variants: {},
  },
  CURRENCY_IS_MAIN: {
    status: 409,
    words: (data: RefusalContext) =>
      `${data.currency} is the main currency, so it can’t be removed.`,
    variants: {},
  },
  CURRENCY_LOCKED: {
    status: 409,
    words: 'Currency cannot change after this Group has financial records.',
    variants: {},
  },
  CURRENCY_MISMATCH: {
    status: 422,
    words: 'Currency is not one of this Group’s currencies',
    moneyWords: 'from-rule',
    variants: {},
  },
  CURRENCY_NOT_LISTED: {
    status: 404,
    words: (data: RefusalContext) => `${data.currency} isn’t one of this Group’s extra currencies.`,
    variants: {},
  },
  DATABASE_UNAVAILABLE: {
    status: 503,
    words: DATABASE_UNAVAILABLE_MESSAGE,
    variants: {},
  },
  DRAFT_GROUP_LIMIT: {
    status: 409,
    words: DRAFT_GROUP_LIMIT_MESSAGE,
    variants: {},
  },
  DRAFT_NOT_FOUND: { status: 404, words: 'Draft not found', variants: {} },
  DRAFT_TRANSACTIONS_REQUIRED: {
    status: 503,
    words: 'Draft changes are temporarily unavailable.',
    variants: {},
  },
  DRAFT_UNCONFIRMED: {
    status: 503,
    words:
      'Draft request not confirmed. Reload before retrying; reuse the original creation request.',
    variants: {
      save: { status: 503, words: DRAFT_SAVE_UNCONFIRMED_MESSAGE },
    },
  },
  DRAFTS_DISABLED: {
    status: 404,
    words: 'Drafts are not enabled',
    variants: {},
  },
  DUPLICATE_PARTICIPANTS: { status: 422, moneyWords: 'from-rule', variants: {} },
  EMPTY_PARTICIPANTS: { status: 422, moneyWords: 'from-rule', variants: {} },
  EXPORT_TOO_LARGE: {
    status: 413,
    words: (data: RefusalContext) =>
      `This export would have ${data.rows!.toLocaleString('en-US')} rows, more than the ${data.limit!.toLocaleString('en-US')} one download can hold. Pick fewer Groups or a shorter period.`,
    variants: {},
  },
  FORBIDDEN_SETTLEMENT: {
    status: 422,
    words: 'Only the payer or recipient can record this payment',
    variants: {},
  },
  FORBIDDEN: { status: 403, words: 'Forbidden', variants: {} },
  GROUP_ARCHIVED: { status: 409, words: GROUP_ARCHIVED_MESSAGE, variants: {} },
  GROUP_DELETION_CONFIRMATION_REQUIRED: {
    status: 409,
    words:
      'You are the last member. Leaving will permanently delete this Group and its history. Confirm deletion to continue.',
    variants: {},
  },
  GROUP_DELETION_UNAVAILABLE: {
    status: 409,
    words:
      'Permanent Group deletion is unavailable here. You are still a member; no history was deleted.',
    variants: {},
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    words: 'This submission key was already used for different data. Start a new submission.',
    variants: {},
  },
  INVALID_AMOUNT_RANGE: { status: 422, moneyWords: 'from-rule', variants: {} },
  INVALID_COMPARE: {
    status: 400,
    words: 'Compare with 1 to 12 earlier months.',
    variants: {},
  },
  INVALID_CROSS_CURRENCY_SETTLEMENT: {
    status: 422,
    moneyWords: 'from-rule',
    variants: {},
  },
  INVALID_CURRENCY: {
    status: 400,
    words: 'Send a currency code, such as INR.',
    variants: {},
  },
  INVALID_GROUP_CURRENCIES: {
    status: 422,
    moneyWords: 'from-rule',
    variants: {},
  },
  INVALID_ID: { status: 400, words: 'Invalid id', variants: {} },
  INVALID_IDEMPOTENCY_KEY: {
    status: 422,
    words: 'Invalid submission key',
    variants: {},
  },
  INVALID_JSON: { status: 400, words: 'Invalid JSON body', variants: {} },
  INVALID_MEMBERS: {
    status: 422,
    words: 'Both payer and recipient must be group members',
    variants: {
      expense: {
        status: 422,
        words: 'All payers and split participants must be group members',
      },
    },
  },
  INVALID_MONEY_PRECISION: {
    status: 422,
    moneyWords: 'from-rule',
    variants: {},
  },
  INVALID_MONEY_RANGE: { status: 422, moneyWords: 'from-rule', variants: {} },
  INVALID_MONEY_VERSION: { status: 422, moneyWords: 'from-rule', variants: {} },
  INVALID_MONEY: {
    status: 422,
    words: 'Enter a positive amount with the currency’s supported precision.',
    moneyWords: 'from-rule',
    variants: {},
  },
  INVALID_MONTH: {
    status: 400,
    words: 'Send a Month as YYYY-MM, such as 2026-09.',
    variants: {},
  },
  INVALID_MONTHS: {
    status: 400,
    words: 'Ask for 1 to 12 months of spending.',
    variants: {},
  },
  INVALID_PARTY: { status: 422, moneyWords: 'from-rule', variants: {} },
  INVALID_PAYER_AMOUNT: { status: 422, moneyWords: 'from-rule', variants: {} },
  INVALID_PERCENTAGE: { status: 422, moneyWords: 'from-rule', variants: {} },
  INVALID_SETTLEMENT_BATCH: {
    status: 422,
    moneyWords: 'from-rule',
    variants: {},
  },
  INVALID_SHARES: { status: 422, moneyWords: 'from-rule', variants: {} },
  INVALID_SPLIT: { status: 422, moneyWords: 'from-rule', variants: {} },
  INVALID_TAG_COMMAND: {
    status: 400,
    words: 'Check the Tag name and submitted action, then try again.',
    variants: {
      identity: {
        status: 400,
        words: 'Invalid Group, Tag or request identity.',
      },
    },
  },
  INVALID_TAG: {
    status: 422,
    words: 'Tag must be an active group tag',
    variants: {},
  },
  INVALID_TIME_ZONE: {
    status: 400,
    words: 'Send a named IANA time zone, such as Asia/Kolkata.',
    variants: {},
  },
  INVALID_WINDOW: {
    status: 422,
    words: 'End date must be on or after the start date',
    variants: {},
  },
  INVITATION_EXPIRED: {
    status: 410,
    words: 'Invitation has expired',
    variants: {},
  },
  INVITATION_NOT_PENDING: {
    status: 400,
    words: 'Invitation is no longer pending',
    variants: {},
  },
  LAST_ACTIVE_TAG: {
    status: 409,
    words: 'Create or restore another Tag before removing the last active Tag.',
    variants: {},
  },
  LAST_ADMIN: {
    status: 409,
    words: 'Make someone else an admin before you leave.',
    variants: {
      demotion: {
        status: 409,
        words: 'Cannot demote the last admin. Promote another member first.',
      },
      removal: { status: 409, words: 'Cannot remove the last admin.' },
    },
  },
  LEAVE_CONFLICT: {
    status: 409,
    words: 'This Group changed while you were leaving. Try again.',
    variants: {},
  },
  MISSING_SPLIT_AMOUNT: { status: 422, moneyWords: 'from-rule', variants: {} },
  MONEY_REPRESENTATION_MISMATCH: {
    status: 422,
    moneyWords: 'from-rule',
    variants: {},
  },
  NO_SETTLEMENT_DEBT: {
    status: 422,
    words:
      'This pair no longer has a Debt or Suggested payment in one of these currencies. Reload before recording the payment.',
    variants: {},
  },
  NOT_A_TRIP: {
    status: 409,
    words: 'Only a Trip has a Trip summary.',
    variants: {},
  },
  NOTIFICATION_SETTINGS_CHANGED: {
    status: 409,
    words: 'Notification settings changed. Retry.',
    variants: {},
  },
  NOTIFICATION_TOKEN_REQUIRED: {
    status: 400,
    words: 'Notification registration needs a device token.',
    variants: {},
  },
  NOT_FOUND: {
    status: 404,
    words: (data: RefusalContext) => `${data.resource} not found`,
    variants: {},
  },
  NOT_HOUSEHOLD: {
    status: 422,
    words: 'Recurring expenses are only available in Household groups',
    variants: {},
  },
  OPEN_BALANCE: {
    status: 409,
    words: (data: RefusalContext) =>
      `Settle up before you leave: you ${owing(data.balances!, false)} in this Group.`,
    variants: {
      removal: {
        status: 409,
        words: (data: RefusalContext) =>
          `${data.memberName} ${owing(data.balances!, true)} in this Group. Settle up before removing them.`,
      },
    },
  },
  PAYER_TOTAL_MISMATCH: { status: 422, moneyWords: 'from-rule', variants: {} },
  PERCENTAGE_TOTAL_MISMATCH: {
    status: 422,
    moneyWords: 'from-rule',
    variants: {},
  },
  QUERY_TOO_LONG: {
    status: 422,
    words: 'Search for at most 100 characters.',
    variants: {},
  },
  RECURRING_EXPENSE_PROBLEM: {
    status: 409,
    words: (data: RefusalContext) => leaveRecurringWords(data),
    variants: {
      removal: {
        status: 409,
        words: (data: RefusalContext) => removalRecurringWords(data),
      },
    },
  },
  RECURRING_EXPENSES_OFF: {
    status: 409,
    words: 'Recurring Expenses are turned off.',
    variants: {},
  },
  REMOVAL_CONFLICT: {
    status: 409,
    words: 'This Group changed while you were removing this member. Try again.',
    variants: {},
  },
  REQUEST_KEY_REUSED: {
    status: 409,
    words: 'This request was already used for another action.',
    variants: {},
  },
  REQUEST_TOO_LARGE: { status: 413, words: 'Request too large', variants: {} },
  REVISION_REQUIRED: {
    status: 428,
    words: 'Reload this record before changing it.',
    variants: {},
  },
  SAME_PARTY: {
    status: 422,
    words: 'Payer and recipient must be different people',
    moneyWords: 'from-rule',
    variants: {},
  },
  SELF_REMOVE: {
    status: 400,
    words: 'You cannot remove yourself. Use leave group instead.',
    variants: {},
  },
  SETTLEMENT_TRANSACTIONS_REQUIRED: {
    status: 503,
    words:
      'Payments across several currencies need a transactional database. Nothing was recorded.',
    variants: {},
  },
  SPLIT_TOTAL_MISMATCH: { status: 422, moneyWords: 'from-rule', variants: {} },
  STALE_REVISION: {
    status: 409,
    words: 'This record changed while you were editing. Reload the latest version before saving.',
    variants: {},
  },
  TAG_ADMIN_REQUIRED: {
    status: 403,
    words: 'Only Group admins can manage Tags.',
    variants: {},
  },
  TAG_CHANGED: {
    status: 409,
    words: 'This Tag changed. Review its current state before applying your change.',
    variants: {},
  },
  TAG_EXISTS: {
    status: 409,
    words: 'A Tag with this name already exists. Archived Tags can be restored.',
    variants: {},
  },
  TAG_IN_USE: {
    status: 409,
    words: 'This Tag is used by Expenses or recurring templates and cannot be deleted.',
    variants: {},
  },
  TAG_PRECONDITION_REQUIRED: {
    status: 428,
    words: 'Reload Tag management before making this change.',
    variants: {},
  },
  TAG_TRANSACTIONS_REQUIRED: {
    status: 503,
    words: 'Tag changes are temporarily unavailable. Try again later.',
    variants: {},
  },
  UNAUTHORIZED: { status: 401, words: 'Unauthorized', variants: {} },
  UNBALANCED_LEDGER: { status: 422, moneyWords: 'from-rule', variants: {} },
  UNBALANCED_TEMPLATE: { status: 422, moneyWords: 'from-rule', variants: {} },
  UNSAFE_MONEY: { status: 422, moneyWords: 'from-rule', variants: {} },
  UNSUPPORTED_CURRENCY: { status: 422, moneyWords: 'from-rule', variants: {} },
} as const satisfies Record<string, Entry>;

export type RefusalCode = keyof typeof refusalVocabulary;
type RequestRefusalCode = {
  [C in RefusalCode]: (typeof refusalVocabulary)[C] extends { words: unknown } ? C : never;
}[RefusalCode];

type RequiredData = {
  NOT_FOUND: { resource: string };
  TAG_ADMIN_REQUIRED: { snapshot: TagSnapshot };
  TAG_CHANGED: { snapshot: TagSnapshot };
  TAG_EXISTS: { snapshot: TagSnapshot; existingTagId: string };
  LAST_ACTIVE_TAG: { snapshot: TagSnapshot };
  REQUEST_KEY_REUSED: { snapshot: TagSnapshot };
  TAG_IN_USE: { snapshot: TagSnapshot };
  AMBIGUOUS_TAG: { snapshot: TagSnapshot };
  CURRENCY_IN_USE: { currency: string; groupName: string; use: ExtraCurrencyUse };
  CURRENCY_NOT_LISTED: { currency: string };
  CURRENCY_IS_MAIN: { currency: string };
  EXPORT_TOO_LARGE: { rows: number; limit: number };
  OPEN_BALANCE: { balances: Balance[] };
  RECURRING_EXPENSE_PROBLEM: { recurringExpenses: BrokenRecurringExpense[]; admin?: boolean };
};
type Data<C extends RequestRefusalCode> = C extends keyof RequiredData ? RequiredData[C] : object;
type Variant<C extends RequestRefusalCode> = Extract<
  keyof (typeof refusalVocabulary)[C]['variants'],
  string
>;
type VariantData<C extends RequestRefusalCode> = {
  [V in Variant<C>]: { variant: V } & Data<C> &
    (C extends 'OPEN_BALANCE' | 'RECURRING_EXPENSE_PROBLEM'
      ? V extends 'removal'
        ? { memberName: string }
        : object
      : object);
}[Variant<C>];
export type RefusalData<C extends RequestRefusalCode> = (
  | (Data<C> & { variant?: never })
  | VariantData<C>
) & {
  snapshot?: TagSnapshot;
  existingTagId?: string;
};

/** One service call. The Error message remains its code during the incremental migration. */
export class Refusal<C extends RequestRefusalCode = RequestRefusalCode> extends Error {
  readonly data: RefusalContext;
  constructor(
    readonly code: C,
    ...payload: object extends RefusalData<C> ? [data?: RefusalData<C>] : [data: RefusalData<C>]
  ) {
    super(code);
    this.name = 'Refusal';
    this.data = payload[0] ?? {};
  }
}

/** The request refusal body serialized by serverError. */
export function refusalAnswer(refusal: Refusal) {
  const entry = refusalVocabulary[refusal.code];
  const variants: Readonly<Record<string, Answer>> = entry.variants;
  const { data, code } = refusal;
  const answer: Answer = (data.variant ? variants[data.variant] : undefined) ?? entry;
  const words = typeof answer.words === 'function' ? answer.words(data) : answer.words;
  return {
    error: words,
    status: answer.status,
    code,
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
