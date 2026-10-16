import type { ExpenseDraftValues } from '@splitbook/shared/validators/expense-draft';
import { draftEntries, draftValues } from '@splitbook/shared/persistent-draft-editor';
import type { ExpenseDraft } from './expense-draft';

/** Picker projection only: empty facts stay omitted when an unrelated tile changes. */
export function reviewForm(values: ExpenseDraftValues, currency: string): ExpenseDraft {
  const entries = draftEntries(values);
  const part =
    values.splitMethod === 'percentage'
      ? 'percentage'
      : values.splitMethod === 'shares'
        ? 'shares'
        : 'amount';
  return {
    amount: entries.amount ?? '',
    currency: values.currency ?? currency,
    description: values.description ?? '',
    date: values.date ?? '',
    // Shown as Other, which saving applies, but stored only once the member chooses.
    category: values.category ?? 'other',
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
export function reviewFormChange(
  values: ExpenseDraftValues,
  patch: Partial<ExpenseDraft>,
  currency: string,
): ExpenseDraftValues {
  const form = { ...reviewForm(values, currency), ...patch };
  const entries = draftEntries(values);
  for (const key of [
    'amount',
    'currency',
    'description',
    'date',
    'category',
    'tagId',
    'notes',
  ] as const) {
    if (patch[key] !== undefined) entries[key] = form[key];
  }
  if (patch.tagId !== undefined) delete entries.tag;
  if (
    ['payerId', 'multiPayer', 'payers'].some((key) => key in patch) ||
    ('amount' in patch && values.paidBy?.length === 1)
  ) {
    for (const key of Object.keys(entries)) if (key.startsWith('paidBy.')) delete entries[key];
    for (const row of form.multiPayer
      ? form.payers
      : form.payerId
        ? [{ user: form.payerId, amount: form.amount }]
        : []) {
      entries[`paidBy.${row.user}`] = 'yes';
      entries[`paidBy.${row.user}.amount`] = row.amount;
    }
  }
  if (['splitMethod', 'participantIds', 'splitValues'].some((key) => key in patch)) {
    for (const key of Object.keys(entries))
      if (key.startsWith('splitBetween.')) delete entries[key];
    entries.splitMethod = form.splitMethod;
    const part =
      form.splitMethod === 'percentage'
        ? 'percentage'
        : form.splitMethod === 'shares'
          ? 'shares'
          : 'amount';
    for (const id of form.participantIds) {
      entries[`splitBetween.${id}`] = 'yes';
      if (form.splitMethod !== 'equal')
        entries[`splitBetween.${id}.${part}`] = form.splitValues[id] ?? '';
    }
  }
  return draftValues(entries);
}
