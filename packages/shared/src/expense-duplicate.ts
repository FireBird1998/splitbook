import type { ExpenseDraftValues } from './validators/expense-draft';

/** Existing review rule: normalized description, exact amount/currency and UTC date. */
export function isPossibleExpenseDuplicate(
  values: ExpenseDraftValues,
  candidate: Pick<ExpenseDraftValues, 'description' | 'amount' | 'currency' | 'date'>,
): boolean {
  if (!values.description || !values.amount || !values.date || !values.currency) return false;
  return (
    candidate.description?.trim().toLowerCase() === values.description.trim().toLowerCase() &&
    candidate.amount === values.amount &&
    candidate.currency === values.currency &&
    candidate.date?.slice(0, 10) === values.date.slice(0, 10)
  );
}
