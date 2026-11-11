import {
  MoneyValidationError,
  normalizeExpenseMoney,
  parseAmountMinor,
  parseDecimalUnits,
} from './exact-money';
import { enteredPayers, payerRemainder, payerEntryProblem } from './payer-remainder';
import {
  splitBreakdown,
  splitChoiceOf,
  type SplitBreakdown,
  type SplitChoice,
  type SplitEntryProblem,
  type SplitProblem,
} from './expense-split';
import { amountExample, amountError, inAmountWords } from './amount-entry';
import { getCurrencyPrecision } from './currency';
import {
  decideExpenseMoneyEdit,
  keepSavedPayers,
  type StoredExpenseMoney,
} from './expense-money-edit';
import type { ExpenseSplitMethod } from './split-calculation';

/**
 * What a member has typed for an Expense, before it is read. The device stores these fields
 * unchanged (version 1): one active split-value map and the entries for both payer modes.
 */
export interface ExpenseEntry {
  amount: string;
  currency: string;
  description: string;
  date: string;
  payerId: string;
  multiPayer: boolean;
  payers: { user: string; amount: string }[];
  splitMethod: ExpenseSplitMethod;
  splitValues: Record<string, string>;
  participantIds: string[];
  tagId: string;
  category: string;
  notes: string;
}

export type ExpenseEntryPurpose = { kind: 'new' } | { kind: 'edit'; saved: StoredExpenseMoney };

/** One entry supplies both the displayed split and the command; callers cannot supply an allocator. */
export function readExpenseEntry(entry: ExpenseEntry, purpose: ExpenseEntryPurpose) {
  const allocate = (multiPayer: boolean) => {
    try {
      const input = {
        amount: entry.amount,
        currency: entry.currency,
        paidBy: multiPayer
          ? enteredPayers(entry.payers)
          : [{ user: entry.payerId, amount: entry.amount }],
        splitMethod: entry.splitMethod,
        splitBetween: entry.participantIds.map((user) => ({
          user,
          ...(entry.splitMethod === 'unequal' || entry.splitMethod === 'exact'
            ? { amount: entry.splitValues[user] || '0' }
            : entry.splitMethod === 'percentage'
              ? { percentage: parseDecimalUnits(entry.splitValues[user] || '0', 2) / 100 }
              : entry.splitMethod === 'shares'
                ? { shares: parseDecimalUnits(entry.splitValues[user] || '0', 0) }
                : {}),
        })),
      };
      if (purpose.kind === 'new') return normalizeExpenseMoney(input);
      const kept = multiPayer ? keepSavedPayers(purpose.saved, input) : null;
      return decideExpenseMoneyEdit(purpose.saved, kept ?? input).money;
    } catch (error) {
      // Part of a yen paid or shared: the amount field's words, as on the web (#755).
      throw inAmountWords(error, entry.currency);
    }
  };
  const { problems, status, ...breakdown } = splitBreakdown(entry, allocate);
  const errors: Partial<Record<string, string>> = {};
  for (const [id, problem] of Object.entries(problems))
    if (problem) errors[id] = entryError(splitChoiceOf(entry.splitMethod), problem, entry.currency);
  const splitStatus:
    | Exclude<SplitBreakdown['status'], { kind: 'problem' }>
    | { kind: 'problem'; message: string } =
    status.kind !== 'problem'
      ? status
      : {
          kind: 'problem',
          message: status.reason === 'refused' ? status.message : problemMessages[status.reason],
        };
  const split = { ...breakdown, errors, status: splitStatus };
  const payerErrors: Record<string, string> = {};
  for (const payer of entry.payers) {
    const error = payerEntryError(payer.amount, entry.currency);
    if (error) payerErrors[payer.user] = error;
  }
  const payers = {
    ...payerRemainder(entry),
    entries: enteredPayers(entry.payers),
    errors: payerErrors,
  };
  const amount = { minor: payers.totalMinor, error: amountError(entry.amount, entry.currency) };
  let result;
  try {
    const money = allocate(entry.multiPayer);
    result = {
      kind: 'ready' as const,
      money,
      financialEdit:
        purpose.kind === 'new' ||
        decideExpenseMoneyEdit(purpose.saved, { ...money, splitMethod: entry.splitMethod })
          .financialEdit,
    };
  } catch (cause) {
    const error = inAmountWords(cause, entry.currency);
    result = {
      kind: 'refused' as const,
      error,
      problems: [
        amount.error
          ? { field: 'amount' as const, message: amount.error }
          : allocationProblem(entry, error),
      ],
    };
  }
  return { amount, split, payers, result };
}

function allocationProblem(entry: ExpenseEntry, error: unknown) {
  const code = error instanceof MoneyValidationError ? error.code : '';
  const payerIds = entry.multiPayer
    ? enteredPayers(entry.payers).map((p) => p.user)
    : [entry.payerId];
  if (code === 'EMPTY_PARTICIPANTS')
    return payerIds.length
      ? { field: 'split' as const, message: 'Choose at least one person to share this Expense.' }
      : { field: 'payers' as const, message: 'Choose who paid.' };
  const unreadablePayer =
    entry.multiPayer &&
    enteredPayers(entry.payers).some((p) => {
      try {
        parseAmountMinor(p.amount, entry.currency);
        return false;
      } catch {
        return true;
      }
    });
  const payerProblem =
    code === 'PAYER_TOTAL_MISMATCH' ||
    code === 'INVALID_PAYER_AMOUNT' ||
    (code === 'DUPLICATE_PARTICIPANTS' && new Set(payerIds).size !== payerIds.length) ||
    (code.startsWith('INVALID_MONEY') && unreadablePayer);
  return {
    field: payerProblem ? ('payers' as const) : ('split' as const),
    message:
      error instanceof MoneyValidationError
        ? error.message
        : 'Review who paid and how this Expense is split.',
  };
}

/** Why one person's entry can't be used, beside it. Nothing is rounded or corrected for them. */
function entryError(choice: SplitChoice, problem: SplitEntryProblem, currency: string) {
  if (problem === 'not-whole') return 'Use a whole number of shares.';
  if (problem === 'negative')
    return choice === 'shares'
      ? 'Shares can’t be negative.'
      : choice === 'percentage'
        ? 'Percentages can’t be negative.'
        : 'Amounts can’t be negative.';
  if (problem === 'too-large')
    return choice === 'percentage'
      ? 'A percentage can be at most 100.'
      : 'That’s more than the Expense total.';
  if (choice === 'percentage')
    return problem === 'too-precise'
      ? 'Percentages can have at most 2 decimal places. Nothing is rounded for you.'
      : 'Use digits and one decimal point, such as 33.5.';
  const digits = getCurrencyPrecision(currency);
  if (problem === 'too-precise')
    return `${currency} amounts ${
      digits
        ? `can have at most ${digits} decimal ${digits === 1 ? 'place' : 'places'}`
        : 'can’t include decimal places'
    }. Nothing is rounded for you.`;
  return digits
    ? `Use digits and one decimal point, such as ${amountExample(currency)}.`
    : `Use digits only, such as ${amountExample(currency)}.`;
}

const problemMessages: Record<SplitProblem, string> = {
  'no-participants': 'Choose at least one person to share this Expense.',
  'marked-entry': 'Correct the entry marked above.',
  'marked-entries': 'Correct the entries marked above.',
  'no-shares': 'Give at least one person a share.',
  unexplained: 'Review how this Expense is split.',
};

/**
 * Why one person's entry in Who paid can't count yet, in words for the row beside it. The
 * arithmetic and the problem itself come from the shared payer rules. Blank entries and 0 are
 * simply empty: that person isn't a payer.
 */
export function payerEntryError(amount: string, currency: string): string | undefined {
  const problem = payerEntryProblem(amount, currency);
  if (!problem) return undefined;
  // 0 is allowed, as blank, so this isn't the Amount field's "greater than 0".
  if (problem === 'negative') return 'Enter an amount of 0 or more.';
  // Unreadable text, the wrong precision and amounts over the limit read as on the Amount field.
  return amountError(amount, currency);
}
