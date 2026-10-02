import { getCurrencyPrecision } from '@splitbook/shared/currency';
import {
  MoneyValidationError,
  moneyParticipantId,
  parseDecimalUnits,
  parseExpenseAmountMinor,
} from '@splitbook/shared/exact-money';
import { expenseMoney, type ExpenseDraft } from './expense-draft';
import { amountExample } from './field-feedback';

/**
 * The Split sheet's view of a draft (#123). Pure: no React, storage or requests. The shared
 * exact-money rules decide every allocation; this module only explains them.
 */
export type SplitChoice = 'equal' | 'amounts' | 'percentage' | 'shares';
type SplitMethod = ExpenseDraft['splitMethod'];

/** "Amounts" covers both stored methods that calculate identically: `unequal` and `exact`. */
export function splitChoiceOf(method: SplitMethod): SplitChoice {
  return method === 'unequal' || method === 'exact' ? 'amounts' : method;
}

/**
 * The stored method for a choice. New Expenses send Amounts as `unequal`, like the web form;
 * an `exact` Expense keeps `exact` while Amounts is its method. Choosing the current method
 * changes nothing, so its values are kept.
 */
export function splitMethodFor(
  choice: SplitChoice,
  draft: Pick<ExpenseDraft, 'splitMethod' | 'original'>,
): SplitMethod {
  if (splitChoiceOf(draft.splitMethod) === choice) return draft.splitMethod;
  if (choice !== 'amounts') return choice;
  return draft.original?.splitMethod === 'exact' ? 'exact' : 'unequal';
}

interface Allocation {
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
export function splitLeftover(method: SplitMethod, allocation: Allocation): SplitLeftover | null {
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

export type SplitStatus =
  /** The Expense amount isn't valid yet, so there is nothing to split. */
  | { kind: 'no-amount' }
  | { kind: 'adds-up'; leftover: SplitLeftover | null }
  /** Amounts in minor units, or Percentage in hundredths of a percent. */
  | { kind: 'remaining'; unit: 'amount' | 'percent'; entered: number; target: number }
  | { kind: 'problem'; message: string };

export interface SplitPreview {
  /** The Expense amount in minor units, or null while it isn't valid. */
  total: number | null;
  /** Each included person's resulting share in minor units, when it can be worked out. */
  shares: Partial<Record<string, number>>;
  /** Corrections for individual entries, by person. */
  errors: Partial<Record<string, string>>;
  status: SplitStatus;
}

const entryDigits = (choice: SplitChoice, currency: string) =>
  choice === 'percentage' ? 2 : choice === 'shares' ? 0 : getCurrencyPrecision(currency);

/** Why one person's entry can't be used. Nothing is rounded or corrected for the member. */
function entryError(choice: SplitChoice, value: string, currency: string) {
  if (choice === 'equal' || !value.trim()) return undefined;
  const digits = entryDigits(choice, currency);
  let units: number;
  try {
    units = parseDecimalUnits(value, digits);
  } catch (error) {
    const code = error instanceof MoneyValidationError ? error.code : '';
    if (choice === 'shares') return 'Use a whole number of shares.';
    if (code === 'INVALID_MONEY_PRECISION')
      return choice === 'percentage'
        ? 'Percentages can have at most 2 decimal places. Nothing is rounded for you.'
        : `${currency} amounts ${
            digits
              ? `can have at most ${digits} decimal ${digits === 1 ? 'place' : 'places'}`
              : 'can’t include decimal places'
          }. Nothing is rounded for you.`;
    if (code === 'UNSAFE_MONEY')
      return choice === 'percentage'
        ? 'A percentage can be at most 100.'
        : 'That’s more than the Expense total.';
    return choice === 'percentage'
      ? 'Use digits and one decimal point, such as 33.5.'
      : digits
        ? `Use digits and one decimal point, such as ${amountExample(currency)}.`
        : `Use digits only, such as ${amountExample(currency)}.`;
  }
  if (units < 0)
    return choice === 'shares'
      ? 'Shares can’t be negative.'
      : choice === 'percentage'
        ? 'Percentages can’t be negative.'
        : 'Amounts can’t be negative.';
  if (choice === 'percentage' && units > 10000) return 'A percentage can be at most 100.';
  return undefined;
}

/** The split alone: a payer problem belongs to Who paid, so it never hides the split's state. */
function splitMoney(draft: ExpenseDraft) {
  try {
    return expenseMoney(draft);
  } catch (error) {
    if (!draft.multiPayer) throw error;
    return expenseMoney({ ...draft, multiPayer: false });
  }
}

/**
 * Each person's share, any entry that needs correcting, and whether the split adds up. While
 * Amounts or Percentage don't add up yet, it reports how far off they are instead.
 */
export function previewSplit(draft: ExpenseDraft): SplitPreview {
  const choice = splitChoiceOf(draft.splitMethod);
  const value = (id: string) => draft.splitValues[id] ?? '';
  const errors: SplitPreview['errors'] = {};
  for (const id of draft.participantIds) {
    const error = entryError(choice, value(id), draft.currency);
    if (error) errors[id] = error;
  }
  /** Readable entries in their units; a blank entry counts as 0. */
  const units = (id: string) =>
    errors[id] ? null : parseDecimalUnits(value(id) || '0', entryDigits(choice, draft.currency));
  const shares: SplitPreview['shares'] = {};
  if (choice === 'amounts')
    for (const id of draft.participantIds) shares[id] = units(id) ?? undefined;
  let total: number | null = null;
  const result = (status: SplitStatus): SplitPreview => ({ total, shares, errors, status });
  try {
    total = parseExpenseAmountMinor(draft.amount, draft.currency);
  } catch {
    return result({ kind: 'no-amount' });
  }
  if (!draft.participantIds.length)
    return result({
      kind: 'problem',
      message: 'Choose at least one person to share this Expense.',
    });
  try {
    const money = splitMoney(draft);
    for (const row of money.splitBetween) shares[moneyParticipantId(row.user)] = row.amountMinor;
    return result({ kind: 'adds-up', leftover: splitLeftover(draft.splitMethod, money) });
  } catch (error) {
    const marked = Object.keys(errors).length;
    if (marked)
      return result({
        kind: 'problem',
        message:
          marked === 1 ? 'Correct the entry marked above.' : 'Correct the entries marked above.',
      });
    if (choice === 'percentage')
      for (const id of draft.participantIds)
        shares[id] = Number((BigInt(total) * BigInt(units(id)!)) / BigInt(10000));
    if (choice === 'amounts' || choice === 'percentage') {
      const entered = draft.participantIds.reduce((sum, id) => sum + units(id)!, 0);
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
    return result({
      kind: 'problem',
      message:
        code === 'INVALID_SHARES' && choice === 'shares'
          ? 'Give at least one person a share.'
          : error instanceof Error
            ? error.message
            : 'Review how this Expense is split.',
    });
  }
}
