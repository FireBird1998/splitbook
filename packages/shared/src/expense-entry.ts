import {
  MoneyValidationError,
  normalizeExpenseMoney,
  parseAmountMinor,
  parseDecimalUnits,
  sumMinorAmounts,
  toMajorAmount,
} from './exact-money';
import {
  enteredPayers,
  payerRemainder,
  payerEntryProblem,
  type PayerEntry,
} from './payer-remainder';
import {
  splitBreakdown,
  splitChoiceOf,
  type SplitBreakdown,
  type SplitChoice,
  type SplitEntryProblem,
  type SplitProblem,
  type SplitLeftover,
} from './expense-split';
import { amountExample, amountError, inAmountWords, readAmountEntry } from './amount-entry';
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

export interface ExpenseEntryPolicy {
  blankShare: 'one' | 'zero';
  blankSplitAmount: 'zero' | 'refuse';
  payerRows: 'all' | 'nonzero';
  savedZeroPayers: 'keep' | 'unchanged';
  singlePayer: 'first-row' | 'field';
  splitPreview: 'whole-expense' | 'independent-split';
  roundingNote: 'show' | 'hide';
  weightInput: 'numbers' | 'numbers-or-zero' | 'decimal-units';
  /** A form summary prioritizes the empty whole-share count; entry corrections mark each box. */
  feedback: 'form-summary' | 'allocation-summary' | 'entry-corrections';
}
export const expenseEntryPolicy: ExpenseEntryPolicy = {
  blankShare: 'zero',
  blankSplitAmount: 'zero',
  payerRows: 'nonzero',
  savedZeroPayers: 'unchanged',
  singlePayer: 'field',
  splitPreview: 'independent-split',
  roundingNote: 'show',
  weightInput: 'decimal-units',
  feedback: 'entry-corrections',
};
export const formSummaryPolicy: ExpenseEntryPolicy = {
  blankShare: 'one',
  blankSplitAmount: 'zero',
  payerRows: 'all',
  savedZeroPayers: 'keep',
  singlePayer: 'first-row',
  splitPreview: 'whole-expense',
  roundingNote: 'hide',
  weightInput: 'numbers',
  feedback: 'form-summary',
};

/** The recurring form reports the allocator's refusal without the whole-share guard. */
export const recurringEntryPolicy: ExpenseEntryPolicy = {
  ...formSummaryPolicy,
  blankShare: 'zero',
  blankSplitAmount: 'refuse',
  singlePayer: 'field',
  feedback: 'allocation-summary',
  weightInput: 'numbers-or-zero',
};

/** One entry supplies both the displayed split and the command; callers cannot supply an allocator. */
export function readExpenseEntry(
  entry: ExpenseEntry,
  purpose: ExpenseEntryPurpose,
  policy: ExpenseEntryPolicy = expenseEntryPolicy,
) {
  const countedPayers = policy.payerRows === 'all' ? entry.payers : enteredPayers(entry.payers);
  const singlePayer =
    policy.singlePayer === 'first-row' ? (entry.payers[0]?.user ?? '') : entry.payerId;
  const payerIds = entry.multiPayer ? countedPayers.map((payer) => payer.user) : [singlePayer];
  const allocate = (multiPayer: boolean) => {
    try {
      // The complete-form guard counts whole share parts before allocating (#1111).
      if (
        policy.feedback === 'form-summary' &&
        entry.splitMethod === 'shares' &&
        entry.participantIds.reduce(
          (sum, id) => sum + (parseInt(entry.splitValues[id]) || 0),
          0,
        ) === 0
      )
        throw new Error('Each member needs at least 1 share');
      // The allocation summary reads the total before the individual boxes; its refusal
      // priority is kept even when a split box also contains an unreadable amount (#1114).
      const total =
        policy.feedback === 'allocation-summary'
          ? toMajorAmount(parseAmountMinor(entry.amount, entry.currency), entry.currency)
          : entry.amount;
      const weight = (user: string, digits: number) => {
        const text =
          entry.splitValues[user] || (digits === 0 && policy.blankShare === 'one' ? '1' : '0');
        return policy.weightInput === 'numbers-or-zero'
          ? Number(text) || 0
          : policy.weightInput === 'numbers'
            ? Number(text)
            : parseDecimalUnits(text, digits) / (digits === 2 ? 100 : 1);
      };
      const input = {
        amount: total,
        currency: entry.currency,
        paidBy: multiPayer ? countedPayers : [{ user: singlePayer, amount: entry.amount }],
        splitMethod: entry.splitMethod,
        splitBetween: entry.participantIds.map((user) => ({
          user,
          ...(entry.splitMethod === 'unequal' || entry.splitMethod === 'exact'
            ? {
                amount:
                  policy.blankSplitAmount === 'refuse'
                    ? toMajorAmount(
                        parseAmountMinor(entry.splitValues[user] ?? '', entry.currency),
                        entry.currency,
                      )
                    : entry.splitValues[user] || '0',
              }
            : entry.splitMethod === 'percentage'
              ? { percentage: weight(user, 2) }
              : entry.splitMethod === 'shares'
                ? { shares: weight(user, 0) }
                : {}),
        })),
      };
      if (purpose.kind === 'new') return normalizeExpenseMoney(input);
      const kept =
        multiPayer && policy.savedZeroPayers === 'unchanged'
          ? keepSavedPayers(purpose.saved, input)
          : null;
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
  const visiblePayers = new Set<string>();
  for (const payer of entry.payers) {
    // The sheet shows each identity once, using its first stored row. A duplicate's later
    // error still belongs to the all-row remainder below, not to that visible first box.
    if (visiblePayers.has(payer.user)) continue;
    visiblePayers.add(payer.user);
    const error = payerEntryError(payer.amount, entry.currency);
    if (error) payerErrors[payer.user] = error;
  }
  const payers = {
    ...payerRemainder(entry),
    entries: countedPayers,
    ids: payerIds,
    errors: payerErrors,
  };
  const amount = { minor: payers.totalMinor, error: amountError(entry.amount, entry.currency) };
  let result;
  try {
    const money = allocate(entry.multiPayer);
    result = {
      kind: 'ready' as const,
      money,
      // A recurring template stores the chosen weights, not today's allocated row amounts.
      // Both projections come from this accepted reading; the caller retains its method name.
      figures: {
        amount: money.amount,
        currency: money.currency,
        paidBy: money.paidBy.map(({ user, amount }) => ({ user, amount })),
        splitMethod: entry.splitMethod,
        splitBetween: money.splitBetween.map((row) => ({
          user: row.user,
          ...(entry.splitMethod === 'exact' || entry.splitMethod === 'unequal'
            ? { amount: row.amount }
            : entry.splitMethod === 'percentage'
              ? { percentage: 'percentage' in row ? row.percentage : undefined }
              : entry.splitMethod === 'shares'
                ? { shares: 'shares' in row ? row.shares : undefined }
                : {}),
        })),
      },
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
        policy.feedback !== 'entry-corrections'
          ? {
              field: 'form' as const,
              message: error instanceof Error ? error.message : 'Invalid allocation',
            }
          : amount.error
            ? { field: 'amount' as const, message: amount.error }
            : allocationProblem(entry, error, payers),
      ],
    };
  }
  if (policy.splitPreview === 'whole-expense') {
    split.shares =
      result.kind === 'ready'
        ? Object.fromEntries(
            result.money.splitBetween.map((row) => [String(row.user), row.amountMinor]),
          )
        : {};
    if (result.kind === 'refused')
      split.status = {
        kind: 'problem',
        message: result.error instanceof Error ? result.error.message : 'Invalid allocation',
      };
  }
  if (policy.roundingNote === 'hide' && split.status.kind === 'adds-up')
    split.status = { kind: 'adds-up', leftover: null };
  const splitSummary = {
    participants: entry.participantIds.length,
    shares:
      split.status.kind === 'adds-up' && entry.splitMethod === 'shares'
        ? entry.participantIds.reduce((sum, id) => sum + Number(entry.splitValues[id] || 0), 0)
        : null,
  };
  // An older stored share can be fractional or unreadable. Its stepper keeps today's display
  // (the number, or 0 for unreadable text); the correction above still refuses an invalid save.
  const shareSteps = Object.fromEntries(
    entry.participantIds.map((id) => {
      const value = Number(entry.splitValues[id] || 0);
      return [id, Number.isFinite(value) ? value : 0];
    }),
  );
  const fields = enteredTotals(entry);
  return { amount, split, splitSummary, shareSteps, payers, result, fields };
}

function allocationProblem(
  entry: ExpenseEntry,
  error: unknown,
  payers: { ids: string[]; entries: PayerEntry[] },
) {
  const code = error instanceof MoneyValidationError ? error.code : '';
  const payerIds = payers.ids;
  if (code === 'EMPTY_PARTICIPANTS')
    return payerIds.length
      ? { field: 'split' as const, message: 'Choose at least one person to share this Expense.' }
      : { field: 'payers' as const, message: 'Choose who paid.' };
  const unreadablePayer =
    entry.multiPayer &&
    payers.entries.some((p) => {
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

/** "The leftover ₹0.01 goes to Sam Chen so the total is exact." */
export function roundingNote(
  leftover: SplitLeftover,
  name: (id: string) => string,
  money: (minor: number) => string,
) {
  const names = leftover.users.map(name);
  const people =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `The leftover ${money(leftover.amountMinor)} goes to ${people} so the total is exact.`;
}

/** Totals shown under the boxes: unreadable totals stay a dash, never a rounded amount. */
function enteredTotals(entry: ExpenseEntry) {
  const { amount, currency, splitMethod, participantIds, splitValues } = entry;
  const sum = (values: string[], digits: number) => {
    try {
      return sumMinorAmounts(values.map((value) => parseDecimalUnits(value || '0', digits)));
    } catch {
      return Number.NaN;
    }
  };
  const digits = getCurrencyPrecision(currency);
  const amountMinor = sum([amount], digits);
  const unequalMinor =
    splitMethod === 'exact' || splitMethod === 'unequal'
      ? sum(
          participantIds.map((id) => splitValues[id]),
          digits,
        )
      : 0;
  const percentageUnits =
    splitMethod === 'percentage'
      ? sum(
          participantIds.map((id) => splitValues[id]),
          2,
        )
      : 0;
  const payerMinor = entry.multiPayer
    ? sum(
        entry.payers.map((payer) => payer.amount),
        digits,
      )
    : amountMinor;
  const sharesTotal =
    splitMethod === 'shares'
      ? participantIds.reduce((total, id) => total + (parseInt(splitValues[id]) || 0), 0)
      : 0;
  const percentageTotal =
    splitMethod === 'percentage'
      ? participantIds.reduce((total, id) => total + (parseFloat(splitValues[id]) || 0), 0)
      : 0;
  let parsedAmount = 0;
  try {
    parsedAmount = toMajorAmount(amountMinor, currency);
  } catch {
    /* An unreadable total shows no per-share amount. */
  }
  return {
    amountReading: readAmountEntry(amount, currency),
    amountMissing: !amount || Number(amount) <= 0,
    amountMinor,
    unequalMinor,
    percentageUnits,
    payerMinor,
    splitsBalanced: amountMinor > 0 && unequalMinor === amountMinor,
    percentagesBalanced: percentageUnits === 10000,
    payersBalanced: amountMinor > 0 && payerMinor === amountMinor,
    percentageTotal,
    sharesTotal,
    parsedAmount,
    perShareAmount: sharesTotal > 0 ? parsedAmount / sharesTotal : 0,
  };
}
