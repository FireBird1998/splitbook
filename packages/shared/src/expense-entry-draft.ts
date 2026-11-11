import type { IncompleteExpenseEntry } from './expense-entry';
import { expenseEntryPolicy, type ExpenseEntryPolicy } from './expense-entry';
import { draftEntries, draftValues, type DraftEntries } from './persistent-draft-editor';
import type { ExpenseDraftValues } from './validators/expense-draft';

/** An incomplete Draft is kept as typed text; no amount is filled in for the member. */
export function entryForExpenseDraft(values: ExpenseDraftValues = {}): IncompleteExpenseEntry {
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
    splitMethod: values.splitMethod ?? '',
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
  entry: IncompleteExpenseEntry,
  policy: ExpenseEntryPolicy = expenseEntryPolicy,
  update?: {
    from: ExpenseDraftValues;
    changed: Partial<Record<keyof IncompleteExpenseEntry, boolean>>;
  },
): ExpenseDraftValues {
  const fields: DraftEntries = update ? draftEntries(update.from) : {};
  for (const key of ['description', 'amount', 'currency', 'date', 'category', 'notes'] as const)
    if (!update || update.changed[key]) fields[key] = entry[key];
  if (!update) {
    Object.assign(
      fields,
      /^[a-f0-9]{24}$/i.test(entry.tagId) ? { tagId: entry.tagId } : { tag: entry.tagId },
    );
    fields.splitMethod = entry.splitMethod;
  } else if (update.changed.tagId) {
    delete fields.tag;
    fields.tagId = entry.tagId;
  }
  const changed = update?.changed;
  if (
    !update ||
    changed?.payerId ||
    changed?.payers ||
    changed?.multiPayer ||
    (changed?.amount &&
      update.from.paidBy?.length === 1 &&
      (policy.singlePayer === 'field' || !entry.multiPayer))
  ) {
    for (const key of Object.keys(fields)) if (key.startsWith('paidBy.')) delete fields[key];
    const payers =
      entry.multiPayer || policy.singlePayer === 'first-row'
        ? entry.payers
        : [{ user: entry.payerId, amount: entry.amount }];
    for (const payer of payers) {
      if (update && !payer.user) continue;
      fields[`paidBy.${payer.user}`] = 'yes';
      fields[`paidBy.${payer.user}.amount`] = entry.multiPayer ? payer.amount : entry.amount;
    }
  }
  if (!update || changed?.splitMethod || changed?.participantIds || changed?.splitValues) {
    for (const key of Object.keys(fields)) if (key.startsWith('splitBetween.')) delete fields[key];
    fields.splitMethod = entry.splitMethod;
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
  }
  return draftValues(fields);
}
