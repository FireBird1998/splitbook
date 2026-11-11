import {
  maxExpenseAmountMinor,
  moneyParticipantId,
  parseExpenseAmountMinor,
  MoneyValidationError,
  normalizeExpenseMoney,
  parseAmountMinor,
  parseDecimalUnits,
  sumMinorAmounts,
  toMajorAmount,
} from './exact-money';
import {
  splitChoiceOf,
  splitLeftover,
  type SplitAllocation,
  type SplitChoice,
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
export interface ExpenseEntry<Method extends ExpenseSplitMethod | '' = ExpenseSplitMethod> {
  amount: string;
  currency: string;
  description: string;
  date: string;
  payerId: string;
  multiPayer: boolean;
  payers: { user: string; amount: string }[];
  splitMethod: Method;
  splitValues: Record<string, string>;
  participantIds: string[];
  tagId: string;
  category: string;
  notes: string;
}

/** To review can ask for a split method that was not given. */
export type IncompleteExpenseEntry = ExpenseEntry<ExpenseSplitMethod | ''>;

export type ExpenseEntryPurpose = { kind: 'new' } | { kind: 'edit'; saved: StoredExpenseMoney };

/** One entry supplies both the displayed split and the command; callers cannot supply an allocator. */
export function readExpenseEntry(entry: IncompleteExpenseEntry, purpose: ExpenseEntryPurpose) {
  const countedPayers = enteredPayers(entry.payers);
  const singlePayer = entry.payerId;
  const payerIds = entry.multiPayer ? countedPayers.map((payer) => payer.user) : [singlePayer];
  const allocate = (multiPayer: boolean) => {
    try {
      const splitMethod = entry.splitMethod;
      if (!splitMethod) throw new Error('Choose how this Expense is split.');
      const weight = (user: string, digits: number) => {
        const text = entry.splitValues[user] || '0';
        return parseDecimalUnits(text, digits) / (digits === 2 ? 100 : 1);
      };
      const input = {
        amount: entry.amount,
        currency: entry.currency,
        paidBy: multiPayer ? countedPayers : [{ user: singlePayer, amount: entry.amount }],
        splitMethod,
        splitBetween: entry.participantIds.map((user) => ({
          user,
          ...(entry.splitMethod === 'unequal' || entry.splitMethod === 'exact'
            ? {
                amount: entry.splitValues[user] || '0',
              }
            : entry.splitMethod === 'percentage'
              ? { percentage: weight(user, 2) }
              : entry.splitMethod === 'shares'
                ? { shares: weight(user, 0) }
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
  const { problems, status, ...breakdown } = splitBreakdown(
    { ...entry, splitMethod: entry.splitMethod || 'equal' },
    allocate,
  );
  const errors: Partial<Record<string, string>> = {};
  for (const [id, problem] of Object.entries(problems))
    if (problem)
      errors[id] = entryError(splitChoiceOf(entry.splitMethod || 'equal'), problem, entry.currency);
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
        splitBetween: entry.participantIds.map((user) => {
          const row = money.splitBetween.find((row) => row.user === user)!;
          return {
            user: row.user,
            ...(entry.splitMethod === 'exact' || entry.splitMethod === 'unequal'
              ? { amount: row.amount }
              : entry.splitMethod === 'percentage'
                ? { percentage: 'percentage' in row ? row.percentage : undefined }
                : entry.splitMethod === 'shares'
                  ? { shares: 'shares' in row ? row.shares : undefined }
                  : {}),
          };
        }),
      },
      financialEdit:
        purpose.kind === 'new' ||
        decideExpenseMoneyEdit(purpose.saved, {
          ...money,
          splitMethod: entry.splitMethod || 'equal',
        }).financialEdit,
    };
  } catch (cause) {
    const original = inAmountWords(cause, entry.currency);
    const fallback = allocationProblem(entry, original, payers);
    const payerError = entry.multiPayer ? Object.values(payerErrors)[0] : undefined;
    const splitError = Object.values(errors)[0];
    const problem = amount.error
      ? { field: 'amount' as const, message: amount.error }
      : fallback.field === 'payers'
        ? { ...fallback, message: payerError ?? fallback.message }
        : splitError
          ? { field: 'split' as const, message: splitError }
          : splitStatus.kind === 'problem'
            ? { field: 'split' as const, message: splitStatus.message }
            : fallback;
    // The client correction and the box use one sentence; money codes still identify the rule.
    const error =
      original instanceof MoneyValidationError
        ? new MoneyValidationError(original.code, problem.message, original.field)
        : original;
    result = { kind: 'refused' as const, error, problems: [problem] };
  }
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
  entry: IncompleteExpenseEntry,
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
function payerEntryError(amount: string, currency: string): string | undefined {
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
function enteredTotals(entry: IncompleteExpenseEntry) {
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
      ? sum(
          participantIds.map((id) => splitValues[id]),
          0,
        )
      : 0;
  const percentageTotal = splitMethod === 'percentage' ? percentageUnits / 100 : 0;
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

/**
 * Who paid, with several people: what the entries add up to and what is left of the Expense
 * total, in exact minor units. The shared money rules still decide whether an Expense can be
 * saved; this only explains the arithmetic while a member types.
 */

/** What one person typed as their part of the Expense. */
type PayerEntry = ExpenseEntry['payers'][number];

/** The entered Expense total, its currency and each person's entry, as typed. */
type PayerEntries = Pick<ExpenseEntry, 'amount' | 'currency' | 'payers'>;

/**
 * Why one person's entry can't count yet: it isn't an amount in the currency's precision, it
 * is below 0, or it is above the Expense limit. The app words each for its own screen.
 */
type PayerEntryProblem = 'invalid' | 'negative' | 'too-large';

/** "0", "0.00" or "-0": nothing, in any currency's precision. Unreadable text isn't 0. */
function isZero(amount: string) {
  try {
    return parseDecimalUnits(amount, 0) === 0;
  } catch {
    return false;
  }
}

/**
 * A blank entry, or one of 0, means that person paid nothing, so they aren't a payer (#187).
 * Their entry stays as typed, so "0" can still become "0.50".
 */
export const enteredPayers = (payers: PayerEntry[]) =>
  payers.filter((payer) => payer.amount.trim() && !isZero(payer.amount));

/** Why one person's entry can't count yet. Blank entries and 0 are simply empty. */
function payerEntryProblem(amount: string, currency: string): PayerEntryProblem | undefined {
  if (!amount.trim()) return undefined;
  let minor: number;
  try {
    minor = parseAmountMinor(amount, currency);
  } catch {
    return 'invalid';
  }
  if (minor < 0) return 'negative';
  if (minor > maxExpenseAmountMinor(currency)) return 'too-large';
  return undefined;
}

interface PayerRemainder {
  /** The Expense total, or null while the amount isn't valid. */
  totalMinor: number | null;
  /** What the countable entries add up to. */
  assignedMinor: number;
  /** Total minus assigned: negative when more than the total is entered. Null without a total. */
  remainingMinor: number | null;
  /** Entries that can't count yet, by person, with why. */
  problems: Record<string, PayerEntryProblem>;
}

function payerRemainder({ amount, currency, payers }: PayerEntries): PayerRemainder {
  let totalMinor: number | null = null;
  try {
    totalMinor = parseExpenseAmountMinor(amount, currency);
  } catch {
    // The Amount field explains this; there is nothing to divide yet.
  }
  const problems: Record<string, PayerEntryProblem> = {};
  let assignedMinor = 0;
  for (const payer of enteredPayers(payers)) {
    const problem = payerEntryProblem(payer.amount, currency);
    if (problem) problems[payer.user] = problem;
    else assignedMinor += parseAmountMinor(payer.amount, currency);
  }
  return {
    totalMinor,
    assignedMinor,
    remainingMinor: totalMinor === null ? null : totalMinor - assignedMinor,
    problems,
  };
}

/** One person's entry changed. Clearing it removes them from the payers. */
export function setPayerAmount(payers: PayerEntry[], user: string, amount: string): PayerEntry[] {
  if (!amount.trim()) return payers.filter((payer) => payer.user !== user);
  return payers.some((payer) => payer.user === user)
    ? payers.map((payer) => (payer.user === user ? { ...payer, amount } : payer))
    : [...payers, { user, amount }];
}

/** Minor units as the digits a member would type, e.g. 4950 INR as "49.50". */
export function minorAmountText(minor: number, currency: string) {
  const digits = getCurrencyPrecision(currency);
  const text = String(minor).padStart(digits + 1, '0');
  return digits ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
}

/**
 * Why one person's entry can't be used: Shares that aren't a whole number, more decimal places
 * than the currency (or 2 for a percentage) allows, a value beyond the exact range, a percentage
 * over 100 or an amount above the largest Expense amount, text that isn't a decimal number, or a
 * value below 0.
 */
type SplitEntryProblem = 'not-whole' | 'too-precise' | 'too-large' | 'invalid' | 'negative';

const entryDigits = (choice: SplitChoice, currency: string) =>
  choice === 'percentage' ? 2 : choice === 'shares' ? 0 : getCurrencyPrecision(currency);

/**
 * Why one person's entry can't be used. Nothing is rounded or corrected for the member. Only an
 * empty entry is blank: saving reads every other entry as typed, so one of only spaces, which an
 * earlier version could store, is checked like any other text.
 */
function splitEntryProblem(
  choice: SplitChoice,
  value: string,
  currency: string,
): SplitEntryProblem | undefined {
  if (choice === 'equal' || value === '') return undefined;
  const digits = entryDigits(choice, currency);
  let units: number;
  try {
    units = parseDecimalUnits(value, digits);
  } catch (error) {
    const code = error instanceof MoneyValidationError ? error.code : '';
    if (choice === 'shares') return 'not-whole';
    if (code === 'INVALID_MONEY_PRECISION') return 'too-precise';
    if (code === 'UNSAFE_MONEY') return 'too-large';
    return 'invalid';
  }
  if (units < 0) return 'negative';
  if (choice === 'percentage' && units > 10000) return 'too-large';
  // No one owes more than an Expense can be, so no sum of entries outgrows what exact money
  // can show (#187).
  if (choice === 'amounts' && units > maxExpenseAmountMinor(currency)) return 'too-large';
  return undefined;
}

/** The entered Expense as the split reads it: text as typed, with people by id. */
type SplitEntries = Pick<
  ExpenseEntry,
  'amount' | 'currency' | 'multiPayer' | 'splitMethod' | 'splitValues' | 'participantIds'
>;

/**
 * The whole Expense allocated by the shared exact-money rules, exactly as the app would save it:
 * Who paid as entered or, when `multiPayer` is false, by the one payer. Throws when the rules
 * refuse it.
 */
type SplitAllocator = (multiPayer: boolean) => SplitAllocation;

/**
 * Why the split can't be made yet: no one is included, one or several entries need
 * correcting, Shares gives no one a share, or the money rules failed without saying why.
 */
type SplitProblem =
  | 'no-participants'
  | 'marked-entry'
  | 'marked-entries'
  | 'no-shares'
  | 'unexplained';

type SplitStatus =
  /** The Expense amount isn't valid yet, so there is nothing to split. */
  | { kind: 'no-amount' }
  | { kind: 'adds-up'; leftover: SplitLeftover | null }
  /** Amounts in minor units, or Percentage in hundredths of a percent. */
  | { kind: 'remaining'; unit: 'amount' | 'percent'; entered: number; target: number }
  | { kind: 'problem'; reason: SplitProblem }
  /** The shared money rules refused the split; `message` is their own. */
  | { kind: 'problem'; reason: 'refused'; message: string };

interface SplitBreakdown {
  /** The Expense amount in minor units, or null while it isn't valid. */
  total: number | null;
  /** Each included person's resulting share in minor units, when it can be worked out. */
  shares: Partial<Record<string, number>>;
  /** Entries that need correcting, by person, with why. */
  problems: Partial<Record<string, SplitEntryProblem>>;
  status: SplitStatus;
}

/** The split alone: a payer problem belongs to Who paid, so it never hides the split's state. */
function splitAllocation({ multiPayer }: SplitEntries, allocate: SplitAllocator) {
  try {
    return allocate(multiPayer);
  } catch (error) {
    if (!multiPayer) throw error;
    return allocate(false);
  }
}

/**
 * Each person's share, any entry that needs correcting, and whether the split adds up. While
 * Amounts or Percentage don't add up yet, it reports how far off they are instead.
 */
function splitBreakdown(entries: SplitEntries, allocate: SplitAllocator): SplitBreakdown {
  const choice = splitChoiceOf(entries.splitMethod);
  const value = (id: string) => entries.splitValues[id] ?? '';
  const problems: SplitBreakdown['problems'] = {};
  for (const id of entries.participantIds) {
    const problem = splitEntryProblem(choice, value(id), entries.currency);
    if (problem) problems[id] = problem;
  }
  /** Readable entries in their units; a blank entry counts as 0. */
  const units = (id: string) =>
    problems[id]
      ? null
      : parseDecimalUnits(value(id) || '0', entryDigits(choice, entries.currency));
  const shares: SplitBreakdown['shares'] = {};
  if (choice === 'amounts')
    for (const id of entries.participantIds) shares[id] = units(id) ?? undefined;
  let total: number | null = null;
  const result = (status: SplitStatus): SplitBreakdown => ({ total, shares, problems, status });
  try {
    total = parseExpenseAmountMinor(entries.amount, entries.currency);
  } catch {
    return result({ kind: 'no-amount' });
  }
  if (!entries.participantIds.length) return result({ kind: 'problem', reason: 'no-participants' });
  try {
    const money = splitAllocation(entries, allocate);
    for (const row of money.splitBetween) shares[moneyParticipantId(row.user)] = row.amountMinor;
    return result({ kind: 'adds-up', leftover: splitLeftover(entries.splitMethod, money) });
  } catch (error) {
    const marked = Object.keys(problems).length;
    if (marked)
      return result({ kind: 'problem', reason: marked === 1 ? 'marked-entry' : 'marked-entries' });
    if (choice === 'percentage')
      for (const id of entries.participantIds)
        shares[id] = Number((BigInt(total) * BigInt(units(id)!)) / BigInt(10000));
    if (choice === 'amounts' || choice === 'percentage') {
      const entered = entries.participantIds.reduce((sum, id) => sum + units(id)!, 0);
      const target = choice === 'amounts' ? total : 10000;
      if (entered !== target)
        return result({
          kind: 'remaining',
          unit: choice === 'amounts' ? 'amount' : 'percent',
          entered,
          target,
        });
    }
    const code = error instanceof MoneyValidationError ? error.code : '';
    if (code === 'INVALID_SHARES' && choice === 'shares')
      return result({ kind: 'problem', reason: 'no-shares' });
    return result(
      error instanceof Error
        ? { kind: 'problem', reason: 'refused', message: error.message }
        : { kind: 'problem', reason: 'unexplained' },
    );
  }
}

/** Money is never merged automatically between two versions of an Expense (ADR 0004). */
export const expenseMoneyFields = ['amount', 'payers', 'split'] as const;
export type ExpenseMoneyField = (typeof expenseMoneyFields)[number];

/**
 * An edit's entries, with the money fields the saved Expense changed while it was open. Each
 * keeps the member's entry until they choose theirs or the saved one.
 */
export interface ExpenseReviewEntries extends ExpenseEntry {
  review?: ExpenseMoneyField[];
}

/** The fields compared between two versions of an Expense, in screen order. */
export const expenseVersionFields = [
  'amount',
  'description',
  'date',
  'payers',
  'split',
  'tag',
  'category',
  'notes',
] as const;
export type ExpenseVersionField = (typeof expenseVersionFields)[number];
const versionKeys: Record<ExpenseVersionField, (keyof ExpenseEntry)[]> = {
  amount: ['amount', 'currency'],
  description: ['description'],
  date: ['date'],
  payers: ['payerId', 'multiPayer', 'payers'],
  split: ['splitMethod', 'splitValues', 'participantIds'],
  tag: ['tagId'],
  category: ['category'],
  notes: ['notes'],
};
export const isMoneyField = (field: ExpenseVersionField): field is ExpenseMoneyField =>
  (expenseMoneyFields as readonly string[]).includes(field);

/** Each field as one comparable value: money by its exact units, not by how it was typed. */
function versionValues(entries: ExpenseEntry): Record<ExpenseVersionField, string> {
  const units = (value: string, digits?: number) => {
    try {
      return String(
        digits === undefined
          ? parseAmountMinor(value, entries.currency)
          : parseDecimalUnits(value, digits),
      );
    } catch {
      return JSON.stringify(value);
    }
  };
  const payers = entries.multiPayer
    ? entries.payers
    : [{ user: entries.payerId, amount: entries.amount }];
  const amounts = entries.splitMethod === 'unequal' || entries.splitMethod === 'exact';
  return {
    amount: `${entries.currency} ${units(entries.amount)}`,
    description: entries.description,
    date: entries.date,
    // One payer pays the whole amount, so only who paid can differ.
    payers: JSON.stringify(
      payers.length === 1
        ? [payers[0].user]
        : payers.map((row) => [row.user, units(row.amount)]).sort(),
    ),
    split: JSON.stringify([
      amounts ? 'amounts' : entries.splitMethod,
      [...entries.participantIds].sort().map((user) => {
        const value = entries.splitValues[user] || '0';
        return entries.splitMethod === 'equal'
          ? user
          : [
              user,
              units(value, amounts ? undefined : entries.splitMethod === 'percentage' ? 2 : 0),
            ];
      }),
    ]),
    tag: entries.tagId,
    category: entries.category,
    notes: entries.notes,
  };
}

/** The fields whose values differ between two versions of an Expense, in screen order. */
export function expenseDifferences(a: ExpenseEntry, b: ExpenseEntry): ExpenseVersionField[] {
  const [x, y] = [versionValues(a), versionValues(b)];
  return expenseVersionFields.filter((field) => x[field] !== y[field]);
}

const versionOf = (entries: ExpenseEntry, field: ExpenseVersionField) =>
  Object.fromEntries(versionKeys[field].map((key) => [key, entries[key]])) as Partial<ExpenseEntry>;

/**
 * "Keep my version for review": the edit's entries rebased from `start`, the saved Expense it
 * began from, onto `saved`, the latest one. The member's changes stay and every field they
 * didn't change takes the saved value. Money is never merged: a money field the saved Expense
 * changed keeps the member's entry and waits in `review` for their choice, and so does one
 * still waiting from an earlier review, while it differs from the saved value.
 */
export function rebaseExpenseEntries<T extends ExpenseReviewEntries>(
  draft: T,
  start: ExpenseEntry,
  saved: ExpenseEntry,
): T {
  const mine = expenseDifferences(draft, start);
  const theirs = expenseDifferences(start, saved);
  const different = expenseDifferences(draft, saved);
  const rebased: T = { ...draft };
  for (const field of expenseVersionFields)
    if (!isMoneyField(field) && !mine.includes(field))
      Object.assign(rebased, versionOf(saved, field));
  const review = expenseMoneyFields.filter(
    (field) =>
      (theirs.includes(field) || !!draft.review?.includes(field)) && different.includes(field),
  );
  return { ...rebased, review: review.length ? review : undefined };
}

/**
 * The member's choice for a money field under review: their entry, or the value from `saved`,
 * the latest saved Expense. Returns only the entries that change.
 */
export function resolveExpenseReview(
  draft: ExpenseReviewEntries,
  field: ExpenseMoneyField,
  keep: 'mine' | 'saved',
  saved: ExpenseEntry | null,
): Partial<ExpenseReviewEntries> {
  const review = draft.review?.filter((item) => item !== field) ?? [];
  return {
    ...(keep === 'saved' && saved ? versionOf(saved, field) : {}),
    review: review.length ? review : undefined,
  };
}
