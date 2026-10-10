import { getCurrencyPrecision } from './currency';
import {
  maxExpenseAmountMinor,
  MoneyValidationError,
  moneyParticipantId,
  parseAmountMinor,
  parseDecimalUnits,
  parseExpenseAmountMinor,
} from './exact-money';
import type { ExpenseEntries } from './expense-review';
import type { ExpenseSplitMethod } from './split-calculation';

/**
 * How an Expense is split, as a member chooses it (#123): Equal, Amounts, Percentage or Shares,
 * each person's resulting share, entries that need correcting, and whether the split adds up.
 * The shared exact-money rules decide every allocation; this only explains them. The app words
 * each reason for its own screen.
 */
export type SplitChoice = 'equal' | 'amounts' | 'percentage' | 'shares';

/** "Amounts" covers both stored methods that calculate identically: `unequal` and `exact`. */
export function splitChoiceOf(method: ExpenseSplitMethod): SplitChoice {
  return method === 'unequal' || method === 'exact' ? 'amounts' : method;
}

/**
 * The stored method for a choice, from the entry's current method and, when editing, the saved
 * Expense's. New Expenses send Amounts as `unequal`, like the web form; an `exact` Expense keeps
 * `exact` while Amounts is its method. Choosing the current method changes nothing, so its
 * values are kept.
 */
export function splitMethodFor(
  choice: SplitChoice,
  method: ExpenseSplitMethod,
  savedMethod?: ExpenseSplitMethod,
): ExpenseSplitMethod {
  if (splitChoiceOf(method) === choice) return method;
  if (choice !== 'amounts') return choice;
  return savedMethod === 'exact' ? 'exact' : 'unequal';
}

/** An Expense's split rows as the shared money rules allocate them, in exact minor units. */
export interface SplitAllocation {
  amountMinor: number;
  splitBetween: { user: unknown; amountMinor: number; percentage?: number; shares?: number }[];
}

export interface SplitLeftover {
  amountMinor: number;
  /** Everyone given a smallest unit beyond their exact share, in split order. */
  users: string[];
}

/**
 * Who got the leftover when Equal, Percentage or Shares don't divide the total exactly. Null
 * when nothing was rounded; Amounts never are.
 */
export function splitLeftover(
  method: ExpenseSplitMethod,
  allocation: SplitAllocation,
): SplitLeftover | null {
  if (method === 'unequal' || method === 'exact') return null;
  const rows = allocation.splitBetween;
  try {
    const weights = rows.map((row) =>
      BigInt(
        method === 'equal'
          ? 1
          : method === 'percentage'
            ? parseDecimalUnits(row.percentage ?? 0, 2)
            : (row.shares ?? 0),
      ),
    );
    const total = weights.reduce((sum, weight) => sum + weight, BigInt(0));
    if (total <= BigInt(0)) return null;
    const leftover: SplitLeftover = { amountMinor: 0, users: [] };
    rows.forEach((row, index) => {
      const exact = Number((BigInt(allocation.amountMinor) * weights[index]) / total);
      if (row.amountMinor <= exact) return;
      leftover.amountMinor += row.amountMinor - exact;
      leftover.users.push(moneyParticipantId(row.user));
    });
    return leftover.users.length ? leftover : null;
  } catch {
    // Historical weights that can't be read: there is nothing reliable to explain.
    return null;
  }
}

/**
 * Why one person's entry can't be used: Shares that aren't a whole number, more decimal places
 * than the currency (or 2 for a percentage) allows, a value beyond the exact range, a percentage
 * over 100 or an amount above the largest Expense amount, text that isn't a decimal number, or a
 * value below 0.
 */
export type SplitEntryProblem = 'not-whole' | 'too-precise' | 'too-large' | 'invalid' | 'negative';

const entryDigits = (choice: SplitChoice, currency: string) =>
  choice === 'percentage' ? 2 : choice === 'shares' ? 0 : getCurrencyPrecision(currency);

/**
 * Why one person's entry can't be used. Nothing is rounded or corrected for the member. Only an
 * empty entry is blank: saving reads every other entry as typed, so one of only spaces, which an
 * earlier version could store, is checked like any other text.
 */
export function splitEntryProblem(
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
export type SplitEntries = Pick<
  ExpenseEntries,
  'amount' | 'currency' | 'multiPayer' | 'splitMethod' | 'splitValues' | 'participantIds'
>;

/**
 * The whole Expense allocated by the shared exact-money rules, exactly as the app would save it:
 * Who paid as entered or, when `multiPayer` is false, by the one payer. Throws when the rules
 * refuse it.
 */
export type SplitAllocator = (multiPayer: boolean) => SplitAllocation;

/**
 * Why the split can't be made yet: no one is included, one or several entries need
 * correcting, Shares gives no one a share, or the money rules failed without saying why.
 */
export type SplitProblem =
  | 'no-participants'
  | 'marked-entry'
  | 'marked-entries'
  | 'no-shares'
  | 'unexplained';

export type SplitStatus =
  /** The Expense amount isn't valid yet, so there is nothing to split. */
  | { kind: 'no-amount' }
  | { kind: 'adds-up'; leftover: SplitLeftover | null }
  /** Amounts in minor units, or Percentage in hundredths of a percent. */
  | { kind: 'remaining'; unit: 'amount' | 'percent'; entered: number; target: number }
  | { kind: 'problem'; reason: SplitProblem }
  /** The shared money rules refused the split; `message` is their own. */
  | { kind: 'problem'; reason: 'refused'; message: string };

export interface SplitBreakdown {
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
export function splitBreakdown(entries: SplitEntries, allocate: SplitAllocator): SplitBreakdown {
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
