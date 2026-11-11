import type { ExpenseDraftValues } from '@splitbook/shared/validators/expense-draft';
import { entryForExpenseDraft, draftForExpenseEntry } from '@splitbook/shared/expense-entry-draft';
import { expenseEntryPolicy } from '@splitbook/shared/expense-entry';
import type { ExpenseDraft } from './expense-draft';

/** Picker defaults are shown, but only a choice the member changes becomes a Draft fact. */
export function reviewForm(values: ExpenseDraftValues, currency: string): ExpenseDraft {
  const entry = entryForExpenseDraft(values);
  return {
    ...entry,
    currency: entry.currency || currency,
    category: entry.category || 'other',
    splitMethod: entry.splitMethod || 'equal',
  };
}
export function reviewFormChange(
  values: ExpenseDraftValues,
  patch: Partial<ExpenseDraft>,
  _currency: string,
): ExpenseDraftValues {
  const entry = { ...entryForExpenseDraft(values), ...patch };
  return draftForExpenseEntry(entry, expenseEntryPolicy, {
    from: values,
    changed: Object.fromEntries(Object.keys(patch).map((key) => [key, true])),
  });
}
