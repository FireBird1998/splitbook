import type { ExpenseEntry } from './expense-entry';
import { expenseEntryPolicy, type ExpenseEntryPolicy } from './expense-entry';
import { draftValues, type DraftEntries } from './persistent-draft-editor';
import type { ExpenseDraftValues } from './validators/expense-draft';

/** An incomplete Draft is kept as typed text; no amount is filled in for the member. */
export function entryForExpenseDraft(values: ExpenseDraftValues = {}): ExpenseEntry {
  const part =
    values.splitMethod === 'percentage'
      ? 'percentage'
      : values.splitMethod === 'shares'
        ? 'shares'
        : 'amount';
  return {
    description: values.description ?? '',
    amount: values.amount === undefined ? '' : String(values.amount),
    currency: values.currency ?? '',
    date: values.date ?? '',
    category: values.category ?? '',
    tagId: values.tagId ?? '',
    notes: values.notes ?? '',
    payerId: values.paidBy?.[0]?.user ?? '',
    multiPayer: (values.paidBy?.length ?? 0) > 1,
    payers:
      values.paidBy?.map((row) => ({
        user: row.user,
        amount: row.amount === undefined ? '' : String(row.amount),
      })) ?? [],
    splitMethod: values.splitMethod ?? 'equal',
    participantIds: values.splitBetween?.map((row) => row.user) ?? [],
    splitValues: Object.fromEntries(
      (values.splitBetween ?? []).map((row) => [
        row.user,
        row[part] === undefined ? '' : String(row[part]),
      ]),
    ),
  };
}

/** Finish later keeps zero rows and omits boxes left blank; it never completes an Expense. */
export function draftForExpenseEntry(
  entry: ExpenseEntry,
  policy: ExpenseEntryPolicy = expenseEntryPolicy,
): ExpenseDraftValues {
  const fields: DraftEntries = {
    description: entry.description,
    amount: entry.amount,
    currency: entry.currency,
    date: entry.date,
    category: entry.category,
    notes: entry.notes,
    splitMethod: entry.splitMethod,
    ...(/^[a-f0-9]{24}$/i.test(entry.tagId) ? { tagId: entry.tagId } : { tag: entry.tagId }),
  };
  const payers =
    entry.multiPayer || policy.singlePayer === 'first-row'
      ? entry.payers
      : [{ user: entry.payerId, amount: entry.amount }];
  for (const payer of payers) {
    fields[`paidBy.${payer.user}`] = 'yes';
    fields[`paidBy.${payer.user}.amount`] = entry.multiPayer ? payer.amount : entry.amount;
  }
  const part =
    entry.splitMethod === 'percentage'
      ? 'percentage'
      : entry.splitMethod === 'shares'
        ? 'shares'
        : 'amount';
  for (const id of entry.participantIds) {
    fields[`splitBetween.${id}`] = 'yes';
    if (entry.splitMethod !== 'equal')
      fields[`splitBetween.${id}.${part}`] = entry.splitValues[id] ?? '';
  }
  return draftValues(fields);
}
