import { parseAmountMinor, parseDecimalUnits } from './exact-money';
import type { ExpenseSplitMethod } from './split-calculation';

/**
 * One version of an Expense as an edit form holds it: the entered text, with members by id.
 * A conflicting edit is compared and reviewed against the latest saved Expense through these.
 */
export interface ExpenseEntries {
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

/** Money is never merged automatically between two versions of an Expense (ADR 0004). */
export const expenseMoneyFields = ['amount', 'payers', 'split'] as const;
export type ExpenseMoneyField = (typeof expenseMoneyFields)[number];

/**
 * An edit's entries, with the money fields the saved Expense changed while it was open. Each
 * keeps the member's entry until they choose theirs or the saved one.
 */
export interface ExpenseReviewEntries extends ExpenseEntries {
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
const versionKeys: Record<ExpenseVersionField, (keyof ExpenseEntries)[]> = {
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
function versionValues(entries: ExpenseEntries): Record<ExpenseVersionField, string> {
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
export function expenseDifferences(a: ExpenseEntries, b: ExpenseEntries): ExpenseVersionField[] {
  const [x, y] = [versionValues(a), versionValues(b)];
  return expenseVersionFields.filter((field) => x[field] !== y[field]);
}

const versionOf = (entries: ExpenseEntries, field: ExpenseVersionField) =>
  Object.fromEntries(
    versionKeys[field].map((key) => [key, entries[key]]),
  ) as Partial<ExpenseEntries>;

/**
 * "Keep my version for review": the edit's entries rebased from `start`, the saved Expense it
 * began from, onto `saved`, the latest one. The member's changes stay and every field they
 * didn't change takes the saved value. Money is never merged: a money field the saved Expense
 * changed keeps the member's entry and waits in `review` for their choice, and so does one
 * still waiting from an earlier review, while it differs from the saved value.
 */
export function rebaseExpenseEntries<T extends ExpenseReviewEntries>(
  draft: T,
  start: ExpenseEntries,
  saved: ExpenseEntries,
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
  saved: ExpenseEntries | null,
): Partial<ExpenseReviewEntries> {
  const review = draft.review?.filter((item) => item !== field) ?? [];
  return {
    ...(keep === 'saved' && saved ? versionOf(saved, field) : {}),
    review: review.length ? review : undefined,
  };
}
