import type { ExpenseDraftValues } from '@splitbook/shared/validators/expense-draft';
import { entryForExpenseDraft, draftForExpenseEntry } from '@splitbook/shared/expense-entry-draft';
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
): ExpenseDraftValues {
  // The sheet displays Equal for an omitted method. Editing that displayed split is a
  // member's choice; the conversion itself must never guess a missing Draft fact.
  if (!values.splitMethod && !patch.splitMethod && (patch.participantIds || patch.splitValues))
    patch = { ...patch, splitMethod: 'equal' };
  const entry = { ...entryForExpenseDraft(values), ...patch };
  return draftForExpenseEntry(entry, {
    from: values,
    changed: Object.fromEntries(Object.keys(patch).map((key) => [key, true])),
  });
}
